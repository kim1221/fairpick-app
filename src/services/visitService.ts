/**
 * 가봤어요 / 도장 서비스
 * 저장한 행사를 실제로 방문하고 체크인 → 여권 도장 + 보너스 티켓 (서버 권위·멱등)
 *
 * 잠긴 API 계약: POST /api/visits (requireAuth) body { eventId: string, lat?: number, lng?: number }
 * - docs/superpowers/plans/2026-07-01-culturecard-implementation.md
 */

import http from '../lib/http';

export type VisitResponse = {
  ok: true;
  alreadyVisited: boolean; // 재호출 시 true, 보너스 중복지급 없음
  verified: boolean; // GPS/기간 검증 성공 여부
  reason?: 'TOO_FAR' | 'NO_LOCATION' | 'EVENT_NO_COORDS' | 'OUT_OF_PERIOD';
  distanceM?: number;
  bonusTickets: number; // 신규 방문 시 +3, 재방문 시 0
  ticketCount: number;
  stampCount: number; // 누적 도장 수
};

export type VisitLocation = {
  lat: number;
  lng: number;
};

export async function markVisited(eventId: string, coords?: VisitLocation): Promise<VisitResponse> {
  const { data } = await http.post<VisitResponse>('/api/visits', {
    eventId,
    ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
  });
  return data;
}
