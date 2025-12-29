import { pool } from '../db';

/**
 * Featured 이벤트 자동 해제 배치
 *
 * 해제 조건:
 * 1. end_at < CURRENT_DATE (종료된 이벤트)
 * 2. featured_at < CURRENT_DATE - 30일 (30일 이상 Featured 유지)
 *
 * 실행 주기: 매일 자정 (cron)
 */
async function autoUnfeatureEvents() {
  console.log('[AutoUnfeature] Starting auto-unfeature job...');
  console.log(`[AutoUnfeature] Execution time: ${new Date().toISOString()}`);

  try {
    // 1. 자동 해제 대상 조회
    const selectQuery = `
      SELECT
        id,
        title,
        end_at,
        featured_at,
        CASE
          WHEN end_at < CURRENT_DATE THEN 'ended'
          WHEN featured_at < CURRENT_DATE - INTERVAL '30 days' THEN 'expired'
          ELSE 'unknown'
        END AS reason
      FROM canonical_events
      WHERE is_featured = true
        AND (
          end_at < CURRENT_DATE
          OR featured_at < CURRENT_DATE - INTERVAL '30 days'
        )
      ORDER BY end_at DESC;
    `;

    const selectResult = await pool.query(selectQuery);
    const targetEvents = selectResult.rows;

    if (targetEvents.length === 0) {
      console.log('[AutoUnfeature] No events to unfeature.');
      return;
    }

    console.log(`[AutoUnfeature] Found ${targetEvents.length} events to unfeature:`);
    targetEvents.forEach((event, index) => {
      console.log(
        `  ${index + 1}. [${event.reason}] ${event.id} - ${event.title} (end: ${event.end_at}, featured: ${event.featured_at})`
      );
    });

    // 2. is_featured = false 업데이트
    const eventIds = targetEvents.map((e) => e.id);
    const updateQuery = `
      UPDATE canonical_events
      SET
        is_featured = false,
        featured_order = NULL,
        featured_at = NULL
      WHERE id = ANY($1::uuid[])
      RETURNING id, title;
    `;

    const updateResult = await pool.query(updateQuery, [eventIds]);

    console.log(`[AutoUnfeature] Successfully unfeatured ${updateResult.rowCount} events.`);
    console.log('[AutoUnfeature] Job completed successfully.');
  } catch (error) {
    console.error('[AutoUnfeature] Job failed:', error);
    throw error;
  }
}

/**
 * 메인 실행
 */
async function main() {
  try {
    await autoUnfeatureEvents();
    process.exit(0);
  } catch (error) {
    console.error('[AutoUnfeature] Fatal error:', error);
    process.exit(1);
  }
}

// 실행
main();
