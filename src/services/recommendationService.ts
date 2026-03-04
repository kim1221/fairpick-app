/**
 * 추천 시스템 API 서비스
 * 
 * Toss MiniApp 환경에서 백엔드 추천 API를 호출합니다.
 * Storage 기반 캐싱으로 트래픽 최적화
 */

import { Storage } from '@apps-in-toss/framework';
import { API_BASE_URL, API_ENDPOINTS, API_TIMEOUT, API_ERROR_MESSAGES } from '../config/api';
import type {
  TodayPickResponse,
  TrendingResponse,
  NearbyResponse,
  PersonalizedResponse,
  WeekendResponse,
  LatestResponse,
  EndingSoonResponse,
  ExhibitionResponse,
  FreeEventsResponse,
  RecommendationParams,
  Location,
  EventDetail,
} from '../types/recommendation';

// ==================== 캐싱 설정 ====================

/**
 * 캐시 엔트리 구조 (프로젝트 패턴 따름)
 */
interface RecommendationCacheEntry {
  endpoint: string;
  params: string;
  data: any;
  cachedAt: string;
  expiresAt: string;
  version: string;
}

/**
 * Storage 캐시 키
 */
const CACHE_KEYS = {
  TODAY_PICK: 'fairpick_api_today',
  TRENDING: 'fairpick_api_trending',
  NEARBY: 'fairpick_api_nearby',
  PERSONALIZED: 'fairpick_api_personalized',
  WEEKEND: 'fairpick_api_weekend',
  LATEST: 'fairpick_api_latest',
  ENDING_SOON: 'fairpick_api_ending_soon',
  EXHIBITION: 'fairpick_api_exhibition',
  FREE: 'fairpick_api_free',
} as const;

/**
 * 캐시 버전 (API 스펙 변경 시 증가)
 */
const CACHE_VERSION = 'v1.0';

/**
 * 기본 TTL (분)
 */
const DEFAULT_TTL_MINUTES = 5;

/**
 * API 요청 헬퍼 (타임아웃 포함)
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(API_ERROR_MESSAGES.TIMEOUT_ERROR);
    }
    throw error;
  }
}

/**
 * API 에러 핸들링
 */
function handleApiError(error: any): never {
  console.error('[RecommendationService] API Error:', error);
  
  if (error.message === API_ERROR_MESSAGES.TIMEOUT_ERROR) {
    throw new Error(API_ERROR_MESSAGES.TIMEOUT_ERROR);
  }
  
  if (error.message?.includes('Network')) {
    throw new Error(API_ERROR_MESSAGES.NETWORK_ERROR);
  }
  
  throw new Error(API_ERROR_MESSAGES.UNKNOWN_ERROR);
}

/**
 * 쿼리 파라미터 생성 헬퍼
 */
function buildQueryParams(params: RecommendationParams): string {
  const searchParams = new URLSearchParams();
  
  if (params.userId) searchParams.append('userId', params.userId);
  if (params.excludeIds && params.excludeIds.length > 0) {
    searchParams.append('excludeIds', params.excludeIds.join(','));
  }
  if (params.limit) searchParams.append('limit', params.limit.toString());
  if (params.location) {
    searchParams.append('lat', params.location.lat.toString());
    searchParams.append('lng', params.location.lng.toString());
  }
  
  return searchParams.toString();
}

// ==================== 캐싱 헬퍼 함수 ====================

/**
 * 파라미터로 캐시 키 생성
 */
function createCacheParams(params: RecommendationParams, additionalData?: Record<string, any>): string {
  const parts: string[] = [];
  
  if (params.userId) parts.push(`u:${params.userId}`);
  if (params.location) parts.push(`loc:${params.location.lat.toFixed(3)},${params.location.lng.toFixed(3)}`);
  if (params.limit) parts.push(`lim:${params.limit}`);
  if (params.excludeIds?.length) parts.push(`exc:${params.excludeIds.length}`);
  
  // 추가 데이터 (예: userId, location)
  if (additionalData) {
    Object.entries(additionalData).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        parts.push(`${key}:${value}`);
      }
    });
  }
  
  return parts.join('|');
}

