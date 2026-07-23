/**
 * 토스 로그인 인증 라우터
 *
 * POST /auth/login   — authorizationCode → 우리 JWT 발급
 * GET  /auth/me      — 현재 로그인 유저 정보
 * POST /auth/logout  — 토스 연결 해제 + 토큰 삭제
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db';
import { config } from '../config';
import { requireAuth } from '../middleware/requireAuth';
import {
  generateTossToken,
  getTossUser,
  revokeTossToken,
} from '../lib/tossAuth';
import { reconcileLogin } from '../services/authReconcile';

const router = Router();

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

// userKey=null·anon=true → 익명 세션 토큰. 환전 등 linked 필수 경로에서 게이트된다.
function signJwt(userId: string, userKey: number | null, anon: boolean): string {
  return jwt.sign(
    { userId, userKey, anon },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn } as jwt.SignOptions
  );
}

// ─── POST /auth/anonymous ─────────────────────────────────────────────────────

/**
 * 익명 세션 시작 — 로그인 없이 카드 구경·열기·티켓 적립을 할 수 있게 익명 users 행 + JWT 발급.
 * 같은 anonymous_id는 항상 같은 행(취향 로깅과 신원 공유). 첫 환전에서 토스 로그인 시 화해된다.
 */
router.post('/anonymous', async (req, res) => {
  const anonymousId = typeof req.body?.anonymousId === 'string' ? req.body.anonymousId.trim() : '';
  if (!anonymousId) {
    res.status(400).json({ error: 'BadRequest', message: 'anonymousId가 필요해요.' });
    return;
  }
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (anonymous_id)
       VALUES ($1)
       ON CONFLICT (anonymous_id) DO UPDATE SET anonymous_id = EXCLUDED.anonymous_id
       RETURNING id`,
      [anonymousId]
    );
    const userId = rows[0].id;
    // 항상 익명 토큰(userKey=null). 이 행이 이전에 promote돼 toss_user_key가 있더라도 익명으로 다뤄
    // 환전 시 재로그인을 강제한다(bearer 보안 모델 유지).
    const token = signJwt(userId, null, true);
    res.json({ token, user: { id: userId, userKey: null, name: null, anonymous: true } });
  } catch (err) {
    console.error('[auth/anonymous]', err);
    res.status(500).json({ error: 'AnonymousFailed', message: '세션을 시작하지 못했어요.' });
  }
});

// ─── GET /auth/session ────────────────────────────────────────────────────────

/**
 * 현재 세션 유효성 + 유형 확인(익명·linked 공통). /auth/me와 달리 toss_access_token을 요구하지 않아
 * 익명 세션 복원에도 쓸 수 있다.
 */
router.get('/session', requireAuth, (req, res) => {
  res.json({
    id: req.user!.userId,
    userKey: req.user!.userKey ?? null,
    anonymous: req.user!.userKey == null,
  });
});


// ─── POST /auth/login ───────────────────────────────────────────────────────

/**
 * 토스 로그인 완료 후 클라이언트가 호출하는 엔드포인트
 *
 * body: { authorizationCode: string, referrer: string }
 * response: { token: string, user: { id, userKey } }
 */
router.post('/login', async (req, res) => {
  const { authorizationCode, referrer, anonymousId } = req.body as {
    authorizationCode?: string;
    referrer?: string;
    anonymousId?: string;
  };

  if (!authorizationCode || !referrer) {
    res.status(400).json({ error: 'BadRequest', message: 'authorizationCode와 referrer가 필요해요.' });
    return;
  }

  try {
    // 1. Toss 서버에서 토큰 교환
    const tokens = await generateTossToken(authorizationCode, referrer);

    // 2. 사용자 정보 조회
    const tossUser = await getTossUser(tokens.accessToken);
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    // 3. 익명 세션 화해(promote/merge)를 단일 트랜잭션에서 처리 → 최종 users.id 결정
    const client = await pool.connect();
    let userId: string;
    try {
      await client.query('BEGIN');
      userId = await reconcileLogin(client, {
        tossUserKey: tossUser.userKey,
        name: tossUser.name ?? null,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt,
        anonymousId: typeof anonymousId === 'string' && anonymousId.trim() ? anonymousId.trim() : null,
      });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // 4. 우리 앱 JWT 발급 (Toss 토큰은 절대 클라이언트에 내려보내지 않음)
    const token = signJwt(userId, tossUser.userKey, false);

    res.json({
      token,
      user: { id: userId, userKey: tossUser.userKey, name: tossUser.name ?? null },
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'LoginFailed', message: '로그인에 실패했어요. 다시 시도해 주세요.' });
  }
});

// ─── GET /auth/me ───────────────────────────────────────────────────────────

/**
 * 현재 로그인 유저 프로필 조회
 * DB에서 바로 반환 (Toss login-me API 호출 안 함 — 호출 빈도 절감)
 * 토큰 유효성은 우리 JWT로 확인하고, unlink 감지는 콜백(POST /auth/callback/unlink)으로 처리
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query<{ name: string | null; toss_access_token: string | null }>(
      'SELECT name, toss_access_token FROM users WHERE id = $1',
      [req.user!.userId]
    );

    if (!rows[0] || !rows[0].toss_access_token) {
      // 토큰 없음 = unlink됐거나 로그아웃된 상태
      res.status(401).json({ error: 'TokenNotFound', message: '다시 로그인해 주세요.' });
      return;
    }

    res.json({
      id: req.user!.userId,
      userKey: req.user!.userKey,
      name: rows[0].name ?? null,
    });
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'FetchFailed', message: '사용자 정보를 가져오지 못했어요.' });
  }
});

// ─── POST /auth/logout ──────────────────────────────────────────────────────

/**
 * 로그아웃: Toss 연결 해제 + DB에서 토큰 삭제
 */
router.post('/logout', requireAuth, async (req, res) => {
  const userId = req.user!.userId;

  try {
    const { rows } = await pool.query<{ toss_access_token: string }>(
      'SELECT toss_access_token FROM users WHERE id = $1',
      [userId]
    );

    if (rows[0]?.toss_access_token) {
      await revokeTossToken(rows[0].toss_access_token).catch((e) =>
        console.warn('[auth/logout] revoke 실패 (무시):', e.message)
      );
    }

    // DB 토큰 삭제 (유저 레코드는 유지)
    await pool.query(
      `UPDATE users
       SET toss_access_token = NULL, toss_refresh_token = NULL, token_expires_at = NULL
       WHERE id = $1`,
      [userId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[auth/logout]', err);
    res.status(500).json({ error: 'LogoutFailed', message: '로그아웃 처리 중 오류가 발생했어요.' });
  }
});

// ─── POST /auth/callback/unlink ─────────────────────────────────────────────

/**
 * 토스 앱에서 연결 끊기 시 토스 서버가 호출하는 콜백
 *
 * 인증: Basic Auth (TOSS_CALLBACK_SECRET)
 *   - Authorization: Basic base64(callbackSecret)
 *
 * body: { userKey: number, referrer: 'UNLINK' | 'WITHDRAWAL_TERMS' | 'WITHDRAWAL_TOSS' }
 *
 * referrer 의미:
 *   UNLINK           — 앱 연결끊기
 *   WITHDRAWAL_TERMS — 서비스 약관 탈퇴
 *   WITHDRAWAL_TOSS  — 토스 탈퇴
 */
router.post('/callback/unlink', (req, res) => {
  // Basic Auth 검증
  const authHeader = req.headers.authorization ?? '';
  const expectedCreds = Buffer.from(config.toss.callbackSecret).toString('base64');
  if (!config.toss.callbackSecret || authHeader !== `Basic ${expectedCreds}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { userKey, referrer } = req.body as { userKey?: number; referrer?: string };
  if (!userKey) {
    res.status(400).json({ error: 'BadRequest', message: 'userKey가 필요해요.' });
    return;
  }

  // 비동기로 처리 (토스 서버에는 즉시 200 응답)
  pool.query(
    `UPDATE users
     SET toss_access_token = NULL, toss_refresh_token = NULL, token_expires_at = NULL
     WHERE toss_user_key = $1`,
    [userKey]
  ).catch((err) => console.error('[auth/callback/unlink] DB 오류:', err));

  console.log(`[auth/callback/unlink] userKey=${userKey} referrer=${referrer}`);
  res.json({ ok: true });
});

export default router;
