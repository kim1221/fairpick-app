-- 푸시 알림 수신 동의 컬럼 추가
-- 기본값 TRUE: 기존 유저 포함 모든 유저가 수신 동의 상태로 시작
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS push_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;
