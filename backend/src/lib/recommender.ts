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
 * 다음 주말 날짜 범위 계산 (토요일 00:00 ~ 일요일 23:59)
 */
function getNextWeekendRange(): { start: Date; end: Date } {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0(일) ~ 6(토)
  
  // 다음 토요일까지 남은 일수
  const daysUntilSaturday = dayOfWeek === 6 ? 7 : (6 - dayOfWeek + 7) % 7;
  
  const saturday = new Date(now);
  saturday.setDate(now.getDate() + daysUntilSaturday);
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
  
  if (location && location.lat && location.lng) {
    // 위치 있음: 10km 이내 근처 이벤트만 조회
    query = `
      SELECT *,
        (6371 * acos(
          cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2)) +
          sin(radians($1)) * sin(radians(lat))
        )) as distance_km
      FROM canonical_events
      WHERE end_at >= NOW()
        AND is_deleted = false
        ${buildDistanceFilter(location.lat, location.lng, DISTANCE_LIMITS.TODAY, 1)}
      ORDER BY
        is_featured DESC NULLS LAST,  -- ⭐ 최우선: Admin 지정
        CASE
          WHEN buzz_score > 0 THEN buzz_score
          WHEN (end_at - NOW()) <= INTERVAL '7 days' THEN 500
          WHEN (NOW() - created_at) <= INTERVAL '3 days' THEN 400
          ELSE 100
        END DESC,
        distance_km ASC,
        id ASC
      LIMIT 100
    `;
    queryParams = [location.lat, location.lng];
  } else {
    // 위치 없음: 기존 로직
    query = `
      SELECT * FROM canonical_events
      WHERE end_at >= NOW()
        AND is_deleted = false
      ORDER BY 
        is_featured DESC NULLS LAST,  -- ⭐ 최우선: Admin 지정
        CASE 
          WHEN buzz_score > 0 THEN buzz_score
          WHEN (end_at - NOW()) <= INTERVAL '7 days' THEN 500
          WHEN (NOW() - created_at) <= INTERVAL '3 days' THEN 400
          ELSE 100
        END DESC
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
      // 점수 차이가 0.01 미만이면 ID로 정렬 (일관성 보장)
      return a.id.localeCompare(b.id);
    }
    return scoreDiff;
  });
  
  return scoredEvents[0] || null;
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

  // 2단계 폴백: 그룹 기반 정렬 (단순화)
  const query = `
    SELECT *,
      CASE
        -- 1순위: 실제 인기 (buzz_score > 0)
        WHEN buzz_score > 0
        THEN buzz_score

        -- 2순위: 마감 임박 (buzz_score = 0)
        WHEN buzz_score = 0 AND (end_at - NOW()) <= INTERVAL '3 days'
        THEN 1000

        -- 3순위: 신규 등록 (buzz_score = 0)
        WHEN buzz_score = 0 AND (NOW() - created_at) <= INTERVAL '3 days'
        THEN 500

        -- 4순위: 기타 (buzz_score = 0)
        ELSE 100
      END AS trend_score,
      CASE
        WHEN buzz_score = 0 AND (end_at - NOW()) <= INTERVAL '3 days' THEN 'deadline'
        WHEN buzz_score = 0 AND (NOW() - created_at) <= INTERVAL '3 days' THEN 'fresh'
        ELSE 'normal'
      END AS fallback_group
    FROM canonical_events
    WHERE end_at >= NOW()
      AND is_deleted = false
      ${cityZoneFilter}
      ${excludeClause}
    ORDER BY
      is_featured DESC NULLS LAST,  -- ⭐ 최우선: Admin 지정 (Hot Score)
      trend_score DESC,              -- 1순위: 점수 (인기=buzz_score, 마감임박=1000, 신규=500, 기타=100)
      end_at ASC,                    -- 2순위: 마감 임박순 (deadline 그룹에 효과적)
      created_at DESC,               -- 3순위: 최신순 (fresh 그룹에 효과적)
      id ASC                         -- 4순위: 안정적 정렬
    LIMIT $${excludeIdsArray.length + 1}
  `;

  const result = await pool.query(query, [...excludeIdsArray, limit]);
  return result.rows.map(row => {
    // 추천 이유 결정 (그룹 기반)
    let reason: string[];

    if (row.buzz_score > 0) {
      // buzz_score가 있으면 인기 급상승
      reason = ['인기 급상승'];
    } else {
      // buzz_score = 0일 때 그룹별 라벨
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

    // 거리 계산 (location이 있을 때만)
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
}

/**
 * "근처 이벤트" - 거리 기반
 */
export async function getNearby(
  pool: Pool,
  location: Location,
  excludeIds: Set<string> = new Set(),
  limit: number = 10
): Promise<ScoredEvent[]> {
  const excludeIdsArray = Array.from(excludeIds);
  const excludeClause = excludeIdsArray.length > 0
    ? `AND id NOT IN (${excludeIdsArray.map((_, i) => `$${i + 3}`).join(',')})`
    : '';
  
  // canonical_events에서 5km 이내 가까운 이벤트만 조회
  const query = `
    SELECT *,
           (6371 * acos(cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2)) + sin(radians($1)) * sin(radians(lat)))) AS distance_km
    FROM canonical_events
    WHERE end_at >= NOW()
      AND is_deleted = false
      ${buildDistanceFilter(location.lat, location.lng, DISTANCE_LIMITS.NEARBY, 1)}
      ${excludeClause}
    ORDER BY 
      is_featured DESC NULLS LAST,  -- ⭐ 최우선: Admin 지정
      distance_km ASC, 
      id ASC
    LIMIT $${excludeIdsArray.length + 3}
  `;

  const result = await pool.query(query, [location.lat, location.lng, ...excludeIdsArray, limit]);
  
  // 거리 기반 점수 및 이유 추가
  const scoredEvents: ScoredEvent[] = result.rows.map(event => {
    const distanceKm = event.distance_km;
    
    // 거리 이유 생성
    let reason: string[] = [];
    if (distanceKm <= 0.5) reason.push('매우 가까움');
    else if (distanceKm <= 1) reason.push('도보 가능');
    else if (distanceKm <= 3) reason.push('가까움');
    else reason.push(`${distanceKm.toFixed(1)}km`);
    
    return {
      ...event,
      score: 100 - distanceKm, // 거리가 가까울수록 높은 점수
      distance_km: distanceKm,
      reason,
    };
  });
  
  return scoredEvents;
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
    SELECT * FROM events
    WHERE end_date >= NOW()
      AND category = ANY($${excludeIdsArray.length + 1})
      ${excludeClause}
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
  if (location && location.lat && location.lng) {
    distanceFilter = buildDistanceFilter(location.lat, location.lng, DISTANCE_LIMITS.WEEKEND, 3);
    distanceSelect = `,
      (6371 * acos(
        cos(radians($3)) * cos(radians(lat)) * cos(radians(lng) - radians($4)) +
        sin(radians($3)) * sin(radians(lat))
      )) AS distance_km`;
    queryParams = [weekend.start, weekend.end, location.lat, location.lng, ...excludeIdsArray, limit];
  } else {
    queryParams = [weekend.start, weekend.end, ...excludeIdsArray, limit];
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
      ${distanceFilter}
      ${excludeClause}
    ORDER BY
      is_featured DESC NULLS LAST,  -- ⭐ 최우선: Admin 지정
      CASE
        WHEN buzz_score > 0 THEN buzz_score
        ELSE 100
      END DESC,
      id ASC
    LIMIT $${limitIndex}
  `;

  const result = await pool.query(query, queryParams);
  
  // 거리 계산 (location이 있을 때만)
  const scoredEvents = result.rows.map(event => {
    let distance_km: number | undefined;
    if (location && event.lat && event.lng) {
      distance_km = calculateDistance(location.lat, location.lng, event.lat, event.lng);
    }
    
    return {
      ...event,
      score: event.buzz_score || 100,
      reason: ['주말 추천'],
      distance_km,
    };
  });
  
  return scoredEvents;
}

