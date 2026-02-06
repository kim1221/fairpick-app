-- Migration: Phase 3-1 - Add featured_order and featured_at columns
-- Created: 2025-12-23
-- Description: 관리자가 추천 이벤트의 노출 순서를 수동 제어할 수 있도록 컬럼 추가
--
-- Prerequisites: 20251223_add_featured_columns_to_canonical_events.sql (is_featured 컬럼 필요)
--
-- ============================================================
-- UP Migration
-- ============================================================

BEGIN;

-- 1. Add featured_order column
-- Purpose: 관리자가 수동으로 지정하는 추천 노출 순서
--   - NULL: 자동 정렬 (기존 로직 사용: quality_score, 임박도 등)
--   - 1, 2, 3...: 수동 순서 (숫자가 작을수록 우선 노출)
--   - 관리자 UI에서 Drag & Drop으로 순서 변경 시 이 값 업데이트
ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS featured_order INTEGER NULL;

-- 2. Add featured_at column
-- Purpose: 추천으로 지정된 시점 기록
--   - is_featured = true로 변경된 시점 자동 기록
--   - 관리 목적: 얼마나 오래 추천 상태인지 추적
--   - 향후 활용: 7일 이상 추천된 이벤트 자동 해제 등
ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS featured_at TIMESTAMP NULL;

-- 3. Add column comments for documentation
COMMENT ON COLUMN canonical_events.featured_order IS
'관리자가 수동으로 지정하는 추천 노출 순서. NULL=자동정렬, 1~N=수동순서(작을수록 우선)';

COMMENT ON COLUMN canonical_events.featured_at IS
'추천(is_featured=true)으로 지정된 시점. 관리 목적 및 자동 해제 정책에 활용';

-- 4. Create index for featured events with manual ordering
-- 추천 이벤트 조회 시 featured_order로 정렬하는 쿼리 최적화
-- 예: SELECT * FROM canonical_events
--     WHERE is_featured = true
--     ORDER BY featured_order ASC NULLS LAST, quality_score DESC;
CREATE INDEX IF NOT EXISTS idx_canonical_events_featured_order
ON canonical_events(is_featured, featured_order ASC NULLS LAST)
WHERE is_featured = true;

-- 5. Update existing featured events
-- 기존에 is_featured=true인 이벤트가 있다면 featured_at에 현재 시각 기록
-- (Phase 1에서 자동으로 featured된 이벤트가 있을 수 있음)
UPDATE canonical_events
SET featured_at = CURRENT_TIMESTAMP
WHERE is_featured = true AND featured_at IS NULL;

COMMIT;

-- ============================================================
-- Verification Queries
-- ============================================================

-- Check if columns were added successfully
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'canonical_events'
--   AND column_name IN ('featured_order', 'featured_at');

-- Check column comments
-- SELECT
--   col.column_name,
--   pgd.description
-- FROM pg_catalog.pg_statio_all_tables AS st
-- INNER JOIN pg_catalog.pg_description pgd ON (pgd.objoid = st.relid)
-- INNER JOIN information_schema.columns col ON (
--   pgd.objsubid = col.ordinal_position AND
--   col.table_name = st.relname
-- )
-- WHERE st.relname = 'canonical_events'
--   AND col.column_name IN ('featured_order', 'featured_at');

-- Check indexes
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'canonical_events'
--   AND indexname LIKE '%featured%';

-- Sample query: 추천 이벤트를 수동 순서 → 자동 정렬 순으로 조회
-- SELECT
--   id,
--   title,
--   is_featured,
--   featured_order,
--   featured_at,
--   quality_score
-- FROM canonical_events
-- WHERE is_featured = true
-- ORDER BY
--   featured_order ASC NULLS LAST,  -- 수동 순서 우선
--   quality_score DESC,               -- 자동 정렬
--   updated_at DESC
-- LIMIT 10;

-- ============================================================
-- DOWN Migration (Rollback)
-- ============================================================

-- To rollback this migration, run:
/*
BEGIN;

-- Drop index
DROP INDEX IF EXISTS idx_canonical_events_featured_order;

-- Remove column comments
COMMENT ON COLUMN canonical_events.featured_order IS NULL;
COMMENT ON COLUMN canonical_events.featured_at IS NULL;

-- Drop columns
ALTER TABLE canonical_events DROP COLUMN IF EXISTS featured_at;
ALTER TABLE canonical_events DROP COLUMN IF EXISTS featured_order;

COMMIT;
*/

-- ============================================================
-- Usage Examples
-- ============================================================

-- Example 1: 관리자가 특정 이벤트를 1순위로 추천 지정
-- UPDATE canonical_events
-- SET
--   is_featured = true,
--   featured_order = 1,
--   featured_at = CURRENT_TIMESTAMP
-- WHERE id = 'some-event-id';

-- Example 2: 여러 이벤트의 노출 순서 일괄 업데이트 (Drag & Drop 후)
-- UPDATE canonical_events SET featured_order = 1 WHERE id = 'event-a';
-- UPDATE canonical_events SET featured_order = 2 WHERE id = 'event-b';
-- UPDATE canonical_events SET featured_order = 3 WHERE id = 'event-c';

-- Example 3: 추천 해제 (자동 정렬로 복귀)
-- UPDATE canonical_events
-- SET
--   is_featured = false,
--   featured_order = NULL,
--   featured_at = NULL
-- WHERE id = 'some-event-id';

-- Example 4: 7일 이상 추천된 이벤트 자동 해제 (배치 작업)
-- UPDATE canonical_events
-- SET
--   is_featured = false,
--   featured_order = NULL
-- WHERE is_featured = true
--   AND featured_at < CURRENT_TIMESTAMP - INTERVAL '7 days';
