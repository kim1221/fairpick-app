import { pool } from '../../db';
import crypto from 'crypto';

/**
 * ============================================================
 * Collection Job - 데이터 수집 및 정규화
 * ============================================================
 * 
 * 실행 순서:
 * 1. collectKopis (KOPIS API)
 * 2. collectCulture (문화포털 API)
 * 3. collectTourApi (한국관광공사 API)
 * 4. dedupeCanonical (중복 제거)
 * 5. normalizeCategories (카테고리 정규화)
 * 
 * 각 단계는 독립적으로 실행되며, 실패해도 다음 단계 계속 진행
 */

// 컬렉션 단계별 최대 실행 시간 (60분)
// 개별 HTTP 요청은 10초 타임아웃이 있지만, 수천 개 항목을 순차 처리 시 루프 전체가 수 시간 걸릴 수 있음
// Promise.race로 타임아웃 시 백그라운드에서 계속 실행되지만 파이프라인은 다음 단계로 진행
const COLLECTION_STEP_TIMEOUT_MS = 60 * 60 * 1000; // 60분

interface CollectionStep {
  name: string;
  modulePath: string;
  functionName: string;
}

const COLLECTION_STEPS: CollectionStep[] = [
  { name: 'KOPIS', modulePath: '../../collectors/kopisCollector', functionName: 'collectKopis' },
  { name: 'Culture', modulePath: '../../collectors/cultureCollector', functionName: 'collectCulture' },
  { name: 'TourAPI', modulePath: '../../collectors/tourApiCollector', functionName: 'collectTourApi' },
  { name: 'Dedupe', modulePath: '../dedupeCanonicalEvents', functionName: 'dedupeCanonicalEvents' },
  { name: 'Normalize', modulePath: '../normalizeCategories', functionName: 'normalizeCategories' },
];

