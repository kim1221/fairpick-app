import { Pool } from 'pg';
import { reverseGeocode, calculateBoundingBox, getHaversineDistanceSQL } from '../utils/geo';
import { extractRegion } from './geocode';

// ─────────────────────────────────────────────────────────────
// Feature flag: TODAY_PICK_V2=false 환경변수로 V1 롤백 가능
// 기본값 true (V2 활성)
// ─────────────────────────────────────────────────────────────
export const USE_TODAY_PICK_V2 = process.env.TODAY_PICK_V2 !== 'false';

/**
 * 오늘의 픽 공통 품질 조건
 */
const QUALITY_WHERE = `
  is_deleted = false
  AND status != 'cancelled'
  AND end_at >= NOW()
  AND image_url IS NOT NULL
  AND image_url NOT LIKE '%placeholder%'
`;

/** 근거리 반경 7km (bounding box 1차 필터 후 Haversine 정밀 계산) */
const NEARBY_RADIUS_M = 7000;

/** auto 단계 후보 풀 크기 – 다양성 확보를 위해 10개 */
const POOL_LIMIT = 10;

/**
 * 날짜 seed 기반 deterministic 셔플
 *
 * - 같은 날 + 같은 후보 → 항상 같은 순서 (캐시 일관성 유지)
 * - 날짜가 바뀌면 순서도 바뀜 (다양성)
 * - LCG(Linear Congruential Generator) 사용
 */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed >>> 0; // unsigned 32-bit
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** 오늘 날짜 기반 seed (YYYYMMDD 정수) */
function todaySeed(): number {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/**
 * 오늘의 픽 후보군 조회
 *
 * 철학:
 *   - 기본 선정은 featured_score 기반 자동 추천
 *   - is_featured = true 는 지역 단위 운영자 override (해당 지역 사용자에게만 적용)
 *   - national_manual 없음 → 자동 추천 단계가 항상 도달 가능
 *   - 위치 정밀도: 근거리(7km) → 시/도 → 전국 순으로 확장
 *
 * 폴백 체인 (1개라도 찾으면 중단):
 *   1. local_manual  – is_featured=true AND region=지역          LIMIT 5
 *   2. nearby_auto   – 반경 7km, featured_score DESC             LIMIT 10
 *   3. local_auto    – region=지역, featured_score DESC          LIMIT 10
 *   4. national_auto – 전국, featured_score DESC                 LIMIT 10
 */
export async function buildTodayPickPool(
  dbPool: Pool,
  location?: { lat: number; lng: number },
): Promise<any[]> {
  let userRegion: string | null = null;

  if (location) {
    try {
      const address = await reverseGeocode(location.lat, location.lng);
      if (address) {
        userRegion = extractRegion(address);
      }
    } catch {
      userRegion = null;
    }
  }

  // 1. local_manual: 운영자 수동 override (해당 지역만)
  if (userRegion) {
    const r = await dbPool.query(
      `SELECT * FROM canonical_events
       WHERE ${QUALITY_WHERE}
         AND is_featured = true
         AND region = $1
       ORDER BY featured_order ASC NULLS LAST, buzz_score DESC NULLS LAST
       LIMIT 5`,
      [userRegion],
    );
    if (r.rows.length > 0) return r.rows;
  }

  // 2. nearby_auto: 반경 7km 이내 featured_score 기반 자동 추천
  // bounding box로 1차 필터 후 Haversine으로 정밀 계산
  if (location) {
    const { lat, lng } = location;
    const box = calculateBoundingBox(lat, lng, NEARBY_RADIUS_M);
    const distSQL = getHaversineDistanceSQL('$1', '$2');

    const r = await dbPool.query(
      `SELECT * FROM (
         SELECT *, ${distSQL} AS _distance_m
         FROM canonical_events
         WHERE ${QUALITY_WHERE}
           AND lat IS NOT NULL AND lng IS NOT NULL
           AND lat BETWEEN $3 AND $4
           AND lng BETWEEN $5 AND $6
       ) sub
       WHERE _distance_m <= $7
       ORDER BY COALESCE(featured_score, 0) DESC, _distance_m ASC
       LIMIT $8`,
      [lat, lng, box.latMin, box.latMax, box.lngMin, box.lngMax, NEARBY_RADIUS_M, POOL_LIMIT],
    );
    if (r.rows.length > 0) return r.rows;
  }

  // 3. local_auto: 시/도 기반 featured_score 자동 추천 (nearby 후보 부족 시 폴백)
  if (userRegion) {
    const r = await dbPool.query(
      `SELECT * FROM canonical_events
       WHERE ${QUALITY_WHERE}
         AND region = $1
       ORDER BY COALESCE(featured_score, 0) DESC, buzz_score DESC NULLS LAST
       LIMIT $2`,
      [userRegion, POOL_LIMIT],
    );
    if (r.rows.length > 0) return r.rows;
  }

  // 4. national_auto: 전국 featured_score 자동 추천 (최종 폴백)
  const r = await dbPool.query(
    `SELECT * FROM canonical_events
     WHERE ${QUALITY_WHERE}
     ORDER BY COALESCE(featured_score, 0) DESC, buzz_score DESC NULLS LAST
     LIMIT $1`,
    [POOL_LIMIT],
  );
  return r.rows;
}

/**
 * 오늘의 픽 최종 후보 1개 선택
 *
 * 다양성 로직:
 *   1. 날짜 seed 기반 셔플 → 매일 다른 순서, 클릭 없어도 자연스럽게 로테이션
 *   2. 최근 3일 미클릭 후보 중 첫 번째
 *   3. 최근 14일 미클릭 후보 중 첫 번째
 *   4. 최후 폴백: shuffled[0]
 */
export function pickTodayPickCandidate(
  candidates: any[],
  recentClickedIds: Set<string>,
  clickedIds: Set<string>,
): any | null {
  if (candidates.length === 0) return null;

  // 날짜 seed로 후보 순서를 매일 다르게 섞기
  const shuffled = seededShuffle(candidates, todaySeed());

  // 1. 최근 3일 미클릭
  const notRecent = shuffled.find((c) => !recentClickedIds.has(c.id));
  if (notRecent) return notRecent;

  // 2. 최근 14일 미클릭
  const notClicked = shuffled.find((c) => !clickedIds.has(c.id));
  if (notClicked) return notClicked;

  // 3. 최후 폴백
  return shuffled[0];
}

// ═══════════════════════════════════════════════════════════════
// V2: today_pick 전용 복합 점수 기반 선정
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

export interface TodayPickScoreBreakdown {
  buzz: number;          // 0-100
  distance: number;      // 0-100
  urgency: number;       // 0-100 (7일 이내 마감만)
  freshness: number;     // 0-100
  featuredBoost: number; // 0 or FEATURED_BOOST (+12)
  personalBoost: number; // 카테고리 친화도 가점 (0, +2, +3 / 최대 +5)
  total: number;
}

export interface ScoredTodayPickCandidate {
  event: any;
  stage: 'nearby' | 'region' | 'national';
  breakdown: TodayPickScoreBreakdown;
}

// ─────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────

const FEATURED_BOOST = 12;   // is_featured=true 가중치 (flat)
const NEARBY_POOL_SIZE = 8;
const REGION_POOL_SIZE = 8;
const NATIONAL_POOL_SIZE = 10;

// 단계별 가중치 (합계 = 100%)
const STAGE_WEIGHTS = {
  nearby:   { buzz: 0.40, distance: 0.30, urgency: 0.15, freshness: 0.15 },
  region:   { buzz: 0.55, distance: 0.05, urgency: 0.20, freshness: 0.20 },
  national: { buzz: 0.60, distance: 0.00, urgency: 0.20, freshness: 0.20 },
} as const;

// ─────────────────────────────────────────────────────────────
// 거리 계산 (JS-side Haversine, 미터 단위)
// ─────────────────────────────────────────────────────────────

function haversineDistanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─────────────────────────────────────────────────────────────
// 점수 컴포넌트 계산 함수들
// ─────────────────────────────────────────────────────────────

function calcBuzz(buzzScore: number): number {
  return Math.min((buzzScore / 200) * 100, 100);
}

function calcDistance(distanceM: number, stage: 'nearby' | 'region'): number {
  const radius = stage === 'nearby' ? NEARBY_RADIUS_M : 50000;
  return Math.max(0, (1 - distanceM / radius) * 100);
}

function calcUrgency(endAt: string | Date): number {
  const daysLeft = (new Date(endAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (daysLeft < 0 || daysLeft > 7) return 0;
  return Math.max(0, (1 - daysLeft / 7) * 100);
}

function calcFreshness(createdAt: string | Date): number {
  const daysOld = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysOld <= 2)  return 100;
  if (daysOld <= 7)  return 60;
  if (daysOld <= 30) return 20;
  return 0;
}

// ─────────────────────────────────────────────────────────────
// 단일 이벤트 today_pick_score 계산
// ─────────────────────────────────────────────────────────────

function scoreCandidate(
  event: any,
  stage: 'nearby' | 'region' | 'national',
  location?: { lat: number; lng: number },
  precomputedDistanceM?: number,
): ScoredTodayPickCandidate {
  const w = STAGE_WEIGHTS[stage];

  const buzz = calcBuzz(event.buzz_score || 0);

  // 거리: SQL에서 미리 계산된 값 우선, 없으면 JS에서 계산
  let distance = 0;
  if (stage !== 'national') {
    const distM =
      precomputedDistanceM ??
      (location && event.lat && event.lng
        ? haversineDistanceM(location.lat, location.lng, event.lat, event.lng)
        : undefined);
    if (distM !== undefined) distance = calcDistance(distM, stage);
  }

  const urgency = calcUrgency(event.end_at);
  const freshness = calcFreshness(event.created_at);
  const featuredBoost = event.is_featured ? FEATURED_BOOST : 0;

  const base =
    buzz      * w.buzz +
    distance  * w.distance +
    urgency   * w.urgency +
    freshness * w.freshness;

  return {
    event,
    stage,
    breakdown: { buzz, distance, urgency, freshness, featuredBoost, personalBoost: 0, total: base + featuredBoost },
  };
}

// ─────────────────────────────────────────────────────────────
// 디버그 로그
// ─────────────────────────────────────────────────────────────

function logV2(candidates: ScoredTodayPickCandidate[], stage: string): void {
  const top3 = [...candidates]
    .sort((a, b) => b.breakdown.total - a.breakdown.total)
    .slice(0, 3);

  console.log(`[today_pick_v2] stage=${stage} pool=${candidates.length}`);
  top3.forEach((c, i) => {
    const b = c.breakdown;
    const personalStr = b.personalBoost > 0 ? ` personal=+${b.personalBoost}` : '';
    console.log(
      `[today_pick_v2]  #${i + 1} "${c.event.title}"` +
      ` total=${b.total.toFixed(1)}` +
      ` (buzz=${b.buzz.toFixed(1)} dist=${b.distance.toFixed(1)}` +
      ` urgency=${b.urgency.toFixed(1)} fresh=${b.freshness.toFixed(1)}` +
      ` feat=${b.featuredBoost}${personalStr})`,
    );
  });
}

// ─────────────────────────────────────────────────────────────
// V2: 후보 풀 구성
//
// local_manual 게이트 제거 — is_featured는 scoreCandidate 내부에서 +12 boost로 처리
// 폴백 체인: nearby(8) → region(8) → national(10)
// SQL 정렬은 buzz_score DESC (1차 필터), 실제 순위는 TS에서 today_pick_score로 결정
// ─────────────────────────────────────────────────────────────

export async function buildTodayPickPoolV2(
  dbPool: Pool,
  location?: { lat: number; lng: number },
): Promise<ScoredTodayPickCandidate[]> {
  let userRegion: string | null = null;

  if (location) {
    try {
      const address = await reverseGeocode(location.lat, location.lng);
      if (address) userRegion = extractRegion(address);
    } catch {
      userRegion = null;
    }
  }

  // Stage 1: nearby — 반경 7km
  if (location) {
    const { lat, lng } = location;
    const box = calculateBoundingBox(lat, lng, NEARBY_RADIUS_M);
    const distSQL = getHaversineDistanceSQL('$1', '$2');

    const r = await dbPool.query(
      `SELECT *, (${distSQL}) AS _distance_m
       FROM canonical_events
       WHERE ${QUALITY_WHERE}
         AND lat IS NOT NULL AND lng IS NOT NULL
         AND lat BETWEEN $3 AND $4
         AND lng BETWEEN $5 AND $6
         AND (${distSQL}) <= $7
       ORDER BY buzz_score DESC NULLS LAST
       LIMIT $8`,
      [lat, lng, box.latMin, box.latMax, box.lngMin, box.lngMax, NEARBY_RADIUS_M, NEARBY_POOL_SIZE],
    );

    if (r.rows.length > 0) {
      const scored = r.rows.map(row => scoreCandidate(row, 'nearby', location, row._distance_m));
      logV2(scored, 'nearby');
      return scored;
    }
    console.log('[today_pick_v2] nearby: 0 results → region fallback');
  }

  // Stage 2: region
  if (userRegion) {
    const r = await dbPool.query(
      `SELECT * FROM canonical_events
       WHERE ${QUALITY_WHERE} AND region = $1
       ORDER BY buzz_score DESC NULLS LAST
       LIMIT $2`,
      [userRegion, REGION_POOL_SIZE],
    );

    if (r.rows.length > 0) {
      const scored = r.rows.map(row => scoreCandidate(row, 'region', location));
      logV2(scored, 'region');
      return scored;
    }
    console.log('[today_pick_v2] region: 0 results → national fallback');
  }

  // Stage 3: national
  const r = await dbPool.query(
    `SELECT * FROM canonical_events
     WHERE ${QUALITY_WHERE}
     ORDER BY buzz_score DESC NULLS LAST
     LIMIT $1`,
    [NATIONAL_POOL_SIZE],
  );
  const scored = r.rows.map(row => scoreCandidate(row, 'national', location));
  logV2(scored, 'national');
  return scored;
}

// ─────────────────────────────────────────────────────────────
// V2: 최종 1개 선택
//
// 1. today_pick_score 내림차순 정렬
// 2. 최근 3일 미클릭 우선 → 14일 미클릭 → 최후 폴백
// ─────────────────────────────────────────────────────────────

export function pickTodayPickCandidateV2(
  candidates: ScoredTodayPickCandidate[],
  recentClickedIds: Set<string>,
  clickedIds: Set<string>,
): ScoredTodayPickCandidate | null {
  if (candidates.length === 0) return null;

  // score DESC, 동점이면 id ASC (결정적 정렬)
  const sorted = [...candidates].sort((a, b) => {
    const diff = b.breakdown.total - a.breakdown.total;
    return Math.abs(diff) < 0.01 ? a.event.id.localeCompare(b.event.id) : diff;
  });

  // top-3 일별 로테이션: 매일 다른 base candidate 사용
  // → 클릭 이력 없는 신규 사용자도 매일 다른 이벤트 노출
  const rotationPool = sorted.slice(0, Math.min(3, sorted.length));
  const todayIdx = todaySeed() % rotationPool.length;
  const rotated = [
    ...rotationPool.slice(todayIdx),
    ...rotationPool.slice(0, todayIdx),
    ...sorted.slice(3), // 나머지 후보는 click exclusion 폴백용
  ];

  console.log(
    `[today_pick_v2] rotation pool=${rotationPool.length}` +
    ` todayIdx=${todayIdx}` +
    ` base="${rotationPool[todayIdx]!.event.title}"`,
  );

  const picked =
    rotated.find(c => !recentClickedIds.has(c.event.id)) ??
    rotated.find(c => !clickedIds.has(c.event.id)) ??
    rotated[0]!;

  console.log(
    `[today_pick_v2] picked="${picked.event.title}"` +
    ` stage=${picked.stage}` +
    ` total=${picked.breakdown.total.toFixed(1)}`,
  );

  return picked;
}

// ─────────────────────────────────────────────────────────────
// V2: 개인화 보정 (카테고리 친화도 기반 소폭 가점)
//
// 설계 원칙:
//   - 강한 개인화 아님 — 알고리즘 점수가 주, 개인화는 보조
//   - 최근 14일 클릭 카테고리 기준으로 +2~+3 가점
//   - 총합 최대 +5 제한 (전체 today_pick_score 대비 ~5% 수준)
//   - 캐시된 풀에 요청마다 메모리에서 적용 (SQL 없음)
//
// 미래 확장 (impression 기반 패널티):
//   - 최근 7일 today_pick 노출 event_id → -5~-10 패널티 예정
//   - 전제: impression 로그가 충분히 쌓인 후 (현재 미수집)
//   - 구현 위치: 이 함수에 penaltyIds: Set<string> 파라미터 추가
// ─────────────────────────────────────────────────────────────

const PERSONAL_BOOST_CAP = 5;

/**
 * V2 후보 풀에 카테고리 친화도 기반 개인화 가점 적용
 *
 * @param candidates  buildTodayPickPoolV2 결과
 * @param categoryClickCounts  최근 14일 카테고리별 클릭 횟수 (category → count)
 */
export function applyPersonalizationV2(
  candidates: ScoredTodayPickCandidate[],
  categoryClickCounts: Map<string, number>,
): ScoredTodayPickCandidate[] {
  if (categoryClickCounts.size === 0) return candidates;

  return candidates.map((c) => {
    const clickCount = categoryClickCounts.get(c.event.main_category ?? '') ?? 0;
    // ≥3회 클릭한 카테고리: +3 / ≥1회: +2 / 없음: 0
    const rawBoost = clickCount >= 3 ? 3 : clickCount >= 1 ? 2 : 0;
    const personalBoost = Math.min(rawBoost, PERSONAL_BOOST_CAP);

    if (personalBoost === 0) return c;

    return {
      ...c,
      breakdown: {
        ...c.breakdown,
        personalBoost,
        total: c.breakdown.total + personalBoost,
      },
    };
  });
}
