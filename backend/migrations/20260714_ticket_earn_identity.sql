-- Permanent identity ledger for opened Culture Cards.
--
-- event_id alone is not sufficient: a dedupe/merge or source re-import can create
-- a new canonical row for the same culture event. Each recoverable identity alias
-- is therefore retained independently from canonical_events and never cleaned up.

BEGIN;

CREATE TABLE IF NOT EXISTS user_card_opened_keys (
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_type         TEXT NOT NULL CHECK (key_type IN ('event_id', 'content_key', 'canonical_key')),
  key_value        TEXT NOT NULL CHECK (BTRIM(key_value) <> ''),
  first_event_id   TEXT NOT NULL,
  first_opened_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, key_type, key_value)
);

COMMENT ON TABLE user_card_opened_keys IS
  'Permanent aliases of Culture Cards a user opened; source of truth for Home exclusion';

-- Keep the historical backfill and trigger installation gap-free. Reads remain
-- available; earn-log writers wait only for this small migration transaction.
LOCK TABLE user_ticket_earn_log IN SHARE ROW EXCLUSIVE MODE;

-- Every historical open can retain its event id even if its canonical row was
-- already deleted before this migration.
INSERT INTO user_card_opened_keys (
  user_id, key_type, key_value, first_event_id, first_opened_at
)
SELECT
  earn.user_id,
  'event_id',
  earn.event_id::text,
  earn.event_id::text,
  MIN(earn.created_at)
FROM user_ticket_earn_log earn
GROUP BY earn.user_id, earn.event_id
ON CONFLICT DO NOTHING;

-- Recover stable aliases for historical rows whose canonical event still exists.
INSERT INTO user_card_opened_keys (
  user_id, key_type, key_value, first_event_id, first_opened_at
)
SELECT
  earn.user_id,
  'content_key',
  event.content_key,
  MIN(earn.event_id::text),
  MIN(earn.created_at)
FROM user_ticket_earn_log earn
JOIN canonical_events event ON event.id::text = earn.event_id::text
WHERE event.content_key IS NOT NULL AND BTRIM(event.content_key) <> ''
GROUP BY earn.user_id, event.content_key
ON CONFLICT DO NOTHING;

INSERT INTO user_card_opened_keys (
  user_id, key_type, key_value, first_event_id, first_opened_at
)
SELECT
  earn.user_id,
  'canonical_key',
  event.canonical_key,
  MIN(earn.event_id::text),
  MIN(earn.created_at)
FROM user_ticket_earn_log earn
JOIN canonical_events event ON event.id::text = earn.event_id::text
WHERE event.canonical_key IS NOT NULL AND BTRIM(event.canonical_key) <> ''
GROUP BY earn.user_id, event.canonical_key
ON CONFLICT DO NOTHING;

-- Legacy Artmap rows did not populate canonical_key. Capture their immutable
-- source tag even when a duplicate row could not receive the unique
-- canonical_key during the preceding Artmap identity migration.
INSERT INTO user_card_opened_keys (
  user_id, key_type, key_value, first_event_id, first_opened_at
)
SELECT
  earn.user_id,
  'canonical_key',
  tag.value,
  MIN(earn.event_id::text),
  MIN(earn.created_at)
FROM user_ticket_earn_log earn
JOIN canonical_events event ON event.id::text = earn.event_id::text
CROSS JOIN LATERAL jsonb_array_elements_text(
  COALESCE(event.source_tags, '[]'::jsonb)
) AS tag(value)
WHERE tag.value ~ '^artmap:[0-9]+$'
GROUP BY earn.user_id, tag.value
ON CONFLICT DO NOTHING;

-- Defense in depth for rolling deploys and future writers. The current API
-- claims aliases before the earn-log INSERT, so these writes become harmless
-- no-ops. An older API instance that is still draining will also preserve every
-- alias at the exact time it records an open.
CREATE OR REPLACE FUNCTION public.capture_opened_card_identity_from_earn_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.user_card_opened_keys (
    user_id, key_type, key_value, first_event_id, first_opened_at
  )
  VALUES (
    NEW.user_id, 'event_id', NEW.event_id::text, NEW.event_id::text, NEW.created_at
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_card_opened_keys (
    user_id, key_type, key_value, first_event_id, first_opened_at
  )
  SELECT
    NEW.user_id,
    alias.key_type,
    alias.key_value,
    NEW.event_id::text,
    NEW.created_at
  FROM public.canonical_events event
  CROSS JOIN LATERAL (
    VALUES
      ('content_key'::text, NULLIF(BTRIM(event.content_key), '')),
      ('canonical_key'::text, NULLIF(BTRIM(event.canonical_key), ''))
  ) AS alias(key_type, key_value)
  WHERE event.id::text = NEW.event_id::text
    AND alias.key_value IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_card_opened_keys (
    user_id, key_type, key_value, first_event_id, first_opened_at
  )
  SELECT
    NEW.user_id,
    'canonical_key',
    tag.value,
    NEW.event_id::text,
    NEW.created_at
  FROM public.canonical_events event
  CROSS JOIN LATERAL jsonb_array_elements_text(
    COALESCE(event.source_tags, '[]'::jsonb)
  ) AS tag(value)
  WHERE event.id::text = NEW.event_id::text
    AND tag.value ~ '^artmap:[0-9]+$'
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_capture_opened_card_identity
  ON public.user_ticket_earn_log;
CREATE TRIGGER trg_capture_opened_card_identity
AFTER INSERT ON public.user_ticket_earn_log
FOR EACH ROW
EXECUTE FUNCTION public.capture_opened_card_identity_from_earn_log();

-- Backend-only table. Browser-facing roles must not read another user's ledger.
ALTER TABLE user_card_opened_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE user_card_opened_keys FROM PUBLIC;
REVOKE ALL ON FUNCTION public.capture_opened_card_identity_from_earn_log() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE user_card_opened_keys FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.capture_opened_card_identity_from_earn_log() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE user_card_opened_keys FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.capture_opened_card_identity_from_earn_log() FROM authenticated';
  END IF;
END
$$;

COMMIT;
