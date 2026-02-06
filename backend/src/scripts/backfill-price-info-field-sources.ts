/**
 * 백필 스크립트: price_info 필드에 대한 field_sources 추가
 * 
 * KOPIS/Culture/TourAPI에서 추출된 price_info에 대해
 * field_sources를 생성하여 DB에 업데이트합니다.
 */

import { pool } from '../db';

/**
 * field_sources 매핑 함수
 */
function mapSourceToFieldSource(source: string): string {
  const mapping: Record<string, string> = {
    'kopis': 'KOPIS',
    'culture': 'Culture',
    'tour': 'TourAPI',
  };
  return mapping[source.toLowerCase()] || 'PUBLIC_API';
}

async function backfillPriceInfoFieldSources() {
  console.log('[Backfill] Starting price_info field_sources backfill...');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // price_info가 있지만 field_sources에 price_info 항목이 없는 이벤트 조회
    const eventsResult = await client.query(`
      SELECT id, canonical_key, source_priority_winner, price_info, field_sources
      FROM canonical_events
      WHERE price_info IS NOT NULL
        AND (field_sources IS NULL OR NOT field_sources ? 'price_info')
    `);

    const eventsToUpdate = eventsResult.rows;
    console.log(`[Backfill] Found ${eventsToUpdate.length} events with price_info but no field_sources`);

    let updatedCount = 0;

    for (const event of eventsToUpdate) {
      const source = mapSourceToFieldSource(event.source_priority_winner);
      const sourceDetail = `${source} public API`;
      const timestamp = new Date().toISOString();

      // 기존 field_sources와 병합
      const mergedFieldSources = {
        ...(event.field_sources || {}),
        price_info: {
          source,
          sourceDetail,
          confidence: 100,
          updatedAt: timestamp
        }
      };

      await client.query(
        `UPDATE canonical_events SET field_sources = $1, updated_at = NOW() WHERE id = $2`,
        [mergedFieldSources, event.id]
      );
      updatedCount++;

      if (updatedCount % 100 === 0) {
        console.log(`[Backfill] Processed ${updatedCount} events...`);
      }
    }

    await client.query('COMMIT');
    console.log(`[Backfill] Backfill complete!`);
    console.log(`  - Updated: ${updatedCount}`);

    // 검증
    const verificationResult = await client.query(`
      SELECT 
        COUNT(*) AS total_with_price_info,
        COUNT(*) FILTER (WHERE field_sources ? 'price_info') AS with_price_info_field_source
      FROM canonical_events
      WHERE price_info IS NOT NULL
    `);
    const verification = verificationResult.rows[0];
    console.log(`\n[Backfill] Verification:`);
    console.log(`  - Total events with price_info: ${verification.total_with_price_info}`);
    console.log(`  - With price_info field_sources: ${verification.with_price_info_field_source}`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Backfill] Transaction failed:', error);
    throw error;
  } finally {
    client.release();
    console.log('[Backfill] Done!');
    await pool.end();
  }
}

backfillPriceInfoFieldSources()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Backfill] Fatal error:', err);
    process.exit(1);
  });

