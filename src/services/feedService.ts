/**
 * 매거진 피드 서비스
 *
 * GET /api/home/feed?page=0&exclude_ids=...&user_id=...
 */

import { API_BASE_URL, API_TIMEOUT } from '../config/api';

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

export async function fetchFeed(params: {
  cursor?: string;    // 기존 호환 유지 (page number로 재해석)
  page?: number;      // 신규 (cursor보다 우선)
  limit?: number;     // 미사용 (슬롯 고정), 호환성 유지
  excludeIds?: string[];
  userId?: string;
}): Promise<FeedResponse> {
  const { cursor, page, excludeIds = [], userId } = params;

  // page가 명시적으로 주어지면 우선 사용, 아니면 cursor를 page number로 해석
  const pageNum = page !== undefined ? page : (parseInt(cursor ?? '0') || 0);

  const query = new URLSearchParams();
  query.set('page', String(pageNum));
  if (excludeIds.length > 0) {
    query.set('exclude_ids', excludeIds.slice(0, 500).join(','));
  }
  if (userId) {
    query.set('user_id', userId);
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
