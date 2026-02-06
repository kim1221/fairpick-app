-- Migration: Add instagram_url column to canonical_events
-- Date: 2026-01-28
-- Description: 팝업 카테고리 이벤트의 인스타그램 URL을 저장하기 위한 컬럼 추가

BEGIN;

-- canonical_events 테이블에 instagram_url 컬럼 추가
ALTER TABLE canonical_events 
ADD COLUMN IF NOT EXISTS instagram_url TEXT;

-- 인덱스 추가 (인스타그램 URL로 검색할 수 있도록)
CREATE INDEX IF NOT EXISTS idx_canonical_events_instagram_url 
ON canonical_events(instagram_url) 
WHERE instagram_url IS NOT NULL;

-- 코멘트 추가
COMMENT ON COLUMN canonical_events.instagram_url IS '팝업스토어 등의 인스타그램 URL (팝업 카테고리에서 주로 사용)';

COMMIT;

