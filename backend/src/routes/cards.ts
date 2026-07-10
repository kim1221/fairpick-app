import express, { Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/requireAuth';
import { calculateBoundingBox, getHaversineDistanceSQL } from '../utils/geo';
import { reverseGeocodeRegion } from '../lib/geocode';
import { openLockedCard, sealLockedCard } from '../services/cardToken';
import {
  DAILY_OPEN_LIMIT,
  DAILY_TICKET_LIMIT,
  grantTicketsForEvent,
  TicketGrantError,
} from '../services/ticketGrant';

const router = express.Router();

const DAILY_LIMIT = DAILY_TICKET_LIMIT;
const TODAY_CARD_COUNT = 3;
const WEEKLY_CARD_COUNT = 3;
const CARD_POOL_LIMIT = 12;           // 최종 노출(오늘+더보기) 상한
const CANDIDATE_LIMIT = 300;          // 헤비 유저도 하루 50장을 열 수 있는 회전 여유
const MIN_ROTATION_POOL = 60;         // 이만큼 모이면 반경 확장 중단(회전 풀 확보)
const RECENT_OPEN_COOLDOWN_DAYS = 14; // 연(광고 본) 카드 재등장 방지
const IMPRESSION_COOLDOWN_DAYS = 7;   // 최근 보여준 카드 소프트 제외(매일 새 발견)
const FRESHNESS_WINDOW_DAYS = 60;     // created_at 신선도 감쇠 창
const TASTE_WINDOW_DAYS = 90;         // 취향 신호 집계 창
const WALK_METERS_PER_MINUTE = 80;
const NEARBY_RADIUS_STEPS_M = [3000, 10000, 50000] as const;
const CATEGORY_PRIORITY = ['전시', '공연', '팝업', '축제', '기타'] as const;
// 공급 점수 가중치(합=1): 근접·신선도·일별로테이션·취향·버즈
const W_PROXIMITY = 0.35;
const W_FRESHNESS = 0.25;
const W_JITTER = 0.20;
const W_TASTE = 0.12;
const W_BUZZ = 0.08;

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
  buzz_score?: number | string | null;
  created_at?: string | Date | null;
};

type TasteRow = { category: string | null; n: number | string; signal_count?: number | string };
type ImpressionRow = { event_id: string };
type TasteMap = Map<string, number>;
type WeeklyOpenedEventRow = EventRow & { earn_date: string | Date | null; total_count?: number | string };

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

