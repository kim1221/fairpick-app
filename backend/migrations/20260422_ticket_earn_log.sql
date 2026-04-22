-- 이벤트별 하루 1회 티켓 적립 이력
-- unique index가 실제 중복 방지 게이트 역할 (INSERT ON CONFLICT DO NOTHING)
CREATE TABLE IF NOT EXISTS user_ticket_earn_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id   TEXT NOT NULL,
  earned     INTEGER NOT NULL DEFAULT 0,
  earn_date  DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 핵심 제약: user × event × 날짜 기준 하루 1회
CREATE UNIQUE INDEX IF NOT EXISTS idx_earn_log_user_event_date
  ON user_ticket_earn_log(user_id, event_id, earn_date);

-- daily_limit 집계 및 오늘 상태 조회용
CREATE INDEX IF NOT EXISTS idx_earn_log_user_date
  ON user_ticket_earn_log(user_id, earn_date);
