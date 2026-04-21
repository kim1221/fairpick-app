-- Phase 2: 교환 confirm 구조 + earn 서버 방어

-- 1. user_tickets에 earn 방어 컬럼 추가
ALTER TABLE user_tickets
  ADD COLUMN IF NOT EXISTS last_earned_at    TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS daily_earned      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_earned_date DATE NULL;

-- 2. user_ticket_exchanges 테이블 (교환 confirm 흐름용)
CREATE TABLE IF NOT EXISTS user_ticket_exchanges (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'completed', 'expired')),
  promotion_code   TEXT NOT NULL,
  amount           INTEGER NOT NULL DEFAULT 1,
  grant_result_key TEXT NULL,       -- grantPromotionReward() 반환 식별값
  confirmed_at     TIMESTAMPTZ NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_ticket_exchanges_user_id
  ON user_ticket_exchanges(user_id);

CREATE INDEX IF NOT EXISTS idx_user_ticket_exchanges_pending
  ON user_ticket_exchanges(user_id, status, expires_at)
  WHERE status = 'pending';
