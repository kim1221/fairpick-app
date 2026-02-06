-- ================================================================
-- Rollback: Remove Image Metadata Fields
-- Date: 2026-01-23
-- Purpose: 마이그레이션 롤백 (문제 발생 시 사용)
-- ================================================================

-- 1. 감사 로그 테이블 삭제
DROP TABLE IF EXISTS image_audit_log;

-- 2. 인덱스 삭제
DROP INDEX IF EXISTS idx_canonical_events_image_storage;
DROP INDEX IF EXISTS idx_canonical_events_image_origin;

-- 3. 컬럼 삭제
ALTER TABLE canonical_events
  DROP COLUMN IF EXISTS image_storage,
  DROP COLUMN IF EXISTS image_origin,
  DROP COLUMN IF EXISTS image_source_page_url,
  DROP COLUMN IF EXISTS image_key,
  DROP COLUMN IF EXISTS image_metadata;

-- ================================================================
-- Rollback 완료
-- ================================================================


