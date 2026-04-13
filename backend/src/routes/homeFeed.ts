/**
 * 매거진 피드 API — 슬롯 기반 동적 생성
 *
 * GET /api/home/feed?page=0&exclude_ids=uuid1,uuid2&user_id=xxx
 *
 * - page: 슬롯 매트릭스 위치 (0~N, SLOT_MATRIX[page % 4] 반복)
 * - exclude_ids: 이미 본 이벤트 UUID CSV (최대 500개)
 * - user_id: 개인화용 (선택)
 */

import express from 'express';
import { pool } from '../db';

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

interface SlotSpec {
  type: 'HERO' | 'BUNDLE' | 'RANKING';
  framing_type: string;
  framing_label: string;
  fetchCount: number; // DB에서 가져올 후보 수
  takeCount: number;  // 카드에 담을 이벤트 수
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

// ─────────────────────────────────────────────────────────────
// 슬롯 매트릭스 (page % 4 반복)
// ─────────────────────────────────────────────────────────────

const SLOT_MATRIX: SlotSpec[][] = [
  // page % 8 === 0
  [
    { type: 'HERO',    framing_type: 'ending_soon',    framing_label: '이번 주 마감',   fetchCount: 5, takeCount: 1 },
    { type: 'BUNDLE',  framing_type: 'weekend_picks',  framing_label: '이번 주말 추천', fetchCount: 8, takeCount: 6 },
    { type: 'RANKING', framing_type: 'top_exhibition', framing_label: '전시 TOP',       fetchCount: 8, takeCount: 5 },
    { type: 'BUNDLE',  framing_type: 'free_picks',     framing_label: '무료로 즐겨요',  fetchCount: 8, takeCount: 6 },
  ],
  // page % 8 === 1
  [
    { type: 'HERO',    framing_type: 'trending_buzz',  framing_label: '지금 가장 화제', fetchCount: 5, takeCount: 1 },
    { type: 'BUNDLE',  framing_type: 'newly_opened',   framing_label: '새로 열렸어요',  fetchCount: 8, takeCount: 6 },
    { type: 'RANKING', framing_type: 'top_popup',      framing_label: '팝업 TOP',       fetchCount: 8, takeCount: 5 },
    { type: 'BUNDLE',  framing_type: 'budget_picks',   framing_label: '가성비 추천',    fetchCount: 8, takeCount: 6 },
  ],
  // page % 8 === 2
  [
    { type: 'HERO',    framing_type: 'newly_opened',    framing_label: '막 오픈했어요',  fetchCount: 5, takeCount: 1 },
    { type: 'BUNDLE',  framing_type: 'trending_buzz',   framing_label: '요즘 핫한 곳',  fetchCount: 8, takeCount: 6 },
    { type: 'RANKING', framing_type: 'top_performance', framing_label: '공연 TOP',       fetchCount: 8, takeCount: 5 },
    { type: 'BUNDLE',  framing_type: 'weekend_picks',   framing_label: '주말에 가볼 곳', fetchCount: 8, takeCount: 6 },
  ],
  // page % 8 === 3
  [
    { type: 'HERO',    framing_type: 'budget_picks',    framing_label: '부담 없이 즐겨요', fetchCount: 5, takeCount: 1 },
    { type: 'BUNDLE',  framing_type: 'ending_soon',     framing_label: '곧 끝나요',        fetchCount: 8, takeCount: 6 },
    { type: 'RANKING', framing_type: 'top_exhibition',  framing_label: '인기 전시',        fetchCount: 8, takeCount: 5 },
    { type: 'BUNDLE',  framing_type: 'free_picks',      framing_label: '0원으로 즐기기',   fetchCount: 8, takeCount: 6 },
  ],
  // page % 8 === 4
  [
    { type: 'HERO',    framing_type: 'free_picks',      framing_label: '무료 입장',      fetchCount: 5, takeCount: 1 },
    { type: 'BUNDLE',  framing_type: 'newly_opened',    framing_label: '이번 달 오픈',   fetchCount: 8, takeCount: 6 },
    { type: 'RANKING', framing_type: 'top_popup',       framing_label: '팝업 인기순',    fetchCount: 8, takeCount: 5 },
    { type: 'BUNDLE',  framing_type: 'trending_buzz',   framing_label: '화제 중인 곳',   fetchCount: 8, takeCount: 6 },
  ],
  // page % 8 === 5
  [
    { type: 'HERO',    framing_type: 'weekend_picks',   framing_label: '이번 주말 픽',   fetchCount: 5, takeCount: 1 },
    { type: 'BUNDLE',  framing_type: 'budget_picks',    framing_label: '알뜰하게 즐기기', fetchCount: 8, takeCount: 6 },
    { type: 'RANKING', framing_type: 'top_performance', framing_label: '공연 인기순',    fetchCount: 8, takeCount: 5 },
    { type: 'BUNDLE',  framing_type: 'ending_soon',     framing_label: '마감 D-7',       fetchCount: 8, takeCount: 6 },
  ],
  // page % 8 === 6
  [
    { type: 'HERO',    framing_type: 'trending_buzz',   framing_label: '지금 뜨는 곳',   fetchCount: 5, takeCount: 1 },
    { type: 'BUNDLE',  framing_type: 'free_picks',      framing_label: '공짜로 즐겨요',  fetchCount: 8, takeCount: 6 },
    { type: 'RANKING', framing_type: 'top_exhibition',  framing_label: '전시 인기순',    fetchCount: 8, takeCount: 5 },
    { type: 'BUNDLE',  framing_type: 'weekend_picks',   framing_label: '주말 나들이',    fetchCount: 8, takeCount: 6 },
  ],
  // page % 8 === 7
  [
    { type: 'HERO',    framing_type: 'ending_soon',     framing_label: '마지막 기회',    fetchCount: 5, takeCount: 1 },
    { type: 'BUNDLE',  framing_type: 'newly_opened',    framing_label: '신규 오픈',      fetchCount: 8, takeCount: 6 },
    { type: 'RANKING', framing_type: 'top_popup',       framing_label: '팝업 스토어 TOP', fetchCount: 8, takeCount: 5 },
    { type: 'BUNDLE',  framing_type: 'budget_picks',    framing_label: '1만원대 즐기기', fetchCount: 8, takeCount: 6 },
  ],
];

// ─────────────────────────────────────────────────────────────
// framing_type → SQL WHERE 절 + ORDER BY
// ─────────────────────────────────────────────────────────────

interface FramingQuery {
  where: string;
  orderBy: string;
  extraParams?: (nextSaturday: string, nextSunday: string) => unknown[];
}

function getFramingQuery(framingType: string): FramingQuery {
  switch (framingType) {
    case 'ending_soon':
      return {
        where: `end_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'`,
        orderBy: 'end_at ASC',
      };
    case 'trending_buzz':
      return {
        where: `buzz_score > 30`,
        orderBy: 'buzz_score DESC',
      };
    case 'newly_opened':
      return {
        where: `start_at >= NOW() - INTERVAL '21 days'`,
        orderBy: 'start_at DESC',
      };
    case 'free_picks':
      return {
        where: `is_free = true`,
        orderBy: 'buzz_score DESC',
      };
    case 'weekend_picks':
      return {
        where: `start_at <= $NEXT_SUNDAY AND end_at >= $NEXT_SATURDAY`,
        orderBy: 'buzz_score DESC',
      };
    case 'budget_picks':
      return {
        where: `(is_free = true OR price_min <= 15000)`,
        orderBy: 'buzz_score DESC',
      };
    case 'top_exhibition':
      return {
        where: `main_category = '전시'`,
        orderBy: 'buzz_score DESC',
      };
    case 'top_popup':
      return {
        where: `main_category = '팝업'`,
        orderBy: 'buzz_score DESC',
      };
    case 'top_performance':
      return {
        where: `main_category IN ('공연', '뮤지컬', '연극')`,
        orderBy: 'buzz_score DESC',
      };
    default:
      // personalized (user_id 있을 때 교체됨) — fallback: buzz_score DESC
      return {
        where: `true`,
        orderBy: 'buzz_score DESC',
      };
  }
}

// ─────────────────────────────────────────────────────────────
// 슬롯 이벤트 조회
// ─────────────────────────────────────────────────────────────

async function fetchSlotEvents(
  slot: SlotSpec,
  usedIds: Set<string>,
  personalizedCategory?: string,
): Promise<EventRow[]> {
  const framingType = slot.framing_type === 'personalized' && personalizedCategory
    ? 'personalized'
    : slot.framing_type;

  // usedIds를 배열로 변환 (UUID 배열 파라미터용)
  const excludeArr = Array.from(usedIds);

  let whereClause: string;
  let orderByClause: string;
  const params: unknown[] = [excludeArr, slot.fetchCount];

  if (framingType === 'personalized' && personalizedCategory) {
    whereClause = `main_category = $3`;
    orderByClause = 'buzz_score DESC';
    params.push(personalizedCategory);
  } else if (slot.framing_type === 'weekend_picks') {
    // 다음 주말 계산
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=일, 6=토
    const daysUntilSat = dayOfWeek === 0 ? 6 : 6 - dayOfWeek;
    const nextSaturday = new Date(now);
    nextSaturday.setDate(now.getDate() + daysUntilSat);
    nextSaturday.setHours(0, 0, 0, 0);
    const nextSunday = new Date(nextSaturday);
    nextSunday.setDate(nextSaturday.getDate() + 1);
    nextSunday.setHours(23, 59, 59, 999);

    whereClause = `start_at <= $3 AND end_at >= $4`;
    orderByClause = 'buzz_score DESC';
    params.push(nextSunday.toISOString(), nextSaturday.toISOString());
  } else {
    const fq = getFramingQuery(slot.framing_type);
    whereClause = fq.where;
    orderByClause = fq.orderBy;
  }

  const query = `
    SELECT id, title, main_category, sub_category, region,
           start_at, end_at, image_url, venue, buzz_score,
           is_free, price_min, overview, derived_tags
    FROM canonical_events
    WHERE is_deleted = false
      AND end_at > NOW()
      AND NOT (id = ANY($1::uuid[]))
      AND ${whereClause}
    ORDER BY ${orderByClause}
    LIMIT $2
  `;

  const result = await pool.query<EventRow>(query, params);
  return result.rows.slice(0, slot.takeCount);
}

// ─────────────────────────────────────────────────────────────
// GET /api/home/feed
// ─────────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/', async (req, res) => {
  try {
    // 파라미터 파싱
    const page = Math.max(0, parseInt(req.query['page'] as string) || 0);
    const excludeIdsRaw = (req.query['exclude_ids'] as string) || '';
    const userId = (req.query['user_id'] as string) || '';

    // exclude_ids 파싱 (UUID 검증, 최대 500개)
    const excludeIds = excludeIdsRaw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => UUID_REGEX.test(id))
      .slice(0, 500);

