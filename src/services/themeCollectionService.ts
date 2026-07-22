/**
 * 테마 컬렉션(주간 발행 세트·배지) 조회 서비스.
 *
 * 잠긴 API 계약: backend/src/routes/collections.ts (읽기 전용 3개)
 * 진행 기록은 서버가 /v2/open 트랜잭션에서만 쓴다 — 클라 쓰기 API는 없다.
 * (기존 collectionService.ts는 "저장 목록" 병합용으로 별개 파일이다.)
 */

import http from '../lib/http';

export type ThemeCollectionFilledSlot = {
  eventId: string;
  title: string;
  category: string | null;
  region: string | null;
  venue: string | null;
  imageUrl: string | null;
  startAt: string | null;
  endAt: string | null;
  filledAt: string | null;
  /** 'mystery' = ? 슬롯이 채워준 조각("우연히 만난 조각" 표기) */
  source: string;
};

export type ThemeCollectionEmptySlot = {
  hintText: string;
  /** 대표 이벤트 원본 이미지 URL. 실루엣 처리(블러/틴트)는 클라 몫. */
  silhouetteImageUrl: string | null;
};

export type ThemeCollectionSlot = {
  slotIndex: number;
  state: 'filled' | 'empty';
  filled: ThemeCollectionFilledSlot | null;
  empty: ThemeCollectionEmptySlot | null;
};

export type ThemeCollectionSet = {
  setId: string;
  slug: string;
  title: string;
  subtitle: string | null;
  template: string;
  tier: string;
  regionScope: string | null;
  status: string;
  publishedAt: string | null;
  expiresAt: string | null;
  daysRemaining: number;
  totalSlots: number;
  filledCount: number;
  completed: boolean;
  slots: ThemeCollectionSlot[];
};

export type ThemeCollectionsResponse = {
  sets: ThemeCollectionSet[];
  activeSetCount: number;
  nearCompletion: {
    setId: string;
    title: string;
    filled: number;
    total: number;
  } | null;
};

export type ThemeCollectionSetDetail = ThemeCollectionSet & {
  badge: { badgeKey: string; awardedAt: string | null } | null;
};

export type CollectionBadge = {
  badgeKey: string;
  setId: string | null;
  tier: string;
  title: string;
  awardedAt: string | null;
};

export async function getThemeCollections(region?: string): Promise<ThemeCollectionsResponse> {
  const { data } = await http.get<ThemeCollectionsResponse>('/api/collections', {
    params: region ? { region } : undefined,
  });
  return data;
}

export async function getThemeCollectionSet(setId: string): Promise<ThemeCollectionSetDetail> {
  const { data } = await http.get<ThemeCollectionSetDetail>(`/api/collections/${setId}`);
  return data;
}

export async function getCollectionBadges(): Promise<CollectionBadge[]> {
  const { data } = await http.get<{ badges: CollectionBadge[] }>('/api/collections/badges');
  return data.badges;
}