/**
 * "새로 올라왔어요" - 등록 시간순
 */
export async function getLatest(
  pool: Pool,
  excludeIds: Set<string> = new Set(),
  limit: number = 10,
  location?: Location
): Promise<ScoredEvent[]> {
  const excludeIdsArray = Array.from(excludeIds);
  let queryParams: any[];
  let distanceFilter = '';
  let distanceSelect = '';

  // location이 있으면 20km 제한 적용
  if (location && location.lat && location.lng) {
    distanceFilter = buildDistanceFilter(location.lat, location.lng, DISTANCE_LIMITS.LATEST, 1);
    distanceSelect = `,
      (6371 * acos(
        cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2)) +
        sin(radians($1)) * sin(radians(lat))
      )) AS distance_km`;
    queryParams = [location.lat, location.lng, ...excludeIdsArray, limit];
  } else {
    queryParams = [...excludeIdsArray, limit];
  }

  const excludeClause = excludeIdsArray.length > 0
    ? `AND id NOT IN (${excludeIdsArray.map((_, i) => {
        const offset = location ? 3 : 1;
        return `$${i + offset}`;
      }).join(',')})`
    : '';

  const limitIndex = location
    ? excludeIdsArray.length + 3
    : excludeIdsArray.length + 1;

  const query = `
    SELECT *${distanceSelect}
    FROM canonical_events
    WHERE end_at >= NOW()
      AND is_deleted = false
      ${distanceFilter}
      ${excludeClause}
    ORDER BY 
      is_featured DESC NULLS LAST,  -- ⭐ 최우선: Admin 지정
      created_at DESC, 
      id ASC
    LIMIT $${limitIndex}
  `;

  const result = await pool.query(query, queryParams);
  return result.rows.map(row => ({
    ...row,
    score: 100, // 최신순이므로 고정 점수
    reason: ['새로 추가됨'],
    distance_km: row.distance_km,
  }));
}

