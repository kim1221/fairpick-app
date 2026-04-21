-- user별 미만료 pending exchange는 1개만 허용 (레이스 컨디션 방지)
-- INSERT ... ON CONFLICT (user_id) WHERE status = 'pending' DO NOTHING 으로 원자적 처리
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_ticket_exchanges_one_pending_per_user
  ON user_ticket_exchanges(user_id)
  WHERE status = 'pending';
