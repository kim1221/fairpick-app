import { pool } from '../../db';
import crypto from 'crypto';

/**
 * ============================================================
 * Cleanup Job - 만료 이벤트 Soft Delete + Hard Delete + Retention
 * ============================================================
 *
 * 이벤트 정책:
 * 1. Soft Delete: end_at < CURRENT_DATE인 이벤트를 is_deleted = true 처리
 * 2. Hard Delete: soft delete 후 30일 이상 지난 이벤트 완전 삭제
 *    - user_likes, user_recent, user_events 연관 레코드 먼저 삭제
 *    - canonical_events에서 완전 삭제 (CASCADE로 event_actions, event_views 자동 삭제)
 * - event_change_logs에 변경 이력 기록 (최대 200개)
 *
 * Retention 정책:
 * - collection_logs: 30일 초과 삭제
 * - event_change_logs: 90일 초과 삭제
 * - user_events (impression): 90일 초과 삭제  ← today_pick 로직은 최근 3일만 사용
 * - user_events (view, click): 180일 초과 삭제
 * - user_events (save, share): 365일 초과 삭제 ← 사용자 자산, 더 길게 보존
 * - raw_kopis/culture/tour_events: end_at 기준 180일 초과 삭제
 *   ← canonical에 이미 반영됨. 대응 canonical은 최소 150일 전 hard delete 완료
 */

export async function runCleanupJob(): Promise<void> {
  const logId = crypto.randomUUID();
  const startTime = new Date();

  console.log('[CleanupJob] Starting cleanup job...');
  console.log(`[CleanupJob] Log ID: ${logId}`);

  // collection_logs 시작 기록
  try {
    await pool.query(`
      INSERT INTO collection_logs (id, scheduler_job_name, source, type, status, started_at, items_count, success_count, failed_count)
      VALUES ($1, 'cleanup', 'system', 'cleanup', 'running', $2, 0, 0, 0)
    `, [logId, startTime]);
  } catch (error) {
    console.error('[CleanupJob] Failed to create collection log:', error);
  }

  let deletedCount = 0;
  let hardDeletedCount = 0;
  let userEventsDeletedCount = 0;
  let rawEventsDeletedCount = 0;
  let errorMessage: string | null = null;
  let finalStatus = 'success';

  try {
    // ─── 로그/캐시 Retention ───────────────────────────────────────────────────

    // collection_logs: 30일 초과 삭제 (운영상 최근 30일이면 충분)
    const cleanedLogs = await pool.query(`
      DELETE FROM collection_logs
      WHERE started_at < NOW() - INTERVAL '30 days'
    `);
    console.log(`[CleanupJob] Deleted ${cleanedLogs.rowCount || 0} old collection_logs (>30d)`);

    // event_change_logs: 90일 초과 삭제
    const cleanedChangeLogs = await pool.query(`
      DELETE FROM event_change_logs
      WHERE created_at < NOW() - INTERVAL '90 days'
    `);
    console.log(`[CleanupJob] Deleted ${cleanedChangeLogs.rowCount || 0} old event_change_logs (>90d)`);

    // ─── user_events Retention (action_type별 TTL) ────────────────────────────

    // impression: 90일 — today_pick 로직이 최근 3일만 사용하므로 장기 보존 불필요
    const deletedImpressions = await pool.query(`
      DELETE FROM user_events
      WHERE action_type = 'impression'
        AND created_at < NOW() - INTERVAL '90 days'
    `);

    // view / click: 180일
    const deletedViewClick = await pool.query(`
      DELETE FROM user_events
      WHERE action_type IN ('view', 'click')
        AND created_at < NOW() - INTERVAL '180 days'
    `);

    // save / share: 365일 (사용자 자산 — 더 길게 보존)
    const deletedSaveShare = await pool.query(`
      DELETE FROM user_events
      WHERE action_type IN ('save', 'share')
        AND created_at < NOW() - INTERVAL '365 days'
    `);

    const impressionDeleted = deletedImpressions.rowCount || 0;
    const viewClickDeleted = deletedViewClick.rowCount || 0;
    const saveShareDeleted = deletedSaveShare.rowCount || 0;
    userEventsDeletedCount = impressionDeleted + viewClickDeleted + saveShareDeleted;

    console.log(
      `[CleanupJob] user_events retention: ` +
      `impression(>90d)=${impressionDeleted}, ` +
      `view/click(>180d)=${viewClickDeleted}, ` +
      `save/share(>365d)=${saveShareDeleted} ` +
      `(total=${userEventsDeletedCount})`,
    );

    // ─── raw_* 테이블 Retention (end_at 기준 180일) ──────────────────────────
    // 근거: end_at이 180일 지난 raw 이벤트는 대응 canonical이 이미 hard delete 완료.
    // dedupeCanonicalEvents가 해당 raw를 읽지 못해도 canonical은 이미 없으므로 충돌 없음.
    // end_at NULL은 안전하게 보존 (종료일 미확정 이벤트).

    const deletedKopis = await pool.query(`
      DELETE FROM raw_kopis_events
      WHERE end_at IS NOT NULL
        AND end_at < NOW() - INTERVAL '180 days'
    `);

    const deletedCulture = await pool.query(`
      DELETE FROM raw_culture_events
      WHERE end_at IS NOT NULL
        AND end_at < NOW() - INTERVAL '180 days'
    `);

    const deletedTour = await pool.query(`
      DELETE FROM raw_tour_events
      WHERE end_at IS NOT NULL
        AND end_at < NOW() - INTERVAL '180 days'
    `);

    const rawKopisDeleted = deletedKopis.rowCount || 0;
    const rawCultureDeleted = deletedCulture.rowCount || 0;
    const rawTourDeleted = deletedTour.rowCount || 0;
    rawEventsDeletedCount = rawKopisDeleted + rawCultureDeleted + rawTourDeleted;

    console.log(
      `[CleanupJob] raw_* retention (>180d end_at): ` +
      `kopis=${rawKopisDeleted}, culture=${rawCultureDeleted}, tour=${rawTourDeleted} ` +
      `(total=${rawEventsDeletedCount})`,
    );

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

  console.log(
    `[CleanupJob] Completed - Status: ${finalStatus}, ` +
    `Soft deleted: ${deletedCount}, Hard deleted: ${hardDeletedCount}, ` +
    `user_events purged: ${userEventsDeletedCount}, ` +
    `raw_events purged: ${rawEventsDeletedCount}`,
  );
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
