-- 현재 컬처카드 선택지를 사용자·카테고리당 한 행으로 고정한다.
-- 날짜가 바뀌면 같은 PK를 덮어쓰므로 이력 테이블처럼 계속 증가하지 않는다.
CREATE TABLE IF NOT EXISTS user_daily_card_slots (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('전시', '공연', '팝업', '축제', '기타')),
  assigned_on DATE NOT NULL,
  event_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, category)
);

COMMENT ON TABLE user_daily_card_slots IS
  'Current sealed Culture Card assignment; bounded to at most one row per user and normalized category.';

ALTER TABLE user_daily_card_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE user_daily_card_slots FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE user_daily_card_slots FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE user_daily_card_slots FROM authenticated';
  END IF;
END
$$;
