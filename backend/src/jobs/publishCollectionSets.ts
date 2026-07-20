import { pool } from '../db';
import { normalizedCategorySql } from '../services/cardCategory';

/**
 * 테마 컬렉션 주간 발행 배치(스펙 §4.3) — 수동 큐레이션 없음.
 *
 * 매주 월요일(KST) 실행. slug가 (템플릿·지역·주차)로 결정되므로 같은 주에 여러 번 돌려도
 * 새 세트를 만들지 않는다(멱등). 하는 일은 세 가지다.
 *   1. 만료된 세트 정리(active → ended)
 *   2. 이번 주 세트 발행(달성 가능성이 담보될 때만)
 *   3. 죽은 티저 이벤트 교체
 */

const SET_LIFETIME_DAYS = 28;
/** 지역(동네) 세트는 상위 3곳까지 — 스펙 §4.3 노출 상한. */
const MAX_NEIGHBORHOOD_SETS = 3;
/** 슬롯을 인정하려면 조건 만족 이벤트가 (슬롯 수 × 이 배수) 이상이어야 한다. */
const POOL_SAFETY_FACTOR = 2;

/**
 * 슬롯 매칭 규칙. `collection_set_slots.match_rule`에 그대로 저장되고
 * 런타임 매칭(services/collections.ts)이 같은 키를 읽는다.
 */
export type MatchRule = {
  category: string;
  region?: string;
  district?: string;
  tags?: string[];
};

type SlotSpec = {
  rule: MatchRule;
  count: number;
  hint: string;
};

type SlotPlan = {
  slotIndex: number;
  matchRule: MatchRule;
  hintText: string;
  teaserEventId: string | null;
};

type SetPlan = {
  slug: string;
  title: string;
  subtitle: string | null;
  template: 'neighborhood' | 'season' | 'deepdive' | 'buzz';
  tier: 'normal' | 'seasonal';
  regionScope: string | null;
  ruleSnapshot: Record<string, unknown>;
  slots: SlotPlan[];
};

export type PublishCollectionSetsResult = {
  weekKey: string;
  endedSets: number;
  publishedSets: number;
  skippedPlans: number;
  refreshedTeasers: number;
  publishedSlugs: string[];
};

