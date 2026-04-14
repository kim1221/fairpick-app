import { pool } from '../db';
import { runningJobs } from '../lib/jobState';

// 파이프라인 단계별 최대 실행 시간이 60분으로 제한되므로
// 전체 5단계(collect + geo×2 + dedupe + AI enrichment) = 최대 300분(5h)이면 충분
// 이전: 720분 (12h) → 현재: 300분 (5h)
const DEFAULT_STUCK_MINUTES = 300;

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