    // 슬롯 매트릭스 선택
    const slots: SlotSpec[] = SLOT_MATRIX[page % 8]!.map((s) => ({ ...s }));

    // 개인화: userId 있으면 마지막 BUNDLE 슬롯을 유저 상위 카테고리로 교체
    let personalizedCategory: string | undefined;
    if (userId) {
      try {
        const topCatResult = await pool.query<{ main_category: string; cnt: string }>(
          `SELECT ce.main_category, COUNT(*) as cnt
           FROM user_events ue
           JOIN canonical_events ce ON ce.id = ue.event_id
           WHERE ue.user_id = $1
             AND ue.action_type IN ('click', 'save', 'dwell', 'sheet_open')
             AND ue.created_at > NOW() - INTERVAL '30 days'
           GROUP BY ce.main_category ORDER BY cnt DESC LIMIT 1`,
          [userId],
        );
        const topCat = topCatResult.rows[0]?.main_category;
        if (topCat) {
          personalizedCategory = topCat;
          const lastBundleIdx = slots.map((s) => s.type).lastIndexOf('BUNDLE');
          if (lastBundleIdx >= 0) {
            slots[lastBundleIdx] = {
              ...slots[lastBundleIdx]!,
              framing_type: 'personalized',
              framing_label: `내 취향 ${topCat}`,
            };
          }
        }
      } catch (err: any) {
        // 개인화 실패는 무시하고 기본 슬롯 사용
        console.warn('[HomeFeed] 개인화 조회 실패 (무시):', err?.message);
      }
    }

    // 응답 내 글로벌 dedup
    const usedIds = new Set<string>(excludeIds);

    // 슬롯별 이벤트 조회 (순차 — dedup 정합성 유지)
    const cards: object[] = [];
    for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
      const slot = slots[slotIdx]!;
      const events = await fetchSlotEvents(slot, usedIds, personalizedCategory);

      if (events.length === 0) continue;

      // 응답에 담은 이벤트 ID를 usedIds에 추가
      for (const e of events) {
        usedIds.add(e.id);
      }

      cards.push({
        id: `slot-${page}-${slotIdx}-${slot.framing_type}`,
        content_type: slot.type,
        framing_type: slot.framing_type,
        framing_label: slot.framing_label,
        title: null,
        body: null,
        events,
        target_region: null,
        metadata: {},
      });
    }

    if (cards.length === 0) {
      return res.json({ cards: [], next_cursor: null, has_more: false });
    }

    return res.json({
      cards,
      next_cursor: String(page + 1),
      has_more: true,
    });
  } catch (err: any) {
    console.error('[HomeFeed] 피드 조회 오류:', err?.message);
    return res.status(500).json({ error: '피드를 불러오지 못했습니다.' });
  }
});

export default router;
