import http from '../lib/http';
import type { GetLikesResponse } from '../types/serverSync';
import { getLikesV2 } from '../utils/storage';

/**
 * 컬렉션 화면들이 같은 저장 상태를 사용하도록 로컬/서버 병합 규칙을 한곳에 둔다.
 * 로그인 서버를 일시적으로 읽지 못해도 기기에 남은 저장 목록으로 바로 그릴 수 있다.
 */
export async function loadCollectionSavedEventIds(isLoggedIn: boolean): Promise<Set<string>> {
  const local = await getLikesV2();
  if (!isLoggedIn) return new Set(local.items.map((item) => item.id));

  try {
    const { data } = await http.get<GetLikesResponse>('/users/me/likes');
    return new Set(data.items.map((item) => item.eventId));
  } catch {
    return new Set(local.items.map((item) => item.id));
  }
}
