-- ============================================================================
-- Migration: 001 - Add Raw and Canonical Events Tables
-- Description: raw_* 테이블 3개 + canonical_events 테이블 추가
-- Date: 2025-12-20
-- ============================================================================

-- UUID 확장 활성화
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- RAW 테이블: raw_kopis_events (KOPIS API 원본 데이터)
-- ============================================================================
CREATE TABLE IF NOT EXISTS raw_kopis_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source VARCHAR(20) NOT NULL DEFAULT 'kopis' CHECK (source = 'kopis'),
  source_event_id VARCHAR(100) NOT NULL,
  source_url TEXT,
  payload JSONB NOT NULL,
  title VARCHAR(200),
  start_at DATE,
  end_at DATE,
  venue VARCHAR(150),
  region VARCHAR(50),
  main_category VARCHAR(50),
  sub_category VARCHAR(50),
  image_url TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (source, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_kopis_events_source_event_id ON raw_kopis_events (source, source_event_id);
CREATE INDEX IF NOT EXISTS idx_raw_kopis_events_dates ON raw_kopis_events (start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_raw_kopis_events_region_category ON raw_kopis_events (region, main_category, sub_category);
CREATE INDEX IF NOT EXISTS idx_raw_kopis_events_updated_at ON raw_kopis_events (updated_at);

COMMENT ON TABLE raw_kopis_events IS 'KOPIS API 원본 이벤트 데이터 (공연 정보)';
COMMENT ON COLUMN raw_kopis_events.payload IS 'API 응답 전체 JSON payload';
COMMENT ON COLUMN raw_kopis_events.source_event_id IS 'KOPIS API의 이벤트 고유 ID';

-- ============================================================================
-- RAW 테이블: raw_culture_events (문화청 API 원본 데이터)
-- ============================================================================
CREATE TABLE IF NOT EXISTS raw_culture_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source VARCHAR(20) NOT NULL DEFAULT 'culture' CHECK (source = 'culture'),
  source_event_id VARCHAR(100) NOT NULL,
  source_url TEXT,
  payload JSONB NOT NULL,
  title VARCHAR(200),
  start_at DATE,
  end_at DATE,
  venue VARCHAR(150),
  region VARCHAR(50),
  main_category VARCHAR(50),
  sub_category VARCHAR(50),
  image_url TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (source, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_culture_events_source_event_id ON raw_culture_events (source, source_event_id);
CREATE INDEX IF NOT EXISTS idx_raw_culture_events_dates ON raw_culture_events (start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_raw_culture_events_region_category ON raw_culture_events (region, main_category, sub_category);
CREATE INDEX IF NOT EXISTS idx_raw_culture_events_updated_at ON raw_culture_events (updated_at);

COMMENT ON TABLE raw_culture_events IS '문화청 API 원본 이벤트 데이터 (문화 행사)';
COMMENT ON COLUMN raw_culture_events.payload IS 'API 응답 전체 JSON payload';
COMMENT ON COLUMN raw_culture_events.source_event_id IS '문화청 API의 이벤트 고유 ID';

-- ============================================================================
-- RAW 테이블: raw_tour_events (Tour API 원본 데이터)
-- ============================================================================
CREATE TABLE IF NOT EXISTS raw_tour_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source VARCHAR(20) NOT NULL DEFAULT 'tour' CHECK (source = 'tour'),
  source_event_id VARCHAR(100) NOT NULL,
  source_url TEXT,
  payload JSONB NOT NULL,
  title VARCHAR(200),
  start_at DATE,
  end_at DATE,
  venue VARCHAR(150),
  region VARCHAR(50),
  main_category VARCHAR(50),
  sub_category VARCHAR(50),
  image_url TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (source, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_tour_events_source_event_id ON raw_tour_events (source, source_event_id);
CREATE INDEX IF NOT EXISTS idx_raw_tour_events_dates ON raw_tour_events (start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_raw_tour_events_region_category ON raw_tour_events (region, main_category, sub_category);
CREATE INDEX IF NOT EXISTS idx_raw_tour_events_updated_at ON raw_tour_events (updated_at);

COMMENT ON TABLE raw_tour_events IS 'Tour API 원본 이벤트 데이터 (관광 축제)';
COMMENT ON COLUMN raw_tour_events.payload IS 'API 응답 전체 JSON payload';
COMMENT ON COLUMN raw_tour_events.source_event_id IS 'Tour API의 이벤트 고유 ID';

-- ============================================================================
-- CANONICAL 테이블: canonical_events (중복 제거된 정규화 이벤트)
-- ============================================================================
CREATE TABLE IF NOT EXISTS canonical_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(200) NOT NULL,
  start_at DATE,
  end_at DATE,
  venue VARCHAR(150),
  region VARCHAR(50),
  main_category VARCHAR(50),
  sub_category VARCHAR(50),
  image_url TEXT,
  source_priority_winner VARCHAR(20) NOT NULL,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canonical_events_dates ON canonical_events (start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_canonical_events_region_category ON canonical_events (region, main_category, sub_category);
CREATE INDEX IF NOT EXISTS idx_canonical_events_title ON canonical_events (title);
CREATE INDEX IF NOT EXISTS idx_canonical_events_updated_at ON canonical_events (updated_at);

COMMENT ON TABLE canonical_events IS '중복 제거된 정규화 이벤트 테이블 (프론트엔드에서 사용)';
COMMENT ON COLUMN canonical_events.source_priority_winner IS '우선순위가 가장 높은 소스 (kopis > culture > tour)';
COMMENT ON COLUMN canonical_events.sources IS '원본 소스 참조 배열: [{"source": "kopis", "id": "uuid", "source_event_id": "PF123"}]';

-- ============================================================================
-- 롤백용 DROP 문 (필요 시 주석 해제 후 실행)
-- ============================================================================
/*
DROP TABLE IF EXISTS canonical_events CASCADE;
DROP TABLE IF EXISTS raw_tour_events CASCADE;
DROP TABLE IF EXISTS raw_culture_events CASCADE;
DROP TABLE IF EXISTS raw_kopis_events CASCADE;
*/
