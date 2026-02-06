/**
 * Analytics 이벤트 유틸리티
 *
 * Today 배너 추천 품질/빈도/실패 원인을 지표로 추적합니다.
 * 현재는 console.log 기반이며, 향후 실제 Analytics 서비스로 확장 가능합니다.
 */

// ============================================================
// Today 배너 이벤트 Payload 타입
// ============================================================

/**
 * Today 배너 노출 이벤트 (today_banner_impression)
 */
export interface TodayBannerImpressionPayload {
  hasRecommendation: boolean;
  noRecommendationReason?: 'nearby_empty' | 'guardrails_filtered' | 'low_score';
  recommendedEventId?: string;
  score?: number;
  reasonTags?: string[];
  dongLabel?: string;
  radius: number;
  size: number;
  tuningProfile: 'DEV' | 'PROD';
  timestamp: string;
  // AI 문구 생성 관련
  copySource?: 'ai' | 'template' | 'cache';
  aiModel?: string; // 'gpt-4o-mini' | 'template-fallback' | undefined
  explanationConfidence?: 'high' | 'medium' | 'low';
}

/**
 * Today 배너 클릭 이벤트 (today_banner_click)
 */
export interface TodayBannerClickPayload extends TodayBannerImpressionPayload {
  destination: 'event_detail' | 'nearby' | 'ignored_loading';
}

/**
 * Today 배너 추천 상세 진입 이벤트 (today_banner_open_detail)
 */
export interface TodayBannerOpenDetailPayload {
  recommendedEventId: string;
  score?: number;
  reasonTags?: string[];
  breakdown?: {
    distance: number;
    hotness: number;
    quality: number;
    urgency: number;
    preference: number;
  };
  travelDistanceMeters?: number;
  timestamp: string;
}

// ============================================================
// Analytics 이벤트 로깅 함수
// ============================================================

/**
 * Analytics 이벤트 로깅 (현재는 console.log 기반)
 * 향후 실제 Analytics 서비스(Firebase, Amplitude 등)로 대체 가능
 */
function logAnalyticsEvent(eventName: string, payload: Record<string, any>): void {
  // DEV 모드에서는 상세 로그
  if (__DEV__) {
    console.log(`[Analytics][${eventName}]`, JSON.stringify(payload, null, 2));
  } else {
    // PROD 모드에서는 간단한 로그
    console.log(`[Analytics][${eventName}]`, payload);
  }

  // 향후 실제 Analytics 서비스 호출
  // Example: firebaseAnalytics.logEvent(eventName, payload);
  // Example: amplitude.track(eventName, payload);
}

/**
 * Today 배너 노출 이벤트 로깅
 */
export function logTodayBannerImpression(payload: TodayBannerImpressionPayload): void {
  // PROD에서는 reasonTags를 최대 2개로 truncate
  const sanitizedPayload = __DEV__
    ? payload
    : {
        ...payload,
        reasonTags: payload.reasonTags?.slice(0, 2),
      };

  logAnalyticsEvent('today_banner_impression', sanitizedPayload);
}

/**
 * Today 배너 클릭 이벤트 로깅
 */
export function logTodayBannerClick(payload: TodayBannerClickPayload): void {
  // PROD에서는 reasonTags를 최대 2개로 truncate
  const sanitizedPayload = __DEV__
    ? payload
    : {
        ...payload,
        reasonTags: payload.reasonTags?.slice(0, 2),
      };

  logAnalyticsEvent('today_banner_click', sanitizedPayload);
}

/**
 * Today 배너 추천 상세 진입 이벤트 로깅
 */
export function logTodayBannerOpenDetail(payload: TodayBannerOpenDetailPayload): void {
  // PROD에서는 breakdown 제거 (민감 정보 최소화)
  const sanitizedPayload = __DEV__
    ? payload
    : {
        recommendedEventId: payload.recommendedEventId,
        score: payload.score,
        reasonTags: payload.reasonTags?.slice(0, 2),
        timestamp: payload.timestamp,
      };

  logAnalyticsEvent('today_banner_open_detail', sanitizedPayload);
}
