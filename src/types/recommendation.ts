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

// 사용자 행동 로그 타입
export type ActionType = 'view' | 'save' | 'unsave' | 'share' | 'click';

export interface UserEventLog {
  userId: string;
  eventId: string;
  actionType: ActionType;
  metadata?: Record<string, any>;
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