function hashStr(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 시드 기반 0..1 난수(mulberry32) — 유저·날짜별로 매일 다르지만 하루 안에서는 안정적인 순서를 만든다
function seededUnit(seed: number): number {
  let a = seed >>> 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function dailySeed(userId: string, today: string): number {
  return hashStr(`${userId}|${today}`);
}

function weekKeyKst(today: string): string {
  const [year, month, day] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  const dayOfWeek = date.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

function dateKeyDaysBefore(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function weeklySeed(userId: string, weekKey: string): number {
  return hashStr(`${userId}|week|${weekKey}`);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// created_at이 최근일수록 1에 가깝게(신규 등록 이벤트 우선 노출), 창 초과 시 0
function freshnessScore(createdAt: string | Date | null | undefined): number {
  if (!createdAt) return 0;
  const created = createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt));
  if (Number.isNaN(created)) return 0;
  const days = (Date.now() - created) / (24 * 60 * 60 * 1000);
  return clamp01(1 - days / FRESHNESS_WINDOW_DAYS);
}

// 0.1 버킷 → 비슷한 거리끼리 동점 처리(지터/신선도/취향이 그 안에서 회전)
function proximityScore(distanceM: number | null): number {
  if (distanceM == null) return 0.5; // 위치 없음 = 중립
  const raw = clamp01(1 - distanceM / 30000);
  return Math.round(raw * 10) / 10;
}

function scoreRow(row: EventRow, ctx: { location: LocationQuery | null; taste: TasteMap; seed: number }): number {
  const distanceM = getDistanceMeters(row, ctx.location);
  const buzz = clamp01((toNumberOrNull(row.buzz_score) ?? 0) / 100);
  const taste = ctx.taste.get(normalizeCategory(row.main_category)) ?? 0;
  const jitter = seededUnit(hashStr(String(row.id)) ^ ctx.seed);
  return (
    W_PROXIMITY * proximityScore(distanceM) +
    W_FRESHNESS * freshnessScore(row.created_at) +
    W_JITTER * jitter +
    W_TASTE * taste +
    W_BUZZ * buzz
  );
}

function buildTasteCounts(rows: TasteRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.category) continue;
    const cat = normalizeCategory(r.category);
    counts.set(cat, (counts.get(cat) ?? 0) + Number(r.n));
  }
  return counts;
}

// 취향맵: 카드 열기(1) + 좋아요(3) + 도장(4)의 가중 신호를 0..1로 정규화
function buildTasteMap(rows: TasteRow[]): TasteMap {
  const counts = buildTasteCounts(rows);
  const max = Math.max(1, ...counts.values());
  const taste: TasteMap = new Map();
  for (const [cat, n] of counts) taste.set(cat, n / max);
  return taste;
}

function buildPersonalization(rows: TasteRow[], taste: TasteMap) {
  const counts = buildTasteCounts(rows);
  const signalCount = rows.reduce((sum, row) => sum + Number(row.signal_count ?? row.n ?? 0), 0);
  const topCategories = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .slice(0, 3)
    .map(([category, signals]) => ({
      category,
      score: Number((taste.get(category) ?? 0).toFixed(2)),
      signals,
    }));

  return {
    level: signalCount === 0 ? 'cold' : signalCount < 5 ? 'growing' : 'established',
    signalCount,
    topCategories,
  };
}

function recommendationReasons(row: EventRow, location: LocationQuery | null, taste: TasteMap): string[] {
  const reasons: string[] = [];
  const distanceM = getDistanceMeters(row, location);
  const category = normalizeCategory(row.main_category);
  const tasteScore = taste.get(category) ?? 0;
  const dday = calculateDday(row.end_at);

  if (distanceM != null && distanceM <= 3000) reasons.push('내 주변');
  if (tasteScore >= 0.5) reasons.push(`취향 ${category}`);
  if (freshnessScore(row.created_at) >= 0.7) reasons.push('새로 등록');
  if (dday != null && dday >= 0 && dday <= 7) reasons.push('곧 마감');
  return reasons.slice(0, 2);
}

function toCard(
  row: EventRow,
  openedEventIds: Set<string>,
  location: LocationQuery | null,
  taste: TasteMap,
) {
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
    reasonTags: recommendationReasons(row, location, taste),
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
  return dedupeRows([...primary, ...secondary]).slice(0, CANDIDATE_LIMIT);
}

function pickDiverseCards(cards: ReturnType<typeof toCard>[], count: number) {
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
    if (selected.length >= count) break;
    const card = byCategory.get(category)?.find((candidate) => !selectedIds.has(candidate.eventId));
    if (!card) continue;
    selected.push(card);
    selectedIds.add(card.eventId);
  }

  if (selected.length < count) {
    for (const card of cards) {
      if (selected.length >= count) break;
      if (selectedIds.has(card.eventId)) continue;
      selected.push(card);
      selectedIds.add(card.eventId);
    }
  }

  return selected;
}

function pickDiverseTodayCards(cards: ReturnType<typeof toCard>[]) {
  return pickDiverseCards(cards, TODAY_CARD_COUNT);
}

