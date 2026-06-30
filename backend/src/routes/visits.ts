import express, { Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/requireAuth';

const router = express.Router();

const VISIT_BONUS_TICKETS = 3;
const DAILY_VISIT_BONUS_LIMIT = 10;

function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function cleanEventId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function countStamps(client: Pick<typeof pool, 'query'>, userId: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT COUNT(DISTINCT event_id)::int AS count
     FROM user_visit_log
     WHERE user_id = $1`,
    [userId]
  );
  return Number(rows[0]?.count ?? 0);
}

router.post('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const eventId = cleanEventId(req.body?.eventId);

  if (!eventId) {
    return res.status(400).json({ error: 'MISSING_EVENT_ID' });
  }

  const today = todayKst();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO user_tickets (user_id, ticket_count, total_earned, total_exchanged)
       VALUES ($1, 0, 0, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    const { rows: lockRows } = await client.query(
      `SELECT ticket_count
       FROM user_tickets
       WHERE user_id = $1
       FOR UPDATE`,
      [userId]
    );
    const currentTicketCount = Number(lockRows[0]?.ticket_count ?? 0);

    const { rows: inserted } = await client.query(
      `INSERT INTO user_visit_log (user_id, event_id, bonus_tickets)
       VALUES ($1, $2, 0)
       ON CONFLICT (user_id, event_id) DO NOTHING
       RETURNING id`,
      [userId, eventId]
    );

    if (inserted.length === 0) {
      const stampCount = await countStamps(client, userId);
      await client.query('COMMIT');
      return res.json({
        ok: true,
        alreadyVisited: true,
        bonusTickets: 0,
        ticketCount: currentTicketCount,
        stampCount,
      });
    }

    const { rows: dailyBonusRows } = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM user_visit_log
       WHERE user_id = $1
         AND bonus_tickets > 0
         AND (visited_at AT TIME ZONE 'Asia/Seoul')::date = $2::date`,
      [userId, today]
    );
    const dailyBonusCount = Number(dailyBonusRows[0]?.count ?? 0);
    const bonusTickets = dailyBonusCount >= DAILY_VISIT_BONUS_LIMIT ? 0 : VISIT_BONUS_TICKETS;

    let ticketCount = currentTicketCount;
    if (bonusTickets > 0) {
      const { rows: updated } = await client.query(
        `UPDATE user_tickets
         SET ticket_count   = ticket_count + $1,
             total_earned   = total_earned + $1,
             last_earned_at = NOW(),
             updated_at     = NOW()
         WHERE user_id = $2
         RETURNING ticket_count`,
        [bonusTickets, userId]
      );
      ticketCount = Number(updated[0]?.ticket_count ?? currentTicketCount + bonusTickets);
    }

    await client.query(
      `UPDATE user_visit_log
       SET bonus_tickets = $1
       WHERE id = $2`,
      [bonusTickets, inserted[0].id]
    );

    const stampCount = await countStamps(client, userId);
    await client.query('COMMIT');

    return res.json({
      ok: true,
      alreadyVisited: false,
      bonusTickets,
      ticketCount,
      stampCount,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Visits] mark visited error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

export default router;
