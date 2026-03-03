import { pool } from '../../db';
import crypto from 'crypto';

/**
 * ============================================================
 * Cleanup Job - 만료 이벤트 Soft Delete + Hard Delete
 * ============================================================
 *
 * 정책:
 * 1. Soft Delete: end_at < CURRENT_DATE인 이벤트를 is_deleted = true 처리
 * 2. Hard Delete: soft delete 후 30일 이상 지난 이벤트 완전 삭제
 *    - user_likes, user_recent, user_events 연관 레코드 먼저 삭제
 *    - canonical_events에서 완전 삭제 (CASCADE로 event_actions, event_views 자동 삭제)
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
  let hardDeletedCount = 0;
  let errorMessage: string | null = null;
  let finalStatus = 'success';

  try {
    // collection_logs 오래된 기록 정리 (90일 초과)
    const cleanedLogs = await pool.query(`
      DELETE FROM collection_logs
      WHERE started_at < NOW() - INTERVAL '90 days'
    `);
    console.log(`[CleanupJob] Deleted ${cleanedLogs.rowCount || 0} old collection_logs`);

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

    // Hard delete: soft delete 후 30일 이상 지난 이벤트 완전 삭제
    const expiredIds = await pool.query(`
      SELECT id FROM canonical_events
      WHERE is_deleted = true
        AND deleted_at < NOW() - INTERVAL '30 days'
    `);

    if (expiredIds.rowCount && expiredIds.rowCount > 0) {
      const ids = expiredIds.rows.map((r: any) => r.id);

      // 연관 레코드 먼저 삭제 (FK 없는 테이블)
      await pool.query(`DELETE FROM user_likes   WHERE event_id = ANY($1)`, [ids]);
      await pool.query(`DELETE FROM user_recent  WHERE event_id = ANY($1)`, [ids]);
      await pool.query(`DELETE FROM user_events  WHERE event_id = ANY($1)`, [ids]);

      // canonical_events 완전 삭제 (CASCADE로 event_actions, event_views 자동 삭제)
      const hardResult = await pool.query(`
        DELETE FROM canonical_events WHERE id = ANY($1)
      `, [ids]);

      hardDeletedCount = hardResult.rowCount || 0;
      console.log(`[CleanupJob] Hard deleted ${hardDeletedCount} events (30d+ after soft delete)`);
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
      finalStatus === 'success' ? deletedCount : 0,
      finalStatus === 'failed' ? 1 : 0,
      errorMessage,
      logId
    ]);
  } catch (error) {
    console.error('[CleanupJob] Failed to update collection log:', error);
  }

  console.log(`[CleanupJob] Completed - Status: ${finalStatus}, Soft deleted: ${deletedCount}, Hard deleted: ${hardDeletedCount}`);
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
