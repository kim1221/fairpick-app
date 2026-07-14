/**
 * 문화 여권 서비스
 * 발견 수·도장 수·취향 카테고리 등 문화 여권 통계 집계 (서버 권위)
 *
 * 잠긴 API 계약: GET /api/passport (requireAuth)
 * - docs/superpowers/plans/2026-07-01-culturecard-implementation.md
 */

import http from '../lib/http';

export type PassportCollectionStatus = 'active' | 'ended' | 'removed';

export type PassportDiscoveredPageInfo = {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export type PassportStamp = {
  eventId: string;
  title: string;
  category: string;
  region: string | null;
  venue: string | null;
  imageUrl: string | null;
  visitedAt: string;
  /** 종료된 행사도 방문 추억으로 남길 수 있도록 서버가 계산한 아카이브 상태. */
  status?: PassportCollectionStatus;
  /** 이 사용자의 해당 지역 첫 도장. 구버전 서버 호환을 위해 optional. */
  isFirstInRegion?: boolean;
  /** 이 사용자의 해당 카테고리 첫 도장. 구버전 서버 호환을 위해 optional. */
  isFirstInCategory?: boolean;
};

export type PassportTopRegion = {
  region: string;
  count: number;
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
  /** 구버전 서버에서는 생략될 수 있으며 클라이언트는 active로 취급한다. */
  status?: PassportCollectionStatus;
};

export type PassportResponse = {
  passportNo: string; // 유저 시퀀스/해시 → 4자리 zero-pad "0432"
  discoveredCount: number; // earn_log distinct event (평생)
  visitedCount: number; // user_visit_log distinct
  monthDiscovered: number; // 이번달(KST) 발견 수
  regionsDiscovered?: number; // 발견 카드가 채운 고유 지역 수
  categoriesDiscovered?: number; // 정규화한 발견 카테고리 수
  regionsVisited?: number; // 도장을 남긴 고유 지역 수
  monthVisited?: number; // 이번달(KST) 도장 수
  topRegions?: PassportTopRegion[]; // 도장이 많은 지역 상위 5개
  stampBook: number; // 1 = 최신 도장권
  stampBookCount: number; // 전체 도장권 수
  stampBookSize: number; // 도장권당 도장 수
  tasteCategories: string[]; // 상위 2~3 카테고리
  stamps: PassportStamp[]; // 다녀온 문화(도장 그리드용, 최대 60, visitedAt 내림차순)
  visitedEventIds: string[]; // 다녀온 이벤트 전체 id(위시리스트 필터용)
  discoveredCards: PassportDiscoveredCard[]; // 광고 보고 받은 카드 첫 페이지(최신순)
  discoveredPageInfo?: PassportDiscoveredPageInfo;
};

export type GetPassportOptions = {
  stampBook?: number;
  discoveredLimit?: number;
};

export async function getPassport(options: GetPassportOptions = {}): Promise<PassportResponse> {
  const { data } = await http.get<PassportResponse>('/api/passport', {
    params: {
      ...(options.stampBook ? { stampBook: options.stampBook } : {}),
      ...(typeof options.discoveredLimit === 'number' ? { discoveredLimit: options.discoveredLimit } : {}),
    },
  });
  return data;
}

export type GetDiscoveredCardsOptions = {
  limit?: number;
  cursor?: string | null;
};

export type PassportDiscoveredCardsResponse = {
  items: PassportDiscoveredCard[];
  pageInfo: PassportDiscoveredPageInfo;
};

/**
 * 공개한 문화 전체를 최신순으로 불러온다.
 * cursor는 서버가 발급한 opaque 값만 그대로 전달한다.
 */
export async function getDiscoveredCards(
  options: GetDiscoveredCardsOptions = {}
): Promise<PassportDiscoveredCardsResponse> {
  const { data } = await http.get<PassportDiscoveredCardsResponse>('/api/passport/discovered', {
    params: {
      ...(typeof options.limit === 'number' ? { limit: options.limit } : {}),
      ...(options.cursor ? { cursor: options.cursor } : {}),
    },
  });
  return data;
}
