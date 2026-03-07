/**
 * Fairpick 추천 엔진 - Phase 1 (룰 기반)
 * 
 * 추천 점수 = (거리 × 0.3) + (인기 × 0.25) + (시간 × 0.2) + (카테고리 × 0.15) + (신선도 × 0.1)
 */

import { Pool } from 'pg';
import { reverseGeocode } from '../utils/geo';
import { getCityZone, buildCityZoneFilter } from './cityZones';

// ==================== 타입 정의 ====================

export interface Event {
  id: string;
  title: string;
  main_category: string;
  start_at: Date;
  end_at: Date;
  created_at: Date;
  view_count: number;
  buzz_score: number;
  lat?: number;
  lng?: number;
  venue?: string;
  region?: string;
  image_url?: string;
  metadata?: any;
}

export interface Location {
  lat: number;
  lng: number;
}

export interface UserPreference {
  categories: Record<string, number>; // {"전시": 80, "팝업": 60}
  tags: string[];
}

export interface ScoredEvent extends Event {
  score: number;
  distance_km?: number;
  reason?: string[];
}

export interface ScoreWeights {
  distance?: number;
  buzz?: number;
  time?: number;
  category?: number;
  freshness?: number;
}

// ==================== 슬롯 캡 (카테고리 다양성) ====================

/**
 * 카테고리별 최대 노출 수 제한
 * 공연이 93% 물량이라 슬롯 없으면 전 섹션이 공연으로 채워짐
 */
const TRENDING_SLOT_CAP: Record<string, number> = {
  '공연': 6,
  '전시': 2,
  '팝업': 1,
};

const WEEKEND_SLOT_CAP: Record<string, number> = {
  '공연': 6,
  '전시': 2,
  '팝업': 1,
};

const ENDING_SOON_SLOT_CAP: Record<string, number> = {
  '공연': 5,
  '전시': 3,
  '팝업': 1,
};

const FREE_SLOT_CAP: Record<string, number> = {
  '공연': 4,
  '전시': 3,
  '팝업': 1,
  '기타': 2,
};

const TRENDING_SLOT_DEFAULT = 1; // 축제, 행사 등 기타

/**
 * 슬롯 캡 적용: 카테고리별 최대 개수 제한 후 total 개수 반환
 * - 1pass: 각 카테고리 캡 적용
 * - 2pass: 슬롯 미달 시(팝업/기타 이벤트 부족) buzz 순으로 나머지 채움
 */
function applySlotCap(
  events: ScoredEvent[],
  cap: Record<string, number>,
  total: number
): ScoredEvent[] {
  const counts: Record<string, number> = {};
  const result: ScoredEvent[] = [];
  const overflow: ScoredEvent[] = [];

  // 1pass: 슬롯 캡 적용
  for (const event of events) {
    const cat = event.main_category;
    const maxForCat = cap[cat] ?? TRENDING_SLOT_DEFAULT;
    counts[cat] = counts[cat] ?? 0;
    if (counts[cat] < maxForCat) {
      result.push(event);
      counts[cat]++;
    } else {
      overflow.push(event);
    }
  }

  // 2pass: 슬롯 미달이면 overflow에서 buzz 순으로 채움
  if (result.length < total) {
    for (const event of overflow) {
      if (result.length >= total) break;
      result.push(event);
    }
  }

  return result.slice(0, total);
}

// ==================== 날짜 기반 결정적 셔플 ====================

/**
 * 문자열 해시 (비암호화, 결정적)
 */
function stringHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(31, hash) + str.charCodeAt(i) | 0;
  }
  return Math.abs(hash);
}

/**
 * 날짜 기반 결정적 셔플
 * - 같은 날 호출하면 항상 같은 순서 (새로고침해도 동일)
 * - 다음 날은 다른 순서 (매일 자동 갱신)
 * - id + 오늘 날짜 문자열 해시 기반 정렬
 */
function dateSeededShuffle(items: any[]): any[] {
  const today = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
  return [...items].sort((a, b) => stringHash(b.id + today) - stringHash(a.id + today));
}

/**
 * 날짜 기반 결정적 단일 선택 (top-N 풀에서 하루 1개 고정)
 * - 1년(365일) 기준으로 풀을 순환
 */
function dateSeededPick<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  const today = new Date();
  const doy = Math.floor(
    (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000
  );
  return items[doy % items.length] ?? null;
}

// 기본 가중치 (종합적인 밸런스)
const WEIGHTS_BALANCED: ScoreWeights = {
  distance: 0.30,    // 거리 (적당히 반영)
  buzz: 0.30,        // 인기도 (중요)
  time: 0.20,        // 시간 (마감 임박)
  category: 0.15,    // 카테고리 (취향)
  freshness: 0.05,   // 신선도 (새 이벤트)
};

// ==================== 거리 제한 상수 ====================

/**
 * 섹션별 거리 제한 (km)
 * - Phase 1: 하드 제한만 적용, 자동 확대는 Phase 2에서 구현
 */
export const DISTANCE_LIMITS = {
  NEARBY: 5,      // 내 주변: 5km
  TODAY: 10,      // 오늘의 추천: 10km
  WEEKEND: 20,    // 이번 주말: 20km
  LATEST: 20,     // 새로 올라왔어요: 20km
  TRENDING: null, // 지금 떠오르는: 도시권 필터 (Task 3)
} as const;

// ==================== 점수 계산 함수들 ====================

/**
 * 거리 점수 계산 (0~100)
 */
export function calcDistanceScore(distanceKm: number): number {
  if (distanceKm <= 1) return 100;
  if (distanceKm <= 3) return 80;
  if (distanceKm <= 5) return 60;
  if (distanceKm <= 10) return 40;
  if (distanceKm <= 20) return 20;
  return 0;
}

/**
 * 인기 점수 계산 (0~100) - 로그 스케일
 */
export function calcBuzzScore(event: Event): number {
  const rawScore = event.buzz_score || 0;
  if (rawScore === 0) return 0;
  
  // 로그 스케일로 정규화
  const normalized = Math.log10(rawScore + 1) * 20;
  return Math.min(100, normalized);
}

