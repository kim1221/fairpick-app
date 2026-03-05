/**
 * 유저 데이터 서버 동기화 API
 *
 * 모든 엔드포인트는 requireAuth 미들웨어로 보호돼요.
 * req.user.userId = users.id (UUID)
 *
 * ── 찜 ──────────────────────────────────────────────────
 * POST   /users/me/likes/batch     — 로컬 → 서버 일괄 업로드 (최초 마이그레이션)
 * GET    /users/me/likes           — 찜 목록 조회
 * POST   /users/me/likes/:eventId  — 개별 찜 추가
 * DELETE /users/me/likes/:eventId  — 개별 찜 해제
 *
 * ── 최근 본 ─────────────────────────────────────────────
 * POST   /users/me/recent/batch    — 로컬 → 서버 일괄 업로드 (최초 마이그레이션)
 * GET    /users/me/recent          — 최근 본 목록 조회 (최대 50개, 최신순)
 * DELETE /users/me/recent/:eventId — 개별 삭제
 * DELETE /users/me/recent          — 전체 삭제
 */

import { Router } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

// 모든 라우트에 JWT 인증 적용
router.use(requireAuth);

const MAX_RECENT = 50;

// ════════════════════════════════════════════════════════
// 찜
// ════════════════════════════════════════════════════════

/**
 * POST /users/me/likes/batch
 * 로컬 찜 목록을 서버에 일괄 업로드해요 (최초 로그인 마이그레이션용).
 * 중복된 event_id는 liked_at만 업데이트해요.
 *
 * body: { items: Array<{ eventId: string, likedAt: string }> }
 */
router.post('/me/likes/batch', async (req, res) => {
  const userId = req.user!.userId;
  const { items } = req.body as { items?: Array<{ eventId: string; likedAt: string }> };

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'BadRequest', message: 'items 배열이 필요해요.' });
    return;
  }

  try {
    // 개별 upsert (PostgreSQL unnest 활용)
    const eventIds = items.map((i) => i.eventId);
    const likedAts = items.map((i) => i.likedAt);

    await pool.query(
      `INSERT INTO user_likes (user_id, event_id, liked_at)
       SELECT $1, unnest($2::text[]), unnest($3::timestamptz[])
       ON CONFLICT (user_id, event_id) DO UPDATE SET liked_at = EXCLUDED.liked_at`,
      [userId, eventIds, likedAts]
    );

    res.json({ ok: true, synced: items.length });
  } catch (err) {
    console.error('[userSync/likes/batch]', err);
    res.status(500).json({ error: 'SyncFailed', message: '동기화에 실패했어요.' });
  }
});

/**
 * GET /users/me/likes
 * 찜 목록 전체 조회 (liked_at 최신순)
 *
 * response: { items: Array<{ eventId, likedAt }> }
 */
router.get('/me/likes', async (req, res) => {
  const userId = req.user!.userId;

  try {
    const { rows } = await pool.query<{ event_id: string; liked_at: Date }>(
      `SELECT event_id, liked_at
       FROM user_likes
       WHERE user_id = $1
       ORDER BY liked_at DESC`,
      [userId]
    );

    res.json({
      items: rows.map((r) => ({ eventId: r.event_id, likedAt: r.liked_at.toISOString() })),
    });
  } catch (err) {
    console.error('[userSync/likes GET]', err);
    res.status(500).json({ error: 'FetchFailed', message: '찜 목록을 불러오지 못했어요.' });
  }
});

/**
 * POST /users/me/likes/:eventId
 * 개별 찜 추가 (이미 있으면 liked_at 갱신)
 */
