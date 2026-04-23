-- 일별 출석 기록
-- UNIQUE(user_id, attend_date) 가 하루 1회 게이트 역할
CREATE TABLE IF NOT EXISTS user_attendance_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attend_date  DATE NOT NULL,        -- KST 기준 날짜
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, attend_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_log_user_date
  ON user_attendance_log(user_id, attend_date);

-- 주간 완주 보너스 지급 이력
-- UNIQUE(user_id, week_start) 가 중복 지급 방지 게이트 역할
CREATE TABLE IF NOT EXISTS user_weekly_bonus_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start     DATE NOT NULL,      -- 해당 주 월요일 (KST)
  ad_tickets     INTEGER NOT NULL,   -- 해당 주 광고 적립 티켓 합계
  bonus_tickets  INTEGER NOT NULL,   -- 실제 지급량 (cap 적용 후)
  capped         BOOLEAN NOT NULL DEFAULT false,
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, week_start)
);
