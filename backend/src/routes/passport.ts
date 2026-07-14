import crypto from 'crypto';
import express, { Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/requireAuth';

const router = express.Router();
const STAMP_BOOK_SIZE = 60;
const DEFAULT_DISCOVERED_LIMIT = 50;
const MAX_DISCOVERED_LIMIT = 100;

type ArchiveStatus = 'active' | 'ended' | 'removed';

type DiscoveredCursor = {
  discoveredAt: string;
  eventId: string;
};

type DiscoveredRow = {
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
  status: ArchiveStatus;
};

type DiscoveredPageInfo = {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
};

type DiscoveredPage = {
  items: ReturnType<typeof mapDiscoveredRow>[];
  pageInfo: DiscoveredPageInfo;
};

const ARCHIVE_STATUS_SQL = `CASE
  WHEN COALESCE(ce.deleted_reason, archive.removed_reason) = 'expired'
    THEN 'ended'
  WHEN ce.is_deleted = true OR archive.removed_at IS NOT NULL
    THEN 'removed'
  WHEN COALESCE(ce.end_at, archive.end_at) IS NOT NULL
   AND (COALESCE(ce.end_at, archive.end_at) AT TIME ZONE 'Asia/Seoul')::date
       < (NOW() AT TIME ZONE 'Asia/Seoul')::date
    THEN 'ended'
  WHEN ce.id IS NOT NULL AND ce.is_deleted = false
    THEN 'active'
  ELSE 'removed'
END`;

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

function positiveInt(value: unknown, fallback: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

function discoveredLimit(value: unknown): number {
  return Math.min(positiveInt(value, DEFAULT_DISCOVERED_LIMIT), MAX_DISCOVERED_LIMIT);
}

function encodeDiscoveredCursor(row: Pick<DiscoveredRow, 'discovered_at' | 'event_id'>): string {
  const payload: DiscoveredCursor = {
    discoveredAt: isoString(row.discovered_at),
    eventId: String(row.event_id),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeDiscoveredCursor(value: unknown): DiscoveredCursor | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') throw new Error('INVALID_DISCOVERED_CURSOR');

  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<DiscoveredCursor>;
    if (
      typeof parsed.discoveredAt !== 'string'
      || Number.isNaN(Date.parse(parsed.discoveredAt))
      || typeof parsed.eventId !== 'string'
      || parsed.eventId.trim() === ''
    ) {
      throw new Error('INVALID_DISCOVERED_CURSOR');
    }
    return { discoveredAt: parsed.discoveredAt, eventId: parsed.eventId };
  } catch {
    throw new Error('INVALID_DISCOVERED_CURSOR');
  }
}

function mapDiscoveredRow(row: DiscoveredRow) {
  return {
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
    status: row.status,
  };
}

async function loadDiscoveredPage(
  userId: string,
  limit: number,
  cursor: DiscoveredCursor | null,
): Promise<DiscoveredPage> {
  const result = await pool.query<DiscoveredRow>(
    `WITH latest_discovery AS (
       SELECT DISTINCT ON (el.event_id)
              el.event_id,
              el.created_at AS discovered_at
       FROM user_ticket_earn_log el
       JOIN event_archive_snapshots archive ON archive.event_id = el.event_id
       WHERE el.user_id = $1
       ORDER BY el.event_id, el.created_at DESC, el.id DESC
     )
     SELECT latest.event_id,
            COALESCE(NULLIF(BTRIM(ce.title), ''), archive.title) AS title,
            COALESCE(NULLIF(BTRIM(ce.display_title), ''), archive.display_title) AS display_title,
            COALESCE(ce.main_category, archive.category) AS category,
            COALESCE(ce.region, archive.region) AS region,
            COALESCE(ce.venue, archive.venue) AS venue,
            COALESCE(ce.image_url, archive.image_url) AS image_url,
            COALESCE(ce.start_at, archive.start_at) AS start_at,
            COALESCE(ce.end_at, archive.end_at) AS end_at,
            COALESCE(ce.lat::double precision, archive.lat) AS lat,
            COALESCE(ce.lng::double precision, archive.lng) AS lng,
            latest.discovered_at,
            ${ARCHIVE_STATUS_SQL} AS status
     FROM latest_discovery latest
     JOIN event_archive_snapshots archive ON archive.event_id = latest.event_id
     LEFT JOIN canonical_events ce ON ce.id::text = latest.event_id
     WHERE (
       $2::timestamptz IS NULL
       OR latest.discovered_at < $2::timestamptz
       OR (latest.discovered_at = $2::timestamptz AND latest.event_id < $3::text)
     )
     ORDER BY latest.discovered_at DESC, latest.event_id DESC
     LIMIT $4`,
    [userId, cursor?.discoveredAt ?? null, cursor?.eventId ?? null, limit + 1],
  );

  const hasMore = result.rows.length > limit;
  const pageRows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const lastRow = pageRows.length > 0 ? pageRows[pageRows.length - 1] : undefined;
  return {
    items: pageRows.map(mapDiscoveredRow),
    pageInfo: {
      limit,
      hasMore,
      nextCursor: hasMore && lastRow ? encodeDiscoveredCursor(lastRow) : null,
    },
  };
}

/** Cursor-paginated opened Culture Cards. */
router.get('/discovered', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const limit = discoveredLimit(req.query.limit);
  let cursor: DiscoveredCursor | null;
  try {
    cursor = decodeDiscoveredCursor(req.query.cursor);
  } catch {
    return res.status(400).json({ error: 'INVALID_DISCOVERED_CURSOR' });
  }

  try {
    const page = await loadDiscoveredPage(userId, limit, cursor);
    return res.json(page);
  } catch (err) {
    console.error('[Passport] discovered page error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

router.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const monthStart = currentKstMonthStart();
  const stampBook = positiveInt(req.query.stampBook, 1);
  const stampOffset = (stampBook - 1) * STAMP_BOOK_SIZE;
  const limit = discoveredLimit(req.query.discoveredLimit);
  let cursor: DiscoveredCursor | null;
  try {
    cursor = decodeDiscoveredCursor(req.query.discoveredCursor);
  } catch {
    return res.status(400).json({ error: 'INVALID_DISCOVERED_CURSOR' });
  }

  try {
    const [
      discoveredResult,
      visitedResult,
      monthDiscoveredResult,
      regionsDiscoveredResult,
      categoriesDiscoveredResult,
      regionsVisitedResult,
      monthVisitedResult,
      topRegionsResult,
      allVisitedStampsResult,
      tasteResult,
      stampResult,
      visitedIdsResult,
      discoveredPage,
    ] = await Promise.all([
      pool.query<{ count: string | number }>(
        `SELECT COUNT(DISTINCT el.event_id)::int AS count
         FROM user_ticket_earn_log el
         JOIN event_archive_snapshots archive ON archive.event_id = el.event_id
         WHERE el.user_id = $1`,
        [userId]
      ),
      pool.query<{ count: string | number }>(
        `SELECT COUNT(DISTINCT vl.event_id)::int AS count
         FROM user_visit_log vl
         JOIN event_archive_snapshots archive ON archive.event_id = vl.event_id
         WHERE vl.user_id = $1`,
        [userId]
      ),
      pool.query<{ count: string | number }>(
        `SELECT COUNT(DISTINCT el.event_id)::int AS count
         FROM user_ticket_earn_log el
         JOIN event_archive_snapshots archive ON archive.event_id = el.event_id
         WHERE el.user_id = $1
           AND el.earn_date >= $2::date
           AND el.earn_date < ($2::date + INTERVAL '1 month')`,
        [userId, monthStart]
      ),
      pool.query<{ count: string | number }>(
        `SELECT COUNT(DISTINCT archive.region)::int AS count
         FROM user_ticket_earn_log el
         JOIN event_archive_snapshots archive ON archive.event_id = el.event_id
         WHERE el.user_id = $1
           AND archive.region IS NOT NULL`,
        [userId]
      ),
      pool.query<{ category: string | null }>(
        `SELECT DISTINCT archive.category
         FROM user_ticket_earn_log el
         JOIN event_archive_snapshots archive ON archive.event_id = el.event_id
         WHERE el.user_id = $1`,
        [userId]
      ),
      pool.query<{ count: string | number }>(
        `SELECT COUNT(DISTINCT archive.region)::int AS count
         FROM user_visit_log vl
         JOIN event_archive_snapshots archive ON archive.event_id = vl.event_id
         WHERE vl.user_id = $1
           AND archive.region IS NOT NULL`,
        [userId]
      ),
      pool.query<{ count: string | number }>(
        `SELECT COUNT(DISTINCT vl.event_id)::int AS count
         FROM user_visit_log vl
         JOIN event_archive_snapshots archive ON archive.event_id = vl.event_id
         WHERE vl.user_id = $1
           AND vl.visited_at >= ($2::date AT TIME ZONE 'Asia/Seoul')
           AND vl.visited_at < (($2::date + INTERVAL '1 month') AT TIME ZONE 'Asia/Seoul')`,
        [userId, monthStart]
      ),
      pool.query<{ region: string; count: string | number }>(
        `SELECT archive.region, COUNT(DISTINCT vl.event_id)::int AS count
         FROM user_visit_log vl
         JOIN event_archive_snapshots archive ON archive.event_id = vl.event_id
         WHERE vl.user_id = $1
           AND archive.region IS NOT NULL
         GROUP BY archive.region
         ORDER BY count DESC, archive.region ASC
         LIMIT 5`,
        [userId]
      ),
      pool.query<{ event_id: string; category: string | null; region: string | null; visited_at: string | Date }>(
        `SELECT vl.event_id, archive.region, archive.category, vl.visited_at
         FROM user_visit_log vl
         JOIN event_archive_snapshots archive ON archive.event_id = vl.event_id
         WHERE vl.user_id = $1
         ORDER BY vl.visited_at ASC, vl.event_id ASC`,
        [userId]
      ),
      pool.query<{ category: string | null }>(
        `SELECT archive.category
         FROM user_ticket_earn_log el
         JOIN event_archive_snapshots archive ON archive.event_id = el.event_id
         WHERE el.user_id = $1
         GROUP BY archive.category
         ORDER BY COUNT(*) DESC, archive.category ASC
         LIMIT 3`,
        [userId]
      ),
      pool.query<{
        event_id: string;
        title: string;
        category: string | null;
        region: string | null;
        venue: string | null;
        image_url: string | null;
        visited_at: string | Date;
        status: ArchiveStatus;
      }>(
        `SELECT vl.event_id,
                COALESCE(
                  NULLIF(BTRIM(ce.display_title), ''),
                  archive.display_title,
                  NULLIF(BTRIM(ce.title), ''),
                  archive.title
                ) AS title,
                COALESCE(ce.main_category, archive.category) AS category,
                COALESCE(ce.region, archive.region) AS region,
                COALESCE(ce.venue, archive.venue) AS venue,
                COALESCE(ce.image_url, archive.image_url) AS image_url,
                vl.visited_at,
                ${ARCHIVE_STATUS_SQL} AS status
         FROM user_visit_log vl
         JOIN event_archive_snapshots archive ON archive.event_id = vl.event_id
         LEFT JOIN canonical_events ce ON ce.id::text = vl.event_id
         WHERE vl.user_id = $1
         ORDER BY vl.visited_at DESC, vl.event_id DESC
         LIMIT $2 OFFSET $3`,
        [userId, STAMP_BOOK_SIZE, stampOffset]
      ),
      pool.query<{ event_id: string }>(
        `SELECT DISTINCT vl.event_id
         FROM user_visit_log vl
         JOIN event_archive_snapshots archive ON archive.event_id = vl.event_id
         WHERE vl.user_id = $1`,
        [userId]
      ),
      loadDiscoveredPage(userId, limit, cursor),
    ]);

    const visitedCount = countFrom(visitedResult.rows[0]);
    const discoveredCategories = new Set(categoriesDiscoveredResult.rows.map((row) => normalizeCategory(row.category)));
    const firstInRegion = new Set<string>();
    const firstInCategory = new Set<string>();
    const seenRegions = new Set<string>();
    const seenCategories = new Set<string>();

    for (const row of allVisitedStampsResult.rows) {
      const eventId = String(row.event_id);
      if (row.region !== null && !seenRegions.has(row.region)) {
        seenRegions.add(row.region);
        firstInRegion.add(eventId);
      }

      const category = normalizeCategory(row.category);
      if (!seenCategories.has(category)) {
        seenCategories.add(category);
        firstInCategory.add(eventId);
      }
    }

    return res.json({
      passportNo: passportNo(userId),
      discoveredCount: countFrom(discoveredResult.rows[0]),
      visitedCount,
      monthDiscovered: countFrom(monthDiscoveredResult.rows[0]),
      regionsDiscovered: countFrom(regionsDiscoveredResult.rows[0]),
      categoriesDiscovered: discoveredCategories.size,
      regionsVisited: countFrom(regionsVisitedResult.rows[0]),
      monthVisited: countFrom(monthVisitedResult.rows[0]),
      topRegions: topRegionsResult.rows.map((row) => ({
        region: row.region,
        count: Number(row.count),
      })),
      stampBook,
      stampBookCount: Math.max(1, Math.ceil(visitedCount / STAMP_BOOK_SIZE)),
      stampBookSize: STAMP_BOOK_SIZE,
      tasteCategories: tasteResult.rows.map((row) => normalizeCategory(row.category)),
      stamps: stampResult.rows.map((row) => ({
        eventId: row.event_id,
        title: row.title,
        category: normalizeCategory(row.category),
        region: row.region,
        venue: row.venue,
        imageUrl: row.image_url,
        visitedAt: isoString(row.visited_at),
        isFirstInRegion: firstInRegion.has(String(row.event_id)),
        isFirstInCategory: firstInCategory.has(String(row.event_id)),
        status: row.status,
      })),
      visitedEventIds: visitedIdsResult.rows.map((row) => String(row.event_id)),
      discoveredCards: discoveredPage.items,
      discoveredPageInfo: discoveredPage.pageInfo,
    });
  } catch (err) {
    console.error('[Passport] summary error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
