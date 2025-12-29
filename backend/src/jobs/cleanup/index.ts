import { pool } from '../../db';
import crypto from 'crypto';

/**
 * ============================================================
 * Cleanup Job - 만료 이벤트 Soft Delete
 * ============================================================
 * 
 * 정책:
 * - end_at < CURRENT_DATE인 이벤트를 soft delete 처리
 * - is_deleted = true, deleted_at = NOW(), deleted_reason = 'expired'
 * - event_change_logs에 변경 이력 기록 (최대 200개)
 */

export async function runCleanupJob(): Promise<void> {
  const logId = crypto.randomUUID();
  const startTime = new Date();

  console.log('[CleanupJob] Starting cleanup job...');
  console.log(`[CleanupJob] Log ID: ${logId}`);

  // collection_logs 시작 기록
  try {
    await pool.query(`
      INSERT INTO collection_logs (id, source, type, status, started_at, items_count, success_count, failed_count)
      VALUES ($1, 'system', 'cleanup', 'running', $2, 0, 0, 0)
    `, [logId, startTime]);
  } catch (error) {
    console.error('[CleanupJob] Failed to create collection log:', error);
  }

  let deletedCount = 0;
  let errorMessage: string | null = null;
  let finalStatus = 'success';

  try {
    // Soft delete 실행
    const result = await pool.query(`
      UPDATE canonical_events
      SET 
        is_deleted = true,
        deleted_at = NOW(),
        deleted_reason = 'expired'
      WHERE is_deleted = false
        AND end_at IS NOT NULL
        AND end_at < CURRENT_DATE
      RETURNING id
    `);

    deletedCount = result.rowCount || 0;
    console.log(`[CleanupJob] Soft deleted ${deletedCount} expired events`);

    // event_change_logs 기록 (최대 200개)
    if (deletedCount > 0) {
      const eventIds = result.rows.slice(0, 200).map((row: any) => row.id);
      
      for (const eventId of eventIds) {
        try {
          await pool.query(`
            INSERT INTO event_change_logs (id, event_id, action, new_data, created_at)
            VALUES ($1, $2, 'deleted', $3, NOW())
          `, [crypto.randomUUID(), eventId, JSON.stringify({ deleted_reason: 'expired' })]);
        } catch (error) {
          console.error(`[CleanupJob] Failed to log change for event ${eventId}:`, error);
        }
      }

      console.log(`[CleanupJob] Logged changes for ${Math.min(eventIds.length, 200)} events`);
    }

  } catch (error: any) {
    finalStatus = 'failed';
    errorMessage = error?.message || String(error);
    console.error('[CleanupJob] Cleanup failed:', error);
  }

  const completedAt = new Date();

  // collection_logs 종료 기록
  try {
    await pool.query(`
      UPDATE collection_logs
      SET 
        completed_at = $1,
        status = $2,
        items_count = $3,
        success_count = $4,
        failed_count = $5,
        error_message = $6
      WHERE id = $7
    `, [
      completedAt,
      finalStatus,
      deletedCount,
      finalStatus === 'success' ? 1 : 0,
      finalStatus === 'failed' ? 1 : 0,
      errorMessage,
      logId
    ]);
  } catch (error) {
    console.error('[CleanupJob] Failed to update collection log:', error);
  }

  console.log(`[CleanupJob] Completed - Status: ${finalStatus}, Deleted: ${deletedCount}`);
}

/**
 * CLI 실행용 main 함수
 */
async function main() {
  try {
    await runCleanupJob();
    console.log('[CleanupJob] Job completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('[CleanupJob] Fatal error:', error);
    process.exit(1);
  }
}

// CLI에서 직접 실행 시
if (require.main === module) {
  main();
}