router.post('/me/likes/:eventId', async (req, res) => {
  const userId = req.user!.userId;
  const { eventId } = req.params;

  try {
    await pool.query(
      `INSERT INTO user_likes (user_id, event_id, liked_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, event_id) DO UPDATE SET liked_at = NOW()`,
      [userId, eventId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[userSync/likes POST]', err);
    res.status(500).json({ error: 'SaveFailed', message: '찜 추가에 실패했어요.' });
  }
});

/**
 * DELETE /users/me/likes/:eventId
 * 개별 찜 해제
 */
router.delete('/me/likes/:eventId', async (req, res) => {
  const userId = req.user!.userId;
  const { eventId } = req.params;

  try {
    await pool.query(
      'DELETE FROM user_likes WHERE user_id = $1 AND event_id = $2',
      [userId, eventId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[userSync/likes DELETE]', err);
    res.status(500).json({ error: 'DeleteFailed', message: '찜 해제에 실패했어요.' });
  }
});

// ════════════════════════════════════════════════════════
// 최근 본
// ════════════════════════════════════════════════════════

/**
 * POST /users/me/recent/batch
 * 로컬 최근 본 목록을 서버에 일괄 업로드해요 (최초 로그인 마이그레이션용).
 * 업로드 후 MAX_RECENT(50개) 초과분은 오래된 순으로 제거해요.
 *
 * body: { items: Array<{ eventId: string, viewedAt: string }> }
 */
router.post('/me/recent/batch', async (req, res) => {
  const userId = req.user!.userId;
  const { items } = req.body as { items?: Array<{ eventId: string; viewedAt: string }> };

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'BadRequest', message: 'items 배열이 필요해요.' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const eventIds = items.map((i) => i.eventId);
    const viewedAts = items.map((i) => i.viewedAt);

    await client.query(
      `INSERT INTO user_recent (user_id, event_id, viewed_at)
       SELECT $1, unnest($2::text[]), unnest($3::timestamptz[])
       ON CONFLICT (user_id, event_id) DO UPDATE SET viewed_at = EXCLUDED.viewed_at`,
      [userId, eventIds, viewedAts]
    );

    // MAX_RECENT 초과분 제거
    await client.query(
      `DELETE FROM user_recent
       WHERE user_id = $1
         AND id NOT IN (
           SELECT id FROM user_recent
           WHERE user_id = $1
           ORDER BY viewed_at DESC
           LIMIT $2
         )`,
      [userId, MAX_RECENT]
    );

    await client.query('COMMIT');
    res.json({ ok: true, synced: items.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[userSync/recent/batch]', err);
    res.status(500).json({ error: 'SyncFailed', message: '동기화에 실패했어요.' });
  } finally {
    client.release();
  }
});

/**
 * GET /users/me/recent
 * 최근 본 목록 조회 (최대 50개, 최신순)
 *
 * response: { items: Array<{ eventId, viewedAt }> }
 */
router.get('/me/recent', async (req, res) => {
  const userId = req.user!.userId;

  try {
    const { rows } = await pool.query<{ event_id: string; viewed_at: Date }>(
      `SELECT event_id, viewed_at
       FROM user_recent
       WHERE user_id = $1
       ORDER BY viewed_at DESC
       LIMIT $2`,
      [userId, MAX_RECENT]
    );

    res.json({
      items: rows.map((r) => ({ eventId: r.event_id, viewedAt: r.viewed_at.toISOString() })),
    });
  } catch (err) {
    console.error('[userSync/recent GET]', err);
    res.status(500).json({ error: 'FetchFailed', message: '최근 본 목록을 불러오지 못했어요.' });
  }
});

/**
 * DELETE /users/me/recent/:eventId
 * 개별 최근 본 항목 삭제
 */
router.delete('/me/recent/:eventId', async (req, res) => {
  const userId = req.user!.userId;
  const { eventId } = req.params;

  try {
    await pool.query(
      'DELETE FROM user_recent WHERE user_id = $1 AND event_id = $2',
      [userId, eventId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[userSync/recent DELETE one]', err);
    res.status(500).json({ error: 'DeleteFailed', message: '삭제에 실패했어요.' });
  }
});

/**
 * DELETE /users/me/recent
 * 최근 본 전체 삭제
 */
router.delete('/me/recent', async (req, res) => {
  const userId = req.user!.userId;

  try {
    await pool.query('DELETE FROM user_recent WHERE user_id = $1', [userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[userSync/recent DELETE all]', err);
    res.status(500).json({ error: 'DeleteFailed', message: '전체 삭제에 실패했어요.' });
  }
});

// ════════════════════════════════════════════════════════
// 알림 설정
// ════════════════════════════════════════════════════════

/**
 * GET /users/me/notifications
 * 푸시 알림 수신 설정 조회
 *
 * response: { pushEnabled: boolean }
 */
router.get('/me/notifications', async (req, res) => {
  const userId = req.user!.userId;

  try {
    const { rows } = await pool.query<{ push_notifications_enabled: boolean }>(
      'SELECT push_notifications_enabled FROM users WHERE id = $1',
      [userId]
    );
    res.json({ pushEnabled: rows[0]?.push_notifications_enabled ?? true });
  } catch (err) {
    console.error('[userSync/notifications GET]', err);
    res.status(500).json({ error: 'FetchFailed', message: '설정을 불러오지 못했어요.' });
  }
});

/**
 * PATCH /users/me/notifications
 * 푸시 알림 수신 설정 변경
 *
 * body: { pushEnabled: boolean }
 * response: { ok: true }
 */
router.patch('/me/notifications', async (req, res) => {
  const userId = req.user!.userId;
  const { pushEnabled } = req.body as { pushEnabled?: boolean };

  if (typeof pushEnabled !== 'boolean') {
    res.status(400).json({ error: 'BadRequest', message: 'pushEnabled(boolean)가 필요해요.' });
    return;
  }

  try {
    await pool.query(
      'UPDATE users SET push_notifications_enabled = $1 WHERE id = $2',
      [pushEnabled, userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[userSync/notifications PATCH]', err);
    res.status(500).json({ error: 'UpdateFailed', message: '설정 변경에 실패했어요.' });
  }
});

export default router;
