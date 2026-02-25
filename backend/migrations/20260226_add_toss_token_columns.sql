-- 기존 users 테이블에 Toss 토큰 컬럼 추가
-- (토스 로그인 서버 측 토큰 보관용 — 클라이언트 미노출)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS toss_access_token  TEXT,
  ADD COLUMN IF NOT EXISTS toss_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at   TIMESTAMPTZ;
