import { pool } from '../db';

const DEFAULT_STUCK_MINUTES = 60;

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
        failed_count = GREATEST(COALESCE(items_count, 0) - COALESCE(success_count, 0), 0)
      WHERE
        status = 'running'
        AND started_at IS NOT NULL
        AND started_at < NOW() - ($1 * INTERVAL '1 minute')
      RETURNING id;
    `,
    [stuckMinutes],
  );

  const cleanedCount = result.rowCount ?? 0;
  console.log(`[FailSafe] cleaned ${cleanedCount} stuck running logs (older_than=${stuckMinutes}m)`);
  return cleanedCount;
}