/**
 * 시간 점수 계산 (0~100)
 */
export function calcTimeScore(event: Event, now: Date = new Date()): number {
  const startDate = new Date(event.start_at);
  const endDate = new Date(event.end_at);
  const daysUntilStart = daysBetween(now, startDate);
  const daysUntilEnd = daysBetween(now, endDate);

  // 진행 중
  if (daysUntilStart <= 0 && daysUntilEnd >= 0) {
    // 마감 임박 보너스
    if (daysUntilEnd <= 3) return 100;
    if (daysUntilEnd <= 7) return 90;
    return 80;
  }

  // 곧 시작 (1주일 이내)
  if (daysUntilStart > 0 && daysUntilStart <= 7) {
    return 70;
  }

  // 이미 지났거나 너무 먼 미래
  return 0;
}

/**
 * 카테고리 점수 계산 (0~100)
 */
export function calcCategoryScore(event: Event, userPrefs?: UserPreference): number {
  if (!userPrefs) return 50; // 익명 사용자는 중립 점수

  const prefScore = userPrefs.categories[event.main_category] || 0;
  return prefScore;
}

/**
 * 신선도 점수 계산 (0~100) - 최근 등록된 이벤트 우대
 */
export function calcFreshnessScore(event: Event, now: Date = new Date()): number {
  const createdAt = new Date(event.created_at);
  const daysOld = daysBetween(createdAt, now);

  if (daysOld <= 1) return 100;
  if (daysOld <= 3) return 80;
  if (daysOld <= 7) return 60;
  if (daysOld <= 14) return 40;
  return 20;
}

/**
 * 종합 점수 계산
 */
export function calcTotalScore(
  event: Event,
  userId?: string,
  location?: Location,
  weights: ScoreWeights = WEIGHTS_BALANCED,
  userPrefs?: UserPreference,
  distanceKm?: number
): number {
  let totalScore = 0;
  const w = { ...WEIGHTS_BALANCED, ...weights };

  // 거리 점수
  if (location && distanceKm !== undefined && w.distance) {
    totalScore += calcDistanceScore(distanceKm) * w.distance;
  }

  // 인기 점수
  if (w.buzz) {
    totalScore += calcBuzzScore(event) * w.buzz;
  }

  // 시간 점수
  if (w.time) {
    totalScore += calcTimeScore(event) * w.time;
  }

  // 카테고리 점수
  if (w.category) {
    totalScore += calcCategoryScore(event, userPrefs) * w.category;
  }

  // 신선도 점수
  if (w.freshness) {
    totalScore += calcFreshnessScore(event) * w.freshness;
  }

  return totalScore;
}

// ==================== 유틸리티 함수 ====================

/**
 * 거리 제한 WHERE 절 생성 (Haversine 공식)
 *
 * @param lat - 사용자 위도
 * @param lng - 사용자 경도
 * @param maxDistanceKm - 최대 거리 (km)
 * @param paramOffset - SQL 파라미터 인덱스 오프셋 (기본값: 1)
 * @returns SQL WHERE 절 문자열
 *
 * @example
 * // $1 = lat, $2 = lng 일 때
 * buildDistanceFilter(37.5444, 127.0557, 10, 1)
 * // Returns: "AND (6371 * acos(...)) <= 10"
 */
export function buildDistanceFilter(
  lat: number,
  lng: number,
  maxDistanceKm: number,
  paramOffset: number = 1
): string {
  return `
    AND lat IS NOT NULL
    AND lng IS NOT NULL
    AND (6371 * acos(
      cos(radians($${paramOffset})) * cos(radians(lat)) *
      cos(radians(lng) - radians($${paramOffset + 1})) +
      sin(radians($${paramOffset})) * sin(radians(lat))
    )) <= ${maxDistanceKm}
  `.trim();
}

/**
 * 두 날짜 사이의 일수 차이 계산
 */
