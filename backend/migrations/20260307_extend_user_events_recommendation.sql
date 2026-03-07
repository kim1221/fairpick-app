-- ============================================================
-- user_events 추천용 확장
-- section_slug / rank_position / session_id 컬럼 추가
-- ============================================================

ALTER TABLE user_events
  ADD COLUMN IF NOT EXISTS section_slug  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS rank_position SMALLINT,
  ADD COLUMN IF NOT EXISTS session_id    TEXT;

-- 섹션별 액션 분석용 인덱스
CREATE INDEX IF NOT EXISTS idx_user_events_section_action
  ON user_events(section_slug, action_type, created_at DESC)
  WHERE section_slug IS NOT NULL;
