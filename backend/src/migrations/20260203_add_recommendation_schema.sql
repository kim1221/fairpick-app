-- =====================================================
-- Fairpick 추천 시스템 스키마 마이그레이션
-- 작성일: 2026-02-03
-- =====================================================

-- 1. events 테이블에 추천 관련 컬럼 추가
ALTER TABLE events ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS save_count INTEGER DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS buzz_score FLOAT DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS buzz_score_24h FLOAT DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS buzz_score_48h FLOAT DEFAULT 0;

-- 인덱스 추가 (추천 쿼리 최적화)
CREATE INDEX IF NOT EXISTS idx_events_buzz_score ON events(buzz_score DESC);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_start_date ON events(start_date);
CREATE INDEX IF NOT EXISTS idx_events_end_date ON events(end_date);

-- 2. 유저 테이블
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  toss_user_id VARCHAR(255) UNIQUE,           -- null이면 익명
  toss_user_key BIGINT,                       -- 토스 로그인 userKey
  anonymous_id UUID UNIQUE,                   -- 익명 식별자
  name VARCHAR(255),                          -- 사용자 이름 (암호화)
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 익명 ID 인덱스
CREATE INDEX IF NOT EXISTS idx_users_anonymous_id ON users(anonymous_id);
CREATE INDEX IF NOT EXISTS idx_users_toss_user_key ON users(toss_user_key);

-- 3. 유저 행동 로그 테이블
CREATE TABLE IF NOT EXISTS user_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  action_type VARCHAR(50) NOT NULL,           -- 'view', 'save', 'unsave', 'share', 'click'
  metadata JSONB,                             -- 추가 정보 (예: 체류 시간)
  created_at TIMESTAMP DEFAULT NOW()
);

-- 빠른 집계를 위한 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_user_events_user_action ON user_events(user_id, action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_events_event_action ON user_events(event_id, action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_events_created_at ON user_events(created_at DESC);

-- 4. 유저 취향 집계 테이블
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  category_scores JSONB NOT NULL DEFAULT '{}', -- {"전시": 80, "팝업": 60, ...}
  preferred_tags TEXT[] DEFAULT '{}',          -- ["사진맛집", "힙한", ...]
  last_location JSONB,                         -- {lat, lng, address}
  last_updated TIMESTAMP DEFAULT NOW()
);

-- 5. buzz_score 계산 함수 (트리거용)
CREATE OR REPLACE FUNCTION calculate_buzz_score(
  p_view_count INTEGER,
  p_save_count INTEGER,
  p_share_count INTEGER
) RETURNS FLOAT AS $$
BEGIN
  RETURN (
    COALESCE(p_view_count, 0) * 1.0 +
    COALESCE(p_save_count, 0) * 3.0 +
    COALESCE(p_share_count, 0) * 5.0
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 6. events 테이블 업데이트 시 buzz_score 자동 계산 트리거
CREATE OR REPLACE FUNCTION update_event_buzz_score()
RETURNS TRIGGER AS $$
BEGIN
  NEW.buzz_score := calculate_buzz_score(
    NEW.view_count,
    NEW.save_count,
    NEW.share_count
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_buzz_score ON events;
CREATE TRIGGER trigger_update_buzz_score
  BEFORE UPDATE OF view_count, save_count, share_count ON events
  FOR EACH ROW
  EXECUTE FUNCTION update_event_buzz_score();

-- 7. 초기 buzz_score 계산 (기존 데이터)
UPDATE events SET buzz_score = calculate_buzz_score(
  view_count,
  save_count,
  share_count
) WHERE buzz_score = 0;

-- 8. 유저 행동 로그 추가 시 events 카운트 자동 증가
CREATE OR REPLACE FUNCTION increment_event_counters()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.action_type = 'view' THEN
    UPDATE events SET view_count = view_count + 1 WHERE id = NEW.event_id;
  ELSIF NEW.action_type = 'save' THEN
    UPDATE events SET save_count = save_count + 1 WHERE id = NEW.event_id;
  ELSIF NEW.action_type = 'unsave' THEN
    UPDATE events SET save_count = GREATEST(save_count - 1, 0) WHERE id = NEW.event_id;
  ELSIF NEW.action_type = 'share' THEN
    UPDATE events SET share_count = share_count + 1 WHERE id = NEW.event_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_increment_event_counters ON user_events;
CREATE TRIGGER trigger_increment_event_counters
  AFTER INSERT ON user_events
  FOR EACH ROW
  EXECUTE FUNCTION increment_event_counters();

-- 9. buzz_score 24h/48h 스냅샷 업데이트 배치용 뷰
CREATE OR REPLACE VIEW event_buzz_snapshot AS
SELECT
  id,
  buzz_score,
  buzz_score_24h,
  buzz_score_48h,
  (buzz_score - COALESCE(buzz_score_24h, 0)) / NULLIF(COALESCE(buzz_score_24h, 1), 0) AS trend_score
FROM events
WHERE buzz_score > 0;

COMMENT ON VIEW event_buzz_snapshot IS '인기 급상승 계산을 위한 스냅샷 뷰';

-- =====================================================
-- 마이그레이션 완료
-- =====================================================

