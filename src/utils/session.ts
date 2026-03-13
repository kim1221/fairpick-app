import { Storage } from '@apps-in-toss/framework';

/**
 * Session ID 관리 유틸리티
 *
 * @apps-in-toss/framework Storage 사용 (AsyncStorage 대신)
 *
 * 단계 1: 영구 UUID — 앱 재설치 전까지 동일 ID 유지
 * 단계 2 (예정): inactivity timeout 기반 갱신
 */

const SESSION_ID_KEY = '@fairpick/session_id';

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Session ID 가져오기 또는 생성
 */
export async function getOrCreateSessionId(): Promise<string> {
  try {
    let sessionId = await Storage.getItem(SESSION_ID_KEY);

    if (!sessionId) {
      sessionId = uuidv4();
      await Storage.setItem(SESSION_ID_KEY, sessionId);
    }

    return sessionId;
  } catch (error) {
    console.error('[Session] Failed to get/create session_id:', error);
    // Storage 실패 시 메모리 내 임시 UUID (앱 재시작 시 변경됨)
    return uuidv4();
  }
}

/**
 * Session ID 재생성 (디버깅 또는 단계 2 갱신 시 사용)
 */
export async function regenerateSessionId(): Promise<string> {
  try {
    const newSessionId = uuidv4();
    await Storage.setItem(SESSION_ID_KEY, newSessionId);
    return newSessionId;
  } catch (error) {
    console.error('[Session] Failed to regenerate session_id:', error);
    return uuidv4();
  }
}

/**
 * Session ID 조회 (생성하지 않음)
 */
export async function getSessionId(): Promise<string | null> {
  try {
    return await Storage.getItem(SESSION_ID_KEY);
  } catch (error) {
    console.error('[Session] Failed to get session_id:', error);
    return null;
  }
}
