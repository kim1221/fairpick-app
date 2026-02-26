-- ================================================================
-- Migration: Add Public Transport Info
-- Date: 2026-02-23
-- Purpose: 이벤트 대중교통 안내 필드 추가
-- ================================================================

BEGIN;

ALTER TABLE canonical_events
  ADD COLUMN IF NOT EXISTS public_transport_info TEXT DEFAULT NULL;

COMMENT ON COLUMN canonical_events.public_transport_info IS
  '대중교통 안내: 가장 가까운 역/버스 정류장, 도보 시간 등 (예: "2호선 홍대입구역 9번 출구 도보 5분")';

COMMIT;

-- ================================================================
-- 검증 쿼리
-- ================================================================
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'canonical_events'
  AND column_name = 'public_transport_info';
