import * as cron from 'node-cron';
import { runCollectionJob } from './jobs/collect';
import { runCleanupJob } from './jobs/cleanup';
import { updateAutoRecommend } from './jobs/recommend';
import { updateMetadata } from './jobs/updateMetadata';

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
 * - 03:00, 15:00: 데이터 수집 (KOPIS, Culture, TourAPI)
 * - 01:00: 정리 작업 (Auto-unfeature, Soft delete)
 * - 04:00: 추천 로직 업데이트 (Quality score 재계산 등)
 */

// ============================================================
// Scheduler Setup
// ============================================================

export function initScheduler() {
  const enableScheduler = process.env.ENABLE_SCHEDULER === 'true';

  if (!enableScheduler) {
    console.log('[Scheduler] Scheduler is disabled (ENABLE_SCHEDULER !== "true")');
    return;
  }

  console.log('[Scheduler] Initializing scheduler...');

  try {
    // 매일 03:00 KST - 데이터 수집
    cron.schedule('0 3 * * *', async () => {
      console.log('[Scheduler] 03:00 - Starting collection job');
      try {
        await runCollectionJob();
      } catch (error) {
        console.error('[Scheduler] Collection job failed:', error);
      }
    }, {
      timezone: 'Asia/Seoul'
    });

    // 매일 15:00 KST - 데이터 수집
    cron.schedule('0 15 * * *', async () => {
      console.log('[Scheduler] 15:00 - Starting collection job');
      try {
        await runCollectionJob();
      } catch (error) {
        console.error('[Scheduler] Collection job failed:', error);
      }
    }, {
      timezone: 'Asia/Seoul'
    });

    // 매일 01:00 KST - 정리 작업
    cron.schedule('0 1 * * *', async () => {
      console.log('[Scheduler] 01:00 - Starting cleanup job');
      try {
        await runCleanupJob();
      } catch (error) {
        console.error('[Scheduler] Cleanup job failed:', error);
      }
    }, {
      timezone: 'Asia/Seoul'
    });

    // 매일 02:00 KST - 메타데이터 업데이트
    cron.schedule('0 2 * * *', async () => {
      console.log('[Scheduler] 02:00 - Starting metadata update job');
      try {
        await updateMetadata();
      } catch (error) {
        console.error('[Scheduler] Metadata update job failed:', error);
      }
    }, {
      timezone: 'Asia/Seoul'
    });

    // 매일 04:00 KST - 추천 업데이트
    cron.schedule('0 4 * * *', async () => {
      console.log('[Scheduler] 04:00 - Starting auto-recommend update');
      try {
        await updateAutoRecommend();
      } catch (error) {
        console.error('[Scheduler] Auto-recommend update failed:', error);
      }
    }, {
      timezone: 'Asia/Seoul'
    });

    console.log('[Scheduler] ✓ Scheduler initialized successfully');
    console.log('[Scheduler] Scheduled jobs:');
    console.log('  - 01:00 KST: Cleanup (auto-unfeature, soft delete)');
    console.log('  - 02:00 KST: Metadata update (is_ending_soon, popularity_score)');
    console.log('  - 03:00 KST: Data collection (KOPIS, Culture, TourAPI)');
    console.log('  - 04:00 KST: Auto-recommend update');
    console.log('  - 15:00 KST: Data collection (KOPIS, Culture, TourAPI)');
  } catch (error) {
    console.error('[Scheduler] Failed to initialize scheduler:', error);
    // 스케줄러 초기화 실패해도 서버는 계속 실행
  }
}
