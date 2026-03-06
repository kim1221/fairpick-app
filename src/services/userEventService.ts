/**
 * 사용자 행동 로그 서비스
 * 
 * 이벤트 조회, 저장, 공유 등의 사용자 행동을 백엔드에 전송합니다.
 */

import { API_BASE_URL, API_ENDPOINTS, API_TIMEOUT, API_ERROR_MESSAGES } from '../config/api';
import type { ActionType, UserEventLog, UserEventResponse } from '../types/recommendation';
import { getCurrentUserId } from '../utils/anonymousUser';

/**
 * 사용자 행동 로그 전송
 */
async function logUserAction(
  eventId: string,
  actionType: ActionType,
  metadata?: Record<string, any>
): Promise<UserEventResponse> {
  try {
    const userId = await getCurrentUserId();
    
    const payload: UserEventLog = {
      userId,
      eventId,
      actionType,
      metadata,
    };
    
    console.log('[UserEventService] Logging action:', payload);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
    
    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.userEvents}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
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

/**
 * 이벤트 조회 로그
 */
export async function logEventView(eventId: string): Promise<UserEventResponse> {
  return logUserAction(eventId, 'view');
}

/**
 * 이벤트 저장 로그
 */
export async function logEventSave(eventId: string): Promise<UserEventResponse> {
  return logUserAction(eventId, 'save');
}

/**
 * 이벤트 저장 취소 로그
 */
export async function logEventUnsave(eventId: string): Promise<UserEventResponse> {
  return logUserAction(eventId, 'unsave');
}

/**
 * 이벤트 공유 로그
 */
export async function logEventShare(
  eventId: string,
  shareType?: 'link' | 'kakao' | 'other'
): Promise<UserEventResponse> {
  return logUserAction(eventId, 'share', { shareType });
}

/**
 * 이벤트 클릭 로그 (배너, 카드 등)
 */
export async function logEventClick(
  eventId: string,
  clickSource?: string
): Promise<UserEventResponse> {
  return logUserAction(eventId, 'click', { clickSource });
}

/**
 * 검색 쿼리 로그 — 자동완성 데이터 축적용
 */
export async function logSearchQuery(
  query: string,
  resultCount?: number,
  searchMode?: string,
  metadata?: Record<string, any>
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
    // fire-and-forget: 실패해도 무시
  }
}

// ==================== Export ====================

const userEventService = {
  logEventView,
  logEventSave,
  logEventUnsave,
  logEventShare,
  logEventClick,
  logSearchQuery,
};

export default userEventService;

