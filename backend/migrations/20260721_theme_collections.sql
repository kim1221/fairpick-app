-- 테마 컬렉션(스펙 2026-07-19 §4·§5.3): 조건 매칭 슬롯 세트 + 진행 + 배지.
-- 진행/배지는 서버(/v2/open 트랜잭션)만 기록한다 — 클라 쓰기 API 없음.
-- 접근은 전부 service_role(backend)로만. RLS deny-all(정책 미정의) 패턴은 기존 테이블과 동일.

-- ── 세트 정의(주간 배치가 발행) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS collection_sets (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 템플릿+지역+주차로 결정적으로 만든 멱등 키. 배치 재실행이 중복 발행하지 않는다.
  slug         TEXT        NOT NULL UNIQUE,
  title        TEXT        NOT NULL,
  subtitle     TEXT,
  template     TEXT        NOT NULL CHECK (template IN ('neighborhood', 'season', 'deepdive', 'buzz')),
  tier         TEXT        NOT NULL DEFAULT 'normal' CHECK (tier IN ('normal', 'seasonal', 'hidden')),
  -- 지역 세트의 매칭 지역. 전국/시즌 세트는 NULL.
  region_scope TEXT,
  -- 생성 당시 룰 파라미터(재현·디버깅용).
  rule_snapshot JSONB      NOT NULL DEFAULT '{}'::jsonb,
  status       TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'ended_early')),
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE collection_sets IS
  '테마 컬렉션 세트 정의. 주 1회 배치가 slug 멱등으로 발행하고 28일 뒤 만료된다.';
COMMENT ON COLUMN collection_sets.slug IS
  '템플릿+지역+주차 결정적 키 — 배치 재실행 멱등(ON CONFLICT DO NOTHING).';

-- 활성 세트 조회(홈/컬렉션 탭)는 status+expires_at으로 잘라 읽는다.
CREATE INDEX IF NOT EXISTS idx_collection_sets_active
  ON collection_sets (status, expires_at DESC);
-- 지역 세트 필터(좌표 → region_scope 매칭).
CREATE INDEX IF NOT EXISTS idx_collection_sets_region
  ON collection_sets (region_scope)
  WHERE region_scope IS NOT NULL;

-- ── 슬롯 조건(특정 이벤트 고정이 아니라 조건 매칭) ────────────────────────────
CREATE TABLE IF NOT EXISTS collection_set_slots (
  set_id          UUID    NOT NULL REFERENCES collection_sets(id) ON DELETE CASCADE,
  slot_index      SMALLINT NOT NULL,
  -- { category, regionScope?, tags? } — 채움 인정은 이 조건으로만 판정한다.
  match_rule      JSONB   NOT NULL,
  hint_text       TEXT    NOT NULL,
  -- 실루엣 대표 이벤트(티저 전용). 만료되면 배치가 활성 이벤트로 교체한다.
  teaser_event_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (set_id, slot_index)
);

COMMENT ON COLUMN collection_set_slots.teaser_event_id IS
  '실루엣 미리보기용 대표 이벤트일 뿐 — 채움 인정 기준이 아니다(조건 매칭이 기준).';

-- ── 유저 진행(서버만 기록) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_collection_progress (
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id     UUID        NOT NULL REFERENCES collection_sets(id) ON DELETE CASCADE,
  slot_index SMALLINT    NOT NULL,
  event_id   TEXT        NOT NULL,
  -- 'open' = 유저가 고른 카테고리 슬롯, 'mystery' = "?" 슬롯(어시스트 효과 측정용).
  source     TEXT        NOT NULL DEFAULT 'open' CHECK (source IN ('open', 'mystery')),
  filled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 한 슬롯은 한 번만 채워진다(재오픈·재시도 멱등).
  PRIMARY KEY (user_id, set_id, slot_index)
);

-- 한 세트 안에서 1카드 = 1슬롯. 같은 카드가 같은 세트의 다른 슬롯을 또 채우지 못한다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ucp_user_set_event
  ON user_collection_progress (user_id, set_id, event_id);
-- 진행 조회(컬렉션 탭·? 어시스트)는 유저 단위로 읽는다.
CREATE INDEX IF NOT EXISTS idx_ucp_user_set
  ON user_collection_progress (user_id, set_id);

COMMENT ON TABLE user_collection_progress IS
  '컬렉션 슬롯 채움 기록. /v2/open 트랜잭션 안에서만 기록되며 클라 쓰기 경로가 없다.';

-- ── 배지(완성 보상 — 티켓·실돈 아님) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_collection_badges (
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 세트 배지는 세트 slug, 마일스톤 배지는 'milestone:*' 형태의 고정 키.
  badge_key  TEXT        NOT NULL,
  set_id     UUID        REFERENCES collection_sets(id) ON DELETE SET NULL,
  tier       TEXT        NOT NULL DEFAULT 'normal' CHECK (tier IN ('normal', 'seasonal', 'hidden')),
  title      TEXT        NOT NULL,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 지급 멱등: 같은 배지는 두 번 수여되지 않는다(ON CONFLICT DO NOTHING).
  PRIMARY KEY (user_id, badge_key)
);

CREATE INDEX IF NOT EXISTS idx_ucb_user_awarded
  ON user_collection_badges (user_id, awarded_at DESC);

COMMENT ON TABLE user_collection_badges IS
  '컬렉션 완성 배지. 티켓·포인트로 환전 불가(검수 안전) — 보관·표시 전용.';

-- ── RLS deny-all + service_role ─────────────────────────────────────────────
-- 정책을 만들지 않아 anon/authenticated는 어떤 행도 읽지 못한다. 백엔드는 service_role.
ALTER TABLE collection_sets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_set_slots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_collection_progress  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_collection_badges    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE collection_sets          FROM PUBLIC;
REVOKE ALL ON TABLE collection_set_slots     FROM PUBLIC;
REVOKE ALL ON TABLE user_collection_progress FROM PUBLIC;
REVOKE ALL ON TABLE user_collection_badges   FROM PUBLIC;

DO $$
DECLARE
  target_table TEXT;
  target_role  TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'collection_sets',
    'collection_set_slots',
    'user_collection_progress',
    'user_collection_badges'
  ] LOOP
    FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', target_table, target_role);
      END IF;
    END LOOP;
  END LOOP;
END
$$;
