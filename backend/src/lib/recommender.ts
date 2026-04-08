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
 * 카테고리별 최대 노출 수 제한 (soft cap — 후보 없으면 해당 슬롯 공백, 2-pass로 보충)
 * 공연이 90%+ 물량이라 cap 없으면 전 섹션이 공연으로 채워짐
 */
const TRENDING_SLOT_CAP: Record<string, number> = {
  '공연': 4,
  '전시': 3,
  '팝업': 1,
};

const WEEKEND_SLOT_CAP: Record<string, number> = {
  '공연': 4,
  '전시': 3,
  '팝업': 1,
};

const ENDING_SOON_SLOT_CAP: Record<string, number> = {
  '공연': 4,
  '전시': 4,
  '팝업': 1,
};

const FREE_SLOT_CAP: Record<string, number> = {
  '공연': 4,
  '전시': 3,
  '팝업': 1,
  '기타': 2,
};

const BUDGET_PICK_SLOT_CAP: Record<string, number> = {
  '공연': 4,
  '전시': 4,
  // 팝업은 SQL에서 이미 제외 (budget_pick 정책)
  '기타': 2,
};

const DATE_PICK_SLOT_CAP: Record<string, number> = {
  '공연': 4,
  '전시': 3,
  '팝업': 2,
};

const WALKABLE_SLOT_CAP: Record<string, number> = {
  '공연': 4,
  '전시': 3,
  '팝업': 2,
};

const DISCOVERY_SLOT_CAP: Record<string, number> = {
  '공연': 3,
  '전시': 4,
  '팝업': 2,
  '축제': 1,
};

const BEGINNER_SLOT_CAP: Record<string, number> = {
  '공연': 4,
  '전시': 3,
  '팝업': 1,
  '축제': 1,
};

const SLOT_CAP_DEFAULT = 1; // 축제, 행사 등 정의되지 않은 카테고리 기본 최대치

/**
 * 카테고리 soft cap 적용
 *
 * cap은 "최대 허용치"이지 "보장 할당량"이 아님.
 * 특정 카테고리 후보가 없거나 적으면 해당 슬롯은 비워두고,
 * 남은 슬롯은 cap 초과 이벤트 중 score 상위 순으로 채움.
 *
 * 품질 필터(buzz_score > 0 등)는 pool 단계(SQL)에서 섹션별로 적용.
 *
 * - 1pass: dateSeededShuffle 순서로 순회하며 카테고리별 cap 적용
 * - 2pass: 잔여 슬롯 → cap 초과 이벤트 중 score DESC 순으로 보충
 */
