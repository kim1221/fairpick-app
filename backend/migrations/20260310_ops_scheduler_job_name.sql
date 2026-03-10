-- Ops 모니터링용 컬럼 추가
-- scheduler_job_name: 스케줄러 잡 이름 (geo-refresh-03 / collect-15 구분, 및 신규 잡 식별)
-- skipped_count: 스킵된 항목 수

ALTER TABLE collection_logs ADD COLUMN IF NOT EXISTS scheduler_job_name TEXT;
ALTER TABLE collection_logs ADD COLUMN IF NOT EXISTS skipped_count INT DEFAULT 0;

-- 인덱스: 잡 이름 + 시간 기준 조회 성능
CREATE INDEX IF NOT EXISTS idx_collection_logs_job_name ON collection_logs (scheduler_job_name, started_at DESC);
