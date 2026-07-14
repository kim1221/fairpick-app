import express, { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import { pool } from '../db';
import { requireAuth } from '../middleware/requireAuth';
import { upsertEventArchive } from '../services/eventArchive';

/**
 * 문화 여권(추억 책자) 방문 도장 — 자기신고 방식.
 * ⚠️ 위치(GPS) 인증·티켓 보상 없음. 순수 추억/컬렉션용 도장.
 *   (구 버전: 400m 반경 + 행사기간 GPS 검증 + 방문 보너스 티켓 → 2026-07-04 자기신고로 전환)
 */

const router = express.Router();

function cleanEventId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function countStamps(
  client: Pick<PoolClient, 'query'>,
  userId: string,
): Promise<number> {
  const { rows } = await client.query<{ count: string | number }>(
    `SELECT COUNT(DISTINCT vl.event_id)::int AS count
     FROM user_visit_log vl
     JOIN event_archive_snapshots archive ON archive.event_id = vl.event_id
     WHERE vl.user_id = $1`,
    [userId]
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * POST /api/visits — "다녀왔어요" 자기신고 → 여권에 도장.
 * body: { eventId }. 멱등(ON CONFLICT DO NOTHING).
 */
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const eventId = cleanEventId(req.body?.eventId);
  if (!eventId) {
    return res.status(400).json({ error: 'MISSING_EVENT_ID' });
  }

  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await upsertEventArchive(client, eventId);
    const { rows: inserted } = await client.query<{ id: string }>(
      `INSERT INTO user_visit_log (user_id, event_id, bonus_tickets)
       VALUES ($1, $2, 0)
       ON CONFLICT (user_id, event_id) DO NOTHING
       RETURNING id`,
      [userId, eventId]
    );
    const stampCount = await countStamps(client, userId);
    await client.query('COMMIT');
    return res.json({
      ok: true,
      alreadyVisited: inserted.length === 0,
      stampCount,
    });
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    console.error('[visits] self-report error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client?.release();
  }
});

/**
 * DELETE /api/visits/:eventId — 도장 취소(잘못 눌렀을 때).
 */
router.delete('/:eventId', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const eventId = cleanEventId(req.params.eventId);
  if (!eventId) {
    return res.status(400).json({ error: 'MISSING_EVENT_ID' });
  }

  try {
    await pool.query(
      `DELETE FROM user_visit_log WHERE user_id = $1 AND event_id = $2`,
      [userId, eventId]
    );
    const stampCount = await countStamps(pool, userId);
    return res.json({ ok: true, stampCount });
  } catch (err) {
    console.error('[visits] delete error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/visits/ids — 내가 도장 찍은 event_id 목록(버튼 상태 표시용).
 */
router.get('/ids', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  try {
    const { rows } = await pool.query<{ event_id: string }>(
      `SELECT DISTINCT vl.event_id
       FROM user_visit_log vl
       JOIN event_archive_snapshots archive ON archive.event_id = vl.event_id
       WHERE vl.user_id = $1`,
      [userId]
    );
    return res.json({ eventIds: rows.map((r) => String(r.event_id)) });
  } catch (err) {
    console.error('[visits] ids error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
