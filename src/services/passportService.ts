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
  visitedAt: string;
};

export type PassportResponse = {
  passportNo: string; // 유저 시퀀스/해시 → 4자리 zero-pad "0432"
  discoveredCount: number; // earn_log distinct event (평생)
  visitedCount: number; // user_visit_log distinct
  monthDiscovered: number; // 이번달(KST) 발견 수
  tasteCategories: string[]; // 상위 2~3 카테고리
  stamps: PassportStamp[]; // 최근 방문(도장 그리드용, 최대 12)
};

export async function getPassport(): Promise<PassportResponse> {
  const { data } = await http.get<PassportResponse>('/api/passport');
  return data;
}
