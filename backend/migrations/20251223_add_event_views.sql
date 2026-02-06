-- Phase 2: 조회수 카운팅 기능 추가
-- 목적: 이벤트 상세 진입 시 조회수 기록 및 집계

-- 1) canonical_events 테이블에 view_count 컬럼 추가 (집계 캐시)
ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;

-- 2) event_views 테이블 생성 (상세 조회 기록, 향후 일자별 분석용)
CREATE TABLE IF NOT EXISTS event_views (
  id SERIAL PRIMARY KEY,
  event_id VARCHAR(255) NOT NULL,
  viewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- FK 제약조건
  CONSTRAINT fk_event_views_event_id
    FOREIGN KEY (event_id)
    REFERENCES canonical_events(id)
    ON DELETE CASCADE
);

-- 3) 인덱스 생성
-- event_id로 특정 이벤트의 조회 기록 조회
CREATE INDEX IF NOT EXISTS idx_event_views_event_id
ON event_views(event_id);

-- 일자별 집계를 위한 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_event_views_event_id_viewed_at
ON event_views(event_id, viewed_at DESC);

-- 4) view_count 인덱스 (인기순 정렬용)
CREATE INDEX IF NOT EXISTS idx_canonical_events_view_count
ON canonical_events(view_count DESC);

-- 롤백 가이드:
-- DROP INDEX IF EXISTS idx_canonical_events_view_count;
-- DROP INDEX IF EXISTS idx_event_views_event_id_viewed_at;
-- DROP INDEX IF EXISTS idx_event_views_event_id;
-- DROP TABLE IF EXISTS event_views;
-- ALTER TABLE canonical_events DROP COLUMN IF EXISTS view_count;
