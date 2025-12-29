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

export async function runCollectionJob(): Promise<void> {
  const logId = crypto.randomUUID();
  const startTime = new Date();

  console.log('[CollectJob] Starting collection job...');
  console.log(`[CollectJob] Log ID: ${logId}`);

  // collection_logs 시작 기록
  try {
    await pool.query(`
      INSERT INTO collection_logs (id, source, type, status, started_at, items_count, success_count, failed_count)
      VALUES ($1, 'system', 'collect', 'running', $2, 0, 0, 0)
    `, [logId, startTime]);
  } catch (error) {
    console.error('[CollectJob] Failed to create collection log:', error);
    // 로그 실패해도 job은 계속 진행
  }

  let successCount = 0;
  let failedCount = 0;
  const errorMessages: string[] = [];

  // 각 단계 실행
  for (const step of COLLECTION_STEPS) {
    console.log(`[CollectJob] Running step: ${step.name}...`);

    try {
      // Dynamic import로 모듈 로드
      const module = await import(step.modulePath);
      const func = module[step.functionName];

      if (typeof func !== 'function') {
        console.log(`[CollectJob] ⊘ ${step.name} - Function not found, skipping`);
        continue;
      }

      // 함수 실행
      await func();
      successCount++;
      console.log(`[CollectJob] ✓ ${step.name} - Success`);
    } catch (error: any) {
      if (error?.code === 'MODULE_NOT_FOUND') {
        console.log(`[CollectJob] ⊘ ${step.name} - Module not found, skipping`);
        continue;
      }

      failedCount++;
      const errorMsg = `${step.name}: ${error?.message || String(error)}`;
      errorMessages.push(errorMsg);
      console.error(`[CollectJob] ✗ ${step.name} - Failed:`, error);
      // 실패해도 다음 단계 계속
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
  const errorMessage = errorMessages.length > 0 ? errorMessages.join('; ') : null;

  console.log(`[CollectJob] Completed - Status: ${finalStatus}, Success: ${successCount}, Failed: ${failedCount}`);

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
    `, [completedAt, finalStatus, totalExecuted, successCount, failedCount, errorMessage, logId]);
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
