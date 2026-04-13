import * as cron from 'node-cron';
import { runGeoRefreshPipeline } from './jobs/geoRefreshPipeline';
import { runCleanupJob } from './jobs/cleanup';
import { updateMetadata } from './jobs/updateMetadata';
import { updateBuzzScore } from './jobs/updateBuzzScore';
import { runBackfill as runPriceInfoBackfill } from './jobs/priceInfoBackfill';
import { cleanupStuckCollectionLogs } from './maintenance/cleanupStuckCollectionLogs';
import { aiEnrichmentBackfill } from './jobs/aiEnrichmentBackfill';
import { enrichInternalFields } from './jobs/enrichInternalFields';
import { runHotRating } from './scripts/ai-hot-rating';
import { embedNewEvents } from './jobs/embedNewEvents';
import { sendEndSoonNotifications } from './jobs/sendEndSoonNotifications';
import { runPopgaCollector } from './jobs/popgaCollector';
import { runAutoFeaturedScore } from './jobs/autoFeaturedScore';
import { generateContentPool } from './jobs/generateContentPool';
import { runningJobs } from './lib/jobState';
import { withJobLog } from './lib/jobLogger';
import { pool } from './db';

/**
 * ============================================================
 * Fairpick Backend Scheduler
 * ============================================================
 *
 * 주의:
 * - node-cron은 서버 시간대(로컬 시간)를 기준으로 동작
 * - 배포 환경에서는 서버 시간대를 KST(Asia/Seoul)로 설정 필요
 * - Docker: TZ=Asia/Seoul 환경변수 설정
 * - Linux: timedatectl set-timezone Asia/Seoul
 *
 * 스케줄 (KST 기준):
 * - 01:00: 정리 작업 (Auto-unfeature, Soft delete)
 * - 02:00: 메타데이터 업데이트 (is_ending_soon, popularity_score)
 * - 02:30: Buzz Score 업데이트 (사용자 행동 기반 인기도)
 * - 03:00, 15:00: 데이터 수집 (KOPIS, Culture, TourAPI + Dedupe + Normalize)
 * - 03:30, 15:30: Price Info 백필 (API payload에서 가격 추출)
 * - 04:00: AI Enrichment (신규 이벤트 자동 보완 - 네이버 API + Gemini AI)
 * - 04:15: Phase 2 Internal Fields 생성 (추천 알고리즘용 metadata.internal)
 */

// ============================================================
// Job Execution Tracking (중복 실행 방지)
// ============================================================
// runningJobs is imported from './lib/jobState' — shared with ops API routes

// ============================================================
// Startup Catch-up: 서버 재시작 시 누락된 잡 자동 재실행
// ============================================================

type CatchupItem = {
  name: string;
  schedH: number;
  schedM: number;
  expectedH: number;
  fn: () => Promise<unknown>;
};

