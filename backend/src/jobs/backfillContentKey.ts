import { pool } from '../db';
import { generateContentKey, generateDisplayTitle } from '../utils/titleNormalizer';

type CanonicalRow = {
  id: string;
  title: string;
  start_at: string | null;
  end_at: string | null;
  venue: string | null;
  region: string | null;
  main_category: string | null;
  display_title: string | null;
  content_key: string | null;
};

async function backfillContentKey(): Promise<void> {
  const result = await pool.query<CanonicalRow>(`
    SELECT id, title, start_at, end_at, venue, region, main_category, display_title, content_key
    FROM canonical_events
    ORDER BY updated_at DESC
  `);

  let updated = 0;

  for (const row of result.rows) {
    const displayTitle = generateDisplayTitle(row.title);
    const contentKey = generateContentKey(
      row.title,
      row.start_at,
      row.end_at,
      row.venue,
      row.region,
      row.main_category,
    );

    const shouldUpdate =
      row.display_title !== displayTitle ||
      row.content_key !== contentKey;

    if (!shouldUpdate) {
      continue;
    }

    await pool.query(
      `
        UPDATE canonical_events
        SET display_title = $1,
            content_key = $2,
            updated_at = NOW()
        WHERE id = $3
      `,
      [displayTitle, contentKey, row.id],
    );
    updated += 1;
  }

  console.log(`[Backfill] updated ${updated} canonical_events with display_title/content_key`);
}

if (require.main === module) {
  backfillContentKey()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[Backfill] failed:', error);
      process.exit(1);
    });
}
