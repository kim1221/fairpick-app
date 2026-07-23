import express, { Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/requireAuth';
import { COLLECTION_COMPLETION_BONUS_TICKETS } from '../services/collections';

/**
 * 테마 컬렉션 조회 API(스펙 §5.2). 읽기 전용 — 진행 쓰기 경로는 `/v2/open`에만 있다.
 * 미공개 슬롯은 실루엣 + 힌트만 내보내 카드 공개 희소성을 지킨다.
 */
const router = express.Router();

/**
 * 동시 노출 상한(스펙 §4.3) — 미션 피로 방지.
 * 배치는 이보다 많이 발행할 수 있고, 넘치는 세트는 상세 조회로만 닿는다.
 */
const MAX_REGION_SETS = 3;
const MAX_NATIONAL_SETS = 2;
const SET_FETCH_LIMIT = 12;

type SetRow = {
  set_id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  template: string;
  tier: string;
  region_scope: string | null;
  status: string;
  published_at: string | Date;
  expires_at: string | Date;
  total_slots: number | string;
  filled_count: number | string;
};

type SlotRow = {
  set_id: string;
  slot_index: number;
  hint_text: string;
  teaser_image_url: string | null;
  filled_event_id: string | null;
  filled_source: string | null;
  filled_at: string | Date | null;
  title: string | null;
  display_title: string | null;
  main_category: string | null;
  region: string | null;
  venue: string | null;
  image_url: string | null;
  start_at: string | Date | null;
  end_at: string | Date | null;
};

function toIso(value: string | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** 남은 일수(KST 날짜 기준). 만료 당일이면 0. */
function daysRemaining(expiresAt: string | Date): number {
  const expires = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  const diffMs = expires.getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

function mapSlot(row: SlotRow) {
  if (row.filled_event_id) {
    return {
      slotIndex: Number(row.slot_index),
      state: 'filled' as const,
      filled: {
        eventId: row.filled_event_id,
        title: row.display_title ?? row.title ?? '',
        category: row.main_category,
        region: row.region,
        venue: row.venue,
        imageUrl: row.image_url,
        startAt: toIso(row.start_at),
        endAt: toIso(row.end_at),
        filledAt: toIso(row.filled_at),
        // 'mystery' = "?" 슬롯이 채워준 조각. 컬렉션 UI가 "우연히 만난 조각"으로 표시한다.
        source: row.filled_source ?? 'open',
      },
      empty: null,
    };
  }
  return {
    slotIndex: Number(row.slot_index),
    state: 'empty' as const,
    filled: null,
    empty: {
      hintText: row.hint_text,
      // 실루엣 처리(블러/단색화)는 클라가 한다 — 서버는 대표 이미지 URL만 준다.
      silhouetteImageUrl: row.teaser_image_url,
    },
  };
}

/** 세트 행 + 슬롯 행을 묶어 응답 형태로. */
function buildSets(setRows: SetRow[], slotRows: SlotRow[]) {
  const slotsBySet = new Map<string, SlotRow[]>();
  for (const slot of slotRows) {
    const bucket = slotsBySet.get(String(slot.set_id)) ?? [];
    bucket.push(slot);
    slotsBySet.set(String(slot.set_id), bucket);
  }
  return setRows.map((set) => {
    const slots = (slotsBySet.get(String(set.set_id)) ?? [])
      .slice()
      .sort((a, b) => Number(a.slot_index) - Number(b.slot_index));
    const totalSlots = Number(set.total_slots);
    const filledCount = Number(set.filled_count);
    return {
      setId: String(set.set_id),
      slug: set.slug,
      title: set.title,
      subtitle: set.subtitle,
      template: set.template,
      tier: set.tier,
      regionScope: set.region_scope,
      status: set.status,
      publishedAt: toIso(set.published_at),
      expiresAt: toIso(set.expires_at),
      daysRemaining: daysRemaining(set.expires_at),
      totalSlots,
      filledCount,
      completed: totalSlots > 0 && filledCount >= totalSlots,
      slots: slots.map(mapSlot),
    };
  });
}

const SET_SELECT_SQL = `
  SELECT cs.id AS set_id, cs.slug, cs.title, cs.subtitle, cs.template, cs.tier,
         cs.region_scope, cs.status, cs.published_at, cs.expires_at,
         (SELECT COUNT(*) FROM collection_set_slots s WHERE s.set_id = cs.id) AS total_slots,
         (SELECT COUNT(*) FROM user_collection_progress p
           WHERE p.user_id = $1 AND p.set_id = cs.id) AS filled_count
  FROM collection_sets cs
`;

/**
 * 슬롯 + 내 진행 + 실루엣 대표 이미지.
 * 채운 슬롯은 실제 카드 정보를, 빈 슬롯은 힌트와 티저 이미지만 노출한다.
 */
const SLOT_SELECT_SQL = `
  SELECT slot.set_id, slot.slot_index, slot.hint_text,
         teaser.image_url AS teaser_image_url,
         progress.event_id AS filled_event_id,
         progress.source AS filled_source,
         progress.filled_at,
         filled.title, filled.display_title, filled.main_category,
         filled.region, filled.venue, filled.image_url,
         filled.start_at, filled.end_at
  FROM collection_set_slots slot
  LEFT JOIN user_collection_progress progress
    ON progress.set_id = slot.set_id
   AND progress.slot_index = slot.slot_index
   AND progress.user_id = $1
  LEFT JOIN canonical_events filled
    ON filled.id::text = progress.event_id
  LEFT JOIN canonical_events teaser
    ON teaser.id::text = slot.teaser_event_id
   AND teaser.is_deleted = false
  WHERE slot.set_id = ANY($2::uuid[])
`;

/**
 * GET /api/collections — 활성 세트 + 내 진행.
 * `region` 쿼리(예: 서울)를 주면 그 지역 세트와 전국 세트만 남긴다.
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const region = typeof req.query.region === 'string' ? req.query.region.trim() : '';

  try {
    const { rows: allSetRows } = await pool.query<SetRow>(
      `${SET_SELECT_SQL}
       WHERE cs.status = 'active'
         AND cs.published_at <= NOW()
         AND cs.expires_at > NOW()
         AND ($2 = '' OR cs.region_scope IS NULL OR cs.region_scope = $2)
       ORDER BY cs.published_at DESC, cs.slug
       LIMIT ${SET_FETCH_LIMIT}`,
      [userId, region],
    );
    // 이미 시작한 세트를 먼저 남긴다 — 상한에 걸려 진행 중 세트가 잘리면 완성 동선이 끊긴다.
    const byProgressThenRecent = (a: SetRow, b: SetRow) => Number(b.filled_count) - Number(a.filled_count);
    const setRows = [
      ...allSetRows.filter((row) => row.region_scope != null).sort(byProgressThenRecent).slice(0, MAX_REGION_SETS),
      ...allSetRows.filter((row) => row.region_scope == null).sort(byProgressThenRecent).slice(0, MAX_NATIONAL_SETS),
    ];
    if (setRows.length === 0) {
      return res.json({
        sets: [],
        activeSetCount: 0,
        nearCompletion: null,
        completionBonusTickets: COLLECTION_COMPLETION_BONUS_TICKETS,
      });
    }

    const setIds = setRows.map((row) => String(row.set_id));
    const { rows: slotRows } = await pool.query<SlotRow>(SLOT_SELECT_SQL, [userId, setIds]);
    const sets = buildSets(setRows, slotRows);

    // 홈 훅용 요약: 완성에 가장 가까운(남은 슬롯이 가장 적은) 진행 중 세트 1개.
    const nearCompletion = sets
      .filter((set) => !set.completed && set.filledCount > 0)
      .sort((a, b) => (a.totalSlots - a.filledCount) - (b.totalSlots - b.filledCount))[0] ?? null;

    return res.json({
      sets,
      activeSetCount: sets.length,
      nearCompletion: nearCompletion
        ? {
          setId: nearCompletion.setId,
          title: nearCompletion.title,
          filled: nearCompletion.filledCount,
          total: nearCompletion.totalSlots,
        }
        : null,
      // 완성 보상 표기용(프론트 하드코딩 방지 — 서버가 단일 소스).
      completionBonusTickets: COLLECTION_COMPLETION_BONUS_TICKETS,
    });
  } catch (err) {
    console.error('[Collections] list error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/** GET /api/collections/badges — 획득 배지. `/:setId`보다 먼저 선언해야 slug로 안 먹힌다. */
router.get('/badges', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  try {
    const { rows } = await pool.query<{
      badge_key: string;
      set_id: string | null;
      tier: string;
      title: string;
      awarded_at: string | Date;
    }>(
      `SELECT badge_key, set_id, tier, title, awarded_at
       FROM user_collection_badges
       WHERE user_id = $1
       ORDER BY awarded_at DESC`,
      [userId],
    );
    return res.json({
      badges: rows.map((row) => ({
        badgeKey: row.badge_key,
        setId: row.set_id ? String(row.set_id) : null,
        tier: row.tier,
        title: row.title,
        awardedAt: toIso(row.awarded_at),
      })),
    });
  } catch (err) {
    console.error('[Collections] badges error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/** GET /api/collections/:setId — 세트 상세(만료·조기마감 세트도 아카이브로 조회 가능). */
router.get('/:setId', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const setId = String(req.params.setId ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(setId)) {
    return res.status(400).json({ error: 'INVALID_SET_ID' });
  }

  try {
    const { rows: setRows } = await pool.query<SetRow>(
      `${SET_SELECT_SQL} WHERE cs.id = $2::uuid`,
      [userId, setId],
    );
    const set = setRows[0];
    if (!set) return res.status(404).json({ error: 'SET_NOT_FOUND' });

    const { rows: slotRows } = await pool.query<SlotRow>(SLOT_SELECT_SQL, [userId, [setId]]);
    const [built] = buildSets([set], slotRows);

    const { rows: badgeRows } = await pool.query<{ badge_key: string; awarded_at: string | Date }>(
      `SELECT badge_key, awarded_at
       FROM user_collection_badges
       WHERE user_id = $1 AND set_id = $2::uuid
       LIMIT 1`,
      [userId, setId],
    );
    const badge = badgeRows[0];

    return res.json({
      ...built,
      badge: badge
        ? { badgeKey: badge.badge_key, awardedAt: toIso(badge.awarded_at) }
        : null,
      completionBonusTickets: COLLECTION_COMPLETION_BONUS_TICKETS,
    });
  } catch (err) {
    console.error('[Collections] detail error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
