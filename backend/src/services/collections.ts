import type { PoolClient } from 'pg';
import { normalizedCategorySql } from './cardCategory';

/**
 * 테마 컬렉션(스펙 2026-07-19 §4).
 *
 * 진행·배지는 오직 `/v2/open` 트랜잭션 안에서 서버가 기록한다 — 클라 쓰기 경로가 없어
 * 위변조 면적이 0이다. 슬롯은 특정 이벤트 고정이 아니라 조건(match_rule) 매칭이라,
 * 세트 발행 후 새로 유입된 이벤트로도 채울 수 있다.
 */

export type CollectionFillSource = 'open' | 'mystery';

/**
 * 세트 완성 보너스 티켓(2026-07-23 사용자 결정 — 배지만으론 허전).
 * 토스포인트 직접 지급이 아니라 티켓인 이유: 지급은 클라 SDK 경로라 서버가 완성 시점에
 * 돈을 쏠 수 없고, 티켓은 어차피 포인트 뽑기로 환전되는 재화라 경제 왜곡 없이 서버 권위로
 * 지급할 수 있다. 멱등 앵커 = 세트 배지 PK(user_id, badge_key) 신규 INSERT 성공.
 */
export const COLLECTION_COMPLETION_BONUS_TICKETS = 5;

/** 이 오픈으로 실제 채워진 세트만 담는다(안 채운 세트는 응답에 넣지 않는다). */
export type CollectionProgressEntry = {
  setId: string;
  slug: string;
  title: string;
  filledSlotIndex: number;
  filledCount: number;
  totalSlots: number;
  completed: boolean;
  badgeKey?: string;
  /** 이 완성으로 새로 지급된 보너스 티켓(배지 재수여 시엔 없음). */
  bonusTickets?: number;
};

export type CollectionBadge = {
  badgeKey: string;
  setId: string | null;
  tier: string;
  title: string;
  awardedAt: string;
};

/** 세트 3개·10개 완성 메타 배지(스펙 §4.4). 히든 발견 마일스톤은 히든 장부가 생기면 추가. */
const SET_COUNT_MILESTONES: Array<{ threshold: number; badgeKey: string; title: string }> = [
  { threshold: 3, badgeKey: 'milestone:sets-3', title: '컬렉터 · 세트 3개 완성' },
  { threshold: 10, badgeKey: 'milestone:sets-10', title: '아카이비스트 · 세트 10개 완성' },
];

/**
 * 슬롯 조건 ↔ 이벤트 매칭 술어(SQL).
 * match_rule 형태: `{ category, region?, district?, tags? }`
 * - category: 정규화 카테고리 완전일치(전시/공연/팝업/축제/기타)
 * - region: canonical_events.region(시·도) 완전일치
 * - district: address 부분일치("성동구") — region 컬럼이 시·도 단위라 구 단위는 주소로 좁힌다
 * - tags: derived_tags와 하나라도 겹치면 매칭(`?|`)
 * 값이 없는 키는 제약 없음으로 취급한다.
 */
export function collectionMatchSql(slotAlias: string, eventAlias: string): string {
  const rule = `${slotAlias}.match_rule`;
  return `(
    (${rule}->>'category' IS NULL OR ${eventAlias}.normalized_category = ${rule}->>'category')
    AND (${rule}->>'region' IS NULL OR ${eventAlias}.region = ${rule}->>'region')
    AND (${rule}->>'district' IS NULL OR ${eventAlias}.address ILIKE '%' || (${rule}->>'district') || '%')
    AND (
      -- ❗IS DISTINCT FROM이어야 한다. tags 키가 없으면 jsonb_typeof(NULL)=NULL이고
      -- NULL <> 'array'는 TRUE가 아니라 NULL이라, 태그 없는 규칙이 전부 매칭에 실패한다.
      jsonb_typeof(${rule}->'tags') IS DISTINCT FROM 'array'
      OR jsonb_array_length(${rule}->'tags') = 0
      OR ${eventAlias}.derived_tags ?| ARRAY(SELECT jsonb_array_elements_text(${rule}->'tags'))
    )
  )`;
}

/** 매칭에 필요한 이벤트 컬럼만 뽑는 CTE 본문. `$${paramIndex}`에 event_id(text)를 바인딩한다. */
export function collectionEventCteSql(paramIndex: number): string {
  return `SELECT id::text AS event_id,
                 ${normalizedCategorySql('main_category')} AS normalized_category,
                 region, address, derived_tags
          FROM canonical_events
          WHERE id::text = $${paramIndex}
          LIMIT 1`;
}

