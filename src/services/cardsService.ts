/**
 * 오늘의 카드 서비스
 * 광고를 보고 여는 "오늘의 문화 카드" 공급 (서버 권위)
 *
 * 잠긴 API 계약: GET /api/cards/today (requireAuth)
 * - docs/superpowers/plans/2026-07-01-culturecard-implementation.md
 */

import http from '../lib/http';

export type Card = {
  eventId: string;
  title: string;
  category: string; // 전시 | 공연 | 팝업 | 축제 | 기타
  venue: string | null;
  region: string | null;
  startAt: string | null; // ISO
  endAt: string | null; // ISO
  dday: number | null; // end_at 기준 남은 일수
  imageUrl: string | null;
  walkMinutes: number | null;
  blurb: string | null; // 짧은 소개(overview 1줄)
  opened: boolean; // 오늘 이 event에서 이미 earn했는지
  reasonTags?: string[]; // 내 주변·취향·신선도 등 추천 이유(구버전 서버 호환 optional)
};

export type WeeklyCuration = {
  weekKey: string; // KST 월요일 YYYY-MM-DD
  region: string | null;
  title: string;
  subtitle: string;
  items: Card[];
};

export type PersonalizationProfile = {
  level: 'cold' | 'growing' | 'established';
  signalCount: number;
  topCategories: Array<{
    category: string;
    score: number;
    signals: number;
  }>;
};

export type CardsTodayResponse = {
  today: Card[]; // 고정 3장
  morePool: Card[]; // 더 뽑기 풀(이미 연 카드 제외)
  ticketCount: number;
  dailyEarned: number;
  dailyLimit: number; // 30
  userRegion: string | null; // 내 위치 동네명(역지오코딩), 좌표 없거나 실패 시 null
  weeklyCuration?: WeeklyCuration;
  personalization?: PersonalizationProfile;
};

export type LockedCardPreview = {
  cardToken: string;
  visualSeed?: string; // 같은 날 같은 추천의 잠금 티켓 외형을 고정하는 비식별 키
  category: string;
  areaLabel: string | null;
  distanceLabel: string | null;
  timingLabel: string;
  reasonTags: string[];
  teaserEyebrow: string;
  teaserHeadline: string;
  palette: {
    background: string;
    foreground: string;
    accent: string;
  };
  /** @deprecated 공개했던 카드는 홈에서 다시 추천하지 않는다. 구버전 응답 호환용. */
  isRevisit?: boolean;
};

export type WeeklyDiscovery = {
  weekKey: string;
  openedCount: number;
  goal: number;
  items: Card[];
};

export type CardsTodayV2Response = {
  lockedCards: LockedCardPreview[];
  ticketCount: number;
  dailyEarned: number;
  dailyLimit: number;
  dailyOpenCount: number;
  dailyOpenLimit: number;
  userRegion: string | null;
  weeklyDiscovery: WeeklyDiscovery;
  personalization: PersonalizationProfile;
};

export type OpenCultureCardResponse = {
  card: Card;
  earned: number;
  ticketCount: number;
  totalEarned: number;
  canExchange: boolean;
  dailyEarned: number;
  dailyLimit: number;
  dailyOpenCount: number;
  dailyOpenLimit: number;
};

export type CardLocation = {
  lat: number;
  lng: number;
};

export async function getTodayCards(coords?: CardLocation): Promise<CardsTodayResponse> {
  const { data } = await http.get<CardsTodayResponse>('/api/cards/today', {
    params: coords ? { lat: coords.lat, lng: coords.lng } : undefined,
  });
  return data;
}

export async function getTodayCardsV2(coords?: CardLocation): Promise<CardsTodayV2Response> {
  const { data } = await http.get<CardsTodayV2Response>('/api/cards/v2/today', {
    params: coords ? { lat: coords.lat, lng: coords.lng } : undefined,
  });
  return data;
}

export async function openCultureCard(
  cardToken: string,
  adAttemptId: string,
): Promise<OpenCultureCardResponse> {
  const { data } = await http.post<OpenCultureCardResponse>('/api/cards/v2/open', {
    cardToken,
    adAttemptId,
  });
  return data;
}
