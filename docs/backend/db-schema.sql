-- events 테이블 생성 스크립트 (PostgreSQL)
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY,
  source VARCHAR(50) NOT NULL,
  external_id VARCHAR(100) NOT NULL,
  title VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  venue VARCHAR(100),
  period_text VARCHAR(50) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  region VARCHAR(20) NOT NULL,
  category VARCHAR(20) NOT NULL,
  tags JSONB DEFAULT '[]'::jsonb,
  thumbnail_url TEXT NOT NULL,
  detail_image_url TEXT NOT NULL,
  detail_link TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (source, external_id)
);

-- 기존 테이블에 venue 컬럼 추가 (이미 테이블이 있는 경우)
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue VARCHAR(100);

-- 기존 테이블에 overview 컬럼 추가 (전체 개요)
ALTER TABLE events ADD COLUMN IF NOT EXISTS overview TEXT;

CREATE INDEX IF NOT EXISTS idx_events_region_category ON events (region, category);
CREATE INDEX IF NOT EXISTS idx_events_start_date ON events (start_date);

