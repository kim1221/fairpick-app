import { Storage } from '@apps-in-toss/framework';

/**
 * Session ID 관리 유틸리티
 *
 * @apps-in-toss/framework Storage 사용 (AsyncStorage 대신)
 *
 * 단계 2: inactivity timeout 기반 세션
 *   - 30분 비활동 후 재진입 시 새 session_id 발급
 *   - 30분 내 액션 발생 시 기존 session_id 유지 + lastActivity 갱신
 *   - impression → click → view → dwell → save → cta_click 퍼널을
 *     같은 세션 기준으로 분석 가능
 */

const SESSION_ID_KEY = '@fairpick/session_id';
const LAST_ACTIVITY_KEY = '@fairpick/last_activity';
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30분

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Session ID 가져오기 또는 생성 (inactivity timeout 기반)
 *
 * 매 액션마다 호출됨. lastActivity를 체크해서:
 * - 30분 초과 비활동 → 새 session_id 발급
 * - 30분 이내 → 기존 session_id 반환 + lastActivity 갱신
 */
export async function getOrCreateSessionId(): Promise<string> {
  try {
    const [sessionId, lastActivityStr] = await Promise.all([
      Storage.getItem(SESSION_ID_KEY),
      Storage.getItem(LAST_ACTIVITY_KEY),
    ]);

    const now = Date.now();
    const lastActivity = lastActivityStr ? parseInt(lastActivityStr, 10) : 0;
    const isExpired =
      !sessionId ||
      !lastActivity ||
      now - lastActivity > INACTIVITY_TIMEOUT_MS;

    if (isExpired) {
      const newSessionId = uuidv4();
      await Promise.all([
        Storage.setItem(SESSION_ID_KEY, newSessionId),
        Storage.setItem(LAST_ACTIVITY_KEY, String(now)),
      ]);
      return newSessionId;
    }

    // 세션 유효 — lastActivity만 갱신
    await Storage.setItem(LAST_ACTIVITY_KEY, String(now));
    return sessionId;
  } catch (error) {
    console.error('[Session] Failed to get/create session_id:', error);
    // Storage 실패 시 메모리 내 임시 UUID (앱 재시작 시 변경됨)
    return uuidv4();
  }
}

/**
 * lastActivity 갱신 (AppState foreground 복귀 시 호출)
 *
 * foreground 복귀 자체는 세션을 갱신하지 않음.
 * 다음 액션 발생 시 getOrCreateSessionId()에서 timeout 체크가 이루어짐.
 * 단, foreground 복귀 시 background 진입 시각을 기록해두면
 * 더 정확한 timeout 계산이 가능함 — 여기서는 그냥 lastActivity를 건드리지 않음.
 */
export async function updateLastActivity(): Promise<void> {
  try {
    await Storage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
  } catch (error) {
    console.error('[Session] Failed to update last activity:', error);
  }
}

/**
 * Session ID 재생성 (강제 갱신)
 */
export async function regenerateSessionId(): Promise<string> {
  try {
    const newSessionId = uuidv4();
    await Promise.all([
      Storage.setItem(SESSION_ID_KEY, newSessionId),
      Storage.setItem(LAST_ACTIVITY_KEY, String(Date.now())),
    ]);
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
