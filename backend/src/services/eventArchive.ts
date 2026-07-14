import type { PoolClient } from 'pg';

/**
 * Refresh the single lightweight archive snapshot for an event.
 *
 * The caller owns the transaction. A missing canonical row is not an error:
 * existing historical snapshots remain untouched and legacy visit/earn flows
 * keep their previous idempotent behaviour.
 */
export async function upsertEventArchive(
  client: Pick<PoolClient, 'query'>,
  eventId: string,
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO event_archive_snapshots (
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
     WHERE ce.id::text = $1
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
       updated_at = NOW()
     RETURNING event_id`,
    [eventId],
  );

  return (result.rowCount ?? result.rows.length) > 0;
}
