import { pool } from '../db';
import { runningJobs } from '../lib/jobState';

const DEFAULT_STUCK_MINUTES = 720; // geo-refresh-03은 최대 12h 실행될 수 있음

function getStuckMinutes(): number {
  const raw = Number(process.env.FAILSAFE_STUCK_MINUTES ?? DEFAULT_STUCK_MINUTES);
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_STUCK_MINUTES;
  }
  return Math.floor(raw);
}

export async function cleanupStuckCollectionLogs(): Promise<number> {
  const stuckMinutes = getStuckMinutes();
  const result = await pool.query(
    `
      UPDATE collection_logs
      SET
        status = 'failed',
        completed_at = NOW(),
        failed_count = GREATEST(COALESCE(items_count, 0) - COALESCE(success_count, 0), 0),
        error_message = 'Job stuck: terminated by failsafe'
      WHERE
        status = 'running'
        AND started_at IS NOT NULL
        AND started_at < NOW() - ($1 * INTERVAL '1 minute')
      RETURNING id, scheduler_job_name;
    `,
    [stuckMinutes],
  );

  const cleanedCount = result.rowCount ?? 0;

  // in-memory runningJobs Set도 정리 — UI가 계속 "실행 중"으로 표시되는 현상 방지
  for (const row of result.rows) {
    if (row.scheduler_job_name && runningJobs.has(row.scheduler_job_name)) {
      runningJobs.delete(row.scheduler_job_name);
      console.log(`[FailSafe] cleared runningJobs: ${row.scheduler_job_name}`);
    }
  }

  console.log(`[FailSafe] cleaned ${cleanedCount} stuck running logs (older_than=${stuckMinutes}m)`);
  return cleanedCount;
}
