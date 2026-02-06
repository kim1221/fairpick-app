-- Phase 1: Location 필드 추가 (address, lat, lng)

-- canonical_events 테이블에 location 컬럼 추가
ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

-- raw_kopis_events 테이블에 location 컬럼 추가
ALTER TABLE raw_kopis_events
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

-- raw_culture_events 테이블에 location 컬럼 추가
ALTER TABLE raw_culture_events
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

-- raw_tour_events 테이블에 location 컬럼 추가
ALTER TABLE raw_tour_events
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

-- 성능 최적화를 위한 인덱스 (lat/lng가 모두 존재하는 경우만)
CREATE INDEX IF NOT EXISTS idx_canonical_events_location
  ON canonical_events(lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- 컬럼 설명 추가
COMMENT ON COLUMN canonical_events.address IS '이벤트 주소';
COMMENT ON COLUMN canonical_events.lat IS '위도';
COMMENT ON COLUMN canonical_events.lng IS '경도';

COMMENT ON COLUMN raw_kopis_events.address IS 'KOPIS 원본 주소';
COMMENT ON COLUMN raw_kopis_events.lat IS 'KOPIS 원본 위도';
COMMENT ON COLUMN raw_kopis_events.lng IS 'KOPIS 원본 경도';

COMMENT ON COLUMN raw_culture_events.address IS 'Culture 원본 주소';
COMMENT ON COLUMN raw_culture_events.lat IS 'Culture 원본 위도';
COMMENT ON COLUMN raw_culture_events.lng IS 'Culture 원본 경도';

COMMENT ON COLUMN raw_tour_events.address IS 'TourAPI 원본 주소';
COMMENT ON COLUMN raw_tour_events.lat IS 'TourAPI 원본 위도';
COMMENT ON COLUMN raw_tour_events.lng IS 'TourAPI 원본 경도';
