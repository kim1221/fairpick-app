-- Rewarded ad attempt telemetry.
-- This separates SDK ad events from ticket grants so revenue impressions and rewards can be reconciled.

CREATE TABLE IF NOT EXISTS ad_reward_attempts (
  attempt_id          TEXT PRIMARY KEY,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id            TEXT NULL,
  ad_group_id         TEXT NOT NULL,
  placement           TEXT NOT NULL DEFAULT 'unknown',
  client_started_at   TIMESTAMPTZ NULL,

  requested_at        TIMESTAMPTZ NULL,
  show_at             TIMESTAMPTZ NULL,
  impression_at       TIMESTAMPTZ NULL,
  clicked_at          TIMESTAMPTZ NULL,
  reward_at           TIMESTAMPTZ NULL,
  dismissed_at        TIMESTAMPTZ NULL,
  failed_to_show_at   TIMESTAMPTZ NULL,
  error_at            TIMESTAMPTZ NULL,

  reward_unit_type    TEXT NULL,
  reward_unit_amount  INTEGER NULL,
  error_message       TEXT NULL,
  last_event_type     TEXT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_reward_attempts_user_created
  ON ad_reward_attempts(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_reward_attempts_created
  ON ad_reward_attempts(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_reward_attempts_event
  ON ad_reward_attempts(event_id);

CREATE TABLE IF NOT EXISTS ad_reward_attempt_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id         TEXT NOT NULL REFERENCES ad_reward_attempts(attempt_id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type         TEXT NOT NULL CHECK (
    event_type IN (
      'requested',
      'show',
      'impression',
      'clicked',
      'userEarnedReward',
      'dismissed',
      'failedToShow',
      'error'
    )
  ),
  event_data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_created_at  TIMESTAMPTZ NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_reward_attempt_events_attempt
  ON ad_reward_attempt_events(attempt_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ad_reward_attempt_events_type_created
  ON ad_reward_attempt_events(event_type, created_at DESC);

ALTER TABLE user_ticket_earn_log
  ADD COLUMN IF NOT EXISTS ad_attempt_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_earn_log_ad_attempt_id
  ON user_ticket_earn_log(ad_attempt_id)
  WHERE ad_attempt_id IS NOT NULL;
