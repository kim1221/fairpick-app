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
  content_type: 'TREND' | 'BUNDLE' | 'SPOTLIGHT' | 'HERO' | 'RANKING';
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
 * BUNDLE 카드에서 EventCard(ScoredEvent 전용)를 직접 재사용하기 위해 사용
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
    created_at: '',
    updated_at: '',
  } as ScoredEvent;
}

export async function fetchFeed(params: {
  cursor?: string;
  page?: number;
  limit?: number;
  excludeIds?: string[];
  userId?: string;
  region?: string;           // DB region 이름 (예: "서울", "경기", "부산")
  regionStage?: 'exact' | 'metro' | 'all';  // 지역 하드 필터 단계
}): Promise<FeedResponse> {
  const { cursor, page, excludeIds = [], userId, region, regionStage } = params;

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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const res = await fetch(`${API_BASE_URL}/api/home/feed?${query.toString()}`, {
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Feed API error: ${res.status}`);
    }

    return (await res.json()) as FeedResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}