async function runMissedJobsOnStartup(): Promise<void> {
  console.log('[Startup] 누락된 잡 확인 중...');
  try {
    // 이전 인스턴스에서 실행 중인 잡 확인 (최근 13h 이내 running 상태)
    const { rows: runningRows } = await pool.query<{ scheduler_job_name: string }>(
      `SELECT DISTINCT scheduler_job_name FROM collection_logs
       WHERE status = 'running' AND started_at > NOW() - INTERVAL '13 hours'`
    );
    const dbRunning = new Set(runningRows.map((r) => r.scheduler_job_name));

    // 최근 48h 내 마지막 성공/부분성공 실행 시각
    const { rows: lastRunRows } = await pool.query<{ scheduler_job_name: string; last_started: string }>(
      `SELECT scheduler_job_name, MAX(started_at) AS last_started
       FROM collection_logs
       WHERE scheduler_job_name IS NOT NULL
         AND status IN ('success', 'partial', 'partial_success')
         AND started_at > NOW() - INTERVAL '48 hours'
       GROUP BY scheduler_job_name`
    );
    const lastRunMs: Record<string, number> = {};
    for (const row of lastRunRows) {
      lastRunMs[row.scheduler_job_name] = new Date(row.last_started + 'Z').getTime();
    }

    // KST 현재 시각
    const nowMs = Date.now();
    const kstDate = new Date(nowMs + 9 * 3_600_000);
    const kstH = kstDate.getUTCHours();
    const kstM = kstDate.getUTCMinutes();

    const pastToday = (h: number, m: number) => kstH > h || (kstH === h && kstM >= m);
    const hoursSince = (name: string) => {
      const last = lastRunMs[name];
      return last !== undefined ? (nowMs - last) / 3_600_000 : Infinity;
    };

    const CATCHUP: CatchupItem[] = [
      { name: 'cleanup',                schedH:  0, schedM:  0, expectedH: 24, fn: runCleanupJob },
      { name: 'metadata',               schedH:  2, schedM:  0, expectedH: 24, fn: updateMetadata },
      { name: 'auto-featured-score',    schedH:  2, schedM: 15, expectedH: 24, fn: () => withJobLog('auto-featured-score', runAutoFeaturedScore) },
      { name: 'buzz-score',             schedH:  2, schedM: 30, expectedH: 24, fn: updateBuzzScore },
      { name: 'geo-refresh-03',         schedH:  3, schedM:  0, expectedH: 24, fn: () => runGeoRefreshPipeline({ schedulerJobName: 'geo-refresh-03' }) },
      { name: 'price-info',             schedH:  3, schedM: 30, expectedH: 24, fn: () => withJobLog('price-info', () => runPriceInfoBackfill({ dryRun: false })) },
      { name: 'phase2-internal-fields', schedH:  4, schedM: 15, expectedH: 24, fn: () => withJobLog('phase2-internal-fields', enrichInternalFields) },
      { name: 'embed-new-events',       schedH:  5, schedM:  0, expectedH: 24, fn: () => withJobLog('embed-new-events', embedNewEvents) },
      { name: 'ai-hot-rating',          schedH:  9, schedM:  0, expectedH: 168, fn: () => withJobLog('ai-hot-rating', runHotRating) },
      { name: 'artmap-collector',       schedH:  7, schedM:  0, expectedH: 24,  fn: async () => { const { runArtmapCollector } = await import('./jobs/artmapCollector'); return withJobLog('artmap-collector', runArtmapCollector); } },
      // collect-15 제거 — 새벽 3시 1회 수집으로 통합
    ];

    let geoRefreshQueued = false;
    const missed: CatchupItem[] = [];

    for (const job of CATCHUP) {
      if (!pastToday(job.schedH, job.schedM)) continue;  // 오늘 아직 예정 시간 미도래
      if (dbRunning.has(job.name)) {
        console.log(`[Startup] ${job.name}: DB 실행 중 로그 존재 — 스킵`);
        continue;
      }
      if (hoursSince(job.name) > job.expectedH * 0.85) {
        // collect-15: geo-refresh-03도 실행 예정이면 스킵 (동일 수집 중복 방지)
        if (job.name === 'collect-15' && geoRefreshQueued) {
          console.log('[Startup] collect-15: geo-refresh-03 실행 예정으로 스킵');
          continue;
        }
        if (job.name === 'geo-refresh-03') geoRefreshQueued = true;
        missed.push(job);
      }
    }

    if (missed.length === 0) {
      console.log('[Startup] 누락 잡 없음.');
      return;
    }

    console.log(`[Startup] 누락 잡 ${missed.length}개 감지: ${missed.map((j) => j.name).join(', ')}`);
    for (const job of missed) {
      await runJobSafely(job.name, job.fn);
      await new Promise((r) => setTimeout(r, 2_000));
    }
    console.log('[Startup] 누락 잡 재실행 완료.');
  } catch (err) {
    console.error('[Startup] 누락 잡 체크 실패:', err);
    // 초기화 실패해도 서버는 계속 실행
  }
}

// 네트워크 일시 장애(DNS 실패, 연결 거부 등) 여부 판단
function isTransientNetworkError(error: any): boolean {
  const code = error?.code;
  const message = error?.message || '';
  return (
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EAI_AGAIN' ||
    message.includes('getaddrinfo') ||
    message.includes('connect ETIMEDOUT')
  );
}

