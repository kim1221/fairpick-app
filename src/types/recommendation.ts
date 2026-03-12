/**
 * 추천 시스템 타입 정의
 */

// 이벤트 기본 정보
export interface Event {
  id: string;
  source: string;
  external_id: string;
  title: string;
  description?: string;
  period_text?: string;
  start_date: string;
  end_date: string;
  region?: string;
  category: string;
  tags?: string[];
  thumbnail_url?: string;
  detail_image_url?: string;
  detail_link?: string;
  venue?: string;
  overview?: string;
  view_count: number;
  save_count: number;
  share_count: number;
  buzz_score: number;
  metadata?: any;
  is_free?: boolean;
  is_ending_soon?: boolean;
  created_at: string;
  updated_at: string;
}

// 점수가 포함된 추천 이벤트
export interface ScoredEvent extends Event {
  score: number;
  distance_km?: number;
  reason?: string[];
}

// API 응답 공통 타입
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  count?: number;
  error?: string;
  message?: string;
}

// 추천 API 응답 타입들
export type TodayPickResponse = ApiResponse<ScoredEvent | null>;
export type TrendingResponse = ApiResponse<ScoredEvent[]>;
export type NearbyResponse = ApiResponse<ScoredEvent[]>;
export type PersonalizedResponse = ApiResponse<ScoredEvent[]>;
export type WeekendResponse = ApiResponse<ScoredEvent[]>;
export type LatestResponse = ApiResponse<ScoredEvent[]>;
export type EndingSoonResponse = ApiResponse<ScoredEvent[]>;
export type ExhibitionResponse = ApiResponse<ScoredEvent[]>;
export type FreeEventsResponse = ApiResponse<ScoredEvent[]>;

// 이벤트 상세 타입 (ScoredEvent와 동일 구조)
export type EventDetail = ScoredEvent;

// 사용자 행동 로그 타입
// impression은 미래 확장용 (현재 프론트에서는 미사용)
export type ActionType = 'view' | 'save' | 'unsave' | 'share' | 'click' | 'impression' | 'dwell' | 'cta_click' | 'sheet_open';

export interface UserEventLog {
  userId: string;
  eventId: string;
  actionType: ActionType;
  sectionSlug?: string;   // 어느 섹션에서 발생했는지 (today_pick, trending 등)
  rankPosition?: number;  // 섹션 내 노출 순서 (1-based)
  sessionId?: string;     // 세션 단위 추적
  metadata?: Record<string, any>; // click_source / algorithm_version 등 추천 컨텍스트
}

export interface UserEventResponse {
  success: boolean;
  message?: string;
  error?: string;
}

// 위치 정보
export interface Location {
  lat: number;
  lng: number;
}

// 추천 요청 파라미터
export interface RecommendationParams {
  userId?: string;
  excludeIds?: string[];
  limit?: number;
  location?: Location;
}