/** ISO 주차 기반 주 키(예: 2026-W30). 같은 주 재실행이 같은 slug를 만들게 한다. */
export function kstWeekKey(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const target = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
  // ISO-8601: 목요일이 속한 해가 그 주의 해.
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** 발행 시점의 계절 키워드(시즌 세트 태그 매칭용). */
export function seasonProfile(now: Date = new Date()): { key: string; label: string; tags: string[] } {
  const month = new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCMonth() + 1;
  if (month >= 3 && month <= 5) return { key: 'spring', label: '봄', tags: ['봄', '야외', '나들이'] };
  if (month >= 6 && month <= 8) return { key: 'summer', label: '여름', tags: ['실내', '시원한', '여름'] };
  if (month >= 9 && month <= 11) return { key: 'autumn', label: '가을', tags: ['가을', '야외', '단풍'] };
  return { key: 'winter', label: '겨울', tags: ['실내', '따뜻한', '겨울'] };
}

/**
 * 주소에서 동네 단위를 뽑는다.
 * 구/군을 우선하고("서울특별시 성동구 …" → 성동구), 구가 없는 중소도시는 시로 물러난다.
 * ⚠️ 광역시·특별시는 시·도 자체라 동네가 아니다 — 이걸 안 걸러내면 "서울특별시 컬렉션"이 생긴다.
 */
const DISTRICT_SQL = `COALESCE(
  (regexp_match(event.address, '([가-힣]{2,10}(?:구|군))(?:\\s|\\)|$)'))[1],
  NULLIF(
    (regexp_match(event.address, '([가-힣]{2,8}시)(?:\\s|$)'))[1],
    ''
  )
)`;

/**
 * 세트에 쓸 수 있는 이벤트 자격(스펙 §4.3):
 * 활성 · 세트 만료 이후까지 열림 · 이미지 있음 · 좌표·장소 있음.
 * (품질 점수 컬럼이 없어 "good 이상"은 이미지+좌표+장소 보유로 근사한다.)
 * `$1`에 세트 만료일(date)을 바인딩한다.
 */
const ELIGIBLE_EVENT_SQL = `
  event.is_deleted = false
  AND event.image_url IS NOT NULL
  AND event.lat IS NOT NULL AND event.lng IS NOT NULL
  AND event.venue IS NOT NULL
  AND (event.end_at IS NULL OR event.end_at >= $1::date)
`;

/** 매치 규칙 → WHERE 조각. `params`에 바인딩 값을 밀어 넣는다(순서 = $n). */
function rulePredicateSql(rule: MatchRule, params: unknown[]): string {
  const parts: string[] = [];
  params.push(rule.category);
  parts.push(`${normalizedCategorySql('event.main_category')} = $${params.length}`);
  if (rule.region) {
    params.push(rule.region);
    parts.push(`event.region = $${params.length}`);
  }
  if (rule.district) {
    params.push(`%${rule.district}%`);
    parts.push(`event.address ILIKE $${params.length}`);
  }
  if (rule.tags?.length) {
    params.push(rule.tags);
    parts.push(`event.derived_tags ?| $${params.length}::text[]`);
  }
  return parts.join(' AND ');
}

/**
 * 규칙에 맞는 이벤트 수와 티저 후보를 한 번에 읽는다.
 * ❗카운트는 반드시 태그까지 적용한 결과여야 한다 — 카테고리만 세면
 * "여름 전시 4곳"처럼 태그로 좁혀지는 세트가 실제로는 못 깨는 미션이 된다.
 */
async function ruleStats(
  rule: MatchRule,
  expiresOn: string,
  teaserLimit: number,
): Promise<{ total: number; teaserIds: string[] }> {
  const params: unknown[] = [expiresOn];
  const predicate = rulePredicateSql(rule, params);
  params.push(teaserLimit);
  const { rows } = await pool.query<{ total: number | string; event_id: string }>(
    `SELECT COUNT(*) OVER () AS total, event.id::text AS event_id
     FROM canonical_events event
     WHERE ${ELIGIBLE_EVENT_SQL} AND ${predicate}
     ORDER BY event.buzz_score DESC NULLS LAST, event.id
     LIMIT $${params.length}`,
    params,
  );
  return {
    total: rows.length > 0 ? Number(rows[0]!.total) : 0,
    teaserIds: rows.map((row) => String(row.event_id)),
  };
}

/**
 * 슬롯 스펙들을 검증하고 SlotPlan으로 편다.
 * 하나라도 (슬롯 수 × 2) 미만이면 null — 못 깨는 미션은 발행하지 않는다.
 * 티저는 슬롯마다 다른 이벤트를 배정한다(같은 실루엣 4개가 늘어서지 않게).
 */
async function planSlots(specs: SlotSpec[], expiresOn: string): Promise<SlotPlan[] | null> {
  const slots: SlotPlan[] = [];
  const usedTeasers = new Set<string>();

  for (const spec of specs) {
    const { total, teaserIds } = await ruleStats(spec.rule, expiresOn, spec.count * POOL_SAFETY_FACTOR);
    if (total < spec.count * POOL_SAFETY_FACTOR) return null;
    for (let index = 0; index < spec.count; index += 1) {
      const teaserEventId = teaserIds.find((id) => !usedTeasers.has(id)) ?? teaserIds[0] ?? null;
      if (teaserEventId) usedTeasers.add(teaserEventId);
      slots.push({
        slotIndex: slots.length,
        matchRule: spec.rule,
        hintText: spec.hint,
        teaserEventId,
      });
    }
  }
  return slots.length > 0 ? slots : null;
}

type DistrictRow = { region: string; district: string; event_count: number | string };

/** 동네 세트 후보 지역 — 자격 이벤트가 많은 구/군 순. */
async function loadTopDistricts(expiresOn: string): Promise<DistrictRow[]> {
  const { rows } = await pool.query<DistrictRow>(
    `SELECT event.region, ${DISTRICT_SQL} AS district, COUNT(*)::int AS event_count
     FROM canonical_events event
     WHERE ${ELIGIBLE_EVENT_SQL}
       AND event.region IS NOT NULL
       AND event.address IS NOT NULL
     GROUP BY 1, 2
     HAVING ${DISTRICT_SQL.replace(/event\./g, 'event.')} IS NOT NULL
     ORDER BY 3 DESC
     LIMIT 40`,
    [expiresOn],
  );
  // 광역시·특별시·도는 동네가 아니다(시 폴백이 잡아온 시·도 이름 제거).
  return rows.filter((row) => !/(광역시|특별시|특별자치시|특별자치도)$/.test(row.district));
}

/** 이번 주에 발행할 세트 계획. 재료가 모자란 계획은 스스로 빠진다. */
export async function buildSetPlans(
  expiresOn: string,
  weekKey: string,
  now: Date = new Date(),
): Promise<SetPlan[]> {
  const plans: SetPlan[] = [];
  const season = seasonProfile(now);

  // ── 동네 세트: 카테고리 횡단(팝업2+전시1+공연1)으로 선택 다변화 유도 ──
  const districts = await loadTopDistricts(expiresOn);
  for (const { region, district } of districts) {
    if (plans.length >= MAX_NEIGHBORHOOD_SETS) break;
    const slots = await planSlots([
      { rule: { category: '팝업', region, district }, count: 2, hint: `${district}의 어느 팝업` },
      { rule: { category: '전시', region, district }, count: 1, hint: `${district}의 어느 전시` },
      { rule: { category: '공연', region, district }, count: 1, hint: `${district}의 어느 공연` },
    ], expiresOn);
    if (!slots) continue;
    plans.push({
      slug: `neighborhood-${region}-${district}-${weekKey}`,
      title: `${district} 컬렉션`,
      subtitle: `${district}의 문화 ${slots.length}곳을 모아요`,
      template: 'neighborhood',
      tier: 'normal',
      regionScope: region,
      ruleSnapshot: { weekKey, region, district, template: 'neighborhood' },
      slots,
    });
  }

  // ── 시즌 세트(전국): 계절 태그 × 전시 4슬롯. 기간 한정이라 seasonal 등급. ──
  const seasonSlots = await planSlots([
    {
      rule: { category: '전시', tags: season.tags },
      count: 4,
      hint: `${season.label}에 어울리는 어느 전시`,
    },
  ], expiresOn);
  if (seasonSlots) {
    plans.push({
      slug: `season-${season.key}-${weekKey}`,
      title: `${season.label} 전시 4곳`,
      subtitle: `${season.label}에 어울리는 전시를 모아요`,
      template: 'season',
      tier: 'seasonal',
      regionScope: null,
      ruleSnapshot: { weekKey, season: season.key, tags: season.tags, template: 'season' },
      slots: seasonSlots,
    });
  }

  // ── 딥다이브 세트: 한 지역 × 한 카테고리 5슬롯 ──
  const deepdiveRegion = districts[0]?.region ?? null;
  if (deepdiveRegion) {
    const deepdiveSlots = await planSlots([
      {
        rule: { category: '공연', region: deepdiveRegion },
        count: 5,
        hint: `${deepdiveRegion}의 어느 공연`,
      },
    ], expiresOn);
    if (deepdiveSlots) {
      plans.push({
        slug: `deepdive-공연-${deepdiveRegion}-${weekKey}`,
        title: `${deepdiveRegion} 공연 5곳`,
        subtitle: `${deepdiveRegion}에서 열리는 공연을 모아요`,
        template: 'deepdive',
        tier: 'normal',
        regionScope: deepdiveRegion,
        ruleSnapshot: { weekKey, region: deepdiveRegion, category: '공연', template: 'deepdive' },
        slots: deepdiveSlots,
      });
    }
  }

  // ── 버즈 세트(전국): 지금 뜨는 팝업 4곳 ──
  const buzzSlots = await planSlots([
    { rule: { category: '팝업' }, count: 4, hint: '지금 뜨는 어느 팝업' },
  ], expiresOn);
  if (buzzSlots) {
    plans.push({
      slug: `buzz-popup-${weekKey}`,
      title: '지금 뜨는 팝업 4곳',
      subtitle: '요즘 이야기되는 팝업을 모아요',
      template: 'buzz',
      tier: 'normal',
      regionScope: null,
      ruleSnapshot: { weekKey, template: 'buzz' },
      slots: buzzSlots,
    });
  }

  return plans;
}

export async function runPublishCollectionSets(): Promise<PublishCollectionSetsResult> {
  const now = new Date();
  const weekKey = kstWeekKey(now);
  const expiresAt = new Date(now.getTime() + SET_LIFETIME_DAYS * 24 * 60 * 60 * 1000);
  const expiresOn = expiresAt.toISOString().slice(0, 10);

  // 1) 만료 정리 — 완성 못 해도 페널티 없이 아카이브로 넘긴다.
  const ended = await pool.query(
    `UPDATE collection_sets
     SET status = 'ended', updated_at = NOW()
     WHERE status = 'active' AND expires_at <= NOW()`,
  );

  // 2) 이번 주 세트 발행.
  const plans = await buildSetPlans(expiresOn, weekKey, now);
  const publishedSlugs: string[] = [];
  let skippedPlans = 0;

  for (const plan of plans) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO collection_sets
           (slug, title, subtitle, template, tier, region_scope, rule_snapshot, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)
         ON CONFLICT (slug) DO NOTHING
         RETURNING id`,
        [
          plan.slug,
          plan.title,
          plan.subtitle,
          plan.template,
          plan.tier,
          plan.regionScope,
          JSON.stringify(plan.ruleSnapshot),
          expiresAt.toISOString(),
        ],
      );
      const setId = rows[0]?.id;
      if (!setId) {
        // 같은 주에 이미 발행됨 — 멱등 재실행.
        await client.query('ROLLBACK');
        skippedPlans += 1;
        continue;
      }

      for (const slot of plan.slots) {
        await client.query(
          `INSERT INTO collection_set_slots
             (set_id, slot_index, match_rule, hint_text, teaser_event_id)
           VALUES ($1::uuid, $2, $3::jsonb, $4, $5)
           ON CONFLICT (set_id, slot_index) DO NOTHING`,
          [setId, slot.slotIndex, JSON.stringify(slot.matchRule), slot.hintText, slot.teaserEventId],
        );
      }
      await client.query('COMMIT');
      publishedSlugs.push(plan.slug);
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error(`[Collections] publish failed for ${plan.slug}:`, error?.message ?? error);
      skippedPlans += 1;
    } finally {
      client.release();
    }
  }

  // 3) 죽은 티저 교체 — 실루엣이 사라진 이벤트를 가리키면 빈 칸이 밋밋해진다.
  const refreshed = await pool.query(
    `UPDATE collection_set_slots slot
     SET teaser_event_id = replacement.event_id, updated_at = NOW()
     FROM (
       SELECT s.set_id, s.slot_index,
              (SELECT event.id::text
                 FROM canonical_events event
                WHERE ${ELIGIBLE_EVENT_SQL}
                  AND ${normalizedCategorySql('event.main_category')} = s.match_rule->>'category'
                  AND (s.match_rule->>'region' IS NULL OR event.region = s.match_rule->>'region')
                  AND (s.match_rule->>'district' IS NULL OR event.address ILIKE '%' || (s.match_rule->>'district') || '%')
                  -- 실루엣도 태그 조건을 따라야 시즌 세트 힌트가 엉뚱한 카드를 가리키지 않는다.
                  -- (tags 키가 없으면 jsonb_typeof가 NULL이라 IS DISTINCT FROM으로 비교한다.)
                  AND (
                    jsonb_typeof(s.match_rule->'tags') IS DISTINCT FROM 'array'
                    OR jsonb_array_length(s.match_rule->'tags') = 0
                    OR event.derived_tags ?| ARRAY(SELECT jsonb_array_elements_text(s.match_rule->'tags'))
                  )
                ORDER BY event.buzz_score DESC NULLS LAST, event.id
                LIMIT 1) AS event_id
         FROM collection_set_slots s
         JOIN collection_sets cs ON cs.id = s.set_id
        WHERE cs.status = 'active'
          AND (
            s.teaser_event_id IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM canonical_events alive
              WHERE alive.id::text = s.teaser_event_id AND alive.is_deleted = false
            )
          )
     ) AS replacement
     WHERE slot.set_id = replacement.set_id
       AND slot.slot_index = replacement.slot_index
       AND replacement.event_id IS NOT NULL`,
    [expiresOn],
  );

  const result: PublishCollectionSetsResult = {
    weekKey,
    endedSets: ended.rowCount ?? 0,
    publishedSets: publishedSlugs.length,
    skippedPlans,
    refreshedTeasers: refreshed.rowCount ?? 0,
    publishedSlugs,
  };
  console.log('[Collections] weekly publish:', JSON.stringify(result));
  return result;
}