async function getFallbackEvents(
  today: string,
  excludedEventIds: Set<string>,
  excludedDedupeKeys: Set<string>
): Promise<EventRow[]> {
  const excludedIds = Array.from(excludedEventIds);
  const excludedKeys = Array.from(excludedDedupeKeys);
  const { rows } = await pool.query<EventRow>(
    `SELECT id, title, display_title, content_key, canonical_key, main_category, region, start_at, end_at, image_url, venue, overview, lat, lng, buzz_score, created_at
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
    [today, excludedIds, excludedKeys, CANDIDATE_LIMIT]
  );
  return dedupeRows(filterExcludedRows(rows, excludedEventIds, excludedDedupeKeys)).slice(0, CANDIDATE_LIMIT);
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
      `SELECT id, title, display_title, content_key, canonical_key, main_category, region, start_at, end_at, image_url, venue, overview, lat, lng, buzz_score, created_at,
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
        CANDIDATE_LIMIT,
      ]
    );

    const nearbyRows = dedupeRows(filterExcludedRows(rows, excludedEventIds, excludedDedupeKeys));
    if (nearbyRows.length > bestNearbyRows.length) bestNearbyRows = nearbyRows;
    // 회전 풀(MIN_ROTATION_POOL)이 확보되면 반경 확장 중단 — 근처를 넓게 받아 JS에서 매일 다르게 뽑는다
    if (nearbyRows.length >= MIN_ROTATION_POOL) return nearbyRows.slice(0, CANDIDATE_LIMIT);
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

function lockedTimingLabel(dday: number | null): string {
  if (dday == null) return '일정 확인 중';
  if (dday === 0) return '오늘 마감';
  if (dday === 1) return '내일 마감';
  if (dday > 1 && dday <= 7) return `${dday}일 안에 마감`;
  return '일정 여유가 있어요';
}

type CardNewsPalette = {
  background: string;
  foreground: string;
  accent: string;
};

const CARD_NEWS_PALETTES: Record<string, CardNewsPalette[]> = {
  전시: [
    { background: '#EFE9D8', foreground: '#171717', accent: '#A52822' },
    { background: '#D8D3C7', foreground: '#171717', accent: '#27264C' },
  ],
  공연: [
    { background: '#171717', foreground: '#F3EDDE', accent: '#A52822' },
    { background: '#70211F', foreground: '#F5EDDA', accent: '#171717' },
  ],
  팝업: [
    { background: '#A52822', foreground: '#F5EDDA', accent: '#171717' },
    { background: '#E1C9B5', foreground: '#171717', accent: '#A52822' },
  ],
  축제: [
    { background: '#D1A84B', foreground: '#171717', accent: '#70211F' },
    { background: '#27264C', foreground: '#F5EDDA', accent: '#A52822' },
  ],
  기타: [
    { background: '#D8D3C7', foreground: '#171717', accent: '#A52822' },
    { background: '#171717', foreground: '#F5EDDA', accent: '#D1A84B' },
  ],
};

function chooseStable<T>(items: T[], seed: number): T {
  if (items.length === 0) throw new Error('EMPTY_STABLE_CHOICE');
  return items[Math.abs(seed) % items.length]!;
}

