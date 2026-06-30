-- Culture Card visit stamps
-- RLS is enabled with no public policies; backend access uses service_role.

CREATE TABLE IF NOT EXISTS user_visit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  bonus_tickets INTEGER NOT NULL DEFAULT 0,
  visited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_user_visit_log_user_visited_at
  ON user_visit_log(user_id, visited_at DESC);

ALTER TABLE user_visit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE user_visit_log FROM anon, authenticated;
