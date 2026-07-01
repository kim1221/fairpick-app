-- Store GPS coordinates submitted for verified Culture Card visit stamps.
-- Apply manually in Supabase/Postgres.

ALTER TABLE user_visit_log
  ADD COLUMN IF NOT EXISTS checkin_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS checkin_lng DOUBLE PRECISION;

COMMENT ON COLUMN user_visit_log.checkin_lat IS 'Device latitude submitted for verified Culture Card visit check-in';
COMMENT ON COLUMN user_visit_log.checkin_lng IS 'Device longitude submitted for verified Culture Card visit check-in';