function buildTeaserCopy(
  card: ReturnType<typeof toCard>,
  isRevisit: boolean,
  seed: number,
): { eyebrow: string; headline: string; palette: CardNewsPalette } {
  const category = card.category || '기타';
  const palettes = CARD_NEWS_PALETTES[category] ?? CARD_NEWS_PALETTES.기타!;
  const palette = chooseStable(palettes, seed);
  const hooks: Array<{ eyebrow: string; headline: string }> = [];
  const hasTasteReason = card.reasonTags.some((reason) => reason.startsWith('취향 '));
  const isFresh = card.reasonTags.includes('새로 등록');

  if (isRevisit) {
    hooks.push(
      { eyebrow: '다시 추천', headline: `지금 다시 떠오른\n${category} 한 곳` },
      { eyebrow: '놓치기 아까워서', headline: `한 번 더 골라본\n가까운 ${category}` },
    );
  }
  if (card.dday != null && card.dday >= 0 && card.dday <= 7) {
    hooks.push(
      { eyebrow: `${card.dday === 0 ? '오늘' : `${card.dday}일 안에`} 마감`, headline: `이번 주가 지나기 전에\n열어볼 ${category}` },
      { eyebrow: '곧 마감', headline: `지금 놓치기 아까운\n${category} 한 곳` },
    );
  }
  if (card.walkMinutes != null && card.walkMinutes <= 40) {
    hooks.push(
      { eyebrow: `도보 ${card.walkMinutes}분`, headline: `산책 끝에 만나는\n가까운 ${category}` },
      { eyebrow: '내 주변 발견', headline: `익숙한 동네에서\n열어볼 ${category}` },
    );
  }
  if (hasTasteReason) {
    hooks.push(
      { eyebrow: `${category} 취향을 따라`, headline: `요즘의 관심사로 고른\n오늘의 한 곳` },
      { eyebrow: '취향 추천', headline: `당신의 반응에서 찾은\n새로운 ${category}` },
    );
  }
  if (isFresh) {
    hooks.push(
      { eyebrow: '이번 주 새로 발견', headline: `지금 처음 꺼내보는\n새로운 ${category}` },
      { eyebrow: '새로 등록', headline: `오늘의 목록에 더해진\n${category} 한 곳` },
    );
  }

  const fallbackByCategory: Record<string, string[]> = {
    전시: ['오늘의 시선을 바꿔줄\n전시 한 곳', '평범한 하루에 더해볼\n새로운 장면'],
    공연: ['오늘의 리듬을 바꿔줄\n가까운 무대', '직접 마주하고 싶은\n공연 한 편'],
    팝업: ['잠깐 열려 있을 때\n들러볼 공간', '새로운 취향을 만나는\n팝업 한 곳'],
    축제: ['하루의 온도를 바꿔줄\n가까운 축제', '이번 주에 더해볼\n활기찬 장면'],
    기타: ['오늘 가볍게 열어볼\n문화 한 곳', '평범한 하루에 더해볼\n새로운 발견'],
  };
  const fallbacks = fallbackByCategory[category] ?? fallbackByCategory.기타!;
  hooks.push(...fallbacks.map((headline) => ({ eyebrow: '오늘의 큐레이션', headline })));

  const hook = chooseStable(hooks, seed ^ hashStr(card.eventId));
  return { ...hook, palette };
}

function toLockedPreview(
  card: ReturnType<typeof toCard>,
  userId: string,
  today: string,
  isRevisit: boolean,
  variant: number,
) {
  const teaser = buildTeaserCopy(card, isRevisit, hashStr(`${card.eventId}|${today}|${variant}`));
  return {
    cardToken: sealLockedCard({
      userId,
      eventId: card.eventId,
      assignedOn: today,
      walkMinutes: card.walkMinutes,
      reasonTags: card.reasonTags,
    }),
    category: card.category,
    areaLabel: card.region,
    distanceLabel: card.walkMinutes == null ? null : `도보 ${card.walkMinutes}분`,
    timingLabel: lockedTimingLabel(card.dday),
    reasonTags: card.reasonTags,
    teaserEyebrow: teaser.eyebrow,
    teaserHeadline: teaser.headline,
    palette: teaser.palette,
    isRevisit,
  };
}

/**
 * v2: 큐레이션 결과 자체를 잠긴 카드로 제공한다.
 * 제목·장소·이미지·eventId는 광고 전 응답에 포함하지 않는다.
 */
