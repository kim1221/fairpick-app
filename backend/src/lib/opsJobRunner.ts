/**
 * opsJobRunner — Admin ops API에서 잡을 즉시 실행할 때 사용
 *
 * scheduler.ts와 동일한 job 함수를 호출하며,
 * 이미 실행 중인지는 runningJobs(jobState)로 확인.
 */

import { runGeoRefreshPipeline } from '../jobs/geoRefreshPipeline';
import { runCleanupJob } from '../jobs/cleanup';
import { updateMetadata } from '../jobs/updateMetadata';
import { updateBuzzScore } from '../jobs/updateBuzzScore';
import { runBackfill as runPriceInfoBackfill } from '../jobs/priceInfoBackfill';
import { enrichInternalFields } from '../jobs/enrichInternalFields';
import { runHotRating } from '../scripts/ai-hot-rating';
import { embedNewEvents } from '../jobs/embedNewEvents';
import { sendEndSoonNotifications } from '../jobs/sendEndSoonNotifications';
import { runAutoFeaturedScore } from '../jobs/autoFeaturedScore';
import { runPopgaCollector } from '../jobs/popgaCollector';
import { runningJobs } from './jobState';
import { withJobLog } from './jobLogger';

// ──────────────────────────────────────────────────────────────
// Job Runner Map
// ──────────────────────────────────────────────────────────────

const JOB_RUNNERS: Record<string, () => Promise<unknown>> = {
  'geo-refresh-03': async () => {
    await runGeoRefreshPipeline({ schedulerJobName: 'geo-refresh-03' });
  },
  'collect-15': async () => {
    await runGeoRefreshPipeline({ lightMode: true, schedulerJobName: 'collect-15' });
  },
  'cleanup': runCleanupJob,
  'metadata': updateMetadata,
  'auto-featured-score': () => withJobLog('auto-featured-score', runAutoFeaturedScore),
  'buzz-score': updateBuzzScore,
  'phase2-internal-fields': () => withJobLog('phase2-internal-fields', enrichInternalFields),
  'embed-new-events': async () => {
    await withJobLog('embed-new-events', embedNewEvents);
  },
  'price-info': () => withJobLog('price-info', () => runPriceInfoBackfill({ dryRun: false })),
  'end-soon-notifications': sendEndSoonNotifications,
  'ai-hot-rating': () => withJobLog('ai-hot-rating', runHotRating),
  'popga-collector': () => withJobLog('popga-collector', runPopgaCollector),
};

export const KNOWN_JOB_NAMES = Object.keys(JOB_RUNNERS);

// ──────────────────────────────────────────────────────────────
// Run job (fire-and-forget, non-blocking)
// ──────────────────────────────────────────────────────────────

export interface RunJobResult {
  jobName: string;
  startedAt: string;
}

/**
 * 잡을 즉시 실행 (fire-and-forget).
 * 이미 실행 중이면 'ALREADY_RUNNING' 코드의 Error를 던진다.
 * 존재하지 않는 jobName이면 'NOT_FOUND' 코드의 Error를 던진다.
 */
export function runOpsJob(jobName: string): RunJobResult {
  const runner = JOB_RUNNERS[jobName];
  if (!runner) {
    const err = new Error(`Unknown job: ${jobName}`);
    (err as NodeJS.ErrnoException).code = 'NOT_FOUND';
    throw err;
  }

  if (runningJobs.has(jobName)) {
    const err = new Error(`Job already running: ${jobName}`);
    (err as NodeJS.ErrnoException).code = 'ALREADY_RUNNING';
    throw err;
  }

  const startedAt = new Date().toISOString();
  runningJobs.add(jobName);

  // 비동기 실행 — HTTP 응답은 즉시 반환
  runner()
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[OpsJobRunner][${jobName}] Error:`, msg);
    })
    .finally(() => {
      runningJobs.delete(jobName);
    });

  return { jobName, startedAt };
}
