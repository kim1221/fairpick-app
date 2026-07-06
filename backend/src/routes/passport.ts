import crypto from 'crypto';
import express, { Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/requireAuth';

const router = express.Router();

function currentKstMonthStart(): string {
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const year = nowKst.getUTCFullYear();
  const month = String(nowKst.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

function normalizeCategory(category: string | null): string {
  if (!category) return '기타';
  if (category.includes('전시')) return '전시';
  if (category.includes('공연') || category.includes('뮤지컬') || category.includes('연극') || category.includes('콘서트')) return '공연';
  if (category.includes('팝업')) return '팝업';
  if (category.includes('축제') || category.includes('페스티벌')) return '축제';
  return '기타';
}

function countFrom(row: { count?: string | number } | undefined): number {
  return Number(row?.count ?? 0);
}

function passportNo(userId: string): string {
  const hash = crypto.createHash('sha256').update(userId).digest('hex');
  const value = parseInt(hash.slice(0, 8), 16) % 10000;
  return String(value).padStart(4, '0');
}

function isoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function isoStringOrNull(value: string | Date | null): string | null {
  if (!value) return null;
  return isoString(value);
}

function numberOrNull(value: string | number | null): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

router.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const monthStart = currentKstMonthStart();

  try {
    const [
      discoveredResult,
      visitedResult,
      monthDiscoveredResult,
      tasteResult,
      stampResult,
      visitedIdsResult,
      discoveredCardsResult,
    ] = await Promise.all([
      pool.query<{ count: string | number }>(
        `SELECT COUNT(DISTINCT event_id)::int AS count
         FROM user_ticket_earn_log
         WHERE user_id = $1`,
        [userId]
      ),
      pool.query<{ count: string | number }>(
        `SELECT COUNT(DISTINCT event_id)::int AS count
         FROM user_visit_log
         WHERE user_id = $1`,
        [userId]
      ),
      pool.query<{ count: string | number }>(
        `SELECT COUNT(DISTINCT event_id)::int AS count
         FROM user_ticket_earn_log
         WHERE user_id = $1
           AND earn_date >= $2::date
           AND earn_date < ($2::date + INTERVAL '1 month')`,
        [userId, monthStart]
      ),
      pool.query<{ category: string | null }>(
        `SELECT ce.main_category AS category
         FROM user_ticket_earn_log el
         JOIN canonical_events ce ON ce.id::text = el.event_id
         WHERE el.user_id = $1
           AND ce.is_deleted = false
         GROUP BY ce.main_category
         ORDER BY COUNT(*) DESC, ce.main_category ASC
         LIMIT 3`,
        [userId]
      ),
      pool.query<{ event_id: string; title: string; category: string | null; region: string | null; venue: string | null; image_url: string | null; visited_at: string | Date }>(
        `SELECT vl.event_id, ce.title, ce.main_category AS category,
                ce.region, ce.venue, ce.image_url, vl.visited_at
         FROM user_visit_log vl
         JOIN canonical_events ce ON ce.id::text = vl.event_id
         WHERE vl.user_id = $1
           AND ce.is_deleted = false
         ORDER BY vl.visited_at DESC
         LIMIT 60`,
        [userId]
      ),
      pool.query<{ event_id: string }>(
        `SELECT DISTINCT event_id
         FROM user_visit_log
         WHERE user_id = $1`,
        [userId]
      ),
      pool.query<{
        event_id: string;
        title: string;
        display_title: string | null;
        category: string | null;
        region: string | null;
        venue: string | null;
        image_url: string | null;
        start_at: string | Date | null;
        end_at: string | Date | null;
        lat: string | number | null;
        lng: string | number | null;
        discovered_at: string | Date;
      }>(
        `SELECT *
         FROM (
           SELECT DISTINCT ON (el.event_id)
                  el.event_id,
                  ce.title,
                  ce.display_title,
                  ce.main_category AS category,
                  ce.region,
                  ce.venue,
                  ce.image_url,
                  ce.start_at,
                  ce.end_at,
                  ce.lat,
                  ce.lng,
                  el.created_at AS discovered_at
           FROM user_ticket_earn_log el
           JOIN canonical_events ce ON ce.id::text = el.event_id
           WHERE el.user_id = $1
             AND ce.is_deleted = false
           ORDER BY el.event_id, el.created_at DESC
         ) discovered
         ORDER BY discovered_at DESC
         LIMIT 50`,
        [userId]
      ),
    ]);

    return res.json({
      passportNo: passportNo(userId),
      discoveredCount: countFrom(discoveredResult.rows[0]),
      visitedCount: countFrom(visitedResult.rows[0]),
      monthDiscovered: countFrom(monthDiscoveredResult.rows[0]),
      tasteCategories: tasteResult.rows.map((row) => normalizeCategory(row.category)),
      stamps: stampResult.rows.map((row) => ({
        eventId: row.event_id,
        title: row.title,
        category: normalizeCategory(row.category),
        region: row.region,
        venue: row.venue,
        imageUrl: row.image_url,
        visitedAt: isoString(row.visited_at),
      })),
      visitedEventIds: visitedIdsResult.rows.map((row) => String(row.event_id)),
      discoveredCards: discoveredCardsResult.rows.map((row) => ({
        eventId: row.event_id,
        title: row.display_title?.trim() || row.title,
        category: normalizeCategory(row.category),
        region: row.region,
        venue: row.venue,
        imageUrl: row.image_url,
        startAt: isoStringOrNull(row.start_at),
        endAt: isoStringOrNull(row.end_at),
        lat: numberOrNull(row.lat),
        lng: numberOrNull(row.lng),
        discoveredAt: isoString(row.discovered_at),
      })),
    });
  } catch (err) {
    console.error('[Passport] summary error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
