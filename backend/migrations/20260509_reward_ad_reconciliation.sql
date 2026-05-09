-- Manual Apps in Toss ad dashboard / settlement reconciliation.
-- SDK events are available in ad_reward_attempts, but ad-network invalidation and
-- final settlement adjustments are only visible from the monetization dashboard.

CREATE TABLE IF NOT EXISTS ad_reward_settlement_daily (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date                     DATE NOT NULL,
  ad_group_id                     TEXT NOT NULL,
  os                              TEXT NOT NULL DEFAULT 'all'
                                    CHECK (os IN ('all', 'ios', 'android', 'unknown')),

  dashboard_impressions           INTEGER NULL CHECK (dashboard_impressions IS NULL OR dashboard_impressions >= 0),
  dashboard_ecpm_krw              NUMERIC(14, 2) NULL CHECK (dashboard_ecpm_krw IS NULL OR dashboard_ecpm_krw >= 0),
  dashboard_estimated_revenue_krw NUMERIC(14, 2) NULL,
  final_revenue_krw               NUMERIC(14, 2) NULL,
  invalid_adjustment_krw          NUMERIC(14, 2) NULL,

  source                          TEXT NOT NULL DEFAULT 'manual',
  note                            TEXT NULL,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (report_date, ad_group_id, os)
);

CREATE INDEX IF NOT EXISTS idx_ad_reward_settlement_daily_date
  ON ad_reward_settlement_daily(report_date DESC);

CREATE INDEX IF NOT EXISTS idx_ad_reward_settlement_daily_group_os
  ON ad_reward_settlement_daily(ad_group_id, os, report_date DESC);
