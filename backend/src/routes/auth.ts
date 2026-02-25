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
  refreshTossToken,
  getTossUser,
  revokeTossToken,
} from '../lib/tossAuth';

const router = Router();

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

function signJwt(userId: string, userKey: number): string {
  return jwt.sign(
    { userId, userKey },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn } as jwt.SignOptions
  );
}

/**
 * DB에서 유저의 Toss access token을 가져오되,
 * 만료 임박(5분 이내)이면 자동으로 refresh해요.
 */
async function getFreshAccessToken(userId: string): Promise<string> {
  const { rows } = await pool.query<{
    toss_access_token: string;
    toss_refresh_token: string;
    token_expires_at: Date;
  }>(
    'SELECT toss_access_token, toss_refresh_token, token_expires_at FROM users WHERE id = $1',
    [userId]
  );

  const user = rows[0];
  if (!user?.toss_access_token) throw new Error('토큰 정보가 없어요. 다시 로그인해 주세요.');

  const expiresAt = new Date(user.token_expires_at).getTime();
  const isExpiringSoon = expiresAt - Date.now() < 5 * 60 * 1000; // 5분 이내

  if (!isExpiringSoon) return user.toss_access_token;

  // Toss access token 재발급
  const refreshed = await refreshTossToken(user.toss_refresh_token);
  const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);

  await pool.query(
    'UPDATE users SET toss_access_token = $1, token_expires_at = $2 WHERE id = $3',
    [refreshed.accessToken, newExpiresAt, userId]
  );

  return refreshed.accessToken;
}

// ─── POST /auth/login ───────────────────────────────────────────────────────

/**
 * 토스 로그인 완료 후 클라이언트가 호출하는 엔드포인트
 *
 * body: { authorizationCode: string, referrer: string }
 * response: { token: string, user: { id, userKey } }
 */
router.post('/login', async (req, res) => {
  const { authorizationCode, referrer } = req.body as {
    authorizationCode?: string;
    referrer?: string;
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

    // 3. users 테이블 upsert (신규 or 재로그인)
    //    기존 스키마: id(uuid), toss_user_key(bigint), name(varchar)
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (toss_user_key, name, toss_access_token, toss_refresh_token, token_expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (toss_user_key) DO UPDATE SET
         name               = COALESCE(EXCLUDED.name, users.name),
         toss_access_token  = EXCLUDED.toss_access_token,
         toss_refresh_token = EXCLUDED.toss_refresh_token,
         token_expires_at   = EXCLUDED.token_expires_at
       RETURNING id`,
      [tossUser.userKey, tossUser.name ?? null, tokens.accessToken, tokens.refreshToken, expiresAt]
    );

    const userId = rows[0].id;

    // 4. 우리 앱 JWT 발급 (Toss 토큰은 절대 클라이언트에 내려보내지 않음)
    const token = signJwt(userId, tossUser.userKey);

    res.json({
      token,
      user: { id: userId, userKey: tossUser.userKey },
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'LoginFailed', message: '로그인에 실패했어요. 다시 시도해 주세요.' });
  }
});

// ─── GET /auth/me ───────────────────────────────────────────────────────────

/**
 * 현재 로그인 유저 프로필 조회
 * Toss access token이 만료됐으면 자동으로 refresh해요.
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const accessToken = await getFreshAccessToken(req.user!.userId);
    const tossUser = await getTossUser(accessToken);

    res.json({
      id: req.user!.userId,
      userKey: req.user!.userKey,
      name: tossUser.name ?? null,
      phoneNumber: tossUser.phoneNumber ?? null,
      email: tossUser.email ?? null,
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

export default router;
