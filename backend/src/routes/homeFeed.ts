/**
 * 매거진 피드 API
 *
 * GET /api/home/feed
 * - 커서 기반 무한 스크롤 페이지네이션
 * - content_pool에서 TREND/BUNDLE/SPOTLIGHT 카드 조회
 * - exclude_ids로 이미 본 이벤트가 포함된 카드 필터링
 */

import express from 'express';
import { pool } from '../db';

const router = express.Router();

interface ContentPoolRow {
  id: string;
  content_type: 'TREND' | 'BUNDLE' | 'SPOTLIGHT';
  framing_type: string;
  title: string;
  body: string | null;
  event_ids: string[];
  target_region: string | null;
  priority: number;
  generated_at: string;
  metadata: Record<string, unknown>;
}

interface EventRow {
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

/**
 * GET /api/home/feed
 *
 * Query params:
 * - cursor: string (마지막으로 받은 카드의 generated_at ISO 문자열, 없으면 처음부터)
 * - limit: number (기본 5)
 * - exclude_ids: string (이미 본 이벤트 UUID 콤마 구분, 최대 100개)
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query['limit'] as string) || 5, 10);
    const cursor = req.query['cursor'] as string | undefined;
    const excludeIdsRaw = (req.query['exclude_ids'] as string) || '';

    // exclude_ids 파싱 (UUID 형식 검증)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const excludeIds = excludeIdsRaw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => uuidRegex.test(id))
      .slice(0, 100);

    // 1. content_pool에서 카드 조회 (커서 기반)
    const cursorCondition = cursor
      ? `AND (priority DESC, generated_at DESC) < (
           SELECT priority, generated_at FROM content_pool WHERE id = $3::uuid
         )`
      : '';

    // 커서 조건 없이 단순 페이지네이션 (priority DESC, generated_at DESC)
    let cardQuery: string;
    let cardParams: unknown[];

    if (cursor) {
      cardQuery = `
        SELECT id, content_type, framing_type, title, body, event_ids,
               target_region, priority, generated_at, metadata
        FROM content_pool
        WHERE expires_at > NOW()
          AND (priority, generated_at) < (
            SELECT priority, generated_at FROM content_pool WHERE id = $1::uuid
          )
        ORDER BY priority DESC, generated_at DESC
        LIMIT $2
      `;
      cardParams = [cursor, limit];
    } else {
      cardQuery = `
        SELECT id, content_type, framing_type, title, body, event_ids,
               target_region, priority, generated_at, metadata
        FROM content_pool
        WHERE expires_at > NOW()
        ORDER BY priority DESC, generated_at DESC
        LIMIT $1
      `;
      cardParams = [limit];
    }

    const cardResult = await pool.query<ContentPoolRow>(cardQuery, cardParams);
    let cards = cardResult.rows;

    // 2. exclude_ids 필터링 (이미 본 이벤트 포함 카드 제외)
    if (excludeIds.length > 0) {
      const excludeSet = new Set(excludeIds);
      cards = cards.filter((card) => {
        // 카드 이벤트의 절반 이상이 이미 본 이벤트면 제외
        const seenCount = card.event_ids.filter((id) => excludeSet.has(id)).length;
        return seenCount < Math.ceil(card.event_ids.length / 2);
      });
    }

    if (cards.length === 0) {
      return res.json({ cards: [], next_cursor: null, has_more: false });
    }

    // 3. 카드에 연결된 이벤트 상세 정보 조회
    const allEventIds = Array.from(new Set(cards.flatMap((c) => c.event_ids)));

    const eventResult = await pool.query<EventRow>(
      `SELECT id, title, main_category, sub_category, region,
              start_at, end_at, image_url, venue, buzz_score,
              is_free, price_min, overview, derived_tags
       FROM canonical_events
       WHERE id = ANY($1::uuid[])
         AND is_deleted = false`,
      [allEventIds],
    );

    const eventMap = new Map<string, EventRow>(
      eventResult.rows.map((e) => [e.id, e]),
    );

    // 4. 응답 조립
    const responseCards = cards.map((card) => {
      const events = card.event_ids
        .map((id) => eventMap.get(id))
        .filter((e): e is EventRow => e !== null && e !== undefined);

      return {
        id: card.id,
        content_type: card.content_type,
        framing_type: card.framing_type,
        title: card.title,
        body: card.body,
        events,
        target_region: card.target_region,
        metadata: card.metadata,
      };
    });

    // 5. 다음 커서 = 마지막 카드의 id
    const lastCard = cards[cards.length - 1]!;
    const nextCursor = cards.length >= limit ? lastCard.id : null;

    return res.json({
      cards: responseCards,
      next_cursor: nextCursor,
      has_more: nextCursor !== null,
    });
  } catch (err: any) {
    console.error('[HomeFeed] 피드 조회 오류:', err?.message);
    return res.status(500).json({ error: '피드를 불러오지 못했습니다.' });
  }
});

export default router;
