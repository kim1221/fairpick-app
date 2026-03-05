-- toss_user_key UNIQUE 제약조건 보장
-- ON CONFLICT (toss_user_key) 구문이 동작하려면 unique index가 아닌
-- unique constraint가 필요해요.
-- 이미 존재하면 무시합니다.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND conname = 'users_toss_user_key_unique'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_toss_user_key_unique UNIQUE (toss_user_key);
    RAISE NOTICE 'users_toss_user_key_unique constraint created.';
  ELSE
    RAISE NOTICE 'users_toss_user_key_unique already exists, skipping.';
  END IF;
END
$$;
