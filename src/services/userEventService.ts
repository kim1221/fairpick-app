/**
 * 사용자 행동 로그 서비스
 *
 * 이벤트 조회, 저장, 공유, 클릭 등의 사용자 행동을 백엔드에 전송합니다.
 */

import { API_BASE_URL, API_ENDPOINTS, API_TIMEOUT, API_ERROR_MESSAGES } from '../config/api';
import type { ActionType, UserEventLog, UserEventResponse } from '../types/recommendation';
import { getCurrentUserId } from '../utils/anonymousUser';

// 클릭/노출 로그에 전달할 추천 컨텍스트
export interface LogActionOptions {
  sectionSlug?: string;           // 섹션 식별자 (today_pick, trending 등)
  rankPosition?: number;          // 섹션 내 순서 (1-based)
  sessionId?: string;             // 세션 ID
  metadata?: Record<string, any>; // click_source / algorithm_version / total_score 등
}

/**
 * 사용자 행동 로그 전송 (내부 공통)
 */
async function logUserAction(
  eventId: string,
  actionType: ActionType,
  options?: LogActionOptions,
): Promise<UserEventResponse> {
  try {
    const userId = await getCurrentUserId();

    const payload: UserEventLog = {
      userId,
      eventId,
      actionType,
      sectionSlug: options?.sectionSlug,
      rankPosition: options?.rankPosition,
      sessionId: options?.sessionId,
      metadata: options?.metadata,
    };

    console.log('[UserEventService] Logging action:', payload);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.userEvents}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    } as RequestInit);

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as any;
    return data;
  } catch (error: any) {
    console.error('[UserEventService] Failed to log action:', error);
    // 에러가 발생해도 사용자 경험에 영향 없도록 조용히 실패
    return {
      success: false,
      error: error.message || API_ERROR_MESSAGES.UNKNOWN_ERROR,
    };
  }
}

/** 이벤트 상세 진입 로그 */
export async function logEventView(eventId: string): Promise<UserEventResponse> {
  return logUserAction(eventId, 'view');
}

/** 찜 저장 로그 */
export async function logEventSave(eventId: string): Promise<UserEventResponse> {
  return logUserAction(eventId, 'save');
}

/** 찜 취소 로그 */
export async function logEventUnsave(eventId: string): Promise<UserEventResponse> {
  return logUserAction(eventId, 'unsave');
}

/** 공유 로그 */
export async function logEventShare(
  eventId: string,
  shareType?: 'link' | 'kakao' | 'other',
): Promise<UserEventResponse> {
  return logUserAction(eventId, 'share', { metadata: { share_type: shareType } });
}

/**
 * 카드/배너 클릭 로그
 *
 * options.metadata 권장 키:
 *   click_source      — 'home_card' | 'explore_card' | ...
 *   algorithm_version — 'v2' (today_pick V2 알고리즘 사용 시)
 *   selection_stage   — 'nearby' | 'region' | 'national' (서버에서 알 수 있는 경우)
 *   total_score       — 추천 점수 (서버에서 알 수 있는 경우)
 */
export async function logEventClick(
  eventId: string,
  options?: LogActionOptions,
): Promise<UserEventResponse> {
  return logUserAction(eventId, 'click', options);
}

/** 검색 쿼리 로그 — 자동완성 데이터 축적용 */
export async function logSearchQuery(
  query: string,
  resultCount?: number,
  searchMode?: string,
  metadata?: Record<string, any>,
): Promise<void> {
  try {
    const userId = await getCurrentUserId().catch(() => 'anonymous');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
    await fetch(`${API_BASE_URL}/api/search-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, query, resultCount, searchMode, metadata }),
      signal: controller.signal,
    } as RequestInit).finally(() => clearTimeout(timeoutId));
  } catch {
    // fire-and-forget
  }
}

const userEventService = {
  logEventView,
  logEventSave,
  logEventUnsave,
  logEventShare,
  logEventClick,
  logSearchQuery,
};

export default userEventService;
