-- Give legacy Artmap rows the same source identity used by artmapCollector.
-- This migration must run before 20260714_ticket_earn_identity.sql so the
-- opened-card ledger backfill captures `artmap:<idx>` for historical opens.

BEGIN;

WITH extracted AS MATERIALIZED (
  SELECT
    event.id,
    tag.value AS artmap_key,
    ROW_NUMBER() OVER (
      PARTITION BY tag.value
      ORDER BY
        (event.canonical_key = tag.value) DESC,
        event.is_deleted ASC,
        event.updated_at DESC,
        event.id
    ) AS identity_rank
  FROM canonical_events event
  CROSS JOIN LATERAL jsonb_array_elements_text(
    COALESCE(event.source_tags, '[]'::jsonb)
  ) AS tag(value)
  WHERE tag.value ~ '^artmap:[0-9]+$'
), preferred AS (
  SELECT id, artmap_key
  FROM extracted
  WHERE identity_rank = 1
)
UPDATE canonical_events event
SET canonical_key = preferred.artmap_key,
    updated_at = NOW()
FROM preferred
WHERE event.id = preferred.id
  -- Do not overwrite a different non-empty identity without first preserving
  -- that alias. Legacy artmapCollector rows omitted canonical_key, so the
  -- expected backfill target is NULL/blank.
  AND (event.canonical_key IS NULL OR BTRIM(event.canonical_key) = '')
  AND NOT EXISTS (
    SELECT 1
    FROM canonical_events conflict
    WHERE conflict.canonical_key = preferred.artmap_key
      AND conflict.id <> event.id
  );

COMMIT;
