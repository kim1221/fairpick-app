/**
 * 추천 시스템 API 서비스
 * 
 * Toss MiniApp 환경에서 백엔드 추천 API를 호출합니다.
 */

import { API_BASE_URL, API_ENDPOINTS, API_TIMEOUT, API_ERROR_MESSAGES } from '../config/api';
import type {
  TodayPickResponse,
  TrendingResponse,
  NearbyResponse,
  PersonalizedResponse,
  WeekendResponse,
  LatestResponse,
  RecommendationParams,
  Location,
  EventDetail,
} from '../types/recommendation';

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

// ==================== 추천 API 함수들 ====================

/**
 * 오늘의 추천 (1개)
 */
export async function getTodayPick(
  userId?: string,
  location?: Location
): Promise<TodayPickResponse> {
  try {
    const params = buildQueryParams({ userId, location });
    const url = `${API_BASE_URL}${API_ENDPOINTS.recommendations.today}${params ? `?${params}` : ''}`;
    
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
 * 지금 떠오르는 (인기 급상승)
 */
export async function getTrending(
  params: RecommendationParams = {}
): Promise<TrendingResponse> {
  try {
    const queryParams = buildQueryParams(params);
    const url = `${API_BASE_URL}${API_ENDPOINTS.recommendations.trending}?${queryParams}`;
    
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
 * 근처 이벤트 (위치 기반)
 */
export async function getNearby(
  location: Location,
  params: RecommendationParams = {}
): Promise<NearbyResponse> {
  try {
    const queryParams = buildQueryParams({ ...params, location });
    const url = `${API_BASE_URL}${API_ENDPOINTS.recommendations.nearby}?${queryParams}`;
    
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
 */
export async function getWeekend(
  params: RecommendationParams = {}
): Promise<WeekendResponse> {
  try {
    const queryParams = buildQueryParams(params);
    const url = `${API_BASE_URL}${API_ENDPOINTS.recommendations.weekend}?${queryParams}`;
    
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
 * 새로 올라왔어요 (최신순)
 */
export async function getLatest(
  params: RecommendationParams = {}
): Promise<LatestResponse> {
  try {
    const queryParams = buildQueryParams(params);
    const url = `${API_BASE_URL}${API_ENDPOINTS.recommendations.latest}?${queryParams}`;
    
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

// ==================== Export ====================

const recommendationService = {
  getTodayPick,
  getTrending,
  getNearby,
  getPersonalized,
  getWeekend,
  getLatest,
  getEventDetail,
};

export default recommendationService;

