function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Session ID 관리 유틸리티
 *
 * Phase 1: Toss 로그인 미연동 상태
 * - session_id가 유일한 사용자 식별자
 * - 앱 최초 실행 시 UUID 생성 및 영구 저장
 * - 모든 API 요청에 X-Session-ID 헤더로 전송
 *
 * Phase 2: Toss 로그인 연동 시
 * - user_id 추가 (getOrCreateUserId 함수)
 * - session_id는 유지 (로그아웃 시 대체 식별자)
 */

const SESSION_ID_KEY = '@fairpick/session_id';

/**
 * Session ID 가져오기 또는 생성
 *
 * @returns Promise<string> UUID 형식의 session_id
 */
export async function getOrCreateSessionId(): Promise<string> {
  try {
    let sessionId = await AsyncStorage.getItem(SESSION_ID_KEY);

    if (!sessionId) {
      sessionId = uuidv4();
      await AsyncStorage.setItem(SESSION_ID_KEY, sessionId);
      console.log('[Session] New session_id created:', sessionId);
    }

    return sessionId;
  } catch (error) {
    console.error('[Session] Failed to get/create session_id:', error);
    // Fallback: 메모리 내 임시 UUID (앱 재시작 시 변경됨)
    return uuidv4();
  }
}

/**
 * Session ID 재생성 (디버깅 또는 테스트용)
 *
 * @returns Promise<string> 새로 생성된 session_id
 */
export async function regenerateSessionId(): Promise<string> {
  try {
    const newSessionId = uuidv4();
    await AsyncStorage.setItem(SESSION_ID_KEY, newSessionId);
    console.log('[Session] Session ID regenerated:', newSessionId);
    return newSessionId;
  } catch (error) {
    console.error('[Session] Failed to regenerate session_id:', error);
    return uuidv4();
  }
}

/**
 * Session ID 조회 (생성하지 않음)
 *
 * @returns Promise<string | null> 저장된 session_id 또는 null
 */
export async function getSessionId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SESSION_ID_KEY);
  } catch (error) {
    console.error('[Session] Failed to get session_id:', error);
    return null;
  }
}
