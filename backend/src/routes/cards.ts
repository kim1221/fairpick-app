import express, { Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/requireAuth';

const router = express.Router();

const DAILY_LIMIT = 30;
const TODAY_CARD_COUNT = 3;
const CARD_POOL_LIMIT = 12;

type EventRow = {
  id: string;
  title: string;
  main_category: string | null;
  region: string | null;
  start_at: string | Date | null;
  end_at: string | Date | null;
  image_url: string | null;
  venue: string | null;
  overview: string | null;
};

function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isoOrNull(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}

function normalizeCategory(category: string | null): string {
  if (!category) return '기타';
  if (category.includes('전시')) return '전시';
  if (category.includes('공연') || category.includes('뮤지컬') || category.includes('연극') || category.includes('콘서트')) return '공연';
  if (category.includes('팝업')) return '팝업';
  if (category.includes('축제') || category.includes('페스티벌')) return '축제';
  return '기타';
}

function calculateDday(endAt: string | Date | null): number | null {
  if (!endAt) return null;
  const endTime = endAt instanceof Date ? endAt.getTime() : Date.parse(endAt);
  if (Number.isNaN(endTime)) return null;
  const nowKst = Date.now() + 9 * 60 * 60 * 1000;
  const endKst = endTime + 9 * 60 * 60 * 1000;
  return Math.ceil((endKst - nowKst) / (24 * 60 * 60 * 1000));
}

function firstLine(value: string | null): string | null {
  if (!value) return null;
  const line = value.split(/\r?\n/).map((part) => part.trim()).find(Boolean);
  return line ?? null;
}

function toCard(row: EventRow, openedEventIds: Set<string>) {
  const eventId = String(row.id);
  return {
    eventId,
    title: row.title,
    category: normalizeCategory(row.main_category),
    venue: row.venue,
    region: row.region,
    startAt: isoOrNull(row.start_at),
    endAt: isoOrNull(row.end_at),
    dday: calculateDday(row.end_at),
    imageUrl: row.image_url,
    walkMinutes: null,
    blurb: firstLine(row.overview),
    opened: openedEventIds.has(eventId),
  };
}

router.get('/today', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const today = todayKst();

  try {
    const [ticketResult, openedResult, eventResult] = await Promise.all([
      pool.query(
        `WITH ensured AS (
           INSERT INTO user_tickets (user_id, ticket_count, total_earned, total_exchanged)
           VALUES ($1, 0, 0, 0)
           ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
           RETURNING ticket_count, daily_earned, daily_earned_date
         )
         SELECT ticket_count, daily_earned, daily_earned_date FROM ensured
         UNION ALL
         SELECT ticket_count, daily_earned, daily_earned_date
         FROM user_tickets
         WHERE user_id = $1
         LIMIT 1`,
        [userId]
      ),
      pool.query<{ event_id: string }>(
        `SELECT event_id
         FROM user_ticket_earn_log
         WHERE user_id = $1 AND earn_date = $2`,
        [userId, today]
      ),
      pool.query<EventRow>(
        `SELECT id, title, main_category, region, start_at, end_at, image_url, venue, overview
         FROM canonical_events
         WHERE is_deleted = false
           AND (end_at IS NULL OR end_at >= NOW())
         ORDER BY
           CASE
             WHEN start_at <= NOW() AND (end_at IS NULL OR end_at >= NOW()) THEN 0
             WHEN start_at > NOW() THEN 1
             ELSE 2
           END,
           CASE WHEN end_at IS NULL THEN 1 ELSE 0 END,
           end_at ASC,
           buzz_score DESC NULLS LAST
         LIMIT $1`,
        [CARD_POOL_LIMIT]
      ),
    ]);

    const ticketRow = ticketResult.rows[0] ?? {};
    const openedEventIds = new Set(openedResult.rows.map((row) => String(row.event_id)));
    const cards = eventResult.rows.map((row) => toCard(row, openedEventIds));
    const todayCards = cards.slice(0, TODAY_CARD_COUNT);
    const todayIds = new Set(todayCards.map((card) => card.eventId));
    const morePool = cards.filter((card) => !card.opened && !todayIds.has(card.eventId));
    const dailyEarnedDate = ticketRow.daily_earned_date ? String(ticketRow.daily_earned_date).slice(0, 10) : null;

    return res.json({
      today: todayCards,
      morePool,
      ticketCount: ticketRow.ticket_count ?? 0,
      dailyEarned: dailyEarnedDate === today ? (ticketRow.daily_earned ?? 0) : 0,
      dailyLimit: DAILY_LIMIT,
    });
  } catch (err) {
    console.error('[Cards] today error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