async function runJobSafely<T = void>(
  jobName: string,
  jobFn: () => Promise<T>,
  options: { allowConcurrent?: boolean; retries?: number; retryDelayMs?: number } = {}
): Promise<T | undefined> {
  const { retries = 2, retryDelayMs = 30_000 } = options;
  const jobId = `${jobName}_${Date.now()}`;
  const startTime = Date.now();
  const startISO = new Date().toISOString();

  // 중복 실행 체크 (allowConcurrent=false인 경우)
  if (!options.allowConcurrent && runningJobs.has(jobName)) {
    console.warn(`[Scheduler][${jobName}] ⚠️ SKIP - Already running (jobId=${jobId})`);
    return undefined;
  }

  runningJobs.add(jobName);

  console.log(`[Scheduler][${jobName}][${jobId}] START (timestamp=${startISO})`);

  let lastError: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await jobFn();
      const durationMs = Date.now() - startTime;
      const durationSec = (durationMs / 1000).toFixed(1);
      const attemptLog = attempt > 0 ? ` (attempt=${attempt + 1})` : '';
      const resultLog = typeof result === 'number' ? ` (result=${result})` : '';
      console.log(`[Scheduler][${jobName}][${jobId}] SUCCESS (duration=${durationSec}s)${attemptLog}${resultLog}`);
      runningJobs.delete(jobName);
      return result;
    } catch (error: any) {
      lastError = error;
      const isTransient = isTransientNetworkError(error);
      if (isTransient && attempt < retries) {
        console.warn(
          `[Scheduler][${jobName}][${jobId}] TRANSIENT ERROR (attempt=${attempt + 1}/${retries + 1}), retrying in ${retryDelayMs / 1000}s: ${error?.message}`
        );
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        continue;
      }
      break;
    }
  }

  const durationMs = Date.now() - startTime;
  const durationSec = (durationMs / 1000).toFixed(1);
  console.error(`[Scheduler][${jobName}][${jobId}] FAILED (duration=${durationSec}s, retries=${retries})`);
  console.error(`[Scheduler][${jobName}][${jobId}] Error:`, lastError?.message || String(lastError));
  // 에러를 던지지 않고 로깅만 (스케줄러 계속 동작)

  runningJobs.delete(jobName);
  const totalDurationMs = Date.now() - startTime;
  const totalDurationSec = (totalDurationMs / 1000).toFixed(1);
  console.log(`[Scheduler][${jobName}][${jobId}] END (total_duration=${totalDurationSec}s)`);
  return undefined;
}

// ============================================================
// Scheduler Setup
// ============================================================

