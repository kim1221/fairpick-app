import { pool } from '../../db';
import crypto from 'crypto';
import { deleteEventImage } from '../../lib/imageUpload';

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
 * - user_events (impression, dwell, sheet_open): 90일 초과 삭제  ← 단기 행동 신호
 * - user_events (view, click, cta_click): 180일 초과 삭제
 * - user_events (save, unsave, share): 365일 초과 삭제 ← 사용자 자산, 더 길게 보존
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
  let r2DeletedCount = 0;
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

    // impression / dwell / sheet_open: 90일 — 단기 행동 신호, 장기 보존 불필요
    const deletedShort = await pool.query(`
      DELETE FROM user_events
      WHERE action_type IN ('impression', 'dwell', 'sheet_open')
        AND created_at < NOW() - INTERVAL '90 days'
    `);

    // view / click / cta_click: 180일
    const deletedMedium = await pool.query(`
      DELETE FROM user_events
      WHERE action_type IN ('view', 'click', 'cta_click')
        AND created_at < NOW() - INTERVAL '180 days'
    `);

    // save / unsave / share: 365일 (사용자 자산 — 더 길게 보존)
    const deletedLong = await pool.query(`
      DELETE FROM user_events
      WHERE action_type IN ('save', 'unsave', 'share')
        AND created_at < NOW() - INTERVAL '365 days'
    `);

    const shortDeleted = deletedShort.rowCount || 0;
    const mediumDeleted = deletedMedium.rowCount || 0;
    const longDeleted = deletedLong.rowCount || 0;
    userEventsDeletedCount = shortDeleted + mediumDeleted + longDeleted;

    console.log(
      `[CleanupJob] user_events retention: ` +
      `impression/dwell/sheet_open(>90d)=${shortDeleted}, ` +
      `view/click/cta_click(>180d)=${mediumDeleted}, ` +
      `save/unsave/share(>365d)=${longDeleted} ` +
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

      // R2 이미지 삭제 (DB 삭제 전 처리)
      const imageRows = await pool.query<{ id: string; image_key: string }>(`
        SELECT id, image_key
        FROM canonical_events
        WHERE id = ANY($1)
          AND image_storage = 'cdn'
          AND image_key IS NOT NULL
      `, [ids]);

      if (imageRows.rows.length > 0) {
        const imageKeys = imageRows.rows.map(r => r.image_key);

        // 배치 refCheck: 삭제 배치 외 다른 이벤트가 같은 key를 참조하는지 1회 쿼리
        const sharedResult = await pool.query<{ image_key: string }>(`
          SELECT image_key
          FROM canonical_events
          WHERE image_key = ANY($1)
            AND NOT (id = ANY($2::uuid[]))
          GROUP BY image_key
          HAVING COUNT(*) > 0
        `, [imageKeys, ids]);

        const sharedKeys = new Set<string>(sharedResult.rows.map(r => r.image_key));
        let r2SkippedCount = 0;

        for (const row of imageRows.rows) {
          if (sharedKeys.has(row.image_key)) {
            r2SkippedCount++;
            continue;  // 다른 이벤트가 참조 중 → 삭제 건너뜀
          }

          try {
            await deleteEventImage(row.image_key);
            r2DeletedCount++;

            // image_audit_log 기록 (fire-and-forget)
            pool.query(`
              INSERT INTO image_audit_log
                (event_id, action, image_key, deleted_at, deletion_reason)
              VALUES ($1, 'delete', $2, NOW(), 'hard_delete_cleanup')
            `, [row.id, row.image_key]).catch(() => {});
          } catch (err: any) {
            console.error(
              `[CleanupJob] R2 delete failed for key ${row.image_key}:`, err?.message,
            );
            // R2 실패해도 DB hard-delete는 계속 진행
          }
        }

        console.log(
          `[CleanupJob] R2 images: deleted=${r2DeletedCount}, skipped(shared)=${r2SkippedCount}`,
        );
      }

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
    `R2 images deleted: ${r2DeletedCount}, ` +
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
