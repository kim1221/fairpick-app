-- ============================================================
-- 이벤트 수집 메타데이터 컬럼 추가 (1단계 MVP)
-- 목적: 새로 수집된 이벤트 식별, 등록 경로 추적, 검토 필요 플래그
-- ============================================================

-- ① 컬럼 추가 (DEFAULT 없음 — 아래 백필 쿼리에서 명시적으로 채움)
ALTER TABLE canonical_events
  ADD COLUMN IF NOT EXISTS created_source         TEXT,
  ADD COLUMN IF NOT EXISTS first_collected_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_collected_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_collector_source   TEXT,
  ADD COLUMN IF NOT EXISTS ingest_change_type      TEXT,
  ADD COLUMN IF NOT EXISTS needs_review            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_reason           TEXT[];

-- ② 필터 성능 인덱스
CREATE INDEX IF NOT EXISTS idx_ce_last_collected_at  ON canonical_events (last_collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_ce_needs_review       ON canonical_events (needs_review) WHERE needs_review = true;
CREATE INDEX IF NOT EXISTS idx_ce_created_source     ON canonical_events (created_source);
CREATE INDEX IF NOT EXISTS idx_ce_ingest_change_type ON canonical_events (ingest_change_type);

-- ③ 백필: created_source
--    기존 이벤트는 공공 API 수집분이므로 public_api로 명시 세팅
UPDATE canonical_events
SET created_source = 'public_api'
WHERE created_source IS NULL;

-- ④ 백필: ingest_change_type
--    기존 이벤트가 신규처럼 보이지 않도록 unchanged로 세팅
--    이후 파이프라인은 new / updated 중심으로만 기록 (unchanged는 미저장)
UPDATE canonical_events
SET ingest_change_type = 'unchanged'
WHERE ingest_change_type IS NULL;

-- ⑤ 백필: 날짜
--    first_collected_at = created_at (최초 수집 시각 근사값)
--    last_collected_at  = COALESCE(updated_at, created_at) — updated_at NULL 방어
UPDATE canonical_events
SET
  first_collected_at = created_at,
  last_collected_at  = COALESCE(updated_at, created_at)
WHERE first_collected_at IS NULL;
