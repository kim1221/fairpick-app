-- Lightweight, event-level archive used by Culture Card collections.
-- One snapshot is shared by every user's open/visit logs for the same event.

BEGIN;

CREATE TABLE IF NOT EXISTS event_archive_snapshots (
  event_id       TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  display_title  TEXT NULL,
  category       TEXT NULL,
  region         TEXT NULL,
  venue          TEXT NULL,
  start_at       TIMESTAMPTZ NULL,
  end_at         TIMESTAMPTZ NULL,
  image_url      TEXT NULL,
  lat            DOUBLE PRECISION NULL,
  lng            DOUBLE PRECISION NULL,
  removed_at     TIMESTAMPTZ NULL,
  removed_reason TEXT NULL,
  archived_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE event_archive_snapshots IS
  'Lightweight event snapshots retained for opened Culture Cards and visit records';
COMMENT ON COLUMN event_archive_snapshots.image_url IS
  'Nullable thumbnail URL only; cleared before the canonical event is permanently deleted';

-- This public-schema table is backend-only. The API server connects with its
-- privileged database role; browser-facing roles receive no direct access.
ALTER TABLE event_archive_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE event_archive_snapshots FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE event_archive_snapshots FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE event_archive_snapshots FROM authenticated';
  END IF;
END
$$;

-- Orphan cleanup and historical backfill lookups are event-centric.
CREATE INDEX IF NOT EXISTS idx_earn_log_event_id
  ON user_ticket_earn_log(event_id);
CREATE INDEX IF NOT EXISTS idx_earn_log_user_event_created
  ON user_ticket_earn_log(user_id, event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_visit_log_event_id
  ON user_visit_log(event_id);
CREATE INDEX IF NOT EXISTS idx_user_likes_event_id
  ON user_likes(event_id);

-- Backfill every still-recoverable canonical event referenced by an existing
-- open or visit log. Events hard-deleted before this migration cannot be
-- reconstructed and intentionally remain outside renderable collection counts.
INSERT INTO event_archive_snapshots (
  event_id,
  title,
  display_title,
  category,
  region,
  venue,
  start_at,
  end_at,
  image_url,
  lat,
  lng,
  removed_at,
  removed_reason
)
SELECT
  ce.id::text,
  COALESCE(NULLIF(BTRIM(ce.title), ''), '문화행사'),
  NULLIF(BTRIM(ce.display_title), ''),
  ce.main_category,
  ce.region,
  ce.venue,
  ce.start_at,
  ce.end_at,
  ce.image_url,
  ce.lat::double precision,
  ce.lng::double precision,
  ce.deleted_at,
  ce.deleted_reason
FROM canonical_events ce
JOIN (
  SELECT event_id FROM user_ticket_earn_log
  UNION
  SELECT event_id FROM user_visit_log
) referenced ON referenced.event_id = ce.id::text
ON CONFLICT (event_id) DO UPDATE SET
  title = EXCLUDED.title,
  display_title = COALESCE(EXCLUDED.display_title, event_archive_snapshots.display_title),
  category = COALESCE(EXCLUDED.category, event_archive_snapshots.category),
  region = COALESCE(EXCLUDED.region, event_archive_snapshots.region),
  venue = COALESCE(EXCLUDED.venue, event_archive_snapshots.venue),
  start_at = COALESCE(EXCLUDED.start_at, event_archive_snapshots.start_at),
  end_at = COALESCE(EXCLUDED.end_at, event_archive_snapshots.end_at),
  image_url = COALESCE(EXCLUDED.image_url, event_archive_snapshots.image_url),
  lat = COALESCE(EXCLUDED.lat, event_archive_snapshots.lat),
  lng = COALESCE(EXCLUDED.lng, event_archive_snapshots.lng),
  removed_at = EXCLUDED.removed_at,
  removed_reason = EXCLUDED.removed_reason,
  updated_at = NOW();

COMMIT;