function daysBetween(date1: Date, date2: Date): number {
  const diff = date2.getTime() - date1.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/**
 * Haversine 공식으로 두 지점 사이 거리 계산 (km)
 */
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // 지구 반지름 (km)
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * 이벤트 위치 정보 추출
 */
function getEventLocation(event: Event): Location | null {
  // canonical_events는 직접 lat/lng 컬럼이 있음
  if (event.lat && event.lng) {
    return {
      lat: event.lat,
      lng: event.lng,
    };
  }
  
  // 혹시 metadata에도 있는지 확인 (레거시)
  try {
    const location = event.metadata?.location;
    if (location?.coordinates?.lat && location?.coordinates?.lng) {
      return {
        lat: location.coordinates.lat,
        lng: location.coordinates.lng,
      };
    }
  } catch (e) {
    // 위치 정보 없음
  }
  return null;
}

/**
 * 이번 주말 날짜 범위 계산 (토요일 00:00 ~ 일요일 23:59)
 *
 * - 평일(월~금): 이번 주 토~일
 * - 토요일: 오늘(토)~내일(일)
 * - 일요일: 어제(토)~오늘(일)  ← 이번 주말 아직 진행 중
 */
function getNextWeekendRange(): { start: Date; end: Date } {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0(일) ~ 6(토)

  const saturday = new Date(now);

  if (dayOfWeek === 6) {
    // 오늘이 토요일 → 오늘부터
    saturday.setDate(now.getDate());
  } else if (dayOfWeek === 0) {
    // 오늘이 일요일 → 어제(토)부터 (이번 주말 아직 진행 중)
    saturday.setDate(now.getDate() - 1);
  } else {
    // 평일 → 이번 주 토요일 (6 - dayOfWeek 일 후)
    saturday.setDate(now.getDate() + (6 - dayOfWeek));
  }
  saturday.setHours(0, 0, 0, 0);

  const sunday = new Date(saturday);
  sunday.setDate(saturday.getDate() + 1);
  sunday.setHours(23, 59, 59, 999);

  return { start: saturday, end: sunday };
}

/**
 * 이벤트가 특정 기간과 겹치는지 확인
 */
function isOverlapping(eventStart: Date, eventEnd: Date, rangeStart: Date, rangeEnd: Date): boolean {
  const start = new Date(eventStart);
  const end = new Date(eventEnd);
  return start <= rangeEnd && end >= rangeStart;
}

// ==================== 추천 섹션 함수들 ====================

/**
 * "오늘의 추천" - 종합 점수 최상위 1개 (콜드 스타트 대응)
 * 
 * buzz_score가 없어도 시간, 거리, 신선도로 추천
 */
export async function getTodaysPick(
  pool: Pool,
  userId?: string,
  location?: Location,
  userPrefs?: UserPreference
): Promise<ScoredEvent | null> {
  // 위치 정보가 있을 때는 거리 기반 후보 포함
  let query: string;
  let queryParams: any[] = [];
  
  // 품질 게이트: 이미지 없는 이벤트 제외
  const qualityGate = `
    AND image_url IS NOT NULL
    AND image_url != ''
    AND image_url NOT LIKE '%placeholder%'
    AND image_url NOT LIKE '%/defaults/%'
  `;

  if (location && location.lat && location.lng) {
    // 위치 있음: 10km 이내 근처 이벤트 조회
    // buzz_score 기반 정렬 → TypeScript에서 distance/time/freshness 종합 재채점
    query = `
      SELECT *,
        (6371 * acos(
          cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2)) +
          sin(radians($1)) * sin(radians(lat))
        )) as distance_km
      FROM canonical_events
      WHERE end_at >= NOW()
        AND is_deleted = false
        ${qualityGate}
        ${buildDistanceFilter(location.lat, location.lng, DISTANCE_LIMITS.TODAY, 1)}
      ORDER BY
        is_featured DESC NULLS LAST,
        buzz_score DESC NULLS LAST,
        id ASC
      LIMIT 100
    `;
    queryParams = [location.lat, location.lng];

    const locationResult = await pool.query(query, queryParams);

    // 10km 이내 결과가 없으면 전국 폴백
    if (locationResult.rows.length === 0) {
      console.log('[getTodaysPick] 10km 이내 결과 없음, 전국 폴백');
      query = `
        SELECT * FROM canonical_events
        WHERE end_at >= NOW()
          AND is_deleted = false
          ${qualityGate}
        ORDER BY
          is_featured DESC NULLS LAST,
          buzz_score DESC NULLS LAST,
          id ASC
        LIMIT 50
      `;
      queryParams = [];
    } else {
      const events: Event[] = locationResult.rows;
      const hasBuzzData = events.some(e => e.buzz_score > 0);
      const weights = hasBuzzData ? WEIGHTS_BALANCED : WEIGHTS_BALANCED;

      const scoredEvents = events.map(event => {
        const eventLoc = getEventLocation(event);
        const distanceKm = location && eventLoc
          ? calculateDistance(location.lat, location.lng, eventLoc.lat, eventLoc.lng)
          : undefined;
        const score = calcTotalScore(event, userId, location, weights, userPrefs, distanceKm);
        const reason: string[] = [];
        if (distanceKm && distanceKm <= 1) reason.push('매우 가까움');
        else if (distanceKm && distanceKm <= 5) reason.push('가까움');
        const daysUntilEnd = Math.ceil((new Date(event.end_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (daysUntilEnd <= 3) reason.push('마감 임박');
        if (event.buzz_score > 50) reason.push('지금 인기');
        const daysOld = Math.ceil((Date.now() - new Date(event.created_at).getTime()) / (1000 * 60 * 60 * 24));
        if (daysOld <= 2) reason.push('새로 등록');
        return { ...event, score, distance_km: distanceKm, reason: reason.length > 0 ? reason : ['추천'] };
      });
      scoredEvents.sort((a, b) => {
        const scoreDiff = b.score - a.score;
        if (Math.abs(scoreDiff) < 0.01) return a.id.localeCompare(b.id);
        return scoreDiff;
      });
      // top-10 풀에서 날짜 기반으로 하루 1개 고정 선택
      return dateSeededPick(scoredEvents.slice(0, 10));
    }
  } else {
    // 위치 없음: 전국 조회
    query = `
      SELECT * FROM canonical_events
      WHERE end_at >= NOW()
        AND is_deleted = false
        ${qualityGate}
      ORDER BY
        is_featured DESC NULLS LAST,
        buzz_score DESC NULLS LAST,
        id ASC
      LIMIT 50
    `;
  }
  
  const result = await pool.query(query, queryParams);
  const events: Event[] = result.rows;
  
  if (events.length === 0) return null;
  
  // 점수 계산 (콜드 스타트 시 시간/거리 가중치 증가)
  const hasBuzzData = events.some(e => e.buzz_score > 0);
  const weights = hasBuzzData 
    ? WEIGHTS_BALANCED 
    : { distance: 0.30, buzz: 0.30, time: 0.20, category: 0.15, freshness: 0.05 }; // 콜드 스타트도 동일한 밸런스
  
  const scoredEvents = events.map(event => {
    const eventLoc = getEventLocation(event);
    const distanceKm = location && eventLoc 
      ? calculateDistance(location.lat, location.lng, eventLoc.lat, eventLoc.lng)
      : undefined;
    
    const score = calcTotalScore(event, userId, location, weights, userPrefs, distanceKm);
    
    // 추천 이유 생성
    const reason: string[] = [];
    if (distanceKm && distanceKm <= 1) reason.push('매우 가까움');
    else if (distanceKm && distanceKm <= 5) reason.push('가까움');
    
    const daysUntilEnd = Math.ceil((new Date(event.end_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysUntilEnd <= 3) reason.push('마감 임박');
    
    if (event.buzz_score > 500) reason.push('지금 인기');
    
    const daysOld = Math.ceil((Date.now() - new Date(event.created_at).getTime()) / (1000 * 60 * 60 * 24));
    if (daysOld <= 2) reason.push('새로 등록');
    
    return {
      ...event,
      score,
      distance_km: distanceKm,
      reason: reason.length > 0 ? reason : ['추천'],
    };
  });
  
  // 최고 점수 (점수가 같으면 ID 순으로 안정적 정렬)
  scoredEvents.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (Math.abs(scoreDiff) < 0.01) {
      return a.id.localeCompare(b.id);
    }
    return scoreDiff;
  });

  // top-10 풀에서 날짜 기반으로 하루 1개 고정 선택
  return dateSeededPick(scoredEvents.slice(0, 10));
}

/**
 * "지금 떠오르는" - 인기 급상승 이벤트 (도시권 필터링)
 *
 * - location이 있으면 도시권 기반 필터링 (예: 서울 → 수도권)
 * - location이 없으면 전국 조회
 */
export async function getTrending(
  pool: Pool,
  location?: Location,
  excludeIds: Set<string> = new Set(),
  limit: number = 10
): Promise<ScoredEvent[]> {
  const excludeIdsArray = Array.from(excludeIds);
  const excludeClause = excludeIdsArray.length > 0
    ? `AND id NOT IN (${excludeIdsArray.map((_, i) => `$${i + 1}`).join(',')})`
    : '';

  // 도시권 필터링 (location이 있을 때만)
  let cityZoneFilter = '';
  if (location && location.lat && location.lng) {
    try {
      // 1. Reverse Geocoding으로 주소 획득
      const address = await reverseGeocode(location.lat, location.lng);
      console.log('[getTrending] Reverse geocoded address:', address);

      // 2. 도시권 판별
      const cityZone = getCityZone(address);
      console.log('[getTrending] City zone:', cityZone);

      // 3. SQL WHERE 조건 추가
      if (cityZone.length > 0) {
        cityZoneFilter = buildCityZoneFilter(cityZone);
        console.log('[getTrending] Applying city zone filter:', cityZoneFilter);
      }
    } catch (error: any) {
      console.error('[getTrending] Error in city zone filtering:', error.message);
      // 에러 발생 시 전국 조회로 폴백 (cityZoneFilter = '')
    }
  }

  // buzz=0 fallback 제거: 인기 없는 마감 이벤트가 1000점으로 상위 차지하는 문제 수정
  // buzz=0 이벤트는 buzz_score 그대로 0점 → 하위 정렬
  //
  // [Phase 2] view_count 반영:
  //   trend_score = buzz_score * 0.8 + view_count_bonus * 0.2
  //   view_count_bonus = LEAST(view_count / 100.0, 100) → 최대 100점, 1만 조회수에서 포화
  //   현재 view_count=0(사용자 없음)이면 trend_score = buzz_score (기존 동작 유지)
  const fetchLimit = 80; // 날짜 기반 셔플을 위해 후보 풀 확장 (기존 limit*5=50 → 80)
  const query = `
    SELECT *,
      (buzz_score * 0.8 + LEAST(COALESCE(view_count, 0)::float / 100.0, 100.0) * 0.2) AS trend_score,
      CASE
        WHEN buzz_score = 0 AND (end_at - NOW()) <= INTERVAL '3 days' THEN 'deadline'
        WHEN buzz_score = 0 AND (NOW() - created_at) <= INTERVAL '3 days' THEN 'fresh'
        ELSE 'normal'
      END AS fallback_group
    FROM canonical_events
    WHERE end_at >= NOW()
      AND is_deleted = false
      AND image_url IS NOT NULL
      AND image_url != ''
      AND image_url NOT LIKE '%placeholder%'
      AND image_url NOT LIKE '%/defaults/%'
      ${cityZoneFilter}
      ${excludeClause}
    ORDER BY
      is_featured DESC NULLS LAST,
      trend_score DESC,
      end_at ASC,
      created_at DESC,
      id ASC
    LIMIT $${excludeIdsArray.length + 1}
  `;

  let trendingRows = (await pool.query(query, [...excludeIdsArray, fetchLimit])).rows;

  // 도시권 필터 결과가 limit 미만이면 전국으로 폴백
  if (cityZoneFilter && trendingRows.length < limit) {
    console.log(`[getTrending] 도시권 결과 ${trendingRows.length}개 < ${limit} — 전국 폴백`);
    const fallbackQuery = query.replace(cityZoneFilter, '');
    trendingRows = (await pool.query(fallbackQuery, [...excludeIdsArray, fetchLimit])).rows;
  }

  // 날짜 기반 셔플: 같은 날 새로고침해도 순서 고정, 다음 날 자동 갱신
  const mappedRows = dateSeededShuffle(trendingRows).map(row => {
    let reason: string[];
    if (row.buzz_score > 0) {
      reason = ['인기 급상승'];
    } else {
      switch (row.fallback_group) {
        case 'deadline': {
          const daysUntilEnd = Math.ceil((new Date(row.end_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          reason = ['마감 임박', `D-${daysUntilEnd}`];
          break;
        }
        case 'fresh': {
          reason = ['새로 등록'];
          break;
        }
        default: {
          reason = ['추천'];
          break;
        }
      }
    }

    let distance_km: number | undefined;
    if (location && row.lat && row.lng) {
      distance_km = calculateDistance(location.lat, location.lng, row.lat, row.lng);
    }

    return {
      ...row,
      score: row.trend_score,
      reason,
      distance_km,
    };
  });

  // 슬롯 캡: 공연 93% 물량 독점 방지
  return applySlotCap(mappedRows, TRENDING_SLOT_CAP, limit);
}

/**
 * "근처 이벤트" - 거리 기반 (단계적 반경 확장)
 *
 * 반경을 5 → 10 → 20km 순으로 확장하며 최소 MIN_NEARBY개를 확보.
 * 20km까지 확장해도 부족하면 확보된 만큼만 반환 (0개면 빈 배열).
 *
 * 점수 = (1 - 거리/반경km) × 60 + (buzz_score/100) × 40
 * → 반경이 커질수록 거리 페널티가 완화되어 먼 이벤트도 자연스럽게 노출
 */
export async function getNearby(
  pool: Pool,
  location: Location,
  excludeIds: Set<string> = new Set(),
  limit: number = 10
): Promise<ScoredEvent[]> {
  const MIN_NEARBY = 5; // 이 이하면 다음 반경으로 확장
  const RADIUS_STEPS = [5, 10, 20]; // km 단계

  const excludeIdsArray = Array.from(excludeIds);
  const excludeClause = excludeIdsArray.length > 0
    ? `AND id NOT IN (${excludeIdsArray.map((_, i) => `$${i + 3}`).join(',')})`
    : '';

  const buildNearbyQuery = (radiusKm: number) => `
    SELECT *,
           (6371 * acos(LEAST(1.0,
             cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2)) +
             sin(radians($1)) * sin(radians(lat))
           ))) AS distance_km,
           ((1.0 - LEAST(
             (6371 * acos(LEAST(1.0,
               cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2)) +
               sin(radians($1)) * sin(radians(lat))
             ))) / ${radiusKm}.0, 1.0)) * 60.0
            + (LEAST(buzz_score, 100.0) / 100.0) * 40.0) AS nearby_score
    FROM canonical_events
    WHERE end_at >= NOW()
      AND is_deleted = false
      AND image_url IS NOT NULL
      AND image_url != ''
      AND image_url NOT LIKE '%placeholder%'
      AND image_url NOT LIKE '%/defaults/%'
      ${buildDistanceFilter(location.lat, location.lng, radiusKm, 1)}
      ${excludeClause}
    ORDER BY
      is_featured DESC NULLS LAST,
      nearby_score DESC,
      id ASC
    LIMIT $${excludeIdsArray.length + 3}
  `;

  let rows: any[] = [];
  let usedRadius = RADIUS_STEPS[0];

  for (const radiusKm of RADIUS_STEPS) {
    usedRadius = radiusKm;
    const result = await pool.query(
      buildNearbyQuery(radiusKm),
      [location.lat, location.lng, ...excludeIdsArray, limit]
    );
    rows = result.rows;

    if (rows.length >= MIN_NEARBY) break;
    console.log(`[getNearby] ${radiusKm}km 결과 ${rows.length}개 — 다음 반경으로 확장`);
  }

  console.log(`[getNearby] 최종 반경: ${usedRadius}km, 결과: ${rows.length}개`);

  return rows.map(event => {
    const distanceKm = event.distance_km;
    let reason: string[] = [];
    if (distanceKm <= 0.5) reason.push('매우 가까움');
    else if (distanceKm <= 1) reason.push('도보 가능');
    else if (distanceKm <= 3) reason.push('가까움');
    else if (distanceKm <= 10) reason.push(`${distanceKm.toFixed(1)}km`);
    else reason.push(`근처 ${distanceKm.toFixed(0)}km`);

    return {
      ...event,
      score: event.nearby_score,
      distance_km: distanceKm,
      reason,
    };
  });
}

/**
 * "취향 저격" - 사용자 선호 카테고리 기반 (로그인 사용자만)
 */
export async function getPersonalized(
  pool: Pool,
  userId: string,
  userPrefs: UserPreference,
  excludeIds: Set<string> = new Set(),
  limit: number = 10
): Promise<ScoredEvent[]> {
  const excludeIdsArray = Array.from(excludeIds);
  const excludeClause = excludeIdsArray.length > 0
    ? `AND id NOT IN (${excludeIdsArray.map((_, i) => `$${i + 1}`).join(',')})`
    : '';
  
  // 선호 카테고리 필터
  const preferredCategories = Object.keys(userPrefs.categories).filter(
    cat => userPrefs.categories[cat] > 50
  );
  
  if (preferredCategories.length === 0) {
    return [];
  }
  
  const query = `
    SELECT * FROM canonical_events
    WHERE end_at >= NOW()
      AND is_deleted = false
      AND main_category = ANY($${excludeIdsArray.length + 1})
      ${excludeClause}
    ORDER BY
      is_featured DESC NULLS LAST,
      buzz_score DESC NULLS LAST
    LIMIT 50
  `;

  const result = await pool.query(query, [...excludeIdsArray, preferredCategories]);
  const events: Event[] = result.rows;
  
  // 점수 계산
  const scoredEvents = events
    .map(event => {
      const score = calcTotalScore(
        event,
        userId,
        undefined,
        { category: 0.5, buzz: 0.3, time: 0.2 },
        userPrefs
      );
      
      return {
        ...event,
        score,
        reason: ['취향 맞춤'],
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  
  return scoredEvents;
}

/**
 * "이번 주말" - 주말 기간 필터 + 종합 점수
 */
export async function getWeekend(
  pool: Pool,
  excludeIds: Set<string> = new Set(),
  limit: number = 10,
  location?: Location
): Promise<ScoredEvent[]> {
  const weekend = getNextWeekendRange();
  const excludeIdsArray = Array.from(excludeIds);
  let queryParams: any[];
  let distanceFilter = '';
  let distanceSelect = '';

  // location이 있으면 20km 제한 적용
  // 날짜 기반 셔플을 위해 후보 풀 확장 (기존 limit*5=50 → 80)
  const fetchLimit = 80;

  if (location && location.lat && location.lng) {
    distanceFilter = buildDistanceFilter(location.lat, location.lng, DISTANCE_LIMITS.WEEKEND, 3);
    distanceSelect = `,
      (6371 * acos(
        cos(radians($3)) * cos(radians(lat)) * cos(radians(lng) - radians($4)) +
        sin(radians($3)) * sin(radians(lat))
      )) AS distance_km`;
    queryParams = [weekend.start, weekend.end, location.lat, location.lng, ...excludeIdsArray, fetchLimit];
  } else {
    queryParams = [weekend.start, weekend.end, ...excludeIdsArray, fetchLimit];
  }

  const excludeClause = excludeIdsArray.length > 0
    ? `AND id NOT IN (${excludeIdsArray.map((_, i) => {
        const offset = location ? 5 : 3;
        return `$${i + offset}`;
      }).join(',')})`
    : '';

  const limitIndex = location
    ? excludeIdsArray.length + 5
    : excludeIdsArray.length + 3;

  const query = `
    SELECT *${distanceSelect}
    FROM canonical_events
    WHERE end_at >= $1
      AND start_at <= $2
      AND is_deleted = false
      AND image_url IS NOT NULL
      AND image_url != ''
      AND image_url NOT LIKE '%placeholder%'
      AND image_url NOT LIKE '%/defaults/%'
      ${distanceFilter}
      ${excludeClause}
    ORDER BY
      is_featured DESC NULLS LAST,
      buzz_score DESC NULLS LAST,
      ${location ? 'distance_km ASC NULLS LAST,' : ''}
      id ASC
    LIMIT $${limitIndex}
  `;

  const result = await pool.query(query, queryParams);

  // 날짜 기반 셔플: 같은 날 새로고침해도 순서 고정, 다음 날 자동 갱신
  const scoredEvents = dateSeededShuffle(result.rows).map(event => {
    let distance_km: number | undefined;
    if (location && event.lat && event.lng) {
      distance_km = calculateDistance(location.lat, location.lng, event.lat, event.lng);
    }

    return {
      ...event,
      score: event.buzz_score ?? 0,
      reason: ['주말 추천'],
      distance_km,
    };
  });

  // 슬롯 캡: 공연 93% 물량 독점 방지
  return applySlotCap(scoredEvents, WEEKEND_SLOT_CAP, limit);
}

/**
 * "새로 올라왔어요" - 등록 시간순
 *
 * 위치 있을 때: 20km 이내 우선 조회, 결과 부족 시 전국 폴백
 * 위치 없을 때: 전국 조회
 */
export async function getLatest(
  pool: Pool,
  excludeIds: Set<string> = new Set(),
  limit: number = 10,
  location?: Location
): Promise<ScoredEvent[]> {
  const qualityGate = `
    AND image_url IS NOT NULL
    AND image_url != ''
    AND image_url NOT LIKE '%placeholder%'
    AND image_url NOT LIKE '%/defaults/%'
    AND NOT (buzz_score = 0 AND overview IS NULL AND created_at < NOW() - INTERVAL '1 day')
  `;

  const buildLatestQuery = (withLocation: boolean) => {
    const excludeIdsArray = Array.from(excludeIds);

    if (withLocation && location) {
      const distanceSelect = `,
        (6371 * acos(
          cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2)) +
          sin(radians($1)) * sin(radians(lat))
        )) AS distance_km`;
      const distanceFilter = buildDistanceFilter(location.lat, location.lng, DISTANCE_LIMITS.LATEST, 1);
      const excludeClause = excludeIdsArray.length > 0
        ? `AND id NOT IN (${excludeIdsArray.map((_, i) => `$${i + 3}`).join(',')})`
        : '';
      const limitIndex = excludeIdsArray.length + 3;
      return {
        query: `
          SELECT *${distanceSelect}
          FROM canonical_events
          WHERE end_at >= NOW()
            AND is_deleted = false
            ${qualityGate}
            ${distanceFilter}
            ${excludeClause}
          ORDER BY
            is_featured DESC NULLS LAST,
            created_at DESC,
            buzz_score DESC NULLS LAST,
            id ASC
          LIMIT $${limitIndex}
        `,
        params: [location.lat, location.lng, ...excludeIdsArray, limit],
      };
    } else {
      const excludeClause = excludeIdsArray.length > 0
        ? `AND id NOT IN (${excludeIdsArray.map((_, i) => `$${i + 1}`).join(',')})`
        : '';
      const limitIndex = excludeIdsArray.length + 1;
      return {
        query: `
          SELECT *
          FROM canonical_events
          WHERE end_at >= NOW()
            AND is_deleted = false
            ${qualityGate}
            ${excludeClause}
          ORDER BY
            is_featured DESC NULLS LAST,
            created_at DESC,
            buzz_score DESC NULLS LAST,
            id ASC
          LIMIT $${limitIndex}
        `,
        params: [...excludeIdsArray, limit],
      };
    }
  };

  const toScoredEvent = (row: any): ScoredEvent => ({
    ...row,
    score: 100,
    reason: ['새로 추가됨'],
    distance_km: row.distance_km,
  });

  // 위치 있을 때: 20km 우선 조회 → 결과 부족 시 전국 폴백
  if (location && location.lat && location.lng) {
    const { query, params } = buildLatestQuery(true);
    const result = await pool.query(query, params);

    if (result.rows.length >= Math.min(3, limit)) {
      return result.rows.map(toScoredEvent);
    }

    // 결과가 3개 미만이면 전국으로 폴백
    console.log(`[getLatest] Location result insufficient (${result.rows.length}), falling back to nationwide`);
    const fallback = buildLatestQuery(false);
    const fallbackResult = await pool.query(fallback.query, fallback.params);
    return fallbackResult.rows.map(toScoredEvent);
  }

  // 위치 없을 때: 전국 조회
  const { query, params } = buildLatestQuery(false);
  const result = await pool.query(query, params);
  return result.rows.map(toScoredEvent);
}

/**
 * "곧 끝나요" - 7일 이내 마감 이벤트 (urgency_score 기반)
 *
 * 위치 있을 때: 20km → 50km → 전국 단계적 확장
 * 위치 없을 때: 전국 조회
 * 결과 < 5개면 빈 배열 반환 (프론트에서 섹션 숨김)
 * excludedIds 없음 (B안 — 독립 풀)
 */
export async function getEndingSoon(
  pool: Pool,
  location?: Location,
  limit: number = 10
): Promise<ScoredEvent[]> {
  const fetchLimit = limit * 5;
  const MIN_COUNT = 1; // 초기 서비스: 1개 이상이면 노출 (기존 5 → 1)

  const qualityGate = `
    AND image_url IS NOT NULL
    AND image_url != ''
    AND image_url NOT LIKE '%placeholder%'
    AND image_url NOT LIKE '%/defaults/%'
  `;

  const urgencyExprs = `
    EXTRACT(EPOCH FROM (end_at - NOW())) / 86400.0 AS days_left,
    ((1.0 - LEAST(EXTRACT(EPOCH FROM (end_at - NOW())) / (7.0 * 86400.0), 1.0)) * 60.0
     + (LEAST(COALESCE(buzz_score, 0), 100.0) / 100.0) * 40.0) AS urgency_score
  `;

  const toMapped = (row: any, loc?: Location): ScoredEvent => {
    const daysLeft = Math.max(1, Math.ceil(row.days_left));
    const reason = row.buzz_score > 0 ? ['마감 임박', `D-${daysLeft}`] : [`D-${daysLeft}`];
    const distance_km = row.distance_km !== undefined
      ? row.distance_km
      : (loc && row.lat && row.lng ? calculateDistance(loc.lat, loc.lng, row.lat, row.lng) : undefined);
    return { ...row, score: row.urgency_score, reason, distance_km } as ScoredEvent;
  };

  if (location && location.lat && location.lng) {
    const loc = location;

    const buildDistanceQuery = (radiusKm: number) => `
      SELECT *,
        (6371 * acos(LEAST(1.0,
          cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2)) +
          sin(radians($1)) * sin(radians(lat))
        ))) AS distance_km,
        ${urgencyExprs}
      FROM canonical_events
      WHERE end_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
        AND is_deleted = false
        ${qualityGate}
        ${buildDistanceFilter(loc.lat, loc.lng, radiusKm, 1)}
      ORDER BY
        is_featured DESC NULLS LAST,
        buzz_score DESC NULLS LAST,
        distance_km ASC NULLS LAST,
        id ASC
      LIMIT $3
    `;

    const nationwideQuery = `
      SELECT *, ${urgencyExprs}
      FROM canonical_events
      WHERE end_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
        AND is_deleted = false
        ${qualityGate}
      ORDER BY
        is_featured DESC NULLS LAST,
        buzz_score DESC NULLS LAST,
        id ASC
      LIMIT $1
    `;

    let rows: any[] = [];

    for (const radiusKm of [20, 50]) {
      rows = (await pool.query(buildDistanceQuery(radiusKm), [loc.lat, loc.lng, fetchLimit])).rows;
      if (rows.length >= MIN_COUNT) break;
      console.log(`[getEndingSoon] ${radiusKm}km 결과 ${rows.length}개 — 반경 확장`);
    }

    if (rows.length < MIN_COUNT) {
      console.log('[getEndingSoon] 전국 폴백');
      rows = (await pool.query(nationwideQuery, [fetchLimit])).rows;
    }

    if (rows.length < MIN_COUNT) return [];
    return applySlotCap(rows.map(row => toMapped(row, loc)), ENDING_SOON_SLOT_CAP, limit);
  }

  // 위치 없음: 전국 조회
  const result = await pool.query(`
    SELECT *, ${urgencyExprs}
    FROM canonical_events
    WHERE end_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
      AND is_deleted = false
      ${qualityGate}
    ORDER BY
      is_featured DESC NULLS LAST,
      buzz_score DESC NULLS LAST,
      id ASC
    LIMIT $1
  `, [fetchLimit]);

  if (result.rows.length < MIN_COUNT) return [];
  return applySlotCap(result.rows.map(row => toMapped(row)), ENDING_SOON_SLOT_CAP, limit);
}

/**
 * "전시 큐레이션" - 전시 카테고리 특화 섹션
 *
 * buzz_score 기반 정렬, 같은 venue 최대 2개 제한
 * 결과 < 3개면 빈 배열 반환
 * excludedIds 없음 (테마 섹션 — 독립 풀)
 */
export async function getExhibition(
  pool: Pool,
  location?: Location,
  limit: number = 10
): Promise<ScoredEvent[]> {
  const fetchLimit = 60; // 날짜 기반 셔플을 위해 후보 풀 확장 (venue 캡 여유분 포함)
  const MIN_COUNT = 3;

  const qualityGate = `
    AND image_url IS NOT NULL
    AND image_url != ''
    AND image_url NOT LIKE '%placeholder%'
    AND image_url NOT LIKE '%/defaults/%'
  `;

  const applyVenueCap = (rows: any[], loc?: Location): ScoredEvent[] => {
    const venueCounts: Record<string, number> = {};
    const filtered: any[] = [];
    for (const row of rows) {
      const venue = row.venue || '__unknown__';
      venueCounts[venue] = venueCounts[venue] ?? 0;
      if (venueCounts[venue] < 2) {
        filtered.push(row);
        venueCounts[venue]++;
      }
      if (filtered.length >= limit) break;
    }
    return filtered.map(row => {
      const daysLeft = Math.ceil((new Date(row.end_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      const daysOld = Math.ceil((Date.now() - new Date(row.created_at).getTime()) / (1000 * 60 * 60 * 24));
      let reason: string[];
      if (daysLeft <= 7) reason = [`마감 D-${daysLeft}`];
      else if (daysOld <= 7) reason = ['새로 열린'];
      else reason = ['인기 전시'];
      const distance_km = row.distance_km !== undefined
        ? row.distance_km
        : (loc && row.lat && row.lng ? calculateDistance(loc.lat, loc.lng, row.lat, row.lng) : undefined);
      return { ...row, score: row.buzz_score || 0, reason, distance_km } as ScoredEvent;
    });
  };

  if (location && location.lat && location.lng) {
    const loc = location;

    const buildDistanceQuery = (radiusKm: number) => `
      SELECT *,
        (6371 * acos(LEAST(1.0,
          cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2)) +
          sin(radians($1)) * sin(radians(lat))
        ))) AS distance_km
      FROM canonical_events
      WHERE main_category = '전시'
        AND end_at >= NOW()
        AND is_deleted = false
        ${qualityGate}
        ${buildDistanceFilter(loc.lat, loc.lng, radiusKm, 1)}
      ORDER BY
        is_featured DESC NULLS LAST,
        buzz_score DESC NULLS LAST,
        distance_km ASC NULLS LAST,
        id ASC
      LIMIT $3
    `;

    const nationwideQuery = `
      SELECT *
      FROM canonical_events
      WHERE main_category = '전시'
        AND end_at >= NOW()
        AND is_deleted = false
        ${qualityGate}
      ORDER BY
        is_featured DESC NULLS LAST,
        buzz_score DESC NULLS LAST,
        id ASC
      LIMIT $1
    `;

    let rows: any[] = [];

    for (const radiusKm of [20, 50]) {
      rows = (await pool.query(buildDistanceQuery(radiusKm), [loc.lat, loc.lng, fetchLimit])).rows;
      if (rows.length >= MIN_COUNT) break;
      console.log(`[getExhibition] ${radiusKm}km 결과 ${rows.length}개 — 반경 확장`);
    }

    if (rows.length < MIN_COUNT) {
      console.log('[getExhibition] 전국 폴백');
      rows = (await pool.query(nationwideQuery, [fetchLimit])).rows;
    }

    if (rows.length < MIN_COUNT) return [];
    // 날짜 기반 셔플 후 venue 캡 적용
    return applyVenueCap(dateSeededShuffle(rows), loc);
  }

  // 위치 없음: 전국 조회
  const result = await pool.query(`
    SELECT *
    FROM canonical_events
    WHERE main_category = '전시'
      AND end_at >= NOW()
      AND is_deleted = false
      ${qualityGate}
    ORDER BY
      is_featured DESC NULLS LAST,
      buzz_score DESC NULLS LAST,
      id ASC
    LIMIT $1
  `, [fetchLimit]);

  if (result.rows.length < MIN_COUNT) return [];
  return applyVenueCap(dateSeededShuffle(result.rows));
}

/**
 * "무료로 즐겨요" - 무료 이벤트 섹션
 *
 * price_min = 0 또는 price_info에 '무료' 포함
 * 결과 < 5개면 빈 배열 반환
 * excludedIds 없음 (테마 섹션 — 독립 풀)
 */
export async function getFreeEvents(
  pool: Pool,
  location?: Location,
  limit: number = 10
): Promise<ScoredEvent[]> {
  const fetchLimit = 60; // 날짜 기반 셔플을 위해 후보 풀 확장
  const MIN_COUNT = 5;

  const qualityGate = `
    AND image_url IS NOT NULL
    AND image_url != ''
    AND image_url NOT LIKE '%placeholder%'
    AND image_url NOT LIKE '%/defaults/%'
  `;

  const toMapped = (row: any, loc?: Location): ScoredEvent => {
    const daysLeft = Math.ceil((new Date(row.end_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    const reason: string[] = ['무료 입장'];
    if (daysLeft <= 7) reason.push(`D-${daysLeft}`);
    const distance_km = row.distance_km !== undefined
      ? row.distance_km
      : (loc && row.lat && row.lng ? calculateDistance(loc.lat, loc.lng, row.lat, row.lng) : undefined);
    return { ...row, score: row.buzz_score || 0, reason, distance_km } as ScoredEvent;
  };

  if (location && location.lat && location.lng) {
    const loc = location;

    const buildDistanceQuery = (radiusKm: number) => `
      SELECT *,
        (6371 * acos(LEAST(1.0,
          cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2)) +
          sin(radians($1)) * sin(radians(lat))
        ))) AS distance_km
      FROM canonical_events
      WHERE (price_min = 0 OR price_info ILIKE '%무료%')
        AND end_at >= NOW()
        AND is_deleted = false
        ${qualityGate}
        ${buildDistanceFilter(loc.lat, loc.lng, radiusKm, 1)}
      ORDER BY
        is_featured DESC NULLS LAST,
        buzz_score DESC NULLS LAST,
        distance_km ASC NULLS LAST,
        id ASC
      LIMIT $3
    `;

    const nationwideQuery = `
      SELECT *
      FROM canonical_events
      WHERE (price_min = 0 OR price_info ILIKE '%무료%')
        AND end_at >= NOW()
        AND is_deleted = false
        ${qualityGate}
      ORDER BY
        is_featured DESC NULLS LAST,
        buzz_score DESC NULLS LAST,
        id ASC
      LIMIT $1
    `;

    let rows: any[] = [];

    for (const radiusKm of [10, 20]) {
      rows = (await pool.query(buildDistanceQuery(radiusKm), [loc.lat, loc.lng, fetchLimit])).rows;
      if (rows.length >= MIN_COUNT) break;
      console.log(`[getFreeEvents] ${radiusKm}km 결과 ${rows.length}개 — 반경 확장`);
    }

    if (rows.length < MIN_COUNT) {
      console.log('[getFreeEvents] 전국 폴백');
      rows = (await pool.query(nationwideQuery, [fetchLimit])).rows;
    }

    if (rows.length < MIN_COUNT) return [];
    // 날짜 기반 셔플 후 슬롯 캡 적용
    return applySlotCap(dateSeededShuffle(rows).map(row => toMapped(row, loc)), FREE_SLOT_CAP, limit);
  }

  // 위치 없음: 전국 조회
  const result = await pool.query(`
    SELECT *
    FROM canonical_events
    WHERE (price_min = 0 OR price_info ILIKE '%무료%')
      AND end_at >= NOW()
      AND is_deleted = false
      ${qualityGate}
    ORDER BY
      is_featured DESC NULLS LAST,
      buzz_score DESC NULLS LAST,
      id ASC
    LIMIT $1
  `, [fetchLimit]);

  if (result.rows.length < MIN_COUNT) return [];
  return applySlotCap(dateSeededShuffle(result.rows).map(row => toMapped(row)), FREE_SLOT_CAP, limit);
}

