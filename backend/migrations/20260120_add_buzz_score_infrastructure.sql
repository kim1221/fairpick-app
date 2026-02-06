-- =====================================================
-- Buzz Score Infrastructure Migration (Phase 1 MVP)
-- =====================================================
-- 목적: 사용자 행동 기반 buzz_score 시스템 구축
--
-- ⚠️ DB Truth Audit 결과 반영:
-- - event_views 테이블 이미 존재 → ALTER TABLE만 사용
-- - canonical_events.view_count 이미 존재 → 추가 금지
-- - session_id는 NULL 허용 (Toss 로그인 미연동)
-- - user_id는 NULL 허용 (향후 확장 대비)
--
-- 변경 사항:
-- 1. event_views 테이블 확장 (user_id, session_id, referrer_screen 추가)
-- 2. event_actions 테이블 생성 (찜, 공유, 티켓 클릭 추적)
-- 3. canonical_events에 buzz_score 관련 컬럼 추가
--
-- 실행 안전성: 모든 작업에 IF NOT EXISTS 사용
-- =====================================================

BEGIN;

-- =====================================================
-- 1. event_views 테이블 확장 (기존 테이블 ALTER)
-- =====================================================
-- ⚠️ 중요: event_views는 이미 존재하므로 CREATE TABLE 금지

ALTER TABLE event_views
ADD COLUMN IF NOT EXISTS user_id UUID NULL,
ADD COLUMN IF NOT EXISTS session_id VARCHAR(255) NULL,
ADD COLUMN IF NOT EXISTS referrer_screen VARCHAR(50) NULL;

-- 인덱스: 성능 최적화
CREATE INDEX IF NOT EXISTS idx_event_views_session_id
  ON event_views(session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_views_user_id
  ON event_views(user_id)
  WHERE user_id IS NOT NULL;

-- =====================================================
-- 2. event_actions 테이블 생성
-- =====================================================
-- 사용자 액션 추적 (찜, 공유, 티켓 클릭)

CREATE TABLE IF NOT EXISTS event_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  user_id UUID NULL,                      -- 향후 Toss 로그인 연동 대비
  session_id VARCHAR(255) NOT NULL,       -- 현재: session 기반 추적 (필수)
  action_type VARCHAR(50) NOT NULL,       -- like, share, ticket_click
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- FK 제약조건
  CONSTRAINT fk_event_actions_event_id
    FOREIGN KEY (event_id)
    REFERENCES canonical_events(id)
    ON DELETE CASCADE
);

-- 인덱스: 성능 최적화 및 집계 쿼리 최적화
CREATE INDEX IF NOT EXISTS idx_event_actions_event_id
  ON event_actions(event_id);

CREATE INDEX IF NOT EXISTS idx_event_actions_action_type
  ON event_actions(action_type);

CREATE INDEX IF NOT EXISTS idx_event_actions_event_id_action_type
  ON event_actions(event_id, action_type);

CREATE INDEX IF NOT EXISTS idx_event_actions_created_at
  ON event_actions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_actions_session_id
  ON event_actions(session_id);

CREATE INDEX IF NOT EXISTS idx_event_actions_user_id
  ON event_actions(user_id)
  WHERE user_id IS NOT NULL;

-- =====================================================
-- 3. canonical_events에 buzz_score 관련 컬럼 추가
-- =====================================================
-- ⚠️ 중요: view_count는 이미 존재하므로 추가 금지

-- buzz_score: 사용자 행동 기반 인기도 점수
-- buzz_updated_at: buzz_score 마지막 업데이트 시각
-- buzz_components: 점수 구성 요소 (디버깅/분석용)

ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS buzz_score FLOAT DEFAULT 0.0,
ADD COLUMN IF NOT EXISTS buzz_updated_at TIMESTAMP NULL,
ADD COLUMN IF NOT EXISTS buzz_components JSONB NULL;

-- 인덱스: buzz_score 기반 정렬용
CREATE INDEX IF NOT EXISTS idx_canonical_events_buzz_score
  ON canonical_events(buzz_score DESC);

-- 인덱스: buzz_updated_at 기반 필터링용
CREATE INDEX IF NOT EXISTS idx_canonical_events_buzz_updated_at
  ON canonical_events(buzz_updated_at DESC)
  WHERE buzz_updated_at IS NOT NULL;

-- =====================================================
-- 4. 주석 (COMMENT)
-- =====================================================

COMMENT ON TABLE event_actions IS '사용자 액션 기록 (찜, 공유, 티켓 클릭) - session 기반';
COMMENT ON COLUMN event_views.user_id IS '향후 Toss 로그인 연동 대비 (현재 NULL)';
COMMENT ON COLUMN event_views.session_id IS 'session 기반 추적 (Phase 1 필수 식별자)';
COMMENT ON COLUMN event_views.referrer_screen IS '유입 화면 (home, hot, nearby, explore, mypage 등)';
COMMENT ON COLUMN canonical_events.buzz_score IS '사용자 행동 기반 인기도 점수 (0~1000)';
COMMENT ON COLUMN canonical_events.buzz_updated_at IS 'buzz_score 마지막 업데이트 시각';
COMMENT ON COLUMN canonical_events.buzz_components IS 'buzz_score 구성 요소 (JSON: views_7d, likes_7d, shares_7d, ticket_clicks_7d, popularity_weight)';

COMMIT;

-- =====================================================
-- 롤백 가이드 (필요 시 사용)
-- =====================================================
-- BEGIN;
-- ALTER TABLE canonical_events DROP COLUMN IF EXISTS buzz_components;
-- ALTER TABLE canonical_events DROP COLUMN IF EXISTS buzz_updated_at;
-- ALTER TABLE canonical_events DROP COLUMN IF EXISTS buzz_score;
-- ALTER TABLE event_views DROP COLUMN IF EXISTS referrer_screen;
-- ALTER TABLE event_views DROP COLUMN IF EXISTS session_id;
-- ALTER TABLE event_views DROP COLUMN IF EXISTS user_id;
-- DROP TABLE IF EXISTS event_actions;
-- COMMIT;
