-- ============================================================================
-- Migration: 002 - Add canonical_key UNIQUE constraint to canonical_events
-- Description: canonical_key를 추가하여 중복 방지 (재실행 가능한 dedupe job)
-- Date: 2025-12-20
-- ============================================================================

-- canonical_key 컬럼 추가 (normalized_title + start_at + venue 해시)
ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS canonical_key VARCHAR(255);

-- UNIQUE 제약 조건 추가
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unique_canonical_key'
    AND conrelid = 'canonical_events'::regclass
  ) THEN
    ALTER TABLE canonical_events
    ADD CONSTRAINT unique_canonical_key UNIQUE (canonical_key);
  END IF;
END $$;

-- 인덱스 추가 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_canonical_events_canonical_key
ON canonical_events(canonical_key);

COMMENT ON COLUMN canonical_events.canonical_key IS 'MD5(normalized_title || start_at || normalized_venue) - 중복 방지 키';

-- ============================================================================
-- 롤백용 DROP 문 (필요 시 주석 해제 후 실행)
-- ============================================================================
/*
ALTER TABLE canonical_events DROP CONSTRAINT IF EXISTS unique_canonical_key;
DROP INDEX IF EXISTS idx_canonical_events_canonical_key;
ALTER TABLE canonical_events DROP COLUMN IF EXISTS canonical_key;
*/