export function initScheduler() {
  const nodeEnv = process.env.NODE_ENV || 'undefined';
  const enableScheduler = process.env.ENABLE_SCHEDULER || 'undefined';
  const enableFailSafe = process.env.ENABLE_FAILSAFE;
  const failSafeCron = process.env.FAILSAFE_CRON || '*/30 * * * *';

  console.log(`[Scheduler] initScheduler (NODE_ENV=${nodeEnv}, ENABLE_SCHEDULER=${enableScheduler})`);

  if (process.env.ENABLE_SCHEDULER !== 'true') {
    console.log('[Scheduler] Scheduler is disabled (ENABLE_SCHEDULER !== "true")');
    return;
  }

  console.log('[Scheduler] Initializing scheduler...');

  try {
    // 매일 03:00 KST - 전체 파이프라인 (중복 실행 방지)
    cron.schedule('0 3 * * *', async () => {
      await runJobSafely('geo-refresh-03', () => runGeoRefreshPipeline({ schedulerJobName: 'geo-refresh-03' }), { allowConcurrent: false });
    }, {
      timezone: 'Asia/Seoul'
    });
    console.log('[Scheduler] registered: Geo refresh pipeline @ 03:00 KST');

    // collect-15 제거 — 새벽 3시 full pipeline 1회로 통합

    // 매일 00:00 KST - 정리 작업 (geo-refresh 03:00 시작 전 완료 목표)
    cron.schedule('0 0 * * *', async () => {
      await runJobSafely('cleanup', runCleanupJob);
    }, {
      timezone: 'Asia/Seoul'
    });
    console.log('[Scheduler] registered: Cleanup job @ 00:00 KST');

    // 매일 02:00 KST - 메타데이터 업데이트
    cron.schedule('0 2 * * *', async () => {
      await runJobSafely('metadata', updateMetadata);
    }, {
      timezone: 'Asia/Seoul'
    });
    console.log('[Scheduler] registered: Metadata update @ 02:00 KST');

    // 매일 02:15 KST - featured_score 자동 계산
    cron.schedule('15 2 * * *', async () => {
      await runJobSafely('auto-featured-score', () => withJobLog('auto-featured-score', runAutoFeaturedScore));
    }, {
      timezone: 'Asia/Seoul'
    });
    console.log('[Scheduler] registered: Auto featured score @ 02:15 KST');

    // 매일 02:30 KST - Buzz Score 업데이트
    cron.schedule('30 2 * * *', async () => {
      await runJobSafely('buzz-score', updateBuzzScore);
    }, {
      timezone: 'Asia/Seoul'
    });
    console.log('[Scheduler] registered: Buzz score update @ 02:30 KST');

    // 매일 03:30 KST - Price Info 백필 (데이터 수집 후)
    cron.schedule('30 3 * * *', async () => {
      await runJobSafely('price-info', () => withJobLog('price-info', () => runPriceInfoBackfill({ dryRun: false })));
    }, {
      timezone: 'Asia/Seoul'
    });
    console.log('[Scheduler] registered: Price info backfill @ 03:30 KST');

    // 15:30 price info backfill 제거 — 03:30 1회로 충분 (delta only, 가격은 자주 안 바뀜)

    // 🤖 AI Enrichment는 이제 geoRefreshPipeline 내에서 자동 실행됩니다!
    // (데이터 수집 직후 바로 AI 분석)
    // 아래 스케줄은 불필요하므로 주석 처리
    
    // // 매일 04:00 KST - AI Enrichment (신규 이벤트 자동 보완)
    // cron.schedule('0 4 * * *', async () => {
    //   await runJobSafely('ai-enrichment', async () => {
    //     await aiEnrichmentBackfill({
    //       limit: null,
    //       testMode: false,
    //       useNaverSearch: true,
    //       onlyMissingTags: true,
    //       onlyRecent: true,  // 최근 24시간 생성/업데이트만
    //     });
    //   });
    // }, {
    //   timezone: 'Asia/Seoul'
    // });
    // console.log('[Scheduler] registered: AI enrichment @ 04:00 KST');

    // 매일 04:15 KST - Phase 2: Internal Fields 생성 (AI enrichment 직후)
    cron.schedule('15 4 * * *', async () => {
      await runJobSafely('phase2-internal-fields', () => withJobLog('phase2-internal-fields', enrichInternalFields));
    }, {
      timezone: 'Asia/Seoul'
    });
    console.log('[Scheduler] registered: Phase 2 Internal Fields @ 04:15 KST');

    // 매일 05:00 KST - 벡터 임베딩 (데이터 수집/AI 보완 완료 후 신규 이벤트 처리)
    cron.schedule('0 5 * * *', async () => {
      await runJobSafely('embed-new-events', () => withJobLog('embed-new-events', embedNewEvents));
    }, {
      timezone: 'Asia/Seoul'
    });
    console.log('[Scheduler] registered: Embed new events @ 05:00 KST');

    // 매일 05:30 KST - 매거진 피드 콘텐츠 풀 생성 (임베딩 완료 후)
    cron.schedule('30 5 * * *', async () => {
      await runJobSafely('generate-content-pool', () => withJobLog('generate-content-pool', generateContentPool));
    }, {
      timezone: 'Asia/Seoul'
    });
    console.log('[Scheduler] registered: Generate content pool @ 05:30 KST');

    // 매일 09:00 KST - 찜한 이벤트 종료 D-3 알림 발송 (기능 보류 중 — 재개 시 주석 해제)
    // cron.schedule('0 9 * * *', async () => {
    //   await runJobSafely('end-soon-notifications', sendEndSoonNotifications);
    // }, {
    //   timezone: 'Asia/Seoul'
    // });
    // console.log('[Scheduler] registered: End-soon notifications @ 09:00 KST');

    // 매일 06:00 KST - 팝가 이벤트 수집
    cron.schedule('0 6 * * *', async () => {
      await runJobSafely('popga-collector', () => withJobLog('popga-collector', runPopgaCollector));
    }, {
      timezone: 'Asia/Seoul'
    });
    console.log('[Scheduler] registered: Popga collector @ 06:00 KST');

    // 매일 07:00 KST - 아트맵 전시 수집 (동적 import — 서버 시작 영향 방지)
    cron.schedule('0 7 * * *', async () => {
      const { runArtmapCollector } = await import('./jobs/artmapCollector');
      await runJobSafely('artmap-collector', () => withJobLog('artmap-collector', runArtmapCollector));
    }, {
      timezone: 'Asia/Seoul'
    });
    console.log('[Scheduler] registered: Artmap collector @ 07:00 KST');

    // 매주 월요일 09:00 KST - AI Hot Rating (전시/공연/축제 핫함 평가)
    cron.schedule('0 9 * * 1', async () => {
      await runJobSafely('ai-hot-rating', () => withJobLog('ai-hot-rating', runHotRating));
    }, {
      timezone: 'Asia/Seoul'
    });
    console.log('[Scheduler] registered: AI Hot Rating @ 09:00 KST (Mon)');

    // Failsafe - 중복 실행 허용 (빠른 작업)
    if (enableFailSafe !== 'false') {
      cron.schedule(failSafeCron, async () => {
        await runJobSafely('failsafe', cleanupStuckCollectionLogs, { allowConcurrent: true });
      }, {
        timezone: 'Asia/Seoul',
      });
      console.log(`[FailSafe] registered: cleanup stuck collection logs @ ${failSafeCron}`);
    } else {
      console.log('[FailSafe] Fail-safe cleanup is disabled (ENABLE_FAILSAFE === "false")');
    }

    // 서버 재시작 후 누락된 잡 보완 (10초 후 실행 — 서버 완전 초기화 대기)
    setTimeout(() => {
      runMissedJobsOnStartup().catch((err) => console.error('[Startup] catch-up error:', err));
    }, 10_000);

    console.log('[Scheduler] ✓ Scheduler initialized successfully');
    console.log('[Scheduler] Scheduled jobs:');
    console.log('  - 00:00 KST: Cleanup (auto-unfeature, soft delete)');
    console.log('  - 02:00 KST: Metadata update (is_ending_soon, popularity_score)');
    console.log('  - 02:15 KST: Auto featured score (featured_score 자동 계산)');
    console.log('  - 02:30 KST: Buzz score update (Hot Score calculation)');
    console.log('  - 03:00 KST: Geo refresh pipeline (collect + geoBackfill + venueBackfill + dedupe + AI enrichment)');
    console.log('  - 03:30 KST: Price info backfill (extract from API payloads)');
    console.log('  - 04:15 KST: Phase 2 Internal Fields (metadata.internal generation)');
    console.log('  - 05:00 KST: Embed new events (벡터 임베딩 생성)');
    console.log('  - 06:00 KST: Popga collector (팝가 신규 이벤트 수집)');
    console.log('  - 07:00 KST: Artmap collector (아트맵 전시 수집)');
    // console.log('  - 09:00 KST: End-soon notifications (찜한 이벤트 D-3 알림) — 보류');
    console.log('  - 09:00 KST (Mon): AI Hot Rating (전시/공연/축제 핫함 평가)');
    console.log('  - 15:00 KST: Light collect pipeline (collect + dedupe only, geo/AI 생략)');
    console.log('');
    console.log('  📝 Note: AI enrichment now runs automatically within Geo refresh pipeline!');
  } catch (error) {
    console.error('[Scheduler] Failed to initialize scheduler:', error);
    // 스케줄러 초기화 실패해도 서버는 계속 실행
  }
}