/** 위와 같지만 여러 후보를 한 번에 판정한다(`$${paramIndex}` = text[]). */
function collectionEventsCteSql(paramIndex: number): string {
  return `SELECT id::text AS event_id,
                 ${normalizedCategorySql('main_category')} AS normalized_category,
                 region, address, derived_tags
          FROM canonical_events
          WHERE id::text = ANY($${paramIndex}::text[])`;
}

/** 발행됐고 아직 살아 있는 세트만 진행에 관여한다(만료·조기마감 세트는 채우지 않는다). */
const ACTIVE_SET_PREDICATE = `
  cs.status = 'active'
  AND cs.published_at <= NOW()
  AND cs.expires_at > NOW()
`;

/**
 * 이 오픈이 채운 컬렉션 슬롯을 기록하고, 완성된 세트의 배지를 수여한다.
 *
 * 멱등: 슬롯 PK(user,set,slot)와 보조 unique(user,set,event), 배지 PK(user,badge_key)가
 * 모두 ON CONFLICT DO NOTHING이라 같은 오픈이 재시도돼도 중복 기록되지 않는다.
 * 호출 위치는 `grantTicketsForEvent` 이후 — 그 함수가 유저 단위 advisory lock을 이미 잡아
 * 동시 오픈끼리 경쟁하지 않는다.
 *
 * ⚠️ 실패는 오픈(티켓 지급)을 절대 되돌리면 안 된다. 컬렉션 쿼리가 그냥 throw하면
 * 트랜잭션이 aborted 상태가 되어 뒤따르는 COMMIT이 조용히 롤백되고 — 광고를 본 유저의
 * 티켓이 사라진다. 그래서 SAVEPOINT로 격리해 여기서만 되감고 빈 배열을 돌려준다.
 */
export async function applyCollectionProgress(
  client: PoolClient,
  input: { userId: string; eventId: string; source: CollectionFillSource },
): Promise<CollectionProgressEntry[]> {
  await client.query('SAVEPOINT culturecard_collection');
  try {
    const entries = await fillMatchingSlots(client, input);
    await client.query('RELEASE SAVEPOINT culturecard_collection');
    return entries;
  } catch (error: any) {
    await client.query('ROLLBACK TO SAVEPOINT culturecard_collection');
    await client.query('RELEASE SAVEPOINT culturecard_collection');
    console.error('[Collections] progress skipped:', error?.message ?? error);
    return [];
  }
}

