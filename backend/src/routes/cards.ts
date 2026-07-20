import express, { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import { pool } from '../db';
import { requireAuth } from '../middleware/requireAuth';
import { calculateBoundingBox, getHaversineDistanceSQL } from '../utils/geo';
import { reverseGeocodeRegion } from '../lib/geocode';
import { openLockedCard, sealLockedCard, type CardSlotType } from '../services/cardToken';
import { normalizeCategory, normalizedCategorySql } from '../services/cardCategory';
import {
  applyCollectionProgress,
  findCollectionAssistCandidates,
  type CollectionProgressEntry,
} from '../services/collections';
import {
  DAILY_OPEN_LIMIT,
  DAILY_TICKET_LIMIT,
  computeDailyOpenCap,
  grantTicketsForEvent,
  resolveEffectiveOpenLimit,
  TicketGrantError,
} from '../services/ticketGrant';

const router = express.Router();

const DAILY_LIMIT = DAILY_TICKET_LIMIT;
// 주간 발견 목표 — 동적 캡 도입으로 DAILY_OPEN_LIMIT 재사용을 중단(스펙 §10-6). 3장×7일.
const WEEKLY_DISCOVERY_GOAL = 21;
const TODAY_CARD_COUNT = 3;
const WEEKLY_CARD_COUNT = 3;
const CARD_POOL_LIMIT = 12;           // 최종 노출(오늘+더보기) 상한
const CANDIDATE_LIMIT = 300;          // 헤비 유저도 하루 50장을 열 수 있는 회전 여유
const IMPRESSION_COOLDOWN_DAYS = 7;   // 최근 보여준 카드 소프트 제외(매일 새 발견)
const FRESHNESS_WINDOW_DAYS = 60;     // created_at 신선도 감쇠 창
const TASTE_WINDOW_DAYS = 90;         // 취향 신호 집계 창
const WALK_METERS_PER_MINUTE = 80;
const NEARBY_RADIUS_STEPS_M = [3000, 10000, 50000] as const;
const PRIMARY_CATEGORIES = ['전시', '공연', '팝업'] as const;
const CATEGORY_PRIORITY = [...PRIMARY_CATEGORIES, '축제', '기타'] as const;
const CATEGORY_CANDIDATE_LIMIT = Math.ceil(CANDIDATE_LIMIT / CATEGORY_PRIORITY.length);
// ── "?" 미스터리 슬롯 (스펙 §3.2·§3.3, /v2 전용) ─────────────────────────────
// 위치는 3번째 고정(스펙 §3.1 시안 배치). 셔플 여부는 G2 오픈이슈(§10-3) — 튜닝 노브.
const MYSTERY_SLOT_INDEX = TODAY_CARD_COUNT - 1;
// 공급 우선순위 확률(스펙 §3.2, 합=1) — 튜닝 노브.
// 어시스트 후보가 없으면(진행 중 세트 없음/조건 불일치) 탐험 → 와일드 순으로 흘러내린다.
const MYSTERY_ASSIST_PROBABILITY = 0.60;
const MYSTERY_EXPLORE_PROBABILITY = 0.25;
// 탐험의 "취향 상위 카테고리" 판정 임계 — recommendationReasons의 취향 태그 기준(0.5)과 동일.
const MYSTERY_TASTE_TOP_THRESHOLD = 0.5;
// 히든 카드 buzz 임계(스펙 §3.2 "buzz 상위" 근사) — 튜닝 노브.
const HIDDEN_BUZZ_MIN = 70;
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
  metadata?: Record<string, unknown> | null;
};

type TasteRow = { category: string | null; n: number | string; signal_count?: number | string };
type ImpressionRow = { event_id: string };
type TasteMap = Map<string, number>;
type WeeklyOpenedEventRow = EventRow & { earn_date: string | Date | null; total_count?: number | string };
type DailyOpenedCountRow = { count: number | string };
type DailySlotEventRow = EventRow & {
  slot_index: number | string;
  slot_category: string;
  slot_event_id: string;
  slot_usable: boolean;
  slot_type?: string | null;
};

type DailyCardAssignment = {
  slotIndex: number;
  card: ReturnType<typeof toCard>;
  slotType: CardSlotType;
};

type MysterySlotContext = {
  slotIndex: number;
  taste: TasteMap;
  buzzById: ReadonlyMap<string, number>;
  assistByEventId: ReadonlyMap<string, number>;
};

type LocationQuery = {
  lat: number;
  lng: number;
};

