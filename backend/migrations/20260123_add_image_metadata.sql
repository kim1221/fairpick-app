-- ================================================================
-- Migration: Add Image Metadata Fields to canonical_events
-- Date: 2026-01-23
-- Purpose: CDN 이미지 관리 및 저작권 추적을 위한 메타데이터 추가
-- ================================================================

-- 1. 이미지 메타데이터 컬럼 추가
ALTER TABLE canonical_events
  ADD COLUMN IF NOT EXISTS image_storage TEXT NOT NULL DEFAULT 'external',
  ADD COLUMN IF NOT EXISTS image_origin TEXT,
  ADD COLUMN IF NOT EXISTS image_source_page_url TEXT,
  ADD COLUMN IF NOT EXISTS image_key TEXT,
  ADD COLUMN IF NOT EXISTS image_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. 컬럼 설명 추가
COMMENT ON COLUMN canonical_events.image_storage IS 'cdn: 내 CDN에 저장, external: 외부 URL';
COMMENT ON COLUMN canonical_events.image_origin IS '이미지 출처: naver|official_site|public_api|user_upload|instagram|other';
COMMENT ON COLUMN canonical_events.image_source_page_url IS '이미지 원본 페이지 URL (네이버 플레이스, 공식 홈페이지 등)';
COMMENT ON COLUMN canonical_events.image_key IS 'S3/R2 오브젝트 key (CDN 저장 시)';
COMMENT ON COLUMN canonical_events.image_metadata IS '이미지 상세 정보: {width, height, sizeKB, format, fileHash, uploadedAt, uploadedBy}';

-- 3. 기존 데이터 backfill (이미지가 있는데 origin이 비어있는 레코드)
-- ⚠️ image_storage는 DEFAULT로 이미 'external'이 들어가므로, 
--    image_origin이 NULL/빈값인 것만 업데이트
UPDATE canonical_events
SET 
  image_origin = CASE
    WHEN image_url LIKE '%instagram.com%' OR image_url LIKE '%cdninstagram%' THEN 'instagram'
    WHEN image_url LIKE '%kopis.or.kr%' THEN 'public_api'
    WHEN image_url LIKE '%data.go.kr%' THEN 'public_api'
    WHEN image_url LIKE '%pstatic.net%' THEN 'naver'
    ELSE 'other'
  END
WHERE image_url IS NOT NULL 
  AND image_url != '' 
  AND (image_origin IS NULL OR image_origin = '');

-- 4. 인덱스 추가 (이미지 검색 최적화)
CREATE INDEX IF NOT EXISTS idx_canonical_events_image_storage 
  ON canonical_events (image_storage) 
  WHERE image_storage = 'cdn';

CREATE INDEX IF NOT EXISTS idx_canonical_events_image_origin 
  ON canonical_events (image_origin) 
  WHERE image_origin IS NOT NULL;

-- 5. 감사 로그 테이블 생성 (이미지 업로드/삭제 추적)
CREATE TABLE IF NOT EXISTS image_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES canonical_events(id) ON DELETE SET NULL,
  action VARCHAR(20) NOT NULL, -- 'upload' | 'delete' | 'dmca_takedown'
  image_url TEXT,
  image_key TEXT,
  image_origin TEXT,
  source_page_url TEXT,
  uploaded_by TEXT,
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  deletion_reason TEXT,
  copyright_holder_email TEXT, -- DMCA 신고자 이메일
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_image_audit_log_event_id ON image_audit_log (event_id);
CREATE INDEX IF NOT EXISTS idx_image_audit_log_action ON image_audit_log (action);
CREATE INDEX IF NOT EXISTS idx_image_audit_log_uploaded_at ON image_audit_log (uploaded_at DESC);

COMMENT ON TABLE image_audit_log IS '이미지 업로드/삭제 감사 로그';
COMMENT ON COLUMN image_audit_log.action IS '작업 유형: upload, delete, dmca_takedown';
COMMENT ON COLUMN image_audit_log.copyright_holder_email IS 'DMCA 신고 시 저작권자 연락처';

-- ================================================================
-- Migration 완료
-- ================================================================

