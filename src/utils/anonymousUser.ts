/**
 * 익명 사용자 관리
 * 
 * Toss MiniApp Storage API를 사용하여 익명 ID를 생성/관리합니다.
 */

import { Storage, getDeviceId } from '@apps-in-toss/framework';

// Storage 키
const STORAGE_KEYS = {
  ANONYMOUS_ID: 'fairpick_anonymous_id',
  USER_ID: 'fairpick_user_id',
  TOSS_USER_KEY: 'fairpick_toss_user_key',
} as const;

/**
 * 간단한 UUID v4 생성 함수
 * (uuid 패키지 대신 경량 구현)
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 익명 ID 가져오기 (없으면 자동 생성)
 */
export async function getOrCreateAnonymousId(): Promise<string> {
  try {
    let anonymousId = await Storage.getItem(STORAGE_KEYS.ANONYMOUS_ID);
    
    if (!anonymousId) {
      // 새로운 익명 ID 생성
      anonymousId = generateUUID();
      await Storage.setItem(STORAGE_KEYS.ANONYMOUS_ID, anonymousId);
      console.log('[AnonymousUser] Created new anonymous ID:', anonymousId);
    } else {
      console.log('[AnonymousUser] Using existing anonymous ID:', anonymousId);
    }
    
    return anonymousId;
  } catch (error) {
    console.error('[AnonymousUser] Failed to get/create anonymous ID:', error);
    // Storage 실패 시 기기 고유 ID를 fallback으로 사용 (세션 간 일관성 유지)
    return getDeviceId();
  }
}

/**
 * 현재 사용자 ID 가져오기 (로그인 여부 확인)
 */
export async function getCurrentUserId(): Promise<string> {
  try {
    // 1순위: 로그인 사용자 ID
    const userId = await Storage.getItem(STORAGE_KEYS.USER_ID);
    if (userId) {
      console.log('[AnonymousUser] Logged in user:', userId);
      return userId;
    }
    
    // 2순위: 익명 사용자 ID
    const anonymousId = await getOrCreateAnonymousId();
    console.log('[AnonymousUser] Anonymous user:', anonymousId);
    return anonymousId;
  } catch (error) {
    console.error('[AnonymousUser] Failed to get current user ID:', error);
    return `error_${Date.now()}`;
  }
}

/**
 * 로그인 여부 확인
 */
export async function isLoggedIn(): Promise<boolean> {
  try {
    const userId = await Storage.getItem(STORAGE_KEYS.USER_ID);
    return !!userId;
  } catch (error) {
    console.error('[AnonymousUser] Failed to check login status:', error);
    return false;
  }
}

/**
 * 로그인 정보 저장
 */
export async function saveLoginInfo(userId: string, tossUserKey?: number): Promise<void> {
  try {
    await Storage.setItem(STORAGE_KEYS.USER_ID, userId);
    
    if (tossUserKey) {
      await Storage.setItem(STORAGE_KEYS.TOSS_USER_KEY, tossUserKey.toString());
    }
    
    console.log('[AnonymousUser] Saved login info:', { userId, tossUserKey });
  } catch (error) {
    console.error('[AnonymousUser] Failed to save login info:', error);
    throw error;
  }
}

/**
 * 로그아웃 (익명 ID는 유지)
 */
export async function logout(): Promise<void> {
  try {
    await Storage.removeItem(STORAGE_KEYS.USER_ID);
    await Storage.removeItem(STORAGE_KEYS.TOSS_USER_KEY);
    console.log('[AnonymousUser] Logged out');
  } catch (error) {
    console.error('[AnonymousUser] Failed to logout:', error);
    throw error;
  }
}

/**
 * 익명 ID 초기화 (디버그용)
 */
export async function resetAnonymousId(): Promise<void> {
  try {
    await Storage.removeItem(STORAGE_KEYS.ANONYMOUS_ID);
    console.log('[AnonymousUser] Reset anonymous ID');
  } catch (error) {
    console.error('[AnonymousUser] Failed to reset anonymous ID:', error);
    throw error;
  }
}

/**
 * 모든 사용자 데이터 삭제 (디버그용)
 */
export async function clearAllUserData(): Promise<void> {
  try {
    await Storage.removeItem(STORAGE_KEYS.ANONYMOUS_ID);
    await Storage.removeItem(STORAGE_KEYS.USER_ID);
    await Storage.removeItem(STORAGE_KEYS.TOSS_USER_KEY);
    console.log('[AnonymousUser] Cleared all user data');
  } catch (error) {
    console.error('[AnonymousUser] Failed to clear user data:', error);
    throw error;
  }
}

