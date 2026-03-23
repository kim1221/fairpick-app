/**
 * withJobLog — collection_logs 미기록 잡을 위한 범용 래퍼
 *
 * 이미 collection_logs를 직접 기록하는 잡(cleanup, metadata, buzz-score 등)에는
 * 사용하지 않는다. 해당 잡은 각 INSERT에 scheduler_job_name 컬럼을 추가하는 방식으로 처리.
 *
 * 사용 대상:
 *   - auto-featured-score (runAutoFeaturedScore)
 *   - phase2-internal-fields (enrichInternalFields)
 *   - embed-new-events (embedNewEvents)
 *   - price-info (runPriceInfoBackfill)
 *   - ai-hot-rating (runHotRating)
 */

import crypto from 'crypto';
import { pool } from '../db';

export async function withJobLog<T>(
  schedulerJobName: string,
  jobFn: () => Promise<T>
): Promise<T | undefined> {
  const logId = crypto.randomUUID();
  const startTime = new Date();

  try {
    await pool.query(
      `INSERT INTO collection_logs
         (id, scheduler_job_name, source, type, status, started_at,
          items_count, success_count, failed_count, skipped_count)
       VALUES ($1, $2, 'system', $3, 'running', NOW(), 0, 0, 0, 0)`,
      [logId, schedulerJobName, schedulerJobName]
    );
  } catch (err) {
    console.error(`[JobLogger][${schedulerJobName}] Failed to create log:`, err);
  }

  try {
    const result = await jobFn();
    const successCount = typeof result === 'number' ? result : 0;

    await pool.query(
      `UPDATE collection_logs
       SET status = 'success', completed_at = NOW(),
           items_count = $1, success_count = $1
       WHERE id = $2`,
      [successCount, logId]
    ).catch((err) => console.error(`[JobLogger][${schedulerJobName}] Failed to update log:`, err));

    return result;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);

    await pool.query(
      `UPDATE collection_logs
       SET status = 'failed', completed_at = NOW(),
           error_message = $1, failed_count = 1
       WHERE id = $2`,
      [msg.slice(0, 500), logId]
    ).catch((err) => console.error(`[JobLogger][${schedulerJobName}] Failed to update log on error:`, err));

    throw error;
  }
}
