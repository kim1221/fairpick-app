-- ============================================================
-- Migration: Add all Featured columns to canonical_events
-- Created: 2025-12-23
-- Description: Phase 1 + Phase 3-1 통합 마이그레이션
--   - is_featured (추천 여부)
--   - featured_score (내부 점수 - Phase 1)
--   - featured_order (관리자 수동 순서 - Phase 3-1)
--   - featured_at (추천 지정 시점 - Phase 3-1)
-- ============================================================

BEGIN;

-- 1. is_featured 컬럼 추가
ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;

-- 2. featured_score 컬럼 추가 (내부 자동 점수)
ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS featured_score INTEGER NOT NULL DEFAULT 0;

-- 3. featured_order 컬럼 추가 (관리자 수동 순서)
ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS featured_order INTEGER NULL;

-- 4. featured_at 컬럼 추가 (추천 지정 시점)
ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS featured_at TIMESTAMP NULL;

-- 5. 컬럼 설명 추가
COMMENT ON COLUMN canonical_events.is_featured IS
'추천 여부. Phase 1: 자동 추천, Phase 3: 관리자 수동 설정';

COMMENT ON COLUMN canonical_events.featured_score IS
'내부 자동 점수 (UI 노출 안 됨). 높을수록 더 추천됨';

COMMENT ON COLUMN canonical_events.featured_order IS
'관리자가 수동으로 지정하는 추천 노출 순서. NULL=자동정렬, 1~N=수동순서(작을수록 우선)';

COMMENT ON COLUMN canonical_events.featured_at IS
'추천(is_featured=true)으로 지정된 시점. 관리 목적 및 자동 해제 정책에 활용';

-- 6. 인덱스 생성
-- 6-1. is_featured만 있는 이벤트 조회용 (partial index)
CREATE INDEX IF NOT EXISTS idx_canonical_events_is_featured
ON canonical_events(is_featured)
WHERE is_featured = true;

-- 6-2. featured_score로 정렬할 때 사용
CREATE INDEX IF NOT EXISTS idx_canonical_events_featured_score
ON canonical_events(is_featured, featured_score DESC)
WHERE is_featured = true;

-- 6-3. featured_order로 정렬할 때 사용 (Phase 3-1)
CREATE INDEX IF NOT EXISTS idx_canonical_events_featured_order
ON canonical_events(is_featured, featured_order ASC NULLS LAST)
WHERE is_featured = true;

-- 6-4. view_count로 정렬할 때 사용 (Phase 2에서 추가된 경우)
-- view_count 컬럼이 있는 경우에만 실행
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'canonical_events' AND column_name = 'view_count'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_canonical_events_view_count
    ON canonical_events(view_count DESC);
  END IF;
END $$;

-- 7. 기존에 is_featured=true인 이벤트가 있다면 featured_at 설정
UPDATE canonical_events
SET featured_at = CURRENT_TIMESTAMP
WHERE is_featured = true AND featured_at IS NULL;

COMMIT;

-- ============================================================
-- 검증 쿼리
-- ============================================================

-- 컬럼 추가 확인
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'canonical_events'
--   AND column_name IN ('is_featured', 'featured_score', 'featured_order', 'featured_at')
-- ORDER BY column_name;

-- 인덱스 확인
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'canonical_events'
--   AND indexname LIKE '%featured%'
-- ORDER BY indexname;

-- Featured 이벤트 확인
-- SELECT id, title, is_featured, featured_order, featured_at
-- FROM canonical_events
-- WHERE is_featured = true
-- ORDER BY featured_order ASC NULLS LAST;

-- ============================================================
-- 롤백 SQL
-- ============================================================

-- To rollback this migration, run:
/*
BEGIN;

DROP INDEX IF EXISTS idx_canonical_events_view_count;
DROP INDEX IF EXISTS idx_canonical_events_featured_order;
DROP INDEX IF EXISTS idx_canonical_events_featured_score;
DROP INDEX IF EXISTS idx_canonical_events_is_featured;

COMMENT ON COLUMN canonical_events.featured_at IS NULL;
COMMENT ON COLUMN canonical_events.featured_order IS NULL;
COMMENT ON COLUMN canonical_events.featured_score IS NULL;
COMMENT ON COLUMN canonical_events.is_featured IS NULL;

ALTER TABLE canonical_events DROP COLUMN IF EXISTS featured_at;
ALTER TABLE canonical_events DROP COLUMN IF EXISTS featured_order;
ALTER TABLE canonical_events DROP COLUMN IF EXISTS featured_score;
ALTER TABLE canonical_events DROP COLUMN IF EXISTS is_featured;

COMMIT;
*/
