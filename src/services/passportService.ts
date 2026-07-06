/**
 * 문화 여권 서비스
 * 발견 수·도장 수·취향 카테고리 등 문화 여권 통계 집계 (서버 권위)
 *
 * 잠긴 API 계약: GET /api/passport (requireAuth)
 * - docs/superpowers/plans/2026-07-01-culturecard-implementation.md
 */

import http from '../lib/http';

export type PassportStamp = {
  eventId: string;
  title: string;
  category: string;
  region: string | null;
  venue: string | null;
  imageUrl: string | null;
  visitedAt: string;
};

export type PassportDiscoveredCard = {
  eventId: string;
  title: string;
  category: string;
  region: string | null;
  venue: string | null;
  imageUrl: string | null;
  startAt: string | null;
  endAt: string | null;
  lat: number | null;
  lng: number | null;
  discoveredAt: string;
};

export type PassportResponse = {
  passportNo: string; // 유저 시퀀스/해시 → 4자리 zero-pad "0432"
  discoveredCount: number; // earn_log distinct event (평생)
  visitedCount: number; // user_visit_log distinct
  monthDiscovered: number; // 이번달(KST) 발견 수
  tasteCategories: string[]; // 상위 2~3 카테고리
  stamps: PassportStamp[]; // 다녀온 문화(도장 그리드용, 최대 60, visitedAt 내림차순)
  visitedEventIds: string[]; // 다녀온 이벤트 전체 id(위시리스트 필터용)
  discoveredCards: PassportDiscoveredCard[]; // 광고 보고 받은 카드(최신순, 최대 50)
};

export async function getPassport(): Promise<PassportResponse> {
  const { data } = await http.get<PassportResponse>('/api/passport');
  return data;
}