async function fillMatchingSlots(
  client: PoolClient,
  input: { userId: string; eventId: string; source: CollectionFillSource },
): Promise<CollectionProgressEntry[]> {
  const { userId, eventId, source } = input;

  // 1) 조건에 맞는 빈 슬롯을 세트당 1개씩(가장 낮은 slot_index) 채운다.
  //    한 카드가 같은 세트의 두 슬롯을 채우지 못하게 DISTINCT ON (set_id).
  const { rows: filledRows } = await client.query<{ set_id: string; slot_index: number }>(
    `WITH ev AS (
       ${collectionEventCteSql(2)}
     ), candidate AS (
       SELECT DISTINCT ON (slot.set_id) slot.set_id, slot.slot_index
       FROM collection_set_slots slot
       JOIN collection_sets cs ON cs.id = slot.set_id
       CROSS JOIN ev
       WHERE ${ACTIVE_SET_PREDICATE}
         AND ${collectionMatchSql('slot', 'ev')}
         AND NOT EXISTS (
           SELECT 1
           FROM user_collection_progress filled
           WHERE filled.user_id = $1
             AND filled.set_id = slot.set_id
             AND (filled.slot_index = slot.slot_index OR filled.event_id = ev.event_id)
         )
       ORDER BY slot.set_id, slot.slot_index
     )
     INSERT INTO user_collection_progress (user_id, set_id, slot_index, event_id, source)
     SELECT $1, candidate.set_id, candidate.slot_index, ev.event_id, $3
     FROM candidate CROSS JOIN ev
     ON CONFLICT DO NOTHING
     RETURNING set_id, slot_index`,
    [userId, eventId, source],
  );

  if (filledRows.length === 0) return [];

  // 2) 채운 세트의 제목·진행도를 다시 읽는다.
  //    (1)의 INSERT 결과는 같은 문(statement) 안에서 안 보이므로 반드시 별도 쿼리여야 한다.
  const setIds = filledRows.map((row) => String(row.set_id));
  const { rows: setRows } = await client.query<{
    set_id: string;
    slug: string;
    title: string;
    tier: string;
    total_slots: number | string;
    filled_count: number | string;
  }>(
    `SELECT cs.id AS set_id, cs.slug, cs.title, cs.tier,
            (SELECT COUNT(*) FROM collection_set_slots s WHERE s.set_id = cs.id) AS total_slots,
            (SELECT COUNT(*) FROM user_collection_progress p
              WHERE p.user_id = $1 AND p.set_id = cs.id) AS filled_count
     FROM collection_sets cs
     WHERE cs.id = ANY($2::uuid[])`,
    [userId, setIds],
  );
  const setById = new Map(setRows.map((row) => [String(row.set_id), row]));

  const entries: CollectionProgressEntry[] = [];
  const completedSets: Array<{ setId: string; slug: string; title: string; tier: string }> = [];

  for (const filled of filledRows) {
    const set = setById.get(String(filled.set_id));
    if (!set) continue;
    const totalSlots = Number(set.total_slots);
    const filledCount = Number(set.filled_count);
    const completed = totalSlots > 0 && filledCount >= totalSlots;
    entries.push({
      setId: String(filled.set_id),
      slug: set.slug,
      title: set.title,
      filledSlotIndex: Number(filled.slot_index),
      filledCount,
      totalSlots,
      completed,
    });
    if (completed) {
      completedSets.push({
        setId: String(filled.set_id),
        slug: set.slug,
        title: set.title,
        tier: set.tier,
      });
    }
  }

  // 3) 완성 세트 배지 + 누적 마일스톤 배지(둘 다 멱등).
  for (const set of completedSets) {
    const badgeKey = `set:${set.slug}`;
    const { rowCount: badgeInserted } = await client.query(
      `INSERT INTO user_collection_badges (user_id, badge_key, set_id, tier, title)
       VALUES ($1, $2, $3::uuid, $4, $5)
       ON CONFLICT (user_id, badge_key) DO NOTHING`,
      [userId, badgeKey, set.setId, set.tier, set.title],
    );
    const entry = entries.find((item) => item.setId === set.setId);
    if (entry) entry.badgeKey = badgeKey;

    // 완성 보너스 티켓 — 배지가 "새로" 들어갔을 때만(재시도·중복 완성엔 0회).
    // user_tickets 행은 같은 트랜잭션의 grantTicketsForEvent가 보장한다.
    // 여기서 실패하면 바깥 SAVEPOINT가 컬렉션 진행째로 되감으므로 본 지급은 안전하다.
    if (badgeInserted === 1) {
      await client.query(
        `UPDATE user_tickets
         SET ticket_count = ticket_count + $2,
             total_earned = total_earned + $2,
             updated_at   = NOW()
         WHERE user_id = $1`,
        [userId, COLLECTION_COMPLETION_BONUS_TICKETS],
      );
      if (entry) entry.bonusTickets = COLLECTION_COMPLETION_BONUS_TICKETS;
    }
  }

  if (completedSets.length > 0) {
    await awardSetCountMilestones(client, userId);
  }

  return entries;
}

/**
 * "?" 슬롯 컬렉션 어시스트 후보(스펙 §3.2-1).
 * 유저가 **이미 진행 중**(1슬롯 이상 채움)인 세트의 빈 슬롯 조건에 맞는 후보만 고른다 —
 * 시작도 안 한 세트를 밀어주면 "설계된 우연"이 아니라 그냥 추천이 된다.
 *
 * 반환값은 eventId → 그 카드가 채울 수 있는 세트 중 **남은 슬롯 최솟값**.
 * 완성이 임박한 세트(스펙 §4.3 조기마감 직전 우선 공급)를 먼저 밀어주는 데 쓴다.
 *
 * /v2/today는 트랜잭션 안에서 돌기 때문에 여기서 그냥 throw하면 조회 전체가 죽는다.
 * SAVEPOINT로 격리해 실패 시 빈 맵으로 조용히 물러난다(어시스트는 부가 기능).
 */
