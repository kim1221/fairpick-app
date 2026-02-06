-- ============================================================
-- Migration: Admin Automation & Logging Infrastructure
-- Date: 2025-12-27
-- Purpose: 
--   1. collection_logs: 데이터 수집/배치 작업 로깅
--   2. event_change_logs: 이벤트 변경 이력 추적
--   3. canonical_events: Soft delete 기능 추가
--   4. 성능 인덱스 추가
-- ============================================================

BEGIN;

-- ============================================================
-- 1. collection_logs: 데이터 수집 및 배치 작업 로그
-- ============================================================
CREATE TABLE IF NOT EXISTS collection_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(20) NOT NULL,  -- kopis, culture, tour, system
  type VARCHAR(30) NOT NULL,    -- collect, cleanup, auto_recommend, auto_unfeature, etc
  items_count INT DEFAULT 0,
  success_count INT DEFAULT 0,
  failed_count INT DEFAULT 0,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'running',  -- running, success, failed, partial
  error_message TEXT NULL
);

-- ============================================================
-- 2. event_change_logs: 이벤트 변경 이력
-- ============================================================
CREATE TABLE IF NOT EXISTS event_change_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NULL,           -- NULL = 전체 삭제 등
  action VARCHAR(20) NOT NULL,  -- created, updated, deleted, featured, unfeatured
  old_data JSONB NULL,
  new_data JSONB NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. canonical_events: Soft Delete 컬럼 추가
-- ============================================================
DO $$
BEGIN
  -- is_deleted 컬럼 추가
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'canonical_events' AND column_name = 'is_deleted'
  ) THEN
    ALTER TABLE canonical_events ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT false;
  END IF;

  -- deleted_at 컬럼 추가
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'canonical_events' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE canonical_events ADD COLUMN deleted_at TIMESTAMP NULL;
  END IF;

  -- deleted_reason 컬럼 추가
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'canonical_events' AND column_name = 'deleted_reason'
  ) THEN
    ALTER TABLE canonical_events ADD COLUMN deleted_reason TEXT NULL;
  END IF;
END $$;

-- ============================================================
-- 4. 인덱스 생성
-- ============================================================

-- collection_logs 인덱스
CREATE INDEX IF NOT EXISTS idx_collection_logs_started_at 
  ON collection_logs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_collection_logs_source_type 
  ON collection_logs(source, type);

CREATE INDEX IF NOT EXISTS idx_collection_logs_status 
  ON collection_logs(status, started_at DESC);

-- event_change_logs 인덱스
CREATE INDEX IF NOT EXISTS idx_event_change_logs_created_at 
  ON event_change_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_change_logs_event_id 
  ON event_change_logs(event_id);

CREATE INDEX IF NOT EXISTS idx_event_change_logs_action 
  ON event_change_logs(action, created_at DESC);

-- canonical_events 인덱스 (기존 테이블)
CREATE INDEX IF NOT EXISTS idx_canonical_events_is_deleted 
  ON canonical_events(is_deleted);

CREATE INDEX IF NOT EXISTS idx_canonical_events_updated_at 
  ON canonical_events(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_canonical_events_deleted_at 
  ON canonical_events(deleted_at DESC) WHERE deleted_at IS NOT NULL;

-- ============================================================
-- 완료
-- ============================================================

COMMIT;

-- ============================================================
-- 실행 방법:
-- psql -h localhost -U postgres -d fairpick_db -f migrations/20251227_admin_automation_logging.sql
--
-- 또는:
-- cat migrations/20251227_admin_automation_logging.sql | psql -h localhost -U postgres -d fairpick_db
-- ============================================================