export async function runCollectionJob(options?: { schedulerJobName?: string }): Promise<void> {
  const schedulerJobName = options?.schedulerJobName ?? 'geo-refresh-03';
  const logId = crypto.randomUUID();
  const startTime = new Date();

  console.log('[CollectJob] Starting collection job...');
  console.log(`[CollectJob] Log ID: ${logId}`);

  // collection_logs 시작 기록
  try {
    await pool.query(`
      INSERT INTO collection_logs (id, scheduler_job_name, source, type, status, started_at, items_count, success_count, failed_count)
      VALUES ($1, $2, 'system', 'collect', 'running', NOW(), 0, 0, 0)
    `, [logId, schedulerJobName]);
  } catch (error) {
    console.error('[CollectJob] Failed to create collection log:', error);
    // 로그 실패해도 job은 계속 진행
  }

  let successCount = 0;
  let failedCount = 0;
  const errorMessages: string[] = [];

  // 각 단계 실행
  for (const step of COLLECTION_STEPS) {
    const stepStartTime = Date.now();
    let stepTimeoutId: ReturnType<typeof setTimeout> | undefined;
    console.log(`[CollectJob] Running step: ${step.name}...`);

    try {
      // Dynamic import로 모듈 로드 (ts-node는 .ts 확장자 자동 해석)
      const module = await import(step.modulePath);
      const func = module[step.functionName];

      if (typeof func !== 'function') {
        console.log(`[CollectJob] ⊘ ${step.name} - Function not found, skipping`);
        continue;
      }

      // 함수 실행 (60분 타임아웃 — 타임아웃 시 백그라운드에서 계속 실행되지만 다음 단계로 진행)
      const stepTimeoutPromise = new Promise<never>((_, reject) => {
        stepTimeoutId = setTimeout(() => {
          reject(new Error(`Step timeout: ${step.name} exceeded ${COLLECTION_STEP_TIMEOUT_MS / 60000}min limit`));
        }, COLLECTION_STEP_TIMEOUT_MS);
      });
      await Promise.race([func(), stepTimeoutPromise]);
      clearTimeout(stepTimeoutId);
      const elapsed = ((Date.now() - stepStartTime) / 1000).toFixed(1);
      successCount++;
      console.log(`[CollectJob] ✓ ${step.name} - Success (${elapsed}s)`);
    } catch (error: any) {
      clearTimeout(stepTimeoutId);
      const elapsed = ((Date.now() - stepStartTime) / 1000).toFixed(1);

      if (error?.code === 'MODULE_NOT_FOUND') {
        console.log(`[CollectJob] ⊘ ${step.name} - Module not found, skipping`);
        continue;
      }

      failedCount++;
      const errorMsg = `${step.name}: ${error?.message || String(error)}`;
      errorMessages.push(errorMsg);

      // 상세 에러 로깅
      console.error(`[CollectJob] ✗ ${step.name} - Failed (${elapsed}s)`);
      console.error(`[CollectJob]   Error: ${error?.message || String(error)}`);
      if (error?.status) {
        console.error(`[CollectJob]   HTTP Status: ${error.status}`);
      }
      if (error?.type) {
        console.error(`[CollectJob]   Error Type: ${error.type}`);
      }
      if (error?.response) {
        const bodyPrefix = typeof error.response === 'string'
          ? error.response.substring(0, 300)
          : JSON.stringify(error.response).substring(0, 300);
        console.error(`[CollectJob]   Response Body (first 300 chars): ${bodyPrefix}`);
      }
      if (error?.stack) {
        console.error(`[CollectJob]   Stack: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
      }

      // 실패해도 다음 단계 계속
      console.warn(`[CollectJob] ⚠️ ${step.name} failed, but continuing with next steps...`);
    }
  }

  // 최종 상태 결정
  const totalExecuted = successCount + failedCount;
  let finalStatus: string;

  if (totalExecuted === 0) {
    finalStatus = 'success'; // 모든 단계 스킵됨 (no-op)
  } else if (failedCount === 0) {
    finalStatus = 'success'; // 모두 성공
  } else if (successCount > 0) {
    finalStatus = 'partial'; // 일부 성공
  } else {
    finalStatus = 'failed'; // 전부 실패
  }

  const completedAt = new Date();
  const totalElapsed = ((completedAt.getTime() - startTime.getTime()) / 1000).toFixed(1);
  const errorMessage = errorMessages.length > 0 ? errorMessages.join('; ') : null;

  console.log('='.repeat(80));
  console.log('[CollectJob] ✓ Collection Job Completed');
  console.log('='.repeat(80));
  console.log(`  Status: ${finalStatus.toUpperCase()}`);
  console.log(`  Success: ${successCount}/${totalExecuted} steps`);
  console.log(`  Failed: ${failedCount}/${totalExecuted} steps`);
  console.log(`  Total elapsed: ${totalElapsed}s`);
  if (errorMessages.length > 0) {
    console.log(`  Errors:`);
    errorMessages.forEach((msg, idx) => {
      console.log(`    ${idx + 1}. ${msg}`);
    });
  }
  console.log('='.repeat(80));

  // collection_logs 종료 기록 (completed_at = NOW() — JS Date 타임존 버그 방지)
  try {
    await pool.query(`
      UPDATE collection_logs
      SET
        completed_at = NOW(),
        status = $1,
        items_count = $2,
        success_count = $3,
        failed_count = $4,
        error_message = $5
      WHERE id = $6
    `, [finalStatus, totalExecuted, successCount, failedCount, errorMessage, logId]);
  } catch (error) {
    console.error('[CollectJob] Failed to update collection log:', error);
  }
}

/**
 * CLI 실행용 main 함수
 */
async function main() {
  try {
    await runCollectionJob();
    console.log('[CollectJob] Job completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('[CollectJob] Fatal error:', error);
    process.exit(1);
  }
}

// CLI에서 직접 실행 시
if (require.main === module) {
  main();
}
