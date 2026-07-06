import express, { Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/requireAuth';
import { calculateBoundingBox, getHaversineDistanceSQL } from '../utils/geo';
import { reverseGeocodeRegion } from '../lib/geocode';

const router = express.Router();

const DAILY_LIMIT = 30;
const TODAY_CARD_COUNT = 3;
const CARD_POOL_LIMIT = 12;
const CARD_QUERY_LIMIT = 36;
const RECENT_OPEN_COOLDOWN_DAYS = 14;
const WALK_METERS_PER_MINUTE = 80;
const NEARBY_RADIUS_STEPS_M = [3000, 10000, 50000] as const;
const CATEGORY_PRIORITY = ['전시', '공연', '팝업', '축제', '기타'] as const;

type EventRow = {
  id: string;
  title: string;
  display_title?: string | null;
  content_key?: string | null;
  canonical_key?: string | null;
  main_category: string | null;
  region: string | null;
  start_at: string | Date | null;
  end_at: string | Date | null;
  image_url: string | null;
  venue: string | null;
  overview: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  distance_m?: number | string | null;
};

type OpenedEventRow = {
  event_id: string;
  earn_date: string | Date | null;
  dedupe_key: string | null;
};

type LocationQuery = {
  lat: number;
  lng: number;
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

function dateOnly(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeDedupePart(value: string | Date | null | undefined): string {
  if (!value) return '';
  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  return raw
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w가-힣 ]/g, '')
    .trim();
}

function getEventDedupeKey(row: EventRow): string {
  const stableKey = row.content_key || row.canonical_key;
  if (stableKey) return stableKey;
  return [
    normalizeDedupePart(row.display_title || row.title),
    normalizeDedupePart(row.venue),
    normalizeDedupePart(row.start_at),
    normalizeDedupePart(row.end_at),
  ].join('|');
}

function normalizeCategory(category: string | null): string {
  if (!category) return '기타';
  if (category.includes('전시')) return '전시';
  if (category.includes('공연') || category.includes('뮤지컬') || category.includes('연극') || category.includes('콘서트')) return '공연';
  if (category.includes('팝업')) return '팝업';
  if (category.includes('축제') || category.includes('페스티벌')) return '축제';
  return '기타';
}

function parseCoordinate(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLocationQuery(req: Request): LocationQuery | null {
  const lat = parseCoordinate(req.query.lat);
  const lng = parseCoordinate(req.query.lng);
  if (lat == null || lng == null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

function calculateDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusM = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getDistanceMeters(row: EventRow, location?: LocationQuery | null): number | null {
  const sqlDistance = toNumberOrNull(row.distance_m);
  if (sqlDistance != null) return sqlDistance;
  if (!location) return null;
  const eventLat = toNumberOrNull(row.lat);
  const eventLng = toNumberOrNull(row.lng);
  if (eventLat == null || eventLng == null) return null;
  return calculateDistanceMeters(location.lat, location.lng, eventLat, eventLng);
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

function toCard(row: EventRow, openedEventIds: Set<string>, location?: LocationQuery | null) {
  const eventId = String(row.id);
  const distanceM = getDistanceMeters(row, location);
  return {
    eventId,
    title: row.display_title?.trim() || row.title,
    category: normalizeCategory(row.main_category),
    venue: row.venue,
    region: row.region,
    startAt: isoOrNull(row.start_at),
    endAt: isoOrNull(row.end_at),
    dday: calculateDday(row.end_at),
    imageUrl: row.image_url,
    walkMinutes: distanceM == null ? null : Math.max(1, Math.ceil(distanceM / WALK_METERS_PER_MINUTE)),
    blurb: firstLine(row.overview),
    opened: openedEventIds.has(eventId),
  };
}

function filterExcludedRows(
  rows: EventRow[],
  excludedEventIds: Set<string>,
  excludedDedupeKeys: Set<string>
): EventRow[] {
  return rows.filter((row) => (
    !excludedEventIds.has(String(row.id)) && !excludedDedupeKeys.has(getEventDedupeKey(row))
  ));
}

function dedupeRows(rows: EventRow[]): EventRow[] {
  const seen = new Set<string>();
  const result: EventRow[] = [];
  for (const row of rows) {
    const key = getEventDedupeKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

function mergeRows(primary: EventRow[], secondary: EventRow[]): EventRow[] {
  return dedupeRows([...primary, ...secondary]).slice(0, CARD_POOL_LIMIT);
}

function pickDiverseTodayCards(cards: ReturnType<typeof toCard>[]) {
  const selected: ReturnType<typeof toCard>[] = [];
  const selectedIds = new Set<string>();
  const byCategory = new Map<string, ReturnType<typeof toCard>[]>();

  for (const card of cards) {
    const category = card.category;
    const bucket = byCategory.get(category) ?? [];
    bucket.push(card);
    byCategory.set(category, bucket);
  }

  for (const category of CATEGORY_PRIORITY) {
    if (selected.length >= TODAY_CARD_COUNT) break;
    const card = byCategory.get(category)?.find((candidate) => !selectedIds.has(candidate.eventId));
    if (!card) continue;
    selected.push(card);
    selectedIds.add(card.eventId);
  }

  if (selected.length < TODAY_CARD_COUNT) {
    for (const card of cards) {
      if (selected.length >= TODAY_CARD_COUNT) break;
      if (selectedIds.has(card.eventId)) continue;
      selected.push(card);
      selectedIds.add(card.eventId);
    }
  }

  return selected;
}

async function getFallbackEvents(
  today: string,
  excludedEventIds: Set<string>,
  excludedDedupeKeys: Set<string>
): Promise<EventRow[]> {
  const excludedIds = Array.from(excludedEventIds);
  const excludedKeys = Array.from(excludedDedupeKeys);
  const { rows } = await pool.query<EventRow>(
    `SELECT id, title, display_title, content_key, canonical_key, main_category, region, start_at, end_at, image_url, venue, overview, lat, lng
     FROM canonical_events
     WHERE is_deleted = false
       AND (end_at IS NULL OR (end_at AT TIME ZONE 'Asia/Seoul')::date >= $1::date)
       AND NOT (id::text = ANY($2::text[]))
       AND NOT (COALESCE(content_key, canonical_key, id::text) = ANY($3::text[]))
     ORDER BY
       CASE
         WHEN start_at <= NOW() AND (end_at IS NULL OR end_at >= NOW()) THEN 0
         WHEN start_at > NOW() THEN 1
         ELSE 2
       END,
       CASE WHEN end_at IS NULL THEN 1 ELSE 0 END,
       end_at ASC,
       buzz_score DESC NULLS LAST
     LIMIT $4`,
    [today, excludedIds, excludedKeys, CARD_QUERY_LIMIT]
  );
  return dedupeRows(filterExcludedRows(rows, excludedEventIds, excludedDedupeKeys)).slice(0, CARD_POOL_LIMIT);
}

async function getNearbyEvents(
  today: string,
  location: LocationQuery,
  excludedEventIds: Set<string>,
  excludedDedupeKeys: Set<string>
): Promise<EventRow[]> {
  const distSQL = getHaversineDistanceSQL('$1', '$2');
  const excludedIds = Array.from(excludedEventIds);
  const excludedKeys = Array.from(excludedDedupeKeys);
  let bestNearbyRows: EventRow[] = [];

  for (const radiusM of NEARBY_RADIUS_STEPS_M) {
    const box = calculateBoundingBox(location.lat, location.lng, radiusM);
    const { rows } = await pool.query<EventRow>(
      `SELECT id, title, display_title, content_key, canonical_key, main_category, region, start_at, end_at, image_url, venue, overview, lat, lng,
              (${distSQL}) AS distance_m
       FROM canonical_events
       WHERE is_deleted = false
         AND (end_at IS NULL OR (end_at AT TIME ZONE 'Asia/Seoul')::date >= $3::date)
         AND NOT (id::text = ANY($4::text[]))
         AND NOT (COALESCE(content_key, canonical_key, id::text) = ANY($5::text[]))
         AND lat IS NOT NULL AND lng IS NOT NULL
         AND lat BETWEEN $6 AND $7
         AND lng BETWEEN $8 AND $9
         AND (${distSQL}) <= $10
       ORDER BY distance_m ASC NULLS LAST, buzz_score DESC NULLS LAST, id ASC
       LIMIT $11`,
      [
        location.lat,
        location.lng,
        today,
        excludedIds,
        excludedKeys,
        box.latMin,
        box.latMax,
        box.lngMin,
        box.lngMax,
        radiusM,
        CARD_QUERY_LIMIT,
      ]
    );

    const nearbyRows = dedupeRows(filterExcludedRows(rows, excludedEventIds, excludedDedupeKeys));
    if (nearbyRows.length > bestNearbyRows.length) bestNearbyRows = nearbyRows;
    if (nearbyRows.length >= CARD_POOL_LIMIT) return nearbyRows.slice(0, CARD_POOL_LIMIT);
  }

  if (bestNearbyRows.length === 0) {
    return getFallbackEvents(today, excludedEventIds, excludedDedupeKeys);
  }

  const fillExcludedIds = new Set([
    ...Array.from(excludedEventIds),
    ...bestNearbyRows.map((row) => String(row.id)),
  ]);
  const fillExcludedKeys = new Set([
    ...Array.from(excludedDedupeKeys),
    ...bestNearbyRows.map(getEventDedupeKey),
  ]);
  const fallbackRows = await getFallbackEvents(today, fillExcludedIds, fillExcludedKeys);
  return mergeRows(bestNearbyRows, fallbackRows);
}

router.get('/today', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const today = todayKst();
  const location = parseLocationQuery(req);
  // 좌표 → 동네명(내 위치 표시용). 쿼리와 병렬, 실패해도 무시.
  const userRegionPromise: Promise<string | null> = location
    ? reverseGeocodeRegion(location.lat, location.lng).catch(() => null)
    : Promise.resolve(null);

  try {
    const [ticketResult, openedResult] = await Promise.all([
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
      pool.query<OpenedEventRow>(
        `SELECT el.event_id,
                el.earn_date,
                COALESCE(ce.content_key, ce.canonical_key, ce.id::text) AS dedupe_key
         FROM user_ticket_earn_log el
         LEFT JOIN canonical_events ce ON ce.id::text = el.event_id::text
         WHERE el.user_id = $1
           AND el.earn_date >= $2::date - (($3::int - 1) * INTERVAL '1 day')`,
        [userId, today, RECENT_OPEN_COOLDOWN_DAYS]
      ),
    ]);

    const ticketRow = ticketResult.rows[0] ?? {};
    const todayOpenedRows = openedResult.rows.filter((row) => dateOnly(row.earn_date) === today);
    const openedEventIds = new Set(todayOpenedRows.map((row) => String(row.event_id)));
    const openedDedupeKeys = new Set(todayOpenedRows.map((row) => row.dedupe_key).filter((key): key is string => !!key));
    const recentEventIds = new Set(openedResult.rows.map((row) => String(row.event_id)));
    const recentDedupeKeys = new Set(openedResult.rows.map((row) => row.dedupe_key).filter((key): key is string => !!key));
    const loadRows = async (eventIds: Set<string>, dedupeKeys: Set<string>) => (
      location
        ? getNearbyEvents(today, location, eventIds, dedupeKeys)
        : getFallbackEvents(today, eventIds, dedupeKeys)
    );
    let rows = await loadRows(recentEventIds, recentDedupeKeys);
    if (rows.length < TODAY_CARD_COUNT && recentEventIds.size > openedEventIds.size) {
      rows = await loadRows(openedEventIds, openedDedupeKeys);
    }
    const cards = rows
      .map((row) => toCard(row, openedEventIds, location))
      .filter((card) => !card.opened);
    const todayCards = pickDiverseTodayCards(cards);
    const todayIds = new Set(todayCards.map((card) => card.eventId));
    const morePool = cards.filter((card) => !todayIds.has(card.eventId));
    const dailyEarnedDate = ticketRow.daily_earned_date ? String(ticketRow.daily_earned_date).slice(0, 10) : null;
    const userRegion = await userRegionPromise;

    return res.json({
      today: todayCards,
      morePool,
      ticketCount: ticketRow.ticket_count ?? 0,
      dailyEarned: dailyEarnedDate === today ? (ticketRow.daily_earned ?? 0) : 0,
      dailyLimit: DAILY_LIMIT,
      userRegion,
    });
  } catch (err) {
    console.error('[Cards] today error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
