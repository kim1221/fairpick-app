-- anonymous_id 컬럼을 UUID → TEXT로 변경
-- Toss getAnonymousKey() hash는 UUID 형식이 아닐 수 있으므로 TEXT로 확장
-- 기존 UUID 값은 그대로 보존 (UUID도 TEXT로 저장 가능)
ALTER TABLE users ALTER COLUMN anonymous_id TYPE TEXT USING anonymous_id::TEXT;
