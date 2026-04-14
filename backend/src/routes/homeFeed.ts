/**
 * 매거진 피드 API — 날짜 기반 일일 셔플 + 슬롯 풀 시스템
 *
 * GET /api/home/feed?page=0&exclude_ids=uuid1,uuid2&user_id=xxx
 *
 * - page: 슬롯 위치 (0~N)
 * - exclude_ids: 이미 본 이벤트 UUID CSV (최대 500개)
 * - user_id: 개인화용 (선택)
 *
 * 매일 날짜 seed로 HERO/BUNDLE/RANKING 풀을 각각 셔플 →
 * 같은 page 번호라도 날짜가 다르면 다른 주제가 나옴
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
  fetchCount: number;
  takeCount: number;
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
// 날짜 시드 기반 셔플 (LCG)
// ─────────────────────────────────────────────────────────────

function seededShuffle<T>(arr: T[], seed: string): T[] {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = (((h << 5) + h) ^ seed.charCodeAt(i)) >>> 0;
  }
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    const j = h % (i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// 슬롯 풀 정의
// ─────────────────────────────────────────────────────────────

const HERO_POOL: SlotSpec[] = [
  { type: 'HERO', framing_type: 'ending_soon',     framing_label: '오늘 안 가면 못 봐요',          fetchCount: 5, takeCount: 1 },
  { type: 'HERO', framing_type: 'trending_buzz',   framing_label: '요즘 다들 여기 가더라고요',      fetchCount: 5, takeCount: 1 },
  { type: 'HERO', framing_type: 'must_see_ending', framing_label: '인기 많은데 곧 끝나요',          fetchCount: 5, takeCount: 1 },
  { type: 'HERO', framing_type: 'newly_opened',    framing_label: '아직 아는 사람 없어요',          fetchCount: 5, takeCount: 1 },
  { type: 'HERO', framing_type: 'long_run_hit',    framing_label: '꾸준히 찾는 데는 이유가 있어요', fetchCount: 5, takeCount: 1 },
  { type: 'HERO', framing_type: 'hidden_gem',      framing_label: '나만 먼저 가볼 수 있는',         fetchCount: 5, takeCount: 1 },
  { type: 'HERO', framing_type: 'musical',         framing_label: '무대가 달라요',                  fetchCount: 5, takeCount: 1 },
  { type: 'HERO', framing_type: 'concert',         framing_label: '직접 봐야 아는 무대',            fetchCount: 5, takeCount: 1 },
];

const BUNDLE_POOL: SlotSpec[] = [
  { type: 'BUNDLE', framing_type: 'weekend_picks', framing_label: '이번 주말 뭐해요?',      fetchCount: 8, takeCount: 6 },
  { type: 'BUNDLE', framing_type: 'free_picks',    framing_label: '공짜인데 진짜 좋아요',   fetchCount: 8, takeCount: 6 },
  { type: 'BUNDLE', framing_type: 'budget_picks',  framing_label: '이 가격이 맞나요',       fetchCount: 8, takeCount: 6 },
  { type: 'BUNDLE', framing_type: 'theater',       framing_label: '배우와 1미터 거리에서',  fetchCount: 8, takeCount: 6 },
  { type: 'BUNDLE', framing_type: 'classical',     framing_label: '클래식은 어렵다고요?',   fetchCount: 8, takeCount: 6 },
  { type: 'BUNDLE', framing_type: 'traditional',   framing_label: 'K-클래식이 있다면',      fetchCount: 8, takeCount: 6 },
  { type: 'BUNDLE', framing_type: 'dance',         framing_label: '몸으로 말하는 무대',     fetchCount: 8, takeCount: 6 },
  { type: 'BUNDLE', framing_type: 'newly_opened',  framing_label: '방금 열었어요',          fetchCount: 8, takeCount: 6 },
  { type: 'BUNDLE', framing_type: 'hidden_gem',    framing_label: '아직 줄 안 서도 돼요',   fetchCount: 8, takeCount: 6 },
];

const RANKING_POOL: SlotSpec[] = [
  { type: 'RANKING', framing_type: 'top_exhibition',     framing_label: '전시 인기순',   fetchCount: 8, takeCount: 5 },
  { type: 'RANKING', framing_type: 'top_popup',          framing_label: '팝업 인기순',   fetchCount: 8, takeCount: 5 },
  { type: 'RANKING', framing_type: 'musical',            framing_label: '뮤지컬 인기순', fetchCount: 8, takeCount: 5 },
  { type: 'RANKING', framing_type: 'classical',          framing_label: '클래식 인기순', fetchCount: 8, takeCount: 5 },
  { type: 'RANKING', framing_type: 'theater',            framing_label: '연극 인기순',   fetchCount: 8, takeCount: 5 },
  { type: 'RANKING', framing_type: 'concert',            framing_label: '콘서트 인기순', fetchCount: 8, takeCount: 5 },
  { type: 'RANKING', framing_type: 'special_exhibition', framing_label: '특별전 인기순', fetchCount: 8, takeCount: 5 },
];

// ─────────────────────────────────────────────────────────────
// framing_type → SQL WHERE + ORDER BY
// buzz_score > 20 기본 조건은 fetchSlotEvents에서 추가
// ─────────────────────────────────────────────────────────────

interface FramingSQL {
  where: string;
  orderBy: string;
  isWeekend?: boolean; // weekend_picks 전용 파라미터 필요 여부
}

function getFramingSQL(framingType: string): FramingSQL {
  switch (framingType) {
    case 'ending_soon':
      return { where: `end_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'`, orderBy: 'end_at ASC' };
    case 'trending_buzz':
      return { where: `buzz_score > 30`, orderBy: 'buzz_score DESC' };
    case 'newly_opened':
      return { where: `start_at >= NOW() - INTERVAL '21 days'`, orderBy: 'start_at DESC' };
    case 'free_picks':
      return { where: `is_free = true`, orderBy: 'buzz_score DESC' };
    case 'budget_picks':
      return { where: `(is_free = true OR price_min <= 15000)`, orderBy: 'buzz_score DESC' };
    case 'weekend_picks':
      return { where: '', orderBy: 'buzz_score DESC', isWeekend: true };
    case 'hidden_gem':
      return { where: `start_at >= NOW() - INTERVAL '14 days' AND buzz_score BETWEEN 5 AND 25`, orderBy: 'start_at DESC' };
    case 'must_see_ending':
      return { where: `end_at BETWEEN NOW() AND NOW() + INTERVAL '7 days' AND buzz_score > 40`, orderBy: 'end_at ASC' };
    case 'long_run_hit':
      return { where: `start_at < NOW() - INTERVAL '60 days' AND buzz_score > 50`, orderBy: 'buzz_score DESC' };
    case 'top_exhibition':
      return { where: `main_category = '전시'`, orderBy: 'buzz_score DESC' };
    case 'top_popup':
      return { where: `main_category = '팝업'`, orderBy: 'buzz_score DESC' };
    case 'musical':
      return { where: `sub_category = '뮤지컬'`, orderBy: 'buzz_score DESC' };
    case 'classical':
      return { where: `sub_category IN ('서양음악(클래식)', '클래식')`, orderBy: 'buzz_score DESC' };
    case 'theater':
      return { where: `sub_category = '연극'`, orderBy: 'buzz_score DESC' };
    case 'concert':
      return { where: `sub_category IN ('콘서트', '대중음악')`, orderBy: 'buzz_score DESC' };
    case 'traditional':
      return { where: `sub_category IN ('한국음악(국악)', '국악')`, orderBy: 'buzz_score DESC' };
    case 'dance':
      return { where: `sub_category IN ('무용(서양/한국무용)', '무용', '대중무용')`, orderBy: 'buzz_score DESC' };
    case 'special_exhibition':
      return { where: `sub_category = '특별전'`, orderBy: 'buzz_score DESC' };
    default:
      return { where: 'true', orderBy: 'buzz_score DESC' };
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
  const excludeArr = Array.from(usedIds);
  const params: unknown[] = [excludeArr, slot.fetchCount];
  let whereClause: string;
  let orderByClause: string;

  if (slot.framing_type === 'personalized' && personalizedCategory) {
    whereClause = `main_category = $3 AND buzz_score > 20`;
    orderByClause = 'buzz_score DESC';
    params.push(personalizedCategory);
  } else if (slot.framing_type === 'weekend_picks') {
    const now = new Date();
    const dow = now.getDay();
    const daysUntilSat = dow === 0 ? 6 : 6 - dow;
    const sat = new Date(now);
    sat.setDate(now.getDate() + daysUntilSat);
    sat.setHours(0, 0, 0, 0);
    const sun = new Date(sat);
    sun.setDate(sat.getDate() + 1);
    sun.setHours(23, 59, 59, 999);
    whereClause = `start_at <= $3 AND end_at >= $4 AND buzz_score > 20`;
    orderByClause = 'buzz_score DESC';
    params.push(sun.toISOString(), sat.toISOString());
  } else {
    const sql = getFramingSQL(slot.framing_type);
    whereClause = sql.where ? `${sql.where} AND buzz_score > 20` : `buzz_score > 20`;
    // hidden_gem은 buzz_score 상한이 있으므로 > 20 조건 중복 방지
    if (slot.framing_type === 'hidden_gem') {
      whereClause = `start_at >= NOW() - INTERVAL '14 days' AND buzz_score BETWEEN 5 AND 25`;
    }
    orderByClause = sql.orderBy;
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
    const page = Math.max(0, parseInt(req.query['page'] as string) || 0);
    const excludeIdsRaw = (req.query['exclude_ids'] as string) || '';
    const userId = (req.query['user_id'] as string) || '';

    const excludeIds = excludeIdsRaw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => UUID_REGEX.test(id))
      .slice(0, 500);

    // 오늘 날짜 기반 일일 셔플
    const today = new Date().toISOString().slice(0, 10);
    const heroPool  = seededShuffle(HERO_POOL,    today + '-hero');
    const bundlePool = seededShuffle(BUNDLE_POOL, today + '-bundle');
    const rankingPool = seededShuffle(RANKING_POOL, today + '-ranking');

    // page마다 고유 슬롯 4개 선택
    const heroSlot    = heroPool[page % heroPool.length]!;
    const bundleSlot1 = bundlePool[(page * 2) % bundlePool.length]!;
    const rankingSlot = rankingPool[page % rankingPool.length]!;
    const bundleSlot2 = bundlePool[(page * 2 + 1) % bundlePool.length]!;
    const slots: SlotSpec[] = [heroSlot, bundleSlot1, rankingSlot, bundleSlot2];

    // 개인화: userId 있으면 마지막 BUNDLE을 유저 상위 카테고리로 교체
    let personalizedCategory: string | undefined;
    if (userId) {
      try {
        const r = await pool.query<{ main_category: string }>(
          `SELECT ce.main_category, COUNT(*) as cnt
           FROM user_events ue
           JOIN canonical_events ce ON ce.id = ue.event_id
           WHERE ue.user_id = $1
             AND ue.action_type IN ('click', 'save', 'dwell', 'sheet_open')
             AND ue.created_at > NOW() - INTERVAL '30 days'
           GROUP BY ce.main_category ORDER BY cnt DESC LIMIT 1`,
          [userId],
        );
        const topCat = r.rows[0]?.main_category;
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
      } catch {
        // 개인화 실패 무시
      }
    }

    // 슬롯별 이벤트 조회 (순차 dedup)
    const usedIds = new Set<string>(excludeIds);
    const cards: object[] = [];

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      const events = await fetchSlotEvents(slot, usedIds, personalizedCategory);
      if (events.length === 0) continue;

      for (const e of events) usedIds.add(e.id);

      cards.push({
        id: `slot-${page}-${i}-${slot.framing_type}`,
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

    return res.json({ cards, next_cursor: String(page + 1), has_more: true });
  } catch (err: any) {
    console.error('[HomeFeed] 오류:', err?.message);
    return res.status(500).json({ error: '피드를 불러오지 못했습니다.' });
  }
});

export default router;
