/**
 * 매거진 피드 서비스
 *
 * GET /api/home/feed 호출 + 커서 관리
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
  content_type: 'TREND' | 'BUNDLE' | 'SPOTLIGHT';
  framing_type: string;
  title: string;
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
  cursor?: string;
  limit?: number;
  excludeIds?: string[];
}): Promise<FeedResponse> {
  const { cursor, limit = 5, excludeIds = [] } = params;

  const query = new URLSearchParams();
  if (cursor) query.set('cursor', cursor);
  query.set('limit', String(limit));
  if (excludeIds.length > 0) {
    query.set('exclude_ids', excludeIds.slice(0, 100).join(','));
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
