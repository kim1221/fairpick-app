-- ================================================================
-- Migration: Add Parking Fields
-- Date: 2026-02-13
-- Purpose: 모든 이벤트에 주차 정보 필드 추가
-- ================================================================

BEGIN;

-- ================================================================
-- 1. 주차 정보 필드 추가
-- ================================================================

ALTER TABLE canonical_events
  -- 🚗 주차 가능 여부
  ADD COLUMN IF NOT EXISTS parking_available BOOLEAN DEFAULT NULL,
  
  -- 🅿️ 주차 상세 정보 (위치, 요금, 제한 등)
  ADD COLUMN IF NOT EXISTS parking_info TEXT DEFAULT NULL;

-- ================================================================
-- 2. 컬럼 설명 추가
-- ================================================================

COMMENT ON COLUMN canonical_events.parking_available IS 
  '주차 가능 여부: true(가능) | false(불가능) | null(정보없음)';

COMMENT ON COLUMN canonical_events.parking_info IS 
  '주차 상세 정보: 주차장 위치, 요금, 제한 사항 등 (예: "건물 지하 주차장 이용 가능, 1시간 무료")';

COMMIT;

-- ================================================================
-- 검증 쿼리
-- ================================================================

-- 새 컬럼 확인
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'canonical_events'
  AND column_name IN ('parking_available', 'parking_info')
ORDER BY ordinal_position;

-- 샘플 데이터 확인
SELECT 
  id, 
  title, 
  parking_available,
  parking_info
FROM canonical_events
WHERE is_deleted = false
LIMIT 5;

-- ================================================================
-- 롤백 가이드 (필요 시 사용)
-- ================================================================
-- BEGIN;
-- ALTER TABLE canonical_events DROP COLUMN IF EXISTS parking_info;
-- ALTER TABLE canonical_events DROP COLUMN IF EXISTS parking_available;
-- COMMIT;

