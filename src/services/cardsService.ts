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

export type CardSlotType = 'category' | 'mystery';

export type LockedCardPreview = {
  cardToken: string;
  visualSeed?: string; // 같은 날 같은 추천의 잠금 티켓 외형을 고정하는 비식별 키
  // S3 백엔드부터 내려옴 — 구버전 응답에는 없으므로 optional. 없으면 'category'로 폴백한다.
  slotType?: CardSlotType;
  // mystery 슬롯은 카테고리·티저 단서를 서버가 은닉한다(null). UI는 값 존재 여부가 아니라
  // slotType으로 분기한다.
  category: string | null;
  areaLabel: string | null;
  distanceLabel: string | null;
  timingLabel: string | null;
  reasonTags: string[];
  teaserEyebrow: string | null;
  teaserHeadline: string | null;
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

export type OpenCapInfo = {
  base: number;
  effective: number;
  // regional_pool = 지역 신선 풀 소진으로 캡이 낮아짐 → "오늘 {지역}의 카드는 여기까지" 프레이밍
  reason: 'daily_max' | 'regional_pool';
  regionLabel: string | null;
};

export type CardsTodayV2Response = {
  lockedCards: LockedCardPreview[];
  ticketCount: number;
  dailyEarned: number;
  dailyLimit: number;
  dailyOpenCount: number;
  dailyOpenLimit: number;
  // S2 백엔드부터 내려옴 — 구버전 백엔드 호환을 위해 optional
  openCap?: OpenCapInfo;
  userRegion: string | null;
  weeklyDiscovery: WeeklyDiscovery;
  personalization: PersonalizationProfile;
};

/** 이번 오픈으로 실제 채워진 테마 컬렉션 세트(안 채워진 세트는 응답에 없다). */
export type CollectionProgressEntry = {
  setId: string;
  slug: string;
  title: string;
  filledSlotIndex: number;
  filledCount: number;
  totalSlots: number;
  completed: boolean;
  badgeKey?: string;
  /** 이 완성으로 새로 지급된 보너스 티켓(배지 재수여·구버전 백엔드엔 없음). */
  bonusTickets?: number;
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
  // S3 백엔드부터 내려옴 — hidden=true면 ? 슬롯에서 나온 히든 카드(절제된 특수 표기만).
  reveal?: {
    slotType: CardSlotType;
    hidden: boolean;
  };
  // S4 백엔드부터 내려옴 — 구버전 응답에는 없으므로 optional.
  collectionProgress?: CollectionProgressEntry[];
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