router.get('/v2/today', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const today = todayKst();
  const weekKey = weekKeyKst(today);
  const location = parseLocationQuery(req);
  const userRegionPromise: Promise<string | null> = location
    ? reverseGeocodeRegion(location.lat, location.lng).catch(() => null)
    : Promise.resolve(null);

  try {
    const [ticketResult, discoveredResult, tasteResult, impressionResult, weeklyOpenedResult] = await Promise.all([
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
         FROM user_tickets WHERE user_id = $1
         LIMIT 1`,
        [userId],
      ),
      // 미발견을 최우선으로 고르고, 공급이 부족할 때만 오래된 발견을 다시 추천한다.
      pool.query<OpenedEventRow>(
        `SELECT el.event_id,
                el.earn_date,
                COALESCE(ce.content_key, ce.canonical_key, ce.id::text) AS dedupe_key
         FROM user_ticket_earn_log el
         LEFT JOIN canonical_events ce ON ce.id::text = el.event_id::text
         WHERE el.user_id = $1`,
        [userId],
      ),
      pool.query<TasteRow>(
        `SELECT ce.main_category AS category,
                SUM(src.weight)::int AS n,
                COUNT(*)::int AS signal_count
         FROM (
           SELECT event_id, 1::int AS weight FROM user_ticket_earn_log
             WHERE user_id = $1 AND earn_date >= $2::date - (($3::int - 1) * INTERVAL '1 day')
           UNION ALL
           SELECT event_id, 3::int AS weight FROM user_likes WHERE user_id = $1
           UNION ALL
           SELECT event_id, 4::int AS weight FROM user_visit_log WHERE user_id = $1
         ) src
         JOIN canonical_events ce ON ce.id::text = src.event_id::text
         WHERE ce.main_category IS NOT NULL
         GROUP BY ce.main_category`,
        [userId, today, TASTE_WINDOW_DAYS],
      ).catch(() => ({ rows: [] as TasteRow[] })),
      // 오늘 배정한 3장은 새로고침해도 유지하고, 이전 7일 노출만 소프트 제외한다.
      pool.query<ImpressionRow>(
        `SELECT event_id FROM user_card_impressions
         WHERE user_id = $1
           AND last_shown_on >= $2::date - (($3::int - 1) * INTERVAL '1 day')
           AND last_shown_on < $2::date`,
        [userId, today, IMPRESSION_COOLDOWN_DAYS],
      ).catch(() => ({ rows: [] as ImpressionRow[] })),
      pool.query<WeeklyOpenedEventRow>(
        `SELECT ce.id, ce.title, ce.display_title, ce.content_key, ce.canonical_key,
                ce.main_category, ce.region, ce.start_at, ce.end_at, ce.image_url,
                ce.venue, ce.overview, ce.lat, ce.lng, ce.buzz_score, ce.created_at,
                MAX(el.earn_date) AS earn_date,
                COUNT(*) OVER()::int AS total_count
         FROM user_ticket_earn_log el
         JOIN canonical_events ce ON ce.id::text = el.event_id::text
         WHERE el.user_id = $1
           AND el.earn_date >= $2::date
           AND ce.is_deleted = false
         GROUP BY ce.id
         ORDER BY MAX(el.earn_date) DESC, ce.id
         LIMIT 7`,
        [userId, weekKey],
      ).catch(() => ({ rows: [] as WeeklyOpenedEventRow[] })),
    ]);

    const discoveredEventIds = new Set(discoveredResult.rows.map((row) => String(row.event_id)));
    const discoveredDedupeKeys = new Set(
      discoveredResult.rows.map((row) => row.dedupe_key).filter((key): key is string => !!key),
    );
    const todayOpenedRows = discoveredResult.rows.filter((row) => dateOnly(row.earn_date) === today);
    const recentCutoff = dateKeyDaysBefore(today, RECENT_OPEN_COOLDOWN_DAYS - 1);
    const recentOpenedRows = discoveredResult.rows.filter((row) => {
      const openedOn = dateOnly(row.earn_date);
      return openedOn != null && openedOn >= recentCutoff;
    });
    const setsFor = (openedRows: OpenedEventRow[]) => ({
      ids: new Set(openedRows.map((row) => String(row.event_id))),
      keys: new Set(openedRows.map((row) => row.dedupe_key).filter((key): key is string => !!key)),
    });
    const todayOpened = setsFor(todayOpenedRows);
    const recentOpened = setsFor(recentOpenedRows);
    const loadRows = (ids: Set<string>, keys: Set<string>) => (
      location ? getNearbyEvents(today, location, ids, keys) : getFallbackEvents(today, ids, keys)
    );

    // 1) 평생 미발견 우선 → 2) 14일 지난 발견 허용 → 3) 오늘만 제외해 빈 화면 방지.
    let rows = await loadRows(discoveredEventIds, discoveredDedupeKeys);
    if (rows.length < TODAY_CARD_COUNT) {
      rows = mergeRows(rows, await loadRows(recentOpened.ids, recentOpened.keys));
    }
    if (rows.length < TODAY_CARD_COUNT) {
      rows = mergeRows(rows, await loadRows(todayOpened.ids, todayOpened.keys));
    }
    const revisitEventIds = new Set(rows
      .filter((row) => (
        discoveredEventIds.has(String(row.id)) || discoveredDedupeKeys.has(getEventDedupeKey(row))
      ))
      .map((row) => String(row.id)));
    const seed = dailySeed(userId, today);
    const taste = buildTasteMap(tasteResult.rows);
    const scoreById = new Map<string, number>();
    for (const row of rows) scoreById.set(String(row.id), scoreRow(row, { location, taste, seed }));

    const cards = rows.map((row) => toCard(row, new Set<string>(), location, taste));
    const previousImpressionIds = new Set(impressionResult.rows.map((row) => String(row.event_id)));
    const freshCards = cards.filter((card) => !previousImpressionIds.has(card.eventId));
    const scored = (freshCards.length >= TODAY_CARD_COUNT ? freshCards : cards)
      .slice()
      .sort((a, b) => (scoreById.get(b.eventId) ?? 0) - (scoreById.get(a.eventId) ?? 0));
    const dailyOpenCount = todayOpenedRows.length;
    const selected = dailyOpenCount >= DAILY_OPEN_LIMIT ? [] : pickDiverseTodayCards(scored);

    const shownIds = selected.map((card) => card.eventId);
    if (shownIds.length > 0) {
      setImmediate(() => {
        pool.query(
          `INSERT INTO user_card_impressions (user_id, event_id, last_shown_on, shown_count)
           SELECT $1, e, $2::date, 1 FROM unnest($3::text[]) AS e
           ON CONFLICT (user_id, event_id)
           DO UPDATE SET last_shown_on = EXCLUDED.last_shown_on,
                         shown_count = user_card_impressions.shown_count + 1`,
          [userId, today, shownIds],
        ).catch((e) => console.error('[Cards] v2 impression log failed:', e?.message ?? e));
      });
    }

    const ticketRow = ticketResult.rows[0] ?? {};
    const dailyEarnedDate = ticketRow.daily_earned_date ? String(ticketRow.daily_earned_date).slice(0, 10) : null;
    const weeklyOpenedIds = new Set(weeklyOpenedResult.rows.map((row) => String(row.id)));
    const weeklyItems = dedupeRows(weeklyOpenedResult.rows)
      .map((row) => toCard(row, weeklyOpenedIds, location, taste));
    const weeklyOpenedCount = Number(weeklyOpenedResult.rows[0]?.total_count ?? weeklyItems.length);

    return res.json({
      lockedCards: selected.map((card, index) => toLockedPreview(
        card,
        userId,
        today,
        revisitEventIds.has(card.eventId),
        index,
      )),
      ticketCount: ticketRow.ticket_count ?? 0,
      dailyEarned: dailyEarnedDate === today ? (ticketRow.daily_earned ?? 0) : 0,
      dailyLimit: DAILY_LIMIT,
      dailyOpenCount,
      dailyOpenLimit: DAILY_OPEN_LIMIT,
      userRegion: await userRegionPromise,
      weeklyDiscovery: {
        weekKey,
        openedCount: weeklyOpenedCount,
        goal: DAILY_OPEN_LIMIT,
        items: weeklyItems,
      },
      personalization: buildPersonalization(tasteResult.rows, taste),
    });
  } catch (err) {
    console.error('[Cards] v2 today error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/** 광고 보상 확인과 카드 공개, 티켓 지급을 한 트랜잭션으로 처리한다. */
router.post('/v2/open', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { cardToken, adAttemptId } = req.body as { cardToken?: unknown; adAttemptId?: unknown };
  if (typeof cardToken !== 'string' || typeof adAttemptId !== 'string') {
    return res.status(400).json({ error: 'INVALID_OPEN_PAYLOAD' });
  }
  const tokenPayload = openLockedCard(cardToken);
  const today = todayKst();
  if (!tokenPayload || tokenPayload.userId !== userId || tokenPayload.assignedOn !== today) {
    return res.status(403).json({ error: 'INVALID_OR_EXPIRED_CARD' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const adResult = await client.query(
      `SELECT attempt_id
       FROM ad_reward_attempts
       WHERE attempt_id = $1
         AND user_id = $2
         AND reward_at IS NOT NULL
         AND metadata->>'cardToken' = $3
       FOR UPDATE`,
      [adAttemptId, userId, cardToken],
    );
    if (adResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'AD_REWARD_NOT_CONFIRMED' });
    }

    const eventResult = await client.query<EventRow>(
      `SELECT id, title, display_title, content_key, canonical_key, main_category, region,
              start_at, end_at, image_url, venue, overview, lat, lng, buzz_score, created_at
       FROM canonical_events
       WHERE id::text = $1
         AND is_deleted = false
         AND (end_at IS NULL OR (end_at AT TIME ZONE 'Asia/Seoul')::date >= $2::date)
       LIMIT 1`,
      [tokenPayload.eventId, today],
    );
    if (eventResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'CARD_EVENT_UNAVAILABLE' });
    }

    const reward = await grantTicketsForEvent(client, {
      userId,
      eventId: tokenPayload.eventId,
      today,
      adAttemptId,
    });
    await client.query('COMMIT');

    const fullCard = toCard(eventResult.rows[0]!, new Set([tokenPayload.eventId]), null, new Map());
    fullCard.walkMinutes = tokenPayload.walkMinutes;
    fullCard.reasonTags = tokenPayload.reasonTags;
    return res.json({ card: fullCard, ...reward });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof TicketGrantError) {
      return res.status(err.status).json({ error: err.code, ...err.details });
    }
    console.error('[Cards] v2 open error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

router.get('/today', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const today = todayKst();
  const location = parseLocationQuery(req);
  // 좌표 → 동네명(내 위치 표시용). 쿼리와 병렬, 실패해도 무시.
  const userRegionPromise: Promise<string | null> = location
    ? reverseGeocodeRegion(location.lat, location.lng).catch(() => null)
    : Promise.resolve(null);

  try {
    const [ticketResult, openedResult, tasteResult, impressionResult] = await Promise.all([
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
      // 취향 신호: 카드 열기(1) + 좋아요(3) + 도장(4). 강한 의도일수록 더 크게 반영한다.
      pool.query<TasteRow>(
        `SELECT ce.main_category AS category,
                SUM(src.weight)::int AS n,
                COUNT(*)::int AS signal_count
         FROM (
           SELECT event_id, 1::int AS weight FROM user_ticket_earn_log
             WHERE user_id = $1 AND earn_date >= $2::date - (($3::int - 1) * INTERVAL '1 day')
           UNION ALL
           SELECT event_id, 3::int AS weight FROM user_likes WHERE user_id = $1
           UNION ALL
           SELECT event_id, 4::int AS weight FROM user_visit_log WHERE user_id = $1
         ) src
         JOIN canonical_events ce ON ce.id::text = src.event_id::text
         WHERE ce.main_category IS NOT NULL
         GROUP BY ce.main_category`,
        [userId, today, TASTE_WINDOW_DAYS]
      ).catch(() => ({ rows: [] as TasteRow[] })),
      // 최근 노출한 카드(소프트 제외용) — 테이블 없거나 실패해도 무시
      pool.query<ImpressionRow>(
        `SELECT event_id FROM user_card_impressions
         WHERE user_id = $1 AND last_shown_on >= $2::date - (($3::int - 1) * INTERVAL '1 day')`,
        [userId, today, IMPRESSION_COOLDOWN_DAYS]
      ).catch(() => ({ rows: [] as ImpressionRow[] })),
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

    // 점수화 v2: 근접+신선도+일별시드+취향+버즈로 재랭킹 → 매일 다른 순서·새 이벤트 우선
    const seed = dailySeed(userId, today);
    const weekKey = weekKeyKst(today);
    const taste = buildTasteMap(tasteResult.rows);
    const personalization = buildPersonalization(tasteResult.rows, taste);
    const recentImpressionIds = new Set(impressionResult.rows.map((row) => String(row.event_id)));
    const scoreById = new Map<string, number>();
    for (const row of rows) scoreById.set(String(row.id), scoreRow(row, { location, taste, seed }));

    const cards = rows
      .map((row) => toCard(row, openedEventIds, location, taste))
      .filter((card) => !card.opened);

    // 최근 보여준 카드는 소프트 제외(제외 후 풀이 부족하면 완화해 빈 화면 방지)
    const notRecentlyShown = cards.filter((card) => !recentImpressionIds.has(card.eventId));
    const scored = (notRecentlyShown.length >= TODAY_CARD_COUNT ? notRecentlyShown : cards)
      .slice()
      .sort((a, b) => (scoreById.get(b.eventId) ?? 0) - (scoreById.get(a.eventId) ?? 0));

    const todayCards = pickDiverseTodayCards(scored);
    const todayIds = new Set(todayCards.map((card) => card.eventId));
    const morePool = scored.filter((card) => !todayIds.has(card.eventId)).slice(0, CARD_POOL_LIMIT);
    const dailyEarnedDate = ticketRow.daily_earned_date ? String(ticketRow.daily_earned_date).slice(0, 10) : null;
    const userRegion = await userRegionPromise;
    const weeklyScoreById = new Map<string, number>();
    for (const row of rows) {
      weeklyScoreById.set(String(row.id), scoreRow(row, {
        location,
        taste,
        seed: weeklySeed(userId, weekKey),
      }));
    }
    const weeklyItems = pickDiverseCards(
      cards.slice().sort((a, b) => (
        (weeklyScoreById.get(b.eventId) ?? 0) - (weeklyScoreById.get(a.eventId) ?? 0)
      )),
      WEEKLY_CARD_COUNT,
    );

    // 오늘 보여준 카드를 노출 기록(fire-and-forget) — 응답을 막지 않고 실패해도 무시
    const shownIds = todayCards.map((card) => card.eventId);
    if (shownIds.length > 0) {
      setImmediate(() => {
        pool.query(
          `INSERT INTO user_card_impressions (user_id, event_id, last_shown_on, shown_count)
           SELECT $1, e, $2::date, 1 FROM unnest($3::text[]) AS e
           ON CONFLICT (user_id, event_id)
           DO UPDATE SET last_shown_on = EXCLUDED.last_shown_on,
                         shown_count = user_card_impressions.shown_count + 1`,
          [userId, today, shownIds]
        ).catch((e) => console.error('[Cards] impression log failed:', e?.message ?? e));
      });
    }

    return res.json({
      today: todayCards,
      morePool,
      ticketCount: ticketRow.ticket_count ?? 0,
      dailyEarned: dailyEarnedDate === today ? (ticketRow.daily_earned ?? 0) : 0,
      dailyLimit: DAILY_LIMIT,
      userRegion,
      weeklyCuration: {
        weekKey,
        region: userRegion,
        title: userRegion ? `${userRegion} 이번 주 문화 3선` : '이번 주 문화 3선',
        subtitle: '월요일마다 새로 고른 가까운 문화예요',
        items: weeklyItems,
      },
      personalization,
    });
  } catch (err) {
    console.error('[Cards] today error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