/**
 * 캐시 조회
 */
async function getCachedRecommendation(
  cacheKey: string,
  params: string
): Promise<any | null> {
  try {
    const raw = await Storage.getItem(cacheKey);
    if (!raw) {
      console.log(`[Cache] MISS: ${cacheKey}`);
      return null;
    }
    
    const entry: RecommendationCacheEntry = JSON.parse(raw);
    const now = new Date();
    
    // 버전 체크
    if (entry.version !== CACHE_VERSION) {
      console.log(`[Cache] VERSION_MISMATCH: ${cacheKey}`, { 
        cached: entry.version, 
        current: CACHE_VERSION 
      });
      return null;
    }
    
    // TTL 체크
    if (new Date(entry.expiresAt) < now) {
      const ageMinutes = ((now.getTime() - new Date(entry.cachedAt).getTime()) / 60000).toFixed(1);
      console.log(`[Cache] EXPIRED: ${cacheKey}`, { ageMinutes });
      return null;
    }
    
    // 파라미터 체크
    if (entry.params !== params) {
      console.log(`[Cache] PARAMS_MISMATCH: ${cacheKey}`);
      return null;
    }
    
    const ageSeconds = ((now.getTime() - new Date(entry.cachedAt).getTime()) / 1000).toFixed(1);
    console.log(`[Cache] HIT: ${cacheKey}`, { ageSeconds: `${ageSeconds}s` });
    return entry.data;
  } catch (error) {
    console.error(`[Cache] READ_ERROR: ${cacheKey}`, error);
    return null;
  }
}

/**
 * 캐시 저장
 */
async function saveCachedRecommendation(
  cacheKey: string,
  params: string,
  data: any,
  ttlMinutes: number = DEFAULT_TTL_MINUTES
): Promise<void> {
  try {
    const now = new Date();
    const entry: RecommendationCacheEntry = {
      endpoint: cacheKey,
      params,
      data,
      cachedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString(),
      version: CACHE_VERSION,
    };
    
    await Storage.setItem(cacheKey, JSON.stringify(entry));
    console.log(`[Cache] SAVED: ${cacheKey}`, { ttl: `${ttlMinutes}min` });
  } catch (error) {
    console.error(`[Cache] SAVE_ERROR: ${cacheKey}`, error);
    // 캐시 저장 실패해도 API 응답은 반환
  }
}

// ==================== 추천 API 함수들 ====================

/**
 * 오늘의 추천 (1개)
 * 캐싱: 5분 TTL
 */
