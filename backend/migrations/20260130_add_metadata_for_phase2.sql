-- ================================================================
-- Migration: Add metadata column for Phase 2
-- Date: 2026-01-30
-- Purpose: Phase 2 - 추천 기반 Internal Fields 저장용 metadata 컬럼 추가
-- ================================================================

BEGIN;

-- ================================================================
-- 1. metadata 컬럼 추가
-- ================================================================

ALTER TABLE canonical_events
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- ================================================================
-- 2. GIN 인덱스 추가 (검색 성능 향상)
-- ================================================================

-- metadata 전체 검색용 GIN 인덱스
CREATE INDEX IF NOT EXISTS idx_canonical_events_metadata 
  ON canonical_events USING GIN(metadata);

-- ================================================================
-- 3. 컬럼 설명 추가
-- ================================================================

COMMENT ON COLUMN canonical_events.metadata IS 
  'Phase 2+ 확장 메타데이터 (JSONB):
  
  metadata.internal (Phase 2 - 추천 알고리즘용):
  {
    "matching": {
      "companions": ["커플", "가족"],          // derived_tags에서 추출
      "age_groups": ["20대", "30대"],          // derived_tags에서 추출
      "mood": ["힙한", "감성적"],              // derived_tags에서 추출
      "characteristics": ["사진맛집"],         // derived_tags에서 추출
      "indoor": true,                          // main_category에서 추론
      "weather_dependent": false               // main_category에서 추론
    },
    "timing": {
      "morning_available": true,               // opening_hours에서 계산
      "afternoon_available": true,
      "evening_available": true,
      "night_available": false,
      "best_days": ["화","수","목","금","토","일"],
      "avg_duration": 90                       // 분 단위
    },
    "location": {
      "metro_nearby": true,                    // lat/lng에서 계산
      "nearest_station": "강남역 5번 출구",
      "walking_distance": 350,                 // 미터
      "downtown": true,
      "tourist_area": true
    }
  },
  
  metadata.display (Phase 3 - 카테고리별 특화 필드):
  {
    "performance": {"runtime": "90분", "cast": "...", "crew": {...}},
    "exhibition": {"artist": "...", "interactive": true},
    "popup": {"brand": "...", "waiting_time": "30분"},
    "festival": {"programs": [...], "food_court": true},
    "event": {"speakers": [...], "capacity": 100}
  }
  ';

-- ================================================================
-- 4. 기존 데이터 초기화
-- ================================================================

-- 빈 metadata 객체로 초기화 (NULL 방지)
UPDATE canonical_events
SET metadata = '{}'::jsonb
WHERE metadata IS NULL OR metadata::text = 'null';

COMMIT;

-- ================================================================
-- 검증 쿼리
-- ================================================================

-- 컬럼 확인
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'canonical_events'
  AND column_name = 'metadata';

-- 샘플 확인
SELECT 
  id, 
  title, 
  metadata
FROM canonical_events
WHERE is_deleted = false
LIMIT 3;

-- ================================================================
-- 롤백 가이드 (필요 시 사용)
-- ================================================================
-- BEGIN;
-- DROP INDEX IF EXISTS idx_canonical_events_metadata;
-- ALTER TABLE canonical_events DROP COLUMN IF EXISTS metadata;
-- COMMIT;