async function acquireUserCardLock(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext('culturecard-open'))`,
    [userId],
  );
}

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

function visibleEndAt(row: EventRow): string | Date | null {
  const openEnded = row.metadata?.popga_open_ended;
  return openEnded === true || openEnded === 'true' ? null : row.end_at;
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
  const dday = calculateDday(visibleEndAt(row));

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
    endAt: isoOrNull(visibleEndAt(row)),
    dday: calculateDday(visibleEndAt(row)),
    imageUrl: row.image_url,
    walkMinutes: distanceM == null ? null : Math.max(1, Math.ceil(distanceM / WALK_METERS_PER_MINUTE)),
    blurb: firstLine(row.overview),
    opened: openedEventIds.has(eventId),
    reasonTags: recommendationReasons(row, location, taste),
  };
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

function categoryCounts(rows: EventRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const category = normalizeCategory(row.main_category);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return counts;
}

function requiredCategoryCounts(categories: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const category of categories) {
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return counts;
}

function hasRequiredCategoryCoverage(
  rows: EventRow[],
  requiredCounts: ReadonlyMap<string, number>,
): boolean {
  const counts = categoryCounts(rows);
  return [...requiredCounts].every(
    ([category, required]) => (counts.get(category) ?? 0) >= required,
  );
}

function mergeRequiredCategoryBuckets(
  current: EventRow[],
  incoming: EventRow[],
  requiredCounts: ReadonlyMap<string, number>,
): EventRow[] {
  const counts = categoryCounts(current);
  const underfilledCategories = new Set(
    [...requiredCounts]
      .filter(([category, required]) => (counts.get(category) ?? 0) < required)
      .map(([category]) => category),
  );
  // 첫 반경에서는 대체 카테고리도 함께 확보한다. 이후 반경은 아직 부족한
  // 카테고리만 넓혀 가까운 기존 슬롯 후보가 더 먼 카드에 밀리지 않게 한다.
  const seedAlternativeBuckets = current.length < TODAY_CARD_COUNT;
  const additions = incoming.filter((row) => (
    seedAlternativeBuckets || underfilledCategories.has(normalizeCategory(row.main_category))
  ));
  return dedupeRows([...current, ...additions]).slice(0, CANDIDATE_LIMIT);
}

function pickDiverseCards(cards: ReturnType<typeof toCard>[], count: number) {
  return pickDiverseCardsByPriority(cards, count, CATEGORY_PRIORITY);
}

function pickDiverseCardsByPriority(
  cards: ReturnType<typeof toCard>[],
  count: number,
  categoryPriority: readonly string[],
  preferredEventIds: ReadonlySet<string> = new Set<string>(),
) {
  const selected: ReturnType<typeof toCard>[] = [];
  const selectedIds = new Set<string>();
  const byCategory = new Map<string, ReturnType<typeof toCard>[]>();

  for (const card of cards) {
    const category = card.category;
    const bucket = byCategory.get(category) ?? [];
    bucket.push(card);
    byCategory.set(category, bucket);
  }

  for (const category of categoryPriority) {
    if (selected.length >= count) break;
    const bucket = byCategory.get(category) ?? [];
    const card = bucket.find(
      (candidate) => preferredEventIds.has(candidate.eventId) && !selectedIds.has(candidate.eventId),
    ) ?? bucket.find((candidate) => !selectedIds.has(candidate.eventId));
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

function dailyCategoryPriority(seed: number): string[] {
  const primary = [...PRIMARY_CATEGORIES];
  for (let index = primary.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(
      seededUnit(seed ^ hashStr(`culturecard-category-slot-${index}`)) * (index + 1),
    );
    [primary[index], primary[swapIndex]] = [primary[swapIndex]!, primary[index]!];
  }
  return [...primary, '축제', '기타'];
}

function buildDesiredSlotCategories(rows: DailySlotEventRow[], seed: number): string[] {
  const desired = dailyCategoryPriority(seed).slice(0, TODAY_CARD_COUNT);
  for (const row of rows) {
    const slotIndex = Number(row.slot_index);
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= TODAY_CARD_COUNT) continue;
    if (!CATEGORY_PRIORITY.some((category) => category === row.slot_category)) continue;
    desired[slotIndex] = row.slot_category;
  }
  return desired;
}

function getUsableDailySlotEvents(rows: DailySlotEventRow[]): DailySlotEventRow[] {
  return rows.filter((row) => (
    row.slot_usable === true
    && String(row.id) === String(row.slot_event_id)
    && normalizeCategory(row.main_category) === row.slot_category
  ));
}

// 오늘 이미 mystery로 저장된 슬롯이 있으면 하루 동안 그 위치를 유지한다(핀 시맨틱).
// 없으면(첫 배정·전환 배포 당일) 고정 위치를 쓴다.
function resolveMysterySlotIndex(rows: DailySlotEventRow[]): number {
  for (const row of rows) {
    const slotIndex = Number(row.slot_index);
    if (
      row.slot_type === 'mystery'
      && Number.isInteger(slotIndex)
      && slotIndex >= 0
      && slotIndex < TODAY_CARD_COUNT
    ) {
      return slotIndex;
    }
  }
  return MYSTERY_SLOT_INDEX;
}

/**
 * "?" 슬롯 후보 선정(서버 권위, 스펙 §3.2): 컬렉션 어시스트 60% / 탐험 25% / 와일드 15%.
 * Math.random 금지 — dailySeed 기반 결정론이라 같은 날 재요청에도 같은 결과가 나와
 * 핀 고정·재보충 시맨틱과 정합한다.
 */
function pickMysteryCard(
  candidates: ReturnType<typeof toCard>[],
  ctx: {
    taste: TasteMap;
    buzzById: ReadonlyMap<string, number>;
    seed: number;
    // eventId → 그 카드가 채울 수 있는 진행 중 세트의 남은 슬롯 최솟값
    assistByEventId: ReadonlyMap<string, number>;
  },
): ReturnType<typeof toCard> | null {
  if (candidates.length === 0) return null;
  const mysterySeed = ctx.seed ^ hashStr('culturecard-mystery-slot');
  const branch = seededUnit(mysterySeed ^ hashStr('branch'));

  if (branch < MYSTERY_ASSIST_PROBABILITY) {
    // 어시스트: 진행 중 세트의 빈 슬롯을 채우는 카드. 완성이 임박한 세트(remaining 작은 쪽)부터.
    const assist = candidates
      .filter((card) => ctx.assistByEventId.has(card.eventId))
      .sort((a, b) => (
        (ctx.assistByEventId.get(a.eventId) ?? 0) - (ctx.assistByEventId.get(b.eventId) ?? 0)
        || (ctx.buzzById.get(b.eventId) ?? 0) - (ctx.buzzById.get(a.eventId) ?? 0)
        || a.eventId.localeCompare(b.eventId)
      ));
    if (assist.length > 0) return assist[0]!;
  }

  if (branch < MYSTERY_ASSIST_PROBABILITY + MYSTERY_EXPLORE_PROBABILITY) {
    // 탐험: 취향 상위 카테고리가 아닌 카테고리의 고buzz 카드(안 가본 장르 노출)
    const exploration = candidates
      .filter((card) => (ctx.taste.get(card.category) ?? 0) < MYSTERY_TASTE_TOP_THRESHOLD)
      .sort((a, b) => (
        (ctx.buzzById.get(b.eventId) ?? 0) - (ctx.buzzById.get(a.eventId) ?? 0)
        || a.eventId.localeCompare(b.eventId)
      ));
    if (exploration.length > 0) return exploration[0]!;
  }

  // 와일드: 완전 랜덤(일별 시드 지터 상위) — 위 분기의 후보가 없을 때의 폴백이기도 하다
  return candidates
    .slice()
    .sort((a, b) => (
      seededUnit(hashStr(b.eventId) ^ mysterySeed) - seededUnit(hashStr(a.eventId) ^ mysterySeed)
      || a.eventId.localeCompare(b.eventId)
    ))[0]!;
}

function assignTodayCardsToSlots(
  cards: ReturnType<typeof toCard>[],
  dailySlotRows: DailySlotEventRow[],
  desiredCategories: readonly string[],
  seed: number,
  // /v2 전용 "?" 슬롯 컨텍스트. 생략하면(legacy /today) 기존 3카테고리 배정 그대로.
  mystery?: MysterySlotContext,
): DailyCardAssignment[] {
  const mysterySlotIndex = mystery?.slotIndex ?? -1;
  const slots: Array<ReturnType<typeof toCard> | undefined> = Array(TODAY_CARD_COUNT);
  const cardByEventId = new Map(cards.map((card) => [card.eventId, card]));
  const selectedIds = new Set<string>();
  const selectedCategories = new Set<string>();

  for (const row of getUsableDailySlotEvents(dailySlotRows)) {
    const slotIndex = Number(row.slot_index);
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= TODAY_CARD_COUNT) continue;
    const card = cardByEventId.get(String(row.slot_event_id));
    if (!card || selectedIds.has(card.eventId)) continue;
    slots[slotIndex] = card;
    selectedIds.add(card.eventId);
    selectedCategories.add(card.category);
  }

  const categoryPriority = dailyCategoryPriority(seed);
  const firstAvailable = (category?: string) => cards.find((candidate) => (
    !selectedIds.has(candidate.eventId)
    && (category == null || candidate.category === category)
  ));

  for (let slotIndex = 0; slotIndex < TODAY_CARD_COUNT; slotIndex += 1) {
    if (slots[slotIndex] || slotIndex === mysterySlotIndex) continue;
    const desiredCategory = desiredCategories[slotIndex];
    let card = firstAvailable(desiredCategory);

    if (!card) {
      for (const category of categoryPriority) {
        if (selectedCategories.has(category)) continue;
        card = firstAvailable(category);
        if (card) break;
      }
    }
    card ??= firstAvailable();
    if (!card) continue;

    slots[slotIndex] = card;
    selectedIds.add(card.eventId);
    selectedCategories.add(card.category);
  }

  // "?" 슬롯: 핀이 없을 때만 새로 뽑는다(열리면 다음 조회에서 여기로 재보충).
  if (mystery && mysterySlotIndex >= 0 && mysterySlotIndex < TODAY_CARD_COUNT && !slots[mysterySlotIndex]) {
    const available = cards.filter((candidate) => !selectedIds.has(candidate.eventId));
    const card = pickMysteryCard(available, {
      taste: mystery.taste,
      buzzById: mystery.buzzById,
      assistByEventId: mystery.assistByEventId,
      seed,
    });
    if (card) {
      slots[mysterySlotIndex] = card;
      selectedIds.add(card.eventId);
      selectedCategories.add(card.category);
    }
  }

  return slots.flatMap((card, slotIndex) => (
    card ? [{
      slotIndex,
      card,
      slotType: (slotIndex === mysterySlotIndex ? 'mystery' : 'category') as CardSlotType,
    }] : []
  ));
}

function preferFreshCardsByCategory<T extends { category: string; eventId: string }>(
  cards: T[],
  recentEventIds: ReadonlySet<string>,
): T[] {
  const categoriesWithFreshCards = new Set(
    cards
      .filter((card) => !recentEventIds.has(card.eventId))
      .map((card) => card.category),
  );
  return cards.filter(
    (card) => !recentEventIds.has(card.eventId) || !categoriesWithFreshCards.has(card.category),
  );
}

async function recordCardAssignments(
  db: PoolClient,
  userId: string,
  today: string,
  assignments: DailyCardAssignment[],
  logLabel: string,
): Promise<void> {
  const slotIndexes = assignments.map(({ slotIndex }) => slotIndex);
  const categories = assignments.map(({ card }) => card.category);
  const eventIds = assignments.map(({ card }) => card.eventId);
  const slotTypes = assignments.map(({ slotType }) => slotType);
  try {
    await db.query(
      `WITH selected AS (
         SELECT slot_index, category, event_id, slot_type
         FROM unnest($3::smallint[], $4::text[], $5::text[], $6::text[])
           AS slot(slot_index, category, event_id, slot_type)
       ), upserted_slots AS (
         INSERT INTO user_daily_card_slots (user_id, slot_index, category, assigned_on, event_id, slot_type)
         SELECT $1, slot_index, category, $2::date, event_id, slot_type FROM selected
         ON CONFLICT (user_id, slot_index)
         DO UPDATE SET assigned_on = EXCLUDED.assigned_on,
                       category = EXCLUDED.category,
                       event_id = EXCLUDED.event_id,
                       slot_type = EXCLUDED.slot_type,
                       updated_at = NOW()
         RETURNING slot_index
       ), deleted_slots AS (
         DELETE FROM user_daily_card_slots existing
         WHERE existing.user_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM selected WHERE selected.slot_index = existing.slot_index
           )
         RETURNING existing.slot_index
       )
       INSERT INTO user_card_impressions (user_id, event_id, last_shown_on, shown_count)
       SELECT $1, event_id, $2::date, 1 FROM selected
       ON CONFLICT (user_id, event_id)
       DO UPDATE SET last_shown_on = EXCLUDED.last_shown_on,
                     shown_count = user_card_impressions.shown_count + 1`,
      [userId, today, slotIndexes, categories, eventIds, slotTypes],
    );
  } catch (error: any) {
    console.error(`[Cards] ${logLabel} assignment log failed:`, error?.message ?? error);
    throw error;
  }
}

async function getDailySlotEvents(
  db: PoolClient,
  today: string,
  userId: string,
): Promise<DailySlotEventRow[]> {
  const { rows } = await db.query<DailySlotEventRow>(
    `SELECT slot.slot_index, slot.category AS slot_category, slot.event_id AS slot_event_id,
            slot.slot_type,
            event.id, event.title, event.display_title, event.content_key, event.canonical_key,
            event.main_category, event.region, event.start_at, event.end_at, event.image_url,
            event.venue, event.overview, event.lat, event.lng, event.buzz_score,
            event.created_at, event.metadata,
            (
              event.id IS NOT NULL
              AND event.is_deleted = false
              AND (event.end_at IS NULL OR (event.end_at AT TIME ZONE 'Asia/Seoul')::date >= $2::date)
              AND NOT EXISTS (
                SELECT 1
                FROM user_card_opened_keys opened
                WHERE opened.user_id = $1
                  AND (
                    (opened.key_type = 'event_id' AND opened.key_value = event.id::text)
                    OR (
                      opened.key_type IN ('content_key', 'canonical_key')
                      AND opened.key_value = ANY(
                        ARRAY_REMOVE(ARRAY[event.content_key, event.canonical_key], NULL)
                      )
                    )
                  )
              )
            ) AS slot_usable
     FROM user_daily_card_slots slot
     LEFT JOIN canonical_events event ON event.id::text = slot.event_id
     WHERE slot.user_id = $1
       AND slot.assigned_on = $2::date
     ORDER BY slot.slot_index`,
    [userId, today],
  );
  return rows;
}

async function getFallbackEvents(
  db: PoolClient,
  today: string,
  userId: string,
): Promise<EventRow[]> {
  const categorySql = normalizedCategorySql('event.main_category');
  const { rows } = await db.query<EventRow>(
    `WITH eligible AS (
       SELECT event.id, event.title, event.display_title, event.content_key, event.canonical_key,
              event.main_category, event.region, event.start_at, event.end_at, event.image_url,
              event.venue, event.overview, event.lat, event.lng, event.buzz_score,
              event.created_at, event.metadata,
              ${categorySql} AS normalized_category,
              CASE
                WHEN event.start_at <= NOW() AND (event.end_at IS NULL OR event.end_at >= NOW()) THEN 0
                WHEN event.start_at > NOW() THEN 1
                ELSE 2
              END AS lifecycle_rank,
              CASE WHEN event.end_at IS NULL THEN 1 ELSE 0 END AS open_ended_rank
       FROM canonical_events event
       WHERE event.is_deleted = false
         AND (event.end_at IS NULL OR (event.end_at AT TIME ZONE 'Asia/Seoul')::date >= $1::date)
         AND NOT EXISTS (
           SELECT 1
           FROM user_card_opened_keys opened
           WHERE opened.user_id = $2
             AND (
               (opened.key_type = 'event_id' AND opened.key_value = event.id::text)
               OR (
                 opened.key_type IN ('content_key', 'canonical_key')
                 AND opened.key_value = ANY(
                   ARRAY_REMOVE(ARRAY[event.content_key, event.canonical_key], NULL)
                 )
               )
             )
         )
     ), ranked AS (
       SELECT eligible.*,
              ROW_NUMBER() OVER (
                PARTITION BY normalized_category
                ORDER BY lifecycle_rank ASC, open_ended_rank ASC,
                         end_at ASC NULLS LAST, buzz_score DESC NULLS LAST, id ASC
              ) AS category_rank
       FROM eligible
     )
     SELECT id, title, display_title, content_key, canonical_key,
            main_category, region, start_at, end_at, image_url,
            venue, overview, lat, lng, buzz_score, created_at, metadata
     FROM ranked
     WHERE category_rank <= $3
     ORDER BY category_rank ASC, lifecycle_rank ASC, open_ended_rank ASC,
              end_at ASC NULLS LAST, buzz_score DESC NULLS LAST, id ASC
     LIMIT $4`,
    [today, userId, CATEGORY_CANDIDATE_LIMIT, CANDIDATE_LIMIT]
  );
  return dedupeRows(rows).slice(0, CANDIDATE_LIMIT);
}

async function getNearbyEvents(
  db: PoolClient,
  today: string,
  location: LocationQuery,
  userId: string,
  requiredCounts: ReadonlyMap<string, number>,
  pinnedRows: EventRow[] = [],
): Promise<EventRow[]> {
  const distSQL = getHaversineDistanceSQL('$1', '$2');
  const categorySql = normalizedCategorySql('event.main_category');
  let stableNearbyRows = dedupeRows(pinnedRows);

  if (hasRequiredCategoryCoverage(stableNearbyRows, requiredCounts)) return stableNearbyRows;

  for (const radiusM of NEARBY_RADIUS_STEPS_M) {
    const box = calculateBoundingBox(location.lat, location.lng, radiusM);
    const { rows } = await db.query<EventRow>(
      `WITH eligible AS (
         SELECT event.id, event.title, event.display_title, event.content_key, event.canonical_key,
                event.main_category, event.region, event.start_at, event.end_at, event.image_url,
                event.venue, event.overview, event.lat, event.lng, event.buzz_score,
                event.created_at, event.metadata,
                (${distSQL}) AS distance_m,
                ${categorySql} AS normalized_category
         FROM canonical_events event
         WHERE event.is_deleted = false
           AND (event.end_at IS NULL OR (event.end_at AT TIME ZONE 'Asia/Seoul')::date >= $3::date)
           AND NOT EXISTS (
             SELECT 1
             FROM user_card_opened_keys opened
             WHERE opened.user_id = $4
               AND (
                 (opened.key_type = 'event_id' AND opened.key_value = event.id::text)
                 OR (
                   opened.key_type IN ('content_key', 'canonical_key')
                   AND opened.key_value = ANY(
                     ARRAY_REMOVE(ARRAY[event.content_key, event.canonical_key], NULL)
                   )
                 )
               )
           )
           AND event.lat IS NOT NULL AND event.lng IS NOT NULL
           AND event.lat BETWEEN $5 AND $6
           AND event.lng BETWEEN $7 AND $8
       ), within_radius AS (
         SELECT * FROM eligible WHERE distance_m <= $9
       ), ranked AS (
         SELECT within_radius.*,
                ROW_NUMBER() OVER (
                  PARTITION BY normalized_category
                  ORDER BY distance_m ASC NULLS LAST, buzz_score DESC NULLS LAST, id ASC
                ) AS category_rank
         FROM within_radius
       )
       SELECT id, title, display_title, content_key, canonical_key,
              main_category, region, start_at, end_at, image_url,
              venue, overview, lat, lng, buzz_score, created_at, metadata, distance_m
       FROM ranked
       WHERE category_rank <= $10
       ORDER BY distance_m ASC NULLS LAST, buzz_score DESC NULLS LAST, id ASC
       LIMIT $11`,
      [
        location.lat,
        location.lng,
        today,
        userId,
        box.latMin,
        box.latMax,
        box.lngMin,
        box.lngMax,
        radiusM,
        CATEGORY_CANDIDATE_LIMIT,
        CANDIDATE_LIMIT,
      ]
    );

    const nearbyRows = dedupeRows(rows);
    // 좁은 반경에서 이미 확보한 카테고리는 고정하고, 없는 카테고리만 넓혀서 보충한다.
    // 이렇게 해야 한 카테고리가 소진돼 반경이 커져도 열지 않은 다른 두 슬롯이 바뀌지 않는다.
    stableNearbyRows = mergeRequiredCategoryBuckets(stableNearbyRows, nearbyRows, requiredCounts);
    if (hasRequiredCategoryCoverage(stableNearbyRows, requiredCounts)) return stableNearbyRows;
  }

  if (stableNearbyRows.length === 0) {
    return getFallbackEvents(db, today, userId);
  }

  const fallbackRows = await getFallbackEvents(db, today, userId);
  return mergeRequiredCategoryBuckets(stableNearbyRows, fallbackRows, requiredCounts);
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
  seed: number,
): { eyebrow: string; headline: string; palette: CardNewsPalette } {
  const category = card.category || '기타';
  const palettes = CARD_NEWS_PALETTES[category] ?? CARD_NEWS_PALETTES.기타!;
  const palette = chooseStable(palettes, seed);
  const hooks: Array<{ eyebrow: string; headline: string }> = [];
  const hasTasteReason = card.reasonTags.some((reason) => reason.startsWith('취향 '));
  const isFresh = card.reasonTags.includes('새로 등록');

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
  variant: number,
  slotType: CardSlotType = 'category',
) {
  const teaser = buildTeaserCopy(card, hashStr(`${card.eventId}|${today}|${variant}`));
  const isMystery = slotType === 'mystery';
  return {
    cardToken: sealLockedCard({
      userId,
      eventId: card.eventId,
      assignedOn: today,
      walkMinutes: card.walkMinutes,
      reasonTags: card.reasonTags,
      slotType,
    }),
    // 카드 토큰은 매 응답마다 IV가 달라진다. 이벤트 ID를 노출하지 않는 안정적인 키로
    // 같은 날 같은 추천의 티켓 스킨과 인쇄 일련번호를 고정한다.
    visualSeed: String(hashStr(`${card.eventId}|${today}`)),
    slotType,
    // "?" 슬롯은 내용 단서를 은닉한다(스펙 §3.3): 카테고리·지역·거리·타이밍·티저 전부 null.
    // 토큰·visualSeed·팔레트·isRevisit만 유지.
    category: isMystery ? null : card.category,
    areaLabel: isMystery ? null : card.region,
    distanceLabel: isMystery || card.walkMinutes == null ? null : `도보 ${card.walkMinutes}분`,
    timingLabel: isMystery ? null : lockedTimingLabel(card.dday),
    reasonTags: isMystery ? [] : card.reasonTags,
    teaserEyebrow: isMystery ? null : teaser.eyebrow,
    teaserHeadline: isMystery ? null : teaser.headline,
    palette: teaser.palette,
    // 연 카드는 평생 재추천하지 않는다. 클라이언 하위 호환을 위해 필드는 유지한다.
    isRevisit: false,
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
  let client: PoolClient | null = null;
  let transactionOpen = false;
  let destroyClient = false;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    await acquireUserCardLock(client, userId);
    // 동적 캡용 신선 풀 크기(스펙 §2.2): /v2/today 후보 eligibility(안 연 카드 + 7일 노출 쿨다운 제외)와
    // 동일 조건. 위치가 있으면 최대 반경(50km) 바운딩박스로 근사하고, 없으면 전국 풀 기준.
    // OPEN_CAP_FULL_POOL(=CANDIDATE_LIMIT) 이상은 셀 필요가 없어 LIMIT으로 자른다.
    const maxRadiusM = NEARBY_RADIUS_STEPS_M[NEARBY_RADIUS_STEPS_M.length - 1];
    const freshBox = location ? calculateBoundingBox(location.lat, location.lng, maxRadiusM) : null;
    const freshPoolParams: unknown[] = [userId, today, IMPRESSION_COOLDOWN_DAYS];
    if (freshBox) freshPoolParams.push(freshBox.latMin, freshBox.latMax, freshBox.lngMin, freshBox.lngMax);
    const freshPoolQuery = client.query<{ fresh: number }>(
      `/* fresh_pool_count */
       SELECT COUNT(*)::int AS fresh FROM (
         SELECT 1 FROM canonical_events event
         WHERE event.is_deleted = false
           AND (event.end_at IS NULL OR (event.end_at AT TIME ZONE 'Asia/Seoul')::date >= $2::date)
           AND NOT EXISTS (
             SELECT 1 FROM user_card_opened_keys opened
             WHERE opened.user_id = $1
               AND (
                 (opened.key_type = 'event_id' AND opened.key_value = event.id::text)
                 OR (
                   opened.key_type IN ('content_key', 'canonical_key')
                   AND opened.key_value = ANY(
                     ARRAY_REMOVE(ARRAY[event.content_key, event.canonical_key], NULL)
                   )
                 )
               )
           )
           AND NOT EXISTS (
             SELECT 1 FROM user_card_impressions ci
             WHERE ci.user_id = $1
               AND ci.event_id = event.id::text
               AND ci.last_shown_on >= $2::date - (($3::int - 1) * INTERVAL '1 day')
               AND ci.last_shown_on < $2::date
           )
           ${freshBox ? 'AND event.lat BETWEEN $4 AND $5 AND event.lng BETWEEN $6 AND $7' : ''}
         LIMIT ${CANDIDATE_LIMIT}
       ) fresh_pool`,
      freshPoolParams,
    );

    const [
      ticketResult,
      dailyOpenedResult,
      tasteResult,
      impressionResult,
      weeklyOpenedResult,
      dailySlotRows,
      freshPoolResult,
    ] = await Promise.all([
      client.query(
        `WITH ensured AS (
           INSERT INTO user_tickets (user_id, ticket_count, total_earned, total_exchanged)
           VALUES ($1, 0, 0, 0)
           ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
           RETURNING ticket_count, daily_earned, daily_earned_date, daily_open_cap, daily_open_cap_date
         )
         SELECT ticket_count, daily_earned, daily_earned_date, daily_open_cap, daily_open_cap_date FROM ensured
         UNION ALL
         SELECT ticket_count, daily_earned, daily_earned_date, daily_open_cap, daily_open_cap_date
         FROM user_tickets WHERE user_id = $1
         LIMIT 1`,
        [userId],
      ),
      // 기존 (user_id, earn_date) 인덱스로 오늘 공개 수만 집계한다.
      client.query<DailyOpenedCountRow>(
        `SELECT COUNT(*)::int AS count
         FROM user_ticket_earn_log el
         WHERE el.user_id = $1
           AND el.earn_date = $2::date`,
        [userId, today],
      ),
      client.query<TasteRow>(
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
      ),
      // 오늘 배정한 3장은 새로고침해도 유지하고, 이전 7일 노출만 소프트 제외한다.
      client.query<ImpressionRow>(
        `SELECT event_id FROM user_card_impressions
         WHERE user_id = $1
           AND last_shown_on >= $2::date - (($3::int - 1) * INTERVAL '1 day')
           AND last_shown_on < $2::date`,
        [userId, today, IMPRESSION_COOLDOWN_DAYS],
      ),
      client.query<WeeklyOpenedEventRow>(
        `SELECT ce.id, ce.title, ce.display_title, ce.content_key, ce.canonical_key,
                ce.main_category, ce.region, ce.start_at, ce.end_at, ce.image_url,
                ce.venue, ce.overview, ce.lat, ce.lng, ce.buzz_score, ce.created_at, ce.metadata,
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
      ),
      getDailySlotEvents(client, today, userId),
      freshPoolQuery,
    ]);

    const seed = dailySeed(userId, today);
    const desiredCategories = buildDesiredSlotCategories(dailySlotRows, seed);
    const requiredCounts = requiredCategoryCounts(desiredCategories);
    const pinnedRows = getUsableDailySlotEvents(dailySlotRows);
    const rows = location
      ? await getNearbyEvents(client, today, location, userId, requiredCounts, pinnedRows)
      : hasRequiredCategoryCoverage(pinnedRows, requiredCounts)
        ? pinnedRows
        : mergeRequiredCategoryBuckets(
            pinnedRows,
            await getFallbackEvents(client, today, userId),
            requiredCounts,
          );
    const taste = buildTasteMap(tasteResult.rows);
    const scoreById = new Map<string, number>();
    const buzzById = new Map<string, number>();
    for (const row of rows) {
      scoreById.set(String(row.id), scoreRow(row, { location, taste, seed }));
      buzzById.set(String(row.id), toNumberOrNull(row.buzz_score) ?? 0);
    }

    const cards = rows.map((row) => toCard(row, new Set<string>(), location, taste));
    const previousImpressionIds = new Set(
      impressionResult.rows.map((row) => String(row.event_id)),
    );
    const scored = preferFreshCardsByCategory(cards, previousImpressionIds)
      .slice()
      .sort((a, b) => (scoreById.get(b.eventId) ?? 0) - (scoreById.get(a.eventId) ?? 0));
    const dailyOpenCount = Number(dailyOpenedResult.rows[0]?.count ?? 0);
    const ticketRow = ticketResult.rows[0] ?? {};

    // 동적 캡 확정(스펙 §2.2): 오늘 저장값과 신규 계산값 중 큰 쪽만 반영(상향만 허용).
    const freshCount = Number(freshPoolResult.rows[0]?.fresh ?? 0);
    const storedCap = resolveEffectiveOpenLimit(ticketRow, today);
    const storedCapIsToday = ticketRow.daily_open_cap_date
      ? String(ticketRow.daily_open_cap_date).slice(0, 10) === today
      : false;
    const computedCap = computeDailyOpenCap(freshCount);
    const effectiveCap = storedCapIsToday ? Math.max(storedCap, computedCap) : computedCap;
    await client.query(
      `UPDATE user_tickets
       SET daily_open_cap = CASE
             WHEN daily_open_cap_date = $2::date THEN GREATEST(COALESCE(daily_open_cap, 0), $3)
             ELSE $3
           END,
           daily_open_cap_date = $2::date
       WHERE user_id = $1`,
      [userId, today, effectiveCap],
    );

    // "?" 슬롯 컬렉션 어시스트 후보(스펙 §3.2-1). 캡에 걸려 배정을 안 할 땐 조회도 생략한다.
    const assistByEventId = dailyOpenCount >= effectiveCap
      ? new Map<string, number>()
      : await findCollectionAssistCandidates(client, {
          userId,
          eventIds: scored.map((card) => card.eventId),
        });

    const assignments = dailyOpenCount >= effectiveCap
      ? []
      : assignTodayCardsToSlots(scored, dailySlotRows, desiredCategories, seed, {
          slotIndex: resolveMysterySlotIndex(dailySlotRows),
          taste,
          buzzById,
          assistByEventId,
        });

    await recordCardAssignments(client, userId, today, assignments, 'v2');

    const dailyEarnedDate = ticketRow.daily_earned_date ? String(ticketRow.daily_earned_date).slice(0, 10) : null;
    const weeklyOpenedIds = new Set(weeklyOpenedResult.rows.map((row) => String(row.id)));
    const weeklyItems = dedupeRows(weeklyOpenedResult.rows)
      .map((row) => toCard(row, weeklyOpenedIds, location, taste));
    const weeklyOpenedCount = Number(weeklyOpenedResult.rows[0]?.total_count ?? weeklyItems.length);
    await client.query('COMMIT');
    transactionOpen = false;
    client.release();
    client = null;
    const userRegion = await userRegionPromise;

    return res.json({
      lockedCards: assignments.map(({ card, slotIndex, slotType }) => toLockedPreview(
        card,
        userId,
        today,
        slotIndex,
        slotType,
      )),
      ticketCount: ticketRow.ticket_count ?? 0,
      dailyEarned: dailyEarnedDate === today ? (ticketRow.daily_earned ?? 0) : 0,
      dailyLimit: DAILY_LIMIT,
      dailyOpenCount,
      dailyOpenLimit: effectiveCap,
      openCap: {
        base: DAILY_OPEN_LIMIT,
        effective: effectiveCap,
        // 캡이 지역 풀 때문에 낮아졌으면 클라는 "오늘 {지역}의 카드는 여기까지" 프레이밍을 쓴다.
        reason: effectiveCap < DAILY_OPEN_LIMIT ? 'regional_pool' : 'daily_max',
        regionLabel: userRegion,
      },
      userRegion,
      weeklyDiscovery: {
        weekKey,
        openedCount: weeklyOpenedCount,
        goal: WEEKLY_DISCOVERY_GOAL,
        items: weeklyItems,
      },
      personalization: buildPersonalization(tasteResult.rows, taste),
    });
  } catch (err) {
    if (client && transactionOpen) {
      await client.query('ROLLBACK').catch((rollbackError) => {
        console.error('[Cards] v2 today rollback failed:', rollbackError);
        destroyClient = true;
      });
      transactionOpen = false;
    }
    console.error('[Cards] v2 today error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client?.release(destroyClient);
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
              start_at, end_at, image_url, venue, overview, lat, lng, buzz_score, created_at, metadata
       FROM canonical_events
       WHERE id::text = $1
       AND is_deleted = false
       AND (end_at IS NULL OR (end_at AT TIME ZONE 'Asia/Seoul')::date >= $2::date)
       LIMIT 1
       FOR SHARE`,
      [tokenPayload.eventId, today],
    );
    if (eventResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'CARD_EVENT_UNAVAILABLE' });
    }

    const event = eventResult.rows[0]!;
    const reward = await grantTicketsForEvent(client, {
      userId,
      eventId: tokenPayload.eventId,
      today,
      adAttemptId,
    });

    // slotType은 토큰이 권위(발급 시점의 슬롯 상태 봉인). 과거 발급 토큰(필드 없음)은 category.
    const slotType: CardSlotType = tokenPayload.slotType === 'mystery' ? 'mystery' : 'category';
    // 컬렉션 진행은 오픈과 같은 트랜잭션에서 기록한다(스펙 §4.2).
    // 내부에서 SAVEPOINT로 격리하므로 실패해도 티켓 지급은 그대로 커밋된다.
    const collectionProgress: CollectionProgressEntry[] = await applyCollectionProgress(client, {
      userId,
      eventId: tokenPayload.eventId,
      source: slotType === 'mystery' ? 'mystery' : 'open',
    });

    await client.query('COMMIT');

    const fullCard = toCard(event, new Set([tokenPayload.eventId]), null, new Map());
    fullCard.walkMinutes = tokenPayload.walkMinutes;
    fullCard.reasonTags = tokenPayload.reasonTags;
    return res.json({
      card: fullCard,
      ...reward,
      reveal: {
        slotType,
        // 히든 카드: "?" 슬롯에서만, buzz 상위(HIDDEN_BUZZ_MIN)일 때 특수 프레임(스펙 §3.2)
        hidden: slotType === 'mystery' && (toNumberOrNull(event.buzz_score) ?? 0) >= HIDDEN_BUZZ_MIN,
      },
      collectionProgress,
    });
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
  let client: PoolClient | null = null;
  let transactionOpen = false;
  let destroyClient = false;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    await acquireUserCardLock(client, userId);
    const [ticketResult, tasteResult, impressionResult, dailySlotRows] = await Promise.all([
      client.query(
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
      // 취향 신호: 카드 열기(1) + 좋아요(3) + 도장(4). 강한 의도일수록 더 크게 반영한다.
      client.query<TasteRow>(
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
      ),
      // 최근 노출한 카드(소프트 제외용) — 테이블 없거나 실패해도 무시
      client.query<ImpressionRow>(
        `SELECT event_id FROM user_card_impressions
         WHERE user_id = $1
           AND last_shown_on >= $2::date - (($3::int - 1) * INTERVAL '1 day')
           AND last_shown_on < $2::date`,
        [userId, today, IMPRESSION_COOLDOWN_DAYS]
      ),
      getDailySlotEvents(client, today, userId),
    ]);

    const ticketRow = ticketResult.rows[0] ?? {};
    const seed = dailySeed(userId, today);
    const desiredCategories = buildDesiredSlotCategories(dailySlotRows, seed);
    const requiredCounts = requiredCategoryCounts(desiredCategories);
    const pinnedRows = getUsableDailySlotEvents(dailySlotRows);
    const rows = location
      ? await getNearbyEvents(client, today, location, userId, requiredCounts, pinnedRows)
      : hasRequiredCategoryCoverage(pinnedRows, requiredCounts)
        ? pinnedRows
        : mergeRequiredCategoryBuckets(
            pinnedRows,
            await getFallbackEvents(client, today, userId),
            requiredCounts,
          );

    // 점수화 v2: 근접+신선도+일별시드+취향+버즈로 재랭킹 → 매일 다른 순서·새 이벤트 우선
    const weekKey = weekKeyKst(today);
    const taste = buildTasteMap(tasteResult.rows);
    const personalization = buildPersonalization(tasteResult.rows, taste);
    const previousImpressionIds = new Set(
      impressionResult.rows.map((row) => String(row.event_id)),
    );
    const scoreById = new Map<string, number>();
    for (const row of rows) scoreById.set(String(row.id), scoreRow(row, { location, taste, seed }));

    const cards = rows
      .map((row) => toCard(row, new Set<string>(), location, taste))
      .filter((card) => !card.opened);

    // 카테고리별로 새 카드를 우선하고, 해당 카테고리가 비었을 때만 최근 노출 제한을 완화한다.
    const scored = preferFreshCardsByCategory(cards, previousImpressionIds)
      .slice()
      .sort((a, b) => (scoreById.get(b.eventId) ?? 0) - (scoreById.get(a.eventId) ?? 0));

    const assignments = assignTodayCardsToSlots(
      scored,
      dailySlotRows,
      desiredCategories,
      seed,
    );
    const todayCards = assignments.map(({ card }) => card);
    const todayIds = new Set(todayCards.map((card) => card.eventId));
    const morePool = scored.filter((card) => !todayIds.has(card.eventId)).slice(0, CARD_POOL_LIMIT);
    const dailyEarnedDate = ticketRow.daily_earned_date ? String(ticketRow.daily_earned_date).slice(0, 10) : null;
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

    // 오늘 보여준 카드를 응답 전에 기록해 다음 조회에서도 같은 미공개 슬롯을 유지한다.
    await recordCardAssignments(client, userId, today, assignments, 'legacy');
    await client.query('COMMIT');
    transactionOpen = false;
    client.release();
    client = null;
    const userRegion = await userRegionPromise;

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
    if (client && transactionOpen) {
      await client.query('ROLLBACK').catch((rollbackError) => {
        console.error('[Cards] today rollback failed:', rollbackError);
        destroyClient = true;
      });
      transactionOpen = false;
    }
    console.error('[Cards] today error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client?.release(destroyClient);
  }
});

export default router;
