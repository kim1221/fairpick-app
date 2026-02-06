-- Add geo tracking columns to canonical_events
-- 목적: 지오코딩 결과 추적 (source, confidence, reason, updated_at)

-- geo_source: 지오코딩 데이터 출처
ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS geo_source TEXT
CHECK (geo_source IN ('kakao', 'nominatim', 'manual', 'venue_map', 'centroid', 'failed'));

-- geo_confidence: 지오코딩 신뢰도 (0.0 ~ 1.0)
ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS geo_confidence NUMERIC(3,2)
CHECK (geo_confidence >= 0.0 AND geo_confidence <= 1.0);

-- geo_reason: 실패 이유 또는 추가 정보
ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS geo_reason TEXT;

-- geo_updated_at: 지오코딩 마지막 업데이트 시각
ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS geo_updated_at TIMESTAMP WITH TIME ZONE;

-- 인덱스 추가 (geo_source 기준 필터링 쿼리 최적화)
CREATE INDEX IF NOT EXISTS idx_canonical_events_geo_source
ON canonical_events(geo_source)
WHERE geo_source IS NOT NULL;

-- 코멘트 추가
COMMENT ON COLUMN canonical_events.geo_source IS '지오코딩 데이터 출처: kakao/nominatim/manual/venue_map/centroid/failed';
COMMENT ON COLUMN canonical_events.geo_confidence IS '지오코딩 신뢰도 (0.0~1.0): 주소=0.9, venue=0.7, centroid=0.5, manual=0.0';
COMMENT ON COLUMN canonical_events.geo_reason IS '지오코딩 실패 이유 또는 추가 정보';
COMMENT ON COLUMN canonical_events.geo_updated_at IS '지오코딩 마지막 업데이트 시각';
