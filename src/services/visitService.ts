/**
 * 다녀왔어요(자기신고) 서비스
 * 저장/상세에서 "다녀왔어요"를 누르면 문화 여권에 도장을 남긴다.
 * 위치 인증·보상 없음(추억 기록 전용).
 *
 * 잠긴 API 계약:
 * - POST   /api/visits          body { eventId } → { ok, alreadyVisited, stampCount }
 * - DELETE /api/visits/:eventId  → { ok, stampCount }
 * - GET    /api/visits/ids       → { eventIds }
 */

import http from '../lib/http';

type MarkVisitedResponse = {
  ok: true;
  alreadyVisited: boolean;
  stampCount: number;
};

type UnmarkVisitedResponse = {
  ok: true;
  stampCount: number;
};

type VisitedIdsResponse = {
  eventIds: string[];
};

export type VisitChangeEvent = {
  eventId: string;
  visited: boolean;
};

type VisitChangeListener = (event: VisitChangeEvent) => void;
const visitChangeListeners = new Set<VisitChangeListener>();

function emitVisitChange(event: VisitChangeEvent): void {
  visitChangeListeners.forEach((listener) => {
    try {
      listener(event);
    } catch (error) {
      if (__DEV__) console.error('[visitService][emitVisitChange]', error);
    }
  });
}

/** 상세/컬렉션 어느 화면에서 바꿔도 열린 컬렉션 화면이 즉시 상태를 맞춘다. */
export function subscribeVisitChange(listener: VisitChangeListener): () => void {
  visitChangeListeners.add(listener);
  return () => visitChangeListeners.delete(listener);
}

/** 다녀왔어요 도장 찍기(위치 안 보냄, 보상 없음). */
export async function markVisited(
  eventId: string,
): Promise<{ alreadyVisited: boolean; stampCount: number }> {
  const { data } = await http.post<MarkVisitedResponse>('/api/visits', { eventId });
  emitVisitChange({ eventId, visited: true });
  return { alreadyVisited: data.alreadyVisited, stampCount: data.stampCount };
}

/** 도장 취소. */
export async function unmarkVisited(eventId: string): Promise<{ stampCount: number }> {
  const { data } = await http.delete<UnmarkVisitedResponse>(`/api/visits/${encodeURIComponent(eventId)}`);
  emitVisitChange({ eventId, visited: false });
  return { stampCount: data.stampCount };
}

/** 다녀온 이벤트 id 집합(버튼 상태용). */
export async function getVisitedIds(): Promise<Set<string>> {
  const { data } = await http.get<VisitedIdsResponse>('/api/visits/ids');
  return new Set(data.eventIds ?? []);
}