function applySlotCap(
  events: ScoredEvent[],
  cap: Record<string, number>,
  total: number
): ScoredEvent[] {
  const counts: Record<string, number> = {};
  const result: ScoredEvent[] = [];
  const overflow: ScoredEvent[] = [];

  // 1pass: 카테고리 soft cap — 후보가 없으면 해당 카테고리는 0개
  for (const event of events) {
    const cat = event.main_category;
    const maxForCat = cap[cat] ?? SLOT_CAP_DEFAULT;
    counts[cat] = counts[cat] ?? 0;
    if (counts[cat] < maxForCat) {
      result.push(event);
      counts[cat]++;
    } else {
      overflow.push(event);
    }
  }

  // 2pass: 잔여 슬롯 → score 상위 overflow로 보충 (품질 순서 보장)
  if (result.length < total) {
    const sortedOverflow = overflow.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    for (const event of sortedOverflow) {
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
 * 거리 선형 점수 계산 (0~100)
 * dist_score = max(0, 1 - distKm / normalizeKm) * 100
 */
export function calcLinearDistScore(distKm: number, normalizeKm: number): number {
  return Math.max(0, (1 - distKm / normalizeKm) * 100);
}

/**
 * Haversine 공식으로 두 좌표 간 거리 계산 (km)
 */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

  // buzz_score > 0 조건: 사회적 증거가 없는 이벤트는 trending 후보 제외
  // (슬롯캡이 buzz=0 이벤트를 팝업/전시 슬롯에 강제 삽입하는 문제 방지)
  //
  // trend_score = buzz_score * 0.8 + view_count_bonus * 0.2
  //   view_count_bonus = LEAST(view_count / 100.0, 100) → 최대 100점, 1만 조회수에서 포화
  const fetchLimit = 80; // 날짜 기반 셔플을 위해 후보 풀 확장 (기존 limit*5=50 → 80)
  const query = `
    SELECT *,
      (buzz_score * 0.8 + LEAST(COALESCE(view_count, 0)::float / 100.0, 100.0) * 0.2) AS trend_score
    FROM canonical_events
    WHERE end_at >= NOW()
      AND is_deleted = false
      AND buzz_score > 0
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
    const reason = ['인기 급상승'];

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
 * "1만원 이하" 가성비 추천
 *
 * 위치 정책: 권역(도시권) 우선 → 결과 부족 시 전국 폴백
 * - 1만원 이하 풀이 권역별로 얇아 20km보다 권역이 안정적
 * - trending과 동일한 getCityZone + buildCityZoneFilter 인프라 사용
 *
 * 가격 조건: is_free=true OR price_min=0 OR price_min <= 10000
 * - price_min IS NULL은 제외 (가격 불명 이벤트가 섹션 의미를 깨뜨림)
 * - is_free=true는 price_min이 NULL이어도 허용 (실제 무료 이벤트)
 *
 * 카테고리 정책: 팝업(팝업) 제외
 * - 팝업은 입장 무료인 경우가 많지만, 실질 경험이 굿즈/식음료/소비 중심
 * - "1만원 이하 / 부담 없이" 섹션 취지와 맞지 않아 명시적으로 제외
 * - 앱 내 무료 뱃지 표시(effectiveIsFree)와는 독립적인 budget_pick 전용 정책
 *
 * 정렬: buzz_score × time_decay DESC (가성비 + 인기 기준)
 */
export async function getBudgetPick(
  pool: Pool,
  location?: Location,
  limit: number = 10,
): Promise<ScoredEvent[]> {
  const MAX_PRICE = 10000;
  const fetchLimit = Math.min(limit * 3, 40); // serve-time click downranking용 후보 풀

  let cityZoneFilter = '';
  if (location) {
    try {
      const address = await reverseGeocode(location.lat, location.lng);
      const cityZone = getCityZone(address);
      if (cityZone.length > 0) {
        cityZoneFilter = buildCityZoneFilter(cityZone);
      }
    } catch (error: any) {
      console.error('[getBudgetPick] city zone error:', error.message);
    }
  }

  const buildQuery = (zoneFilter: string) => `
    SELECT *,
      buzz_score * POWER(0.99, GREATEST(0, EXTRACT(DAY FROM NOW() - created_at)::int)) AS decayed_buzz
    FROM canonical_events
    WHERE is_deleted = false
      AND status != 'cancelled'
      AND end_at >= NOW()
      AND (is_free = true OR price_min = 0 OR price_min <= $1)
      AND main_category != '팝업'   -- 정책: 팝업은 입장 무료여도 실질 경험이 굿즈/소비 중심이므로 budget_pick 제외
      AND image_url IS NOT NULL
      AND image_url != ''
      AND image_url NOT LIKE '%placeholder%'
      AND image_url NOT LIKE '%/defaults/%'
      ${zoneFilter}
    ORDER BY is_featured DESC NULLS LAST,
      decayed_buzz DESC NULLS LAST,
      created_at DESC
    LIMIT $2
  `;

  let rows = (await pool.query(buildQuery(cityZoneFilter), [MAX_PRICE, fetchLimit])).rows;

  if (cityZoneFilter && rows.length < limit) {
    console.log(`[getBudgetPick] 권역 결과 ${rows.length}개 < ${limit} → 전국 폴백`);
    rows = (await pool.query(buildQuery(''), [MAX_PRICE, fetchLimit])).rows;
  }

  const scored = rows.map(row => ({
    ...row,
    score: row.decayed_buzz ?? 0,
    reason: ['가성비 추천'],
  }));
  return applySlotCap(scored, BUDGET_PICK_SLOT_CAP, limit);
}

/**
 * "둘이 가기 좋은 곳" — 데이트 추천 (date_pick)
 *
 * 후보 풀: derived_tags @> '["데이트"]'
 * - 1,037개 후보 (2026-03-08 기준, 키즈 제외 후 ~1,020개)
 *
 * 위치 정책: 권역(도시권) 우선 → 결과 부족 시 전국 폴백
 * - trending / budget_pick과 동일한 getCityZone + buildCityZoneFilter 인프라 사용
 *
 * 카테고리 정책: 전시 / 공연(뮤지컬·연극·콘서트·대중음악·무용) / 팝업 허용
 * - 기타 공연(역사강연·특강 등), 클래식, 서양음악(클래식) sub_category 제외
 * - 단, "가족" 태그 자체는 제외하지 않음
 *   (난타, 센과 치히로 등 성인 커플도 충분히 즐기는 공연 포함)
 *
 * 키즈 시그널 제외 (2단계):
 * 1. 태그: 아이와함께 / 어린이공연 / 어린이뮤지컬 / 어린이
 * 2. 제목: 인어공주 / 신데렐라 / 라푼젤 / 백설공주 / 피터팬 / 피노키오 / 동화 / 알라딘과 요술램프
 *    - 지역 소극장 순회 어린이 뮤지컬이 태그 없이 통과하는 것을 차단 (~53개)
 *    - '알라딘' 단독은 제외하지 않음 (성인 대상 뮤지컬 존재)
 *    - 버블쇼/서커스/매직쇼 계열은 경계 모호 → 2차 검토 보류
 * - "가족" 태그 단독은 제외하지 않음 (난타, 센과 치히로 등 성인 커플도 충분히 즐기는 공연 보존)
 *
 * 정렬: buzz_score 중심 (인기 있는 데이트 장소 우선)
 * - serve-time click downranking 여유분을 위해 fetchLimit = limit × 3
 */
export async function getDatePick(
  pool: Pool,
  location?: Location,
  limit: number = 10,
): Promise<ScoredEvent[]> {
  const fetchLimit = Math.min(limit * 3, 50);

  let cityZoneFilter = '';
  if (location) {
    try {
      const address = await reverseGeocode(location.lat, location.lng);
      const cityZone = getCityZone(address);
      if (cityZone.length > 0) {
        cityZoneFilter = buildCityZoneFilter(cityZone);
      }
    } catch (error: any) {
      console.error('[getDatePick] city zone error:', error.message);
    }
  }

  const buildQuery = (zoneFilter: string) => `
    SELECT *
    FROM canonical_events
    WHERE is_deleted = false
      AND status != 'cancelled'
      AND end_at >= NOW()
      AND derived_tags @> '["데이트"]'
      AND NOT (
        derived_tags @> '["아이와함께"]'
        OR derived_tags @> '["어린이공연"]'
        OR derived_tags @> '["어린이뮤지컬"]'
        OR derived_tags @> '["어린이"]'
      )
      -- 강연/기타·클래식 계열 sub_category 제외 (역사강연·특강 등 비데이트 콘텐츠 차단)
      AND sub_category NOT IN ('기타 공연', '클래식', '서양음악(클래식)')
      -- 동화/캐릭터 기반 어린이 뮤지컬 제목 제외 (~53개)
      -- '알라딘' 단독은 제외하지 않음 (성인 대상 뮤지컬 존재)
      -- 버블쇼/서커스/매직쇼 계열은 경계 모호 → 2차 검토 보류
      AND title NOT ILIKE '%인어공주%'
      AND title NOT ILIKE '%신데렐라%'
      AND title NOT ILIKE '%라푼젤%'
      AND title NOT ILIKE '%백설공주%'
      AND title NOT ILIKE '%피터팬%'
      AND title NOT ILIKE '%피노키오%'
      AND title NOT ILIKE '%동화%'
      AND title NOT ILIKE '%알라딘과 요술램프%'
      AND image_url IS NOT NULL
      AND image_url != ''
      AND image_url NOT LIKE '%placeholder%'
      AND image_url NOT LIKE '%/defaults/%'
      ${zoneFilter}
    ORDER BY is_featured DESC NULLS LAST,
      buzz_score DESC NULLS LAST,
      created_at DESC
    LIMIT $1
  `;

  let rows = (await pool.query(buildQuery(cityZoneFilter), [fetchLimit])).rows;

  if (cityZoneFilter) {
    if (rows.length < limit) {
      // 기존 폴백: 전체 결과 부족
      console.log(`[getDatePick] 권역 결과 ${rows.length}개 < ${limit} → 전국 폴백`);
      rows = (await pool.query(buildQuery(''), [fetchLimit])).rows;
    } else {
      // 희소 카테고리 제한 보충: 전시/팝업만 slot cap 부족분만큼 전국에서 보충
      // 공연은 수도권 유지 (전국 보충 없음), 수도권 이벤트가 항상 앞에 위치
      const zoneExhibitCnt = rows.filter((r: any) => r.main_category === '전시').length;
      const zonePopupCnt   = rows.filter((r: any) => r.main_category === '팝업').length;
      const needExhibit    = Math.max(0, (DATE_PICK_SLOT_CAP['전시'] ?? 0) - zoneExhibitCnt);
      const needPopup      = Math.max(0, (DATE_PICK_SLOT_CAP['팝업'] ?? 0) - zonePopupCnt);

      if (needExhibit > 0 || needPopup > 0) {
        console.log(
          `[getDatePick] 전시 ${zoneExhibitCnt}/${DATE_PICK_SLOT_CAP['전시']}` +
          ` 팝업 ${zonePopupCnt}/${DATE_PICK_SLOT_CAP['팝업']} 부족` +
          ` → 전국 보충 (전시+${needExhibit} 팝업+${needPopup})`
        );
        const nationalRows = (await pool.query(buildQuery(''), [fetchLimit])).rows;
        const existingIds  = new Set(rows.map((r: any) => r.id));
        const supplements: any[] = [];
        let exhibitAdded = 0, popupAdded = 0;

        for (const r of nationalRows) {
          if (existingIds.has(r.id)) continue;
          if (r.main_category === '전시' && exhibitAdded < needExhibit) {
            supplements.push(r);
            exhibitAdded++;
          } else if (r.main_category === '팝업' && popupAdded < needPopup) {
            supplements.push(r);
            popupAdded++;
          }
          if (exhibitAdded >= needExhibit && popupAdded >= needPopup) break;
        }
        rows = [...rows, ...supplements]; // 수도권 먼저, 전국 보충이 뒤에
      }
    }
  }

  const DATE_PICK_DIST_WEIGHT = 0.30;
  const DATE_PICK_NORMALIZE_KM = 50;

  const scored = rows.map(row => {
    const contentScore = row.buzz_score ?? 0;
    let distKm: number | undefined;
    let distScore = 0;
    if (location && row.lat != null && row.lng != null) {
      distKm = haversineKm(location.lat, location.lng, Number(row.lat), Number(row.lng));
      distScore = calcLinearDistScore(distKm, DATE_PICK_NORMALIZE_KM);
    }
    const finalScore = contentScore * (1 - DATE_PICK_DIST_WEIGHT) + distScore * DATE_PICK_DIST_WEIGHT;
    return { ...row, score: finalScore, distance_km: distKm, reason: ['데이트 추천'] };
  });

  [...scored].sort((a, b) => b.score - a.score).slice(0, 5).forEach(r => {
    const contentScore = r.buzz_score ?? 0;
    const distKm = r.distance_km;
    const distScore = distKm != null ? calcLinearDistScore(distKm, DATE_PICK_NORMALIZE_KM) : 0;
    console.log(
      `[getDatePick] "${(r.title ?? '').substring(0, 30)}" content=${contentScore.toFixed(1)} dist_km=${distKm != null ? distKm.toFixed(1) : 'N/A'} dist_score=${distScore.toFixed(1)} final=${r.score.toFixed(1)}`
    );
  });

  return applySlotCap(scored, DATE_PICK_SLOT_CAP, limit);
}

/**
 * "걸어서 다녀오기 좋은 곳" — 도보권 추천 (walkable)
 *
 * 반경 1.5km 고정, 폴백 없음.
 * - 결과 0개 → 빈 배열 반환 → 프런트에서 섹션 자동 숨김
 * - 위치 없으면 호출하지 않음 (buildSectionPools에서 스킵)
 *
 * 후보 범위: ongoing(현재 진행 중) + 7일 이내 시작 upcoming
 * - start_at <= NOW() + 7 days로 먼 미래 이벤트 차단
 * - 사용자 기대: "지금 걸어갈 수 있거나 곧 시작하는 곳"
 *
 * 정렬: ongoing 우선 → distance_km ASC → buzz_score 보조
 * - ongoing(start_at <= NOW())을 항상 상단에, upcoming을 뒤쪽에
 * - 동일 그룹 내에서는 가까운 순
 *
 * 차별성: 기존 getNearby(5→10→20km 폴백)와 완전히 다름
 * - 의미: "지금/곧 걸어서 갈 수 있는" vs "내 주변 어딘가"
 */
export async function getWalkable(
  pool: Pool,
  location: Location,
  limit: number = 10,
): Promise<ScoredEvent[]> {
  const RADIUS_KM = 1.5;
  const fetchLimit = Math.min(limit * 3, 50);

  const query = `
    SELECT *,
      (6371 * acos(LEAST(1.0,
        cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2)) +
        sin(radians($1)) * sin(radians(lat))
      ))) AS distance_km
    FROM canonical_events
    WHERE is_deleted = false
      AND status != 'cancelled'
      AND end_at >= NOW()
      AND start_at <= NOW() + INTERVAL '7 days'
      AND image_url IS NOT NULL
      AND image_url != ''
      AND image_url NOT LIKE '%placeholder%'
      AND image_url NOT LIKE '%/defaults/%'
      ${buildDistanceFilter(location.lat, location.lng, RADIUS_KM, 1)}
    ORDER BY
      is_featured DESC NULLS LAST,
      CASE WHEN start_at <= NOW() THEN 0 ELSE 1 END ASC,
      distance_km ASC NULLS LAST,
      buzz_score DESC NULLS LAST,
      id ASC
    LIMIT $3
  `;

  const rows = (await pool.query(query, [location.lat, location.lng, fetchLimit])).rows;

  const scored = rows.map(row => ({
    ...row,
    score: row.buzz_score ?? 0,
    reason: ['도보권 추천'],
  }));
  return applySlotCap(scored, WALKABLE_SLOT_CAP, limit);
}

/**
 * "먼저 발견하는 곳" — 최근 14일 이내 발견 가치 있는 이벤트 (discovery)
 *
 * 컨셉: trending(이미 뜬 것)과 달리 "아직 덜 알려졌지만 먼저 볼 만한 최근 이벤트"
 *
 * 점수 공식:
 *   discover_score = freshness(0~60) + buzz_boost(0~?)
 *   - freshness = GREATEST(0, 14 - days_since_created) / 14 × 60
 *     → 오늘 등록(D+0): 60점, 7일 전(D+7): 30점, 14일 전(D+14): 0점
 *   - buzz_boost = buzz_score × 0.4 (보조 역할만)
 *
 * 위치 정책: city zone 권역 우선 → 전국 폴백 (trending/budget_pick 동일 인프라)
 *
 * 품질 게이트: 이미지 있음 + 진행/예정 중 + 최근 14일 이내 등록
 *   - overview 필터 미적용 (최근 14일 중 22개만 → 후보 풀 과소)
 *
 * slot cap: 공연 3, 전시 4, 팝업 2, 축제 1 (trending보다 전시/팝업 우대)
 */
export async function getDiscovery(
  pool: Pool,
  location?: Location,
  limit: number = 10,
): Promise<ScoredEvent[]> {
  const WINDOW_DAYS = 14;
  const fetchLimit = Math.min(limit * 3, 50);

  let cityZoneFilter = '';
  if (location) {
    try {
      const address = await reverseGeocode(location.lat, location.lng);
      const cityZone = getCityZone(address);
      if (cityZone.length > 0) {
        cityZoneFilter = buildCityZoneFilter(cityZone);
      }
    } catch (error: any) {
      console.error('[getDiscovery] city zone error:', error.message);
    }
  }

  const buildQuery = (zoneFilter: string) => `
    SELECT *,
      GREATEST(0, ${WINDOW_DAYS} - EXTRACT(DAY FROM NOW() - created_at)::int)
        / ${WINDOW_DAYS}.0 * 60
      + COALESCE(buzz_score, 0) * 0.4
      AS discover_score
    FROM canonical_events
    WHERE is_deleted = false
      AND status != 'cancelled'
      AND end_at >= NOW()
      AND created_at >= NOW() - INTERVAL '${WINDOW_DAYS} days'
      AND image_url IS NOT NULL
      AND image_url != ''
      AND image_url NOT LIKE '%placeholder%'
      AND image_url NOT LIKE '%/defaults/%'
      ${zoneFilter}
    ORDER BY discover_score DESC NULLS LAST,
      created_at DESC
    LIMIT $1
  `;

  let rows = (await pool.query(buildQuery(cityZoneFilter), [fetchLimit])).rows;

  if (cityZoneFilter && rows.length < limit) {
    console.log(`[getDiscovery] 권역 결과 ${rows.length}개 < ${limit} → 전국 폴백`);
    rows = (await pool.query(buildQuery(''), [fetchLimit])).rows;
  }

  const scored = rows.map(row => ({
    ...row,
    score: row.discover_score ?? 0,
    reason: ['먼저 발견'],
  }));
  return applySlotCap(scored, DISCOVERY_SLOT_CAP, limit);
}

/**
 * "처음 가도 좋은 곳" — 입문형 추천 (beginner)
 *
 * 컨셉: "전시/공연을 잘 모르는 사람도 부담 없이 시작할 수 있는" 이벤트
 *   - 취향이 너무 강하지 않음 (마니아 장르 제외)
 *   - 어린이 전용 아님 (어린이 태그 제외)
 *   - 반응이 어느 정도 있음 (buzz >= 30)
 *   - 가격 정보 명확 + 부담 없는 수준 (price_min <= 50,000 or 무료, NULL 제외)
 *
 * 마니아 제외 태그: 클래식, 오케스트라, 국악, 리사이틀, 실내악, 음악제
 * 어린이 제외 태그: 아이와함께, 어린이공연, 어린이뮤지컬
 *
 * slot cap: 전시 5 (공연 위주 편중 방지 — 전시가 입문형 느낌을 가장 잘 살림)
 *
 * 위치 정책: city zone 권역 우선 → 전국 폴백
 * 정렬: buzz_score DESC (검증된 반응 우선)
 */
export async function getBeginner(
  pool: Pool,
  location?: Location,
  limit: number = 10,
): Promise<ScoredEvent[]> {
  const fetchLimit = Math.min(limit * 3, 50);

  let cityZoneFilter = '';
  if (location) {
    try {
      const address = await reverseGeocode(location.lat, location.lng);
      const cityZone = getCityZone(address);
      if (cityZone.length > 0) {
        cityZoneFilter = buildCityZoneFilter(cityZone);
      }
    } catch (error: any) {
      console.error('[getBeginner] city zone error:', error.message);
    }
  }

  const buildQuery = (zoneFilter: string) => `
    SELECT *
    FROM canonical_events
    WHERE is_deleted = false
      AND status != 'cancelled'
      AND end_at >= NOW()
      AND buzz_score >= 30
      AND (is_free = true OR price_min <= 50000)
      AND NOT (
        derived_tags @> '["클래식"]' OR derived_tags @> '["오케스트라"]' OR
        derived_tags @> '["국악"]'    OR derived_tags @> '["리사이틀"]'  OR
        derived_tags @> '["실내악"]'  OR derived_tags @> '["음악제"]'   OR
        derived_tags @> '["공포"]'
      )
      AND NOT (
        derived_tags @> '["아이와함께"]'  OR
        derived_tags @> '["어린이공연"]'  OR
        derived_tags @> '["어린이뮤지컬"]'
      )
      -- 태그 없이 제목으로만 판별되는 클래식 독주회 계열 차단
      -- (AI가 클래식/리사이틀 태그 대신 전통적인/조용한으로 분류한 경우)
      AND title NOT ILIKE '%독주회%'
      AND title NOT ILIKE '%독창회%'
      AND title NOT ILIKE '%리사이틀%'
      AND image_url IS NOT NULL
      AND image_url != ''
      AND image_url NOT LIKE '%placeholder%'
      AND image_url NOT LIKE '%/defaults/%'
      ${zoneFilter}
    ORDER BY is_featured DESC NULLS LAST,
      buzz_score DESC NULLS LAST,
      created_at DESC
    LIMIT $1
  `;

  let rows = (await pool.query(buildQuery(cityZoneFilter), [fetchLimit])).rows;

  if (cityZoneFilter && rows.length < limit) {
    console.log(`[getBeginner] 권역 결과 ${rows.length}개 < ${limit} → 전국 폴백`);
    rows = (await pool.query(buildQuery(''), [fetchLimit])).rows;
  }

  const BEGINNER_DIST_WEIGHT = 0.20;
  const BEGINNER_NORMALIZE_KM = 50;

  const scored = rows.map(row => {
    const contentScore = row.buzz_score ?? 0;
    let distKm: number | undefined;
    let distScore = 0;
    if (location && row.lat != null && row.lng != null) {
      distKm = haversineKm(location.lat, location.lng, Number(row.lat), Number(row.lng));
      distScore = calcLinearDistScore(distKm, BEGINNER_NORMALIZE_KM);
    }
    const finalScore = contentScore * (1 - BEGINNER_DIST_WEIGHT) + distScore * BEGINNER_DIST_WEIGHT;
    return { ...row, score: finalScore, distance_km: distKm, reason: ['처음 가도 좋은 곳'] };
  });

  [...scored].sort((a, b) => b.score - a.score).slice(0, 5).forEach(r => {
    const contentScore = r.buzz_score ?? 0;
    const distKm = r.distance_km;
    const distScore = distKm != null ? calcLinearDistScore(distKm, BEGINNER_NORMALIZE_KM) : 0;
    console.log(
      `[getBeginner] "${(r.title ?? '').substring(0, 30)}" content=${contentScore.toFixed(1)} dist_km=${distKm != null ? distKm.toFixed(1) : 'N/A'} dist_score=${distScore.toFixed(1)} final=${r.score.toFixed(1)}`
    );
  });

  return applySlotCap(scored, BEGINNER_SLOT_CAP, limit);
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

  let rows = (await pool.query(query, queryParams)).rows;

  // 20km 결과 없으면 전국 폴백
  if (rows.length === 0 && location) {
    console.log('[getWeekend] 20km 결과 없음 → 전국 폴백');
    const nExclude = excludeIdsArray.length > 0
      ? `AND id NOT IN (${excludeIdsArray.map((_, i) => `$${i + 3}`).join(',')})`
      : '';
    const fallbackResult = await pool.query(
      `SELECT * FROM canonical_events
       WHERE end_at >= $1
         AND start_at <= $2
         AND is_deleted = false
         AND image_url IS NOT NULL
         AND image_url != ''
         AND image_url NOT LIKE '%placeholder%'
         AND image_url NOT LIKE '%/defaults/%'
         ${nExclude}
       ORDER BY is_featured DESC NULLS LAST, buzz_score DESC NULLS LAST, id ASC
       LIMIT $${excludeIdsArray.length + 3}`,
      [weekend.start, weekend.end, ...excludeIdsArray, fetchLimit],
    );
    rows = fallbackResult.rows;
  }

  // 날짜 기반 셔플: 같은 날 새로고침해도 순서 고정, 다음 날 자동 갱신
  const scoredEvents = dateSeededShuffle(rows).map(event => {
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

