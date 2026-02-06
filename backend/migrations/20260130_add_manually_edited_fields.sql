-- Migration: Add manually_edited_fields tracking
-- Date: 2026-01-30
-- Purpose: Track which fields were manually edited by admin to prevent AI overwriting

-- Add manually_edited_fields column
ALTER TABLE canonical_events
ADD COLUMN manually_edited_fields JSONB DEFAULT '{}'::jsonb;

-- Add index for efficient querying
CREATE INDEX idx_canonical_events_manually_edited_fields 
ON canonical_events USING GIN (manually_edited_fields);

-- Add comment
COMMENT ON COLUMN canonical_events.manually_edited_fields IS 
'Admin이 수동으로 편집한 필드 추적 (AI 덮어쓰기 방지)
예시: {"overview": true, "derived_tags": true}';

-- Example usage:
-- Admin이 overview를 수정하면:
-- UPDATE canonical_events 
-- SET overview = '...', 
--     manually_edited_fields = manually_edited_fields || '{"overview": true}'::jsonb
-- WHERE id = '...';

-- AI 보완 시 체크:
-- SELECT manually_edited_fields->>'overview' as is_manually_edited
-- FROM canonical_events
-- WHERE id = '...';
-- → "true"면 AI가 덮어쓰지 않음

