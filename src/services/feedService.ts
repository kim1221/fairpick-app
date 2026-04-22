/**
 * 매거진 피드 서비스
 *
 * GET /api/home/feed?page=0&exclude_ids=...&user_id=...
 */

import { API_BASE_URL, API_TIMEOUT } from '../config/api';
import type { ScoredEvent } from '../types/recommendation';

export interface FeedEvent {
  id: string;
  title: string;
  main_category: string;
  sub_category: string | null;
  region: string | null;
  start_at: string | null;
  end_at: string | null;
  image_url: string | null;
  venue: string | null;
  buzz_score: number;
  is_free: boolean | null;
  price_min: number | null;
  overview: string | null;
  derived_tags: string[] | null;
}

export interface FeedCard {
  id: string;
  // TODAY_PICK / SECTION: /api/home/sections 에서 변환된 섹션 카드
  // 나머지: /api/home/feed 에서 오는 매거진 카드
  content_type: 'TREND' | 'BUNDLE' | 'SPOTLIGHT' | 'HERO' | 'RANKING' | 'TODAY_PICK' | 'SECTION';
  framing_type: string;
  framing_label: string | null;
  title: string | null;
  body: string | null;
  events: FeedEvent[];
  target_region: string | null;
  metadata: Record<string, unknown>;
}

export interface FeedResponse {
  cards: FeedCard[];
  next_cursor: string | null;
  has_more: boolean;
}

/**
 * FeedEvent → ScoredEvent 어댑터
 * EventCard(ScoredEvent 전용)를 재사용하기 위해 사용
 * price_min은 ScoredEvent 타입에 없지만 getSectionSignal에서 (as any)로 접근하므로 포함
 */
export function feedEventToScoredEvent(e: FeedEvent): ScoredEvent {
  return {
    id: e.id,
    source: '',
    external_id: '',
    title: e.title,
    start_date: e.start_at ?? '',
    end_date: e.end_at ?? '',
    region: e.region ?? undefined,
    category: e.main_category,
    thumbnail_url: e.image_url ?? undefined,
    venue: e.venue ?? undefined,
    buzz_score: e.buzz_score,
    view_count: 0,
    save_count: 0,
    share_count: 0,
    score: e.buzz_score,
    is_free: e.is_free ?? undefined,
    // budget_pick / ending_soon 신호 계산용 (getSectionSignal이 (as any)로 접근)
    price_min: e.price_min,
    created_at: '',
    updated_at: '',
  } as ScoredEvent;
}

/**
 * ScoredEvent → FeedEvent 어댑터
 * /api/home/sections 응답(ScoredEvent[])을 FeedCard.events(FeedEvent[])로 변환할 때 사용
 */
function scoredEventToFeedEvent(e: ScoredEvent): FeedEvent {
  return {
    id: e.id,
    title: e.title,
    main_category: e.category,
    sub_category: null,
    region: e.region ?? null,
    start_at: e.start_date ?? null,
    end_at: e.end_date ?? null,
    image_url: e.thumbnail_url ?? null,
    venue: e.venue ?? null,
    buzz_score: e.buzz_score,
    is_free: e.is_free ?? null,
    price_min: (e as any).price_min ?? null,
    overview: null,
    derived_tags: null,
  };
}

/**
 * /api/home/sections 응답 섹션 배열 → FeedCard[] 변환
 * today_pick → TODAY_PICK, 나머지 → SECTION content_type으로 매핑
 */
export function sectionToFeedCards(sections: Array<{
  slug: string;
  title: string;
  subtitle: string | null;
  events: ScoredEvent[];
}>): FeedCard[] {
  return sections
    .filter(s => s.events.length > 0)
    .map(s => ({
      id: `section-${s.slug}`,
      content_type: (s.slug === 'today_pick' ? 'TODAY_PICK' : 'SECTION') as FeedCard['content_type'],
      framing_type: s.slug,
      framing_label: s.title,
      title: s.subtitle ?? null,
      body: null,
      events: s.events.map(scoredEventToFeedEvent),
      target_region: null,
      metadata: {},
    }));
}

export async function fetchFeed(params: {
  cursor?: string;
  page?: number;
  limit?: number;
  excludeIds?: string[];
  userId?: string;
  region?: string;
  regionStage?: 'exact' | 'metro' | 'all';
  timeout?: number;
}): Promise<FeedResponse> {
  const { cursor, page, excludeIds = [], userId, region, regionStage, timeout } = params;
  const effectiveTimeout = timeout ?? API_TIMEOUT;

  const pageNum = page !== undefined ? page : (parseInt(cursor ?? '0') || 0);

  const query = new URLSearchParams();
  query.set('page', String(pageNum));
  if (excludeIds.length > 0) {
    query.set('exclude_ids', excludeIds.slice(0, 500).join(','));
  }
  if (userId) {
    query.set('user_id', userId);
  }
  if (region) {
    query.set('region', region);
  }
  if (regionStage) {
    query.set('region_stage', regionStage);
  }

  // 듀얼 타임아웃:
  // 1) AbortController signal → iOS URLSession이 정상 동작하려면 signal 필요
  // 2) Promise.race → Android OkHttp가 abort를 무시해도 JS 레벨에서 타임아웃 보장
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

  const fetchPromise = fetch(`${API_BASE_URL}/api/home/feed?${query.toString()}`, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    signal: controller.signal as any,
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Feed request JS timeout')), effectiveTimeout + 500);
  });

  try {
    const res = await Promise.race([fetchPromise, timeoutPromise]);

    if (!res.ok) {
      throw new Error(`Feed API error: ${res.status}`);
    }

    return (await res.json()) as FeedResponse;
  } finally {
    clearTimeout(timeoutId);
    controller.abort();
  }
}
