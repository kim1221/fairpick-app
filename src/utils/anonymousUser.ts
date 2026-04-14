/**
 * 익명 사용자 관리
 *
 * 1순위: getAnonymousKey() — Toss 플랫폼이 발급하는 미니앱별 고유 hash
 *   - 서버 연동·사용자 동의 불필요, 앱 재설치 후에도 동일 키 보장
 *   - SDK 2.4.5+, 토스앱 최소 지원 버전 이상에서만 반환
 * 2순위: Storage UUID — 구버전 앱 또는 getAnonymousKey 오류 시 fallback
 * 3순위: getDeviceId() — Storage 자체 실패 시 최후 fallback
 */

import { Storage, getDeviceId, getAnonymousKey } from '@apps-in-toss/framework';

// Storage 키
const STORAGE_KEYS = {
  ANONYMOUS_ID: 'fairpick_anonymous_id',
  USER_ID: 'fairpick_user_id',
  TOSS_USER_KEY: 'fairpick_toss_user_key',
} as const;

/**
 * 간단한 UUID v4 생성 함수 (구버전 앱 fallback용)
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 익명 ID 가져오기
 *
 * - getAnonymousKey() 성공 시 Toss hash 반환 (서버 연동 불필요)
 * - 실패(구버전 앱 등) 시 Storage UUID로 fallback
 */
export async function getOrCreateAnonymousId(): Promise<string> {
  try {
    // 1순위: Toss 플랫폼 익명 키
    const result = await getAnonymousKey();
    if (result && result !== 'ERROR') {
      console.log('[AnonymousUser] Using Toss anonymous key (hash)');
      return result.hash;
    }
    if (result === 'ERROR') {
      console.warn('[AnonymousUser] getAnonymousKey returned ERROR, falling back to UUID');
    } else {
      console.warn('[AnonymousUser] getAnonymousKey returned undefined (unsupported app version), falling back to UUID');
    }
  } catch (error) {
    console.warn('[AnonymousUser] getAnonymousKey threw, falling back to UUID:', error);
  }

  // 2순위: Storage UUID (구버전 앱 호환)
  try {
    let anonymousId = await Storage.getItem(STORAGE_KEYS.ANONYMOUS_ID);
    if (!anonymousId) {
      anonymousId = generateUUID();
      await Storage.setItem(STORAGE_KEYS.ANONYMOUS_ID, anonymousId);
      console.log('[AnonymousUser] Created new UUID:', anonymousId);
    } else {
      console.log('[AnonymousUser] Using existing UUID:', anonymousId);
    }
    return anonymousId;
  } catch (error) {
    console.error('[AnonymousUser] Storage failed, using deviceId fallback:', error);
    return getDeviceId();
  }
}

// 세션 내 userId 캐시 — 최초 resolve된 값을 고정하여 호출마다 다른 값 반환 방지
let _sessionUserId: string | null = null;

/**
 * 현재 사용자 ID 가져오기 (로그인 여부 확인)
 * 세션 내에서 한 번 resolve된 값을 캐싱하여 일관성 보장
 */
export async function getCurrentUserId(): Promise<string> {
  if (_sessionUserId) return _sessionUserId;
  try {
    // 1순위: 로그인 사용자 ID
    const userId = await Storage.getItem(STORAGE_KEYS.USER_ID);
    if (userId) {
      console.log('[AnonymousUser] Logged in user:', userId);
      _sessionUserId = userId;
      return userId;
    }

    // 2순위: 익명 사용자 ID (Toss hash 또는 UUID)
    const anonymousId = await getOrCreateAnonymousId();
    console.log('[AnonymousUser] Anonymous user:', anonymousId);
    _sessionUserId = anonymousId;
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
    _sessionUserId = userId; // 로그인 시 캐시 즉시 갱신
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
    _sessionUserId = null; // 로그아웃 시 캐시 초기화 (이후 익명 ID로 fallback)
    console.log('[AnonymousUser] Logged out');
  } catch (error) {
    console.error('[AnonymousUser] Failed to logout:', error);
    throw error;
  }
}

/**
 * 익명 ID 초기화 (디버그용 — UUID fallback만 초기화, Toss hash는 플랫폼 관리)
 */
export async function resetAnonymousId(): Promise<void> {
  try {
    await Storage.removeItem(STORAGE_KEYS.ANONYMOUS_ID);
    _sessionUserId = null;
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
    _sessionUserId = null;
    console.log('[AnonymousUser] Cleared all user data');
  } catch (error) {
    console.error('[AnonymousUser] Failed to clear user data:', error);
    throw error;
  }
}
