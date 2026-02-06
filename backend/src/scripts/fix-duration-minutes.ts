/**
 * 백필 스크립트: duration_minutes 재계산
 * 
 * parseRuntime 함수 버그로 인해 잘못 계산된 duration_minutes를 수정합니다.
 * "1시간 30분" → 30분으로 잘못 계산된 값을 90분으로 수정
 */

import { pool } from '../db';
import { parseRuntime } from '../lib/displayFieldsGenerator/utils/payloadReader';

async function fixDurationMinutes() {
  console.log('[Fix] Starting duration_minutes fix...');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // metadata.display.performance.runtime과 duration_minutes가 있는 이벤트 조회
    const eventsResult = await client.query(`
      SELECT id, title, metadata, field_sources
      FROM canonical_events
      WHERE main_category = '공연'
        AND metadata->'display'->'performance'->'runtime' IS NOT NULL
        AND metadata->'display'->'performance'->'duration_minutes' IS NOT NULL
    `);

    const eventsToFix = eventsResult.rows;
    console.log(`[Fix] Found ${eventsToFix.length} performance events with duration data`);

    let fixedCount = 0;
    let unchangedCount = 0;

    for (const event of eventsToFix) {
      const runtime = event.metadata.display.performance.runtime;
      const currentDuration = event.metadata.display.performance.duration_minutes;
      const correctDuration = parseRuntime(runtime);

      if (correctDuration !== null && correctDuration !== currentDuration) {
        console.log(`[Fix] Fixing: "${event.title}"`);
        console.log(`  Runtime text: "${runtime}"`);
        console.log(`  Old duration: ${currentDuration} minutes`);
        console.log(`  New duration: ${correctDuration} minutes`);

        // duration_minutes 업데이트
        const updatedMetadata = {
          ...event.metadata,
          display: {
            ...event.metadata.display,
            performance: {
              ...event.metadata.display.performance,
              duration_minutes: correctDuration
            }
          }
        };

        await client.query(
          `UPDATE canonical_events SET metadata = $1, updated_at = NOW() WHERE id = $2`,
          [updatedMetadata, event.id]
        );

        fixedCount++;
      } else {
        unchangedCount++;
      }
    }

    await client.query('COMMIT');
    console.log(`\n[Fix] Backfill complete!`);
    console.log(`  - Fixed: ${fixedCount}`);
    console.log(`  - Unchanged: ${unchangedCount}`);
    console.log(`  - Total: ${eventsToFix.length}`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Fix] Transaction failed:', error);
    throw error;
  } finally {
    client.release();
    console.log('[Fix] Done!');
    await pool.end();
  }
}

fixDurationMinutes()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Fix] Fatal error:', err);
    process.exit(1);
  });