export async function getTodayPick(
  userId?: string,
  location?: Location
): Promise<TodayPickResponse> {
  // 1. 캐시 키 생성
  const cacheParams = createCacheParams(
    { userId, location }, 
    { u: userId || 'anon', lat: location?.lat, lng: location?.lng }
  );
  
  // 2. 캐시 확인
  const cached = await getCachedRecommendation(CACHE_KEYS.TODAY_PICK, cacheParams);
  if (cached) {
    return cached;
  }
  
  // 3. API 호출
  try {
    const params = buildQueryParams({ userId, location });
    const url = `${API_BASE_URL}${API_ENDPOINTS.recommendations.today}${params ? `?${params}` : ''}`;
    
    const response = await fetchWithTimeout(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    // 4. 캐시 저장 (30분)
    await saveCachedRecommendation(CACHE_KEYS.TODAY_PICK, cacheParams, data, 30);
    
    return data;
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * 지금 떠오르는 (인기 급상승)
 * 캐싱: 5분 TTL
 */
export async function getTrending(
  params: RecommendationParams = {}
): Promise<TrendingResponse> {
  // 1. 캐시 키 생성
  const cacheParams = createCacheParams(params);
  
  // 2. 캐시 확인
  const cached = await getCachedRecommendation(CACHE_KEYS.TRENDING, cacheParams);
  if (cached) {
    return cached;
  }
  
  // 3. API 호출
  try {
    const queryParams = buildQueryParams(params);
    const url = `${API_BASE_URL}${API_ENDPOINTS.recommendations.trending}?${queryParams}`;
    
    const response = await fetchWithTimeout(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    // 4. 캐시 저장 (5분)
    await saveCachedRecommendation(CACHE_KEYS.TRENDING, cacheParams, data, 5);
    
    return data;
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * 근처 이벤트 (위치 기반)
 * 캐싱: 3분 TTL (위치 기반이라 짧게)
 */
export async function getNearby(
  location: Location,
  params: RecommendationParams = {}
): Promise<NearbyResponse> {
  // 1. 캐시 키 생성
  const cacheParams = createCacheParams({ ...params, location });
  
  // 2. 캐시 확인
  const cached = await getCachedRecommendation(CACHE_KEYS.NEARBY, cacheParams);
  if (cached) {
    return cached;
  }
  
  // 3. API 호출
  try {
    const queryParams = buildQueryParams({ ...params, location });
    const url = `${API_BASE_URL}${API_ENDPOINTS.recommendations.nearby}?${queryParams}`;
    
    const response = await fetchWithTimeout(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    // 4. 캐시 저장 (3분 - 위치 기반이라 짧게)
    await saveCachedRecommendation(CACHE_KEYS.NEARBY, cacheParams, data, 3);
    
    return data;
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * 취향 저격 (로그인 사용자 전용)
 */
export async function getPersonalized(
  userId: string,
  params: RecommendationParams = {}
): Promise<PersonalizedResponse> {
  try {
    const queryParams = buildQueryParams({ ...params, userId });
    const url = `${API_BASE_URL}${API_ENDPOINTS.recommendations.personalized}?${queryParams}`;
    
    const response = await fetchWithTimeout(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * 이번 주말 추천
 * 캐싱: 5분 TTL
 */
export async function getWeekend(
  params: RecommendationParams = {}
): Promise<WeekendResponse> {
  // 1. 캐시 키 생성
  const cacheParams = createCacheParams(params);

  // 2. 캐시 확인
  const cached = await getCachedRecommendation(CACHE_KEYS.WEEKEND, cacheParams);
  if (cached) {
    return cached;
  }

  // 3. API 호출
  try {
    const queryParams = buildQueryParams(params);
    const url = `${API_BASE_URL}${API_ENDPOINTS.recommendations.weekend}?${queryParams}`;

    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    // 4. 캐시 저장 (5분)
    await saveCachedRecommendation(CACHE_KEYS.WEEKEND, cacheParams, data, 5);

    return data;
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * 새로 올라왔어요 (최신순)
 * 캐싱: 2분 TTL (최신 데이터라 더 짧게)
 */
export async function getLatest(
  params: RecommendationParams = {}
): Promise<LatestResponse> {
  // 1. 캐시 키 생성
  const cacheParams = createCacheParams(params);
  
  // 2. 캐시 확인
  const cached = await getCachedRecommendation(CACHE_KEYS.LATEST, cacheParams);
  if (cached) {
    return cached;
  }
  
  // 3. API 호출
  try {
    const queryParams = buildQueryParams(params);
    const url = `${API_BASE_URL}${API_ENDPOINTS.recommendations.latest}?${queryParams}`;
    
    const response = await fetchWithTimeout(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    // 4. 캐시 저장 (10분)
    await saveCachedRecommendation(CACHE_KEYS.LATEST, cacheParams, data, 10);
    
    return data;
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * 곧 끝나요 (7일 이내 마감)
 * 캐싱: 5분 TTL
 */
export async function getEndingSoon(
  params: RecommendationParams = {}
): Promise<EndingSoonResponse> {
  const cacheParams = createCacheParams(params);
  const cached = await getCachedRecommendation(CACHE_KEYS.ENDING_SOON, cacheParams);
  if (cached) return cached;

  try {
    const queryParams = buildQueryParams(params);
    const url = `${API_BASE_URL}${API_ENDPOINTS.recommendations.endingSoon}${queryParams ? `?${queryParams}` : ''}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    await saveCachedRecommendation(CACHE_KEYS.ENDING_SOON, cacheParams, data, 5);
    return data;
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * 전시 큐레이션
 * 캐싱: 10분 TTL
 */
export async function getExhibition(
  params: RecommendationParams = {}
): Promise<ExhibitionResponse> {
  const cacheParams = createCacheParams(params);
  const cached = await getCachedRecommendation(CACHE_KEYS.EXHIBITION, cacheParams);
  if (cached) return cached;

  try {
    const queryParams = buildQueryParams(params);
    const url = `${API_BASE_URL}${API_ENDPOINTS.recommendations.exhibition}${queryParams ? `?${queryParams}` : ''}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    await saveCachedRecommendation(CACHE_KEYS.EXHIBITION, cacheParams, data, 10);
    return data;
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * 무료로 즐겨요
 * 캐싱: 10분 TTL
 */
export async function getFreeEvents(
  params: RecommendationParams = {}
): Promise<FreeEventsResponse> {
  const cacheParams = createCacheParams(params);
  const cached = await getCachedRecommendation(CACHE_KEYS.FREE, cacheParams);
  if (cached) return cached;

  try {
    const queryParams = buildQueryParams(params);
    const url = `${API_BASE_URL}${API_ENDPOINTS.recommendations.free}${queryParams ? `?${queryParams}` : ''}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    await saveCachedRecommendation(CACHE_KEYS.FREE, cacheParams, data, 10);
    return data;
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * 홈 화면 섹션 일괄 조회 (curation_themes 기반)
 * 기존 8개 개별 API 호출을 1회로 통합
 */
export async function getSections(
  location?: Location,
  userId?: string,
): Promise<{ success: boolean; sections: Array<{ slug: string; title: string; subtitle: string | null; events: any[] }> }> {
  try {
    const params = new URLSearchParams();
    if (location) {
      params.append('lat', location.lat.toString());
      params.append('lng', location.lng.toString());
    }
    if (userId) {
      params.append('userId', userId);
    }
    const url = `${API_BASE_URL}${API_ENDPOINTS.homeSections}${params.toString() ? `?${params}` : ''}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error: any) {
    console.error('[RecommendationService] getSections error:', error);
    return { success: false, sections: [] };
  }
}

/**
 * 이벤트 상세 정보 조회
 */
export async function getEventDetail(eventId: string): Promise<{ success: boolean; data: EventDetail | null; error?: string }> {
  try {
    const url = `${API_BASE_URL}${API_ENDPOINTS.eventDetail}/${eventId}`;
    
    console.log('[RecommendationService] Fetching event detail:', url);
    
    const response = await fetchWithTimeout(url);
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('이벤트를 찾을 수 없습니다.');
      }
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    console.log('[RecommendationService] Event detail fetched successfully');
    return data;
  } catch (error: any) {
    console.error('[RecommendationService] Event detail error:', error);
    return { success: false, data: null, error: error.message };
  }
}

// ==================== 캐시 관리 유틸리티 ====================

/**
 * 모든 추천 API 캐시 클리어 (개발/디버그용)
 */
export async function clearAllRecommendationCache(): Promise<void> {
  try {
    const keys = Object.values(CACHE_KEYS);
    await Promise.all(keys.map(key => Storage.removeItem(key)));
    console.log('[RecommendationService] All caches cleared:', keys);
  } catch (error) {
    console.error('[RecommendationService] Failed to clear caches:', error);
  }
}

/**
 * 특정 캐시만 클리어 (개발/디버그용)
 */
export async function clearRecommendationCache(cacheKey: keyof typeof CACHE_KEYS): Promise<void> {
  try {
    await Storage.removeItem(CACHE_KEYS[cacheKey]);
    console.log(`[RecommendationService] Cache cleared: ${cacheKey}`);
  } catch (error) {
    console.error(`[RecommendationService] Failed to clear cache ${cacheKey}:`, error);
  }
}

// ==================== Export ====================

const recommendationService = {
  getSections,
  getTodayPick,
  getTrending,
  getNearby,
  getPersonalized,
  getWeekend,
  getLatest,
  getEndingSoon,
  getExhibition,
  getFreeEvents,
  getEventDetail,
  // 캐시 관리
  clearAllRecommendationCache,
  clearRecommendationCache,
};

export default recommendationService;

