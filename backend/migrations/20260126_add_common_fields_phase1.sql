-- ================================================================
-- Migration: Add Common Fields (Phase 1)
-- Date: 2026-01-26
-- Purpose: 추천/필터링/품질 관리를 위한 공통 필드 추가
-- ================================================================

BEGIN;

-- ================================================================
-- 1. 공통 필드 추가
-- ================================================================

ALTER TABLE canonical_events
  -- 🔗 URL 통합 관리
  ADD COLUMN IF NOT EXISTS external_links JSONB DEFAULT '{}'::jsonb,
  
  -- 📊 이벤트 상태 (scheduled | ongoing | ended | cancelled | unknown)
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'unknown',
  
  -- 💰 가격 필터링
  ADD COLUMN IF NOT EXISTS price_min INTEGER,
  ADD COLUMN IF NOT EXISTS price_max INTEGER,
  
  -- 🏷️ 태그 분리 (원본 vs AI 추론)
  ADD COLUMN IF NOT EXISTS source_tags JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS derived_tags JSONB DEFAULT '[]'::jsonb,
  
  -- ✅ 데이터 품질 추적
  ADD COLUMN IF NOT EXISTS quality_flags JSONB DEFAULT '{}'::jsonb,
  
  -- ⏰ 운영 시간 (전시/팝업용)
  ADD COLUMN IF NOT EXISTS opening_hours JSONB;

-- ================================================================
-- 2. 인덱스 추가
-- ================================================================

-- 상태 기반 필터링
CREATE INDEX IF NOT EXISTS idx_canonical_events_status 
  ON canonical_events(status);

-- 가격 범위 필터링
CREATE INDEX IF NOT EXISTS idx_canonical_events_price_min 
  ON canonical_events(price_min) 
  WHERE price_min IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_events_price_max 
  ON canonical_events(price_max) 
  WHERE price_max IS NOT NULL;

-- 태그 기반 검색 (GIN 인덱스)
CREATE INDEX IF NOT EXISTS idx_canonical_events_source_tags 
  ON canonical_events USING GIN(source_tags);

CREATE INDEX IF NOT EXISTS idx_canonical_events_derived_tags 
  ON canonical_events USING GIN(derived_tags);

-- 외부 링크 검색
CREATE INDEX IF NOT EXISTS idx_canonical_events_external_links 
  ON canonical_events USING GIN(external_links);

-- ================================================================
-- 3. 컬럼 설명 추가
-- ================================================================

COMMENT ON COLUMN canonical_events.external_links IS 
  'URL 통합 관리 JSON: {"official": "...", "ticket": "...", "instagram": "...", "reservation": "..."}';

COMMENT ON COLUMN canonical_events.status IS 
  '이벤트 상태: scheduled(예정) | ongoing(진행중) | ended(종료) | cancelled(취소) | unknown(미확인)';

COMMENT ON COLUMN canonical_events.price_min IS 
  '최소 가격 (원) - 필터링/정렬용';

COMMENT ON COLUMN canonical_events.price_max IS 
  '최대 가격 (원) - 필터링/정렬용';

COMMENT ON COLUMN canonical_events.source_tags IS 
  '원본 소스에서 추출한 태그 (KOPIS 장르, 인스타 해시태그 등) - 배열 형식';

COMMENT ON COLUMN canonical_events.derived_tags IS 
  'AI가 추론한 태그 (데이트, 가족, 힙한, 감성적 등) - 배열 형식';

COMMENT ON COLUMN canonical_events.quality_flags IS 
  '데이터 품질 플래그 JSON: {"has_real_image": true, "has_exact_address": true, "geo_ok": true}';

COMMENT ON COLUMN canonical_events.opening_hours IS 
  '운영 시간 JSON: {"mon": "10:00-18:00", "tue": "10:00-18:00", "wed": "휴무", ...}';

-- ================================================================
-- 4. 기존 데이터 초기화 (status 자동 계산)
-- ================================================================

-- status 자동 계산: start_at, end_at 기준
UPDATE canonical_events
SET status = CASE
  WHEN start_at > CURRENT_DATE THEN 'scheduled'
  WHEN end_at < CURRENT_DATE THEN 'ended'
  WHEN start_at <= CURRENT_DATE AND end_at >= CURRENT_DATE THEN 'ongoing'
  ELSE 'unknown'
END
WHERE status = 'unknown';

-- ================================================================
-- 5. quality_flags 자동 계산
-- ================================================================

UPDATE canonical_events
SET quality_flags = jsonb_build_object(
  'has_real_image', (
    image_url IS NOT NULL 
    AND image_url != '' 
    AND image_url NOT LIKE '%placeholder%'
    AND image_url NOT LIKE '%/defaults/%'
  ),
  'has_exact_address', (address IS NOT NULL AND address != ''),
  'geo_ok', (lat IS NOT NULL AND lng IS NOT NULL),
  'has_overview', (overview IS NOT NULL AND overview != ''),
  'has_price_info', (price_info IS NOT NULL AND price_info != '')
)
WHERE quality_flags = '{}'::jsonb;

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
  AND column_name IN (
    'external_links', 'status', 'price_min', 'price_max',
    'source_tags', 'derived_tags', 'quality_flags', 'opening_hours'
  )
ORDER BY ordinal_position;

-- status 분포 확인
SELECT status, COUNT(*) as count
FROM canonical_events
WHERE is_deleted = false
GROUP BY status
ORDER BY count DESC;

-- quality_flags 샘플 확인
SELECT 
  id, 
  title, 
  quality_flags
FROM canonical_events
WHERE is_deleted = false
LIMIT 5;

-- ================================================================
-- 롤백 가이드 (필요 시 사용)
-- ================================================================
-- BEGIN;
-- DROP INDEX IF EXISTS idx_canonical_events_external_links;
-- DROP INDEX IF EXISTS idx_canonical_events_derived_tags;
-- DROP INDEX IF EXISTS idx_canonical_events_source_tags;
-- DROP INDEX IF EXISTS idx_canonical_events_price_max;
-- DROP INDEX IF EXISTS idx_canonical_events_price_min;
-- DROP INDEX IF EXISTS idx_canonical_events_status;
-- ALTER TABLE canonical_events DROP COLUMN IF EXISTS opening_hours;
-- ALTER TABLE canonical_events DROP COLUMN IF EXISTS quality_flags;
-- ALTER TABLE canonical_events DROP COLUMN IF EXISTS derived_tags;
-- ALTER TABLE canonical_events DROP COLUMN IF EXISTS source_tags;
-- ALTER TABLE canonical_events DROP COLUMN IF EXISTS price_max;
-- ALTER TABLE canonical_events DROP COLUMN IF EXISTS price_min;
-- ALTER TABLE canonical_events DROP COLUMN IF EXISTS status;
-- ALTER TABLE canonical_events DROP COLUMN IF EXISTS external_links;
-- COMMIT;


