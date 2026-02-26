/**
 * backfill-embeddings.ts
 *
 * Batch-generates Gemini text-embedding-004 vectors for all events
 * that don't yet have an embedding stored in canonical_events.embedding.
 *
 * Usage (from backend/ directory):
 *   npx ts-node -r dotenv/config src/scripts/backfill-embeddings.ts
 *
 * Optional env vars:
 *   BATCH_SIZE=10   (default: 10, max safe with free-tier RPM)
 *   DELAY_MS=1000   (delay between batches, default: 1000ms)
 *   FORCE=true      (re-embed even events that already have embedding)
 */

import { pool } from '../db';
import { buildEventText, embedDocument, toVectorLiteral } from '../lib/embeddingService';

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? '10', 10);
const DELAY_MS = parseInt(process.env.DELAY_MS ?? '1000', 10);
const FORCE = process.env.FORCE === 'true';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const whereClause = FORCE
    ? 'WHERE is_deleted = false'
    : 'WHERE embedding IS NULL AND is_deleted = false';
  const countRes = await pool.query(
    `SELECT COUNT(*) FROM canonical_events ${whereClause}`
  );
  const total = parseInt(countRes.rows[0].count, 10);
  console.log(`[backfill-embeddings] Total to process: ${total} events (FORCE=${FORCE})`);

  if (total === 0) {
    console.log('[backfill-embeddings] Nothing to do. Exiting.');
    await pool.end();
    return;
  }

  let processed = 0;
  let errors = 0;
  let offset = 0;

  while (offset < total) {
    const batchRes = await pool.query<{
      id: string;
      title: string;
      display_title: string;
      venue: string;
      address: string;
      overview: string;
      main_category: string;
      sub_category: string;
      derived_tags: string[];
      region: string;
      price_info: string;
    }>(
      `SELECT id, title, display_title, venue, address, overview,
              main_category, sub_category, derived_tags, region, price_info
       FROM canonical_events
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset]
    );

    const batch = batchRes.rows;
    if (batch.length === 0) break;

    console.log(`[backfill-embeddings] Batch ${Math.floor(offset / BATCH_SIZE) + 1}: processing ${batch.length} events...`);

    for (const row of batch) {
      try {
        const text = buildEventText({
          title: row.title,
          displayTitle: row.display_title,
          venue: row.venue,
          address: row.address,
          overview: row.overview,
          mainCategory: row.main_category,
          subCategory: row.sub_category,
          tags: row.derived_tags,
          region: row.region,
          priceInfo: row.price_info,
        });

        const embedding = await embedDocument(text);
        const literal = toVectorLiteral(embedding);

        await pool.query(
          `UPDATE canonical_events SET embedding = $1::vector WHERE id = $2`,
          [literal, row.id]
        );

        processed++;
        if (processed % 50 === 0) {
          console.log(`[backfill-embeddings] Progress: ${processed}/${total}`);
        }
      } catch (err) {
        errors++;
        console.error(`[backfill-embeddings] Error on event ${row.id}:`, (err as Error).message);
      }
    }

    offset += batch.length;

    // Rate-limit delay between batches
    if (offset < total) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n[backfill-embeddings] Done. processed=${processed}, errors=${errors}, total=${total}`);

  // Create IVFFlat index after backfill (if enough rows with embeddings)
  try {
    const embeddedCount = await pool.query(
      `SELECT COUNT(*) FROM canonical_events WHERE embedding IS NOT NULL`
    );
    const n = parseInt(embeddedCount.rows[0].count, 10);
    if (n >= 100) {
      const lists = Math.min(100, Math.floor(n / 20));
      console.log(`[backfill-embeddings] Creating IVFFlat index with lists=${lists}...`);
      await pool.query(`
        DROP INDEX IF EXISTS canonical_events_embedding_idx;
        CREATE INDEX canonical_events_embedding_idx
          ON canonical_events USING ivfflat (embedding vector_cosine_ops)
          WITH (lists = ${lists});
      `);
      console.log('[backfill-embeddings] Index created.');
    } else {
      console.log(`[backfill-embeddings] Only ${n} embeddings — skipping index creation (need ≥100).`);
    }
  } catch (err) {
    console.error('[backfill-embeddings] Index creation error:', (err as Error).message);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('[backfill-embeddings] Fatal:', err);
  process.exit(1);
});
