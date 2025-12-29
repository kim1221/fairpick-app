-- 메타데이터 컬럼 추가
ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_ending_soon BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS popularity_score INTEGER DEFAULT 0;

-- 성능 최적화 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_canonical_events_is_free
  ON canonical_events(is_free)
  WHERE is_free = true;

CREATE INDEX IF NOT EXISTS idx_canonical_events_is_ending_soon
  ON canonical_events(is_ending_soon)
  WHERE is_ending_soon = true;

CREATE INDEX IF NOT EXISTS idx_canonical_events_popularity_score
  ON canonical_events(popularity_score DESC);

-- 컬럼 설명 추가
COMMENT ON COLUMN canonical_events.is_free IS '무료 이벤트 여부';
COMMENT ON COLUMN canonical_events.is_ending_soon IS '3일 이내 종료 여부';
COMMENT ON COLUMN canonical_events.popularity_score IS '인기도 점수 (0-1000)';
