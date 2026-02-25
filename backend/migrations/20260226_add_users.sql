-- 토스 로그인 유저 테이블
-- userKey: Toss가 발급하는 고유 식별자 (int64)
-- toss_access_token / toss_refresh_token: 서버에서만 보관 (클라이언트 미노출)
-- token_expires_at: Toss access token 만료 시각 (서버에서 투명하게 refresh 처리)

CREATE TABLE IF NOT EXISTS users (
  id                  BIGSERIAL PRIMARY KEY,
  user_key            BIGINT       UNIQUE NOT NULL,
  toss_access_token   TEXT,
  toss_refresh_token  TEXT,
  token_expires_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_user_key ON users (user_key);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
