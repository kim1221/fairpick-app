-- AI enrichment 처리 상태 추적 컬럼 추가
-- ai_enriched_at: 처리 완료 시각 (NULL이면 미처리)
-- ai_enrichment_attempts: 실패 횟수 (3회 이상이면 포기)

ALTER TABLE canonical_events
  ADD COLUMN IF NOT EXISTS ai_enriched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_enrichment_attempts INT NOT NULL DEFAULT 0;

-- 인덱스: 미처리 이벤트 조회 최적화
CREATE INDEX IF NOT EXISTS idx_canonical_events_ai_enriched
  ON canonical_events (ai_enriched_at, ai_enrichment_attempts)
  WHERE ai_enriched_at IS NULL;

COMMENT ON COLUMN canonical_events.ai_enriched_at IS 'AI enrichment 완료 시각. NULL이면 미처리.';
COMMENT ON COLUMN canonical_events.ai_enrichment_attempts IS 'AI enrichment 실패 횟수. 3회 이상이면 재시도 중단.';
