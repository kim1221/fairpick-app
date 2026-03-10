import * as cron from 'node-cron';
import { runGeoRefreshPipeline } from './jobs/geoRefreshPipeline';
import { runCleanupJob } from './jobs/cleanup';
import { updateMetadata } from './jobs/updateMetadata';
import { updateBuzzScore } from './jobs/updateBuzzScore';
import { runBackfill as runPriceInfoBackfill } from './jobs/priceInfoBackfill';
import { cleanupStuckCollectionLogs } from './maintenance/cleanupStuckCollectionLogs';
import { aiEnrichmentBackfill } from './jobs/aiEnrichmentBackfill';
import { enrichInternalFields } from './jobs/enrichInternalFields';
import { runPopupDiscovery } from './scripts/ai-popup-discovery';
import { runHotRating } from './scripts/ai-hot-rating';
import { embedNewEvents } from './jobs/embedNewEvents';
import { sendEndSoonNotifications } from './jobs/sendEndSoonNotifications';
import { runAutoFeaturedScore } from './jobs/autoFeaturedScore';
import { runningJobs } from './lib/jobState';
import { withJobLog } from './lib/jobLogger';

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

    // 매일 15:00 KST - 경량 파이프라인 (수집 + 중복제거만, geo/AI 생략)
    // heavy 후처리(geo backfill, AI enrichment)는 03:00 full pipeline에서 1회 처리
    cron.schedule('0 15 * * *', async () => {
      await runJobSafely('collect-15', () => runGeoRefreshPipeline({ lightMode: true, schedulerJobName: 'collect-15' }), { allowConcurrent: false });
    }, {
      timezone: 'Asia/Seoul'
    });
    console.log('[Scheduler] registered: Light collect pipeline @ 15:00 KST (collect+dedupe only)');

    // 매일 01:00 KST - 정리 작업
    cron.schedule('0 1 * * *', async () => {
      await runJobSafely('cleanup', runCleanupJob);
    }, {
      timezone: 'Asia/Seoul'
    });
    console.log('[Scheduler] registered: Cleanup job @ 01:00 KST');

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

    // 매일 08:00 KST - AI Popup Discovery (팝업 신규 발굴 + DB 중복 체크)
    cron.schedule('0 8 * * *', async () => {
      await runJobSafely('ai-popup-discovery', () => withJobLog('ai-popup-discovery', runPopupDiscovery));
    }, {
      timezone: 'Asia/Seoul'
    });
    console.log('[Scheduler] registered: AI Popup Discovery @ 08:00 KST');

    // 매일 09:00 KST - 찜한 이벤트 종료 D-3 알림 발송
    cron.schedule('0 9 * * *', async () => {
      await runJobSafely('end-soon-notifications', sendEndSoonNotifications);
    }, {
      timezone: 'Asia/Seoul'
    });
    console.log('[Scheduler] registered: End-soon notifications @ 09:00 KST');

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

    console.log('[Scheduler] ✓ Scheduler initialized successfully');
    console.log('[Scheduler] Scheduled jobs:');
    console.log('  - 01:00 KST: Cleanup (auto-unfeature, soft delete)');
    console.log('  - 02:00 KST: Metadata update (is_ending_soon, popularity_score)');
    console.log('  - 02:15 KST: Auto featured score (featured_score 자동 계산)');
    console.log('  - 02:30 KST: Buzz score update (Hot Score calculation)');
    console.log('  - 03:00 KST: Geo refresh pipeline (collect + geoBackfill + venueBackfill + dedupe + AI enrichment)');
    console.log('  - 03:30 KST: Price info backfill (extract from API payloads)');
    console.log('  - 04:15 KST: Phase 2 Internal Fields (metadata.internal generation)');
    console.log('  - 05:00 KST: Embed new events (벡터 임베딩 생성)');
    console.log('  - 08:00 KST: AI Popup Discovery (팝업 신규 발굴)');
    console.log('  - 09:00 KST: End-soon notifications (찜한 이벤트 D-3 알림)');
    console.log('  - 09:00 KST (Mon): AI Hot Rating (전시/공연/축제 핫함 평가)');
    console.log('  - 15:00 KST: Light collect pipeline (collect + dedupe only, geo/AI 생략)');
    console.log('');
    console.log('  📝 Note: AI enrichment now runs automatically within Geo refresh pipeline!');
  } catch (error) {
    console.error('[Scheduler] Failed to initialize scheduler:', error);
    // 스케줄러 초기화 실패해도 서버는 계속 실행
  }
}
