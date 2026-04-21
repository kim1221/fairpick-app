-- 유저 티켓 조각 테이블
-- 광고 시청 → 티켓 조각 적립 → 10개 = 1포인트 교환

CREATE TABLE IF NOT EXISTS user_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticket_count INTEGER NOT NULL DEFAULT 0,   -- 현재 보유 조각 수
  total_earned INTEGER NOT NULL DEFAULT 0,   -- 누적 획득 조각
  total_exchanged INTEGER NOT NULL DEFAULT 0, -- 누적 교환 횟수
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_tickets_user_id ON user_tickets(user_id);
