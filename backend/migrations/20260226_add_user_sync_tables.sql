-- 서버 동기화 테이블
-- user_likes: 찜 상태 (로컬 likes와 1:1 대응)
-- user_recent: 최근 본 목록 (로컬 recent와 1:1 대응, 유저당 최대 50개)

-- ── 찜 ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_likes (
  id         BIGSERIAL    PRIMARY KEY,
  user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id   TEXT         NOT NULL,
  liked_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_user_likes_user_liked
  ON user_likes (user_id, liked_at DESC);

-- ── 최근 본 ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_recent (
  id         BIGSERIAL    PRIMARY KEY,
  user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id   TEXT         NOT NULL,
  viewed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_user_recent_user_viewed
  ON user_recent (user_id, viewed_at DESC);