export async function findCollectionAssistCandidates(
  client: PoolClient,
  input: { userId: string; eventIds: string[] },
): Promise<Map<string, number>> {
  const { userId, eventIds } = input;
  if (eventIds.length === 0) return new Map();

  await client.query('SAVEPOINT culturecard_assist');
  try {
    const { rows } = await client.query<{ event_id: string; remaining: number | string }>(
      `WITH ev AS (
         ${collectionEventsCteSql(2)}
       ), in_progress AS (
         SELECT cs.id AS set_id,
                (SELECT COUNT(*) FROM collection_set_slots s WHERE s.set_id = cs.id)
                  - (SELECT COUNT(*) FROM user_collection_progress p
                      WHERE p.user_id = $1 AND p.set_id = cs.id) AS remaining
         FROM collection_sets cs
         WHERE ${ACTIVE_SET_PREDICATE}
           AND EXISTS (
             SELECT 1 FROM user_collection_progress started
             WHERE started.user_id = $1 AND started.set_id = cs.id
           )
       )
       SELECT ev.event_id, MIN(in_progress.remaining)::int AS remaining
       FROM collection_set_slots slot
       JOIN in_progress ON in_progress.set_id = slot.set_id
       CROSS JOIN ev
       WHERE in_progress.remaining > 0
         AND ${collectionMatchSql('slot', 'ev')}
         AND NOT EXISTS (
           SELECT 1
           FROM user_collection_progress filled
           WHERE filled.user_id = $1
             AND filled.set_id = slot.set_id
             AND (filled.slot_index = slot.slot_index OR filled.event_id = ev.event_id)
         )
       GROUP BY ev.event_id`,
      [userId, eventIds],
    );
    await client.query('RELEASE SAVEPOINT culturecard_assist');
    return new Map(rows.map((row) => [String(row.event_id), Number(row.remaining)]));
  } catch (error: any) {
    await client.query('ROLLBACK TO SAVEPOINT culturecard_assist');
    await client.query('RELEASE SAVEPOINT culturecard_assist');
    console.error('[Collections] assist lookup skipped:', error?.message ?? error);
    return new Map();
  }
}

/** 세트 배지 개수 기준 메타 배지. 세트 배지만 세고 마일스톤끼리는 세지 않는다. */
/**
 * 완성(모든 슬롯 채움)됐는데 배지가 없는 세트에 배지+보너스를 소급 지급한다(자가치유, 멱등).
 * 완성 open의 배지 발급이 순간 장애(배포 중 등)로 유실돼도 다음 컬렉션 조회에서 정정된다.
 * 배지 PK(user, badge_key)가 멱등 앵커라 중복 지급 불가. 반환: 새로 지급한 배지 수.
 */
export async function backfillCompletedSetBadges(client: PoolClient, userId: string): Promise<number> {
  const { rows: pending } = await client.query<{ set_id: string; slug: string; title: string; tier: string }>(
    `SELECT cs.id AS set_id, cs.slug, cs.title, cs.tier
     FROM collection_sets cs
     WHERE (SELECT COUNT(*) FROM collection_set_slots s WHERE s.set_id = cs.id) > 0
       AND (SELECT COUNT(*) FROM user_collection_progress p WHERE p.user_id = $1 AND p.set_id = cs.id)
           >= (SELECT COUNT(*) FROM collection_set_slots s WHERE s.set_id = cs.id)
       AND NOT EXISTS (
         SELECT 1 FROM user_collection_badges b
         WHERE b.user_id = $1 AND b.badge_key = 'set:' || cs.slug
       )`,
    [userId],
  );
  let granted = 0;
  for (const set of pending) {
    const { rowCount } = await client.query(
      `INSERT INTO user_collection_badges (user_id, badge_key, set_id, tier, title)
       VALUES ($1, $2, $3::uuid, $4, $5)
       ON CONFLICT (user_id, badge_key) DO NOTHING`,
      [userId, `set:${set.slug}`, set.set_id, set.tier, set.title],
    );
    if (rowCount === 1) {
      granted += 1;
      await client.query(
        `UPDATE user_tickets
         SET ticket_count = ticket_count + $2, total_earned = total_earned + $2, updated_at = NOW()
         WHERE user_id = $1`,
        [userId, COLLECTION_COMPLETION_BONUS_TICKETS],
      );
    }
  }
  if (granted > 0) await awardSetCountMilestones(client, userId);
  return granted;
}

async function awardSetCountMilestones(client: PoolClient, userId: string): Promise<void> {
  const { rows } = await client.query<{ count: number | string }>(
    `SELECT COUNT(*)::int AS count
     FROM user_collection_badges
     WHERE user_id = $1 AND badge_key LIKE 'set:%'`,
    [userId],
  );
  const setBadgeCount = Number(rows[0]?.count ?? 0);
  for (const milestone of SET_COUNT_MILESTONES) {
    if (setBadgeCount < milestone.threshold) continue;
    await client.query(
      `INSERT INTO user_collection_badges (user_id, badge_key, set_id, tier, title)
       VALUES ($1, $2, NULL, 'normal', $3)
       ON CONFLICT (user_id, badge_key) DO NOTHING`,
      [userId, milestone.badgeKey, milestone.title],
    );
  }
}
