import { pool } from '../db';
import crypto from 'crypto';

/**
 * 메타데이터 자동 업데이트 Job
 * - is_ending_soon: 종료일 3일 이내 여부
 * - popularity_score: 인기도 점수 (최신성 + 긴급도 + 조회수 + 소스 우선순위)
 */

export async function updateMetadata(): Promise<void> {
  const logId = crypto.randomUUID();

  console.log('[UpdateMetadata] Starting metadata update job...');
  console.log(`[UpdateMetadata] Log ID: ${logId}`);

  // 시작 로그 기록 (started_at = NOW() — DB 서버 시간으로 timezone 일관성 보장)
  try {
    await pool.query(`
      INSERT INTO collection_logs (id, scheduler_job_name, source, type, status, started_at, items_count, success_count, failed_count)
      VALUES ($1, 'metadata', 'system', 'metadata_update', 'running', NOW(), 0, 0, 0)
    `, [logId]);
  } catch (logError) {
    console.error('[UpdateMetadata] Failed to create start log:', logError);
  }

  try {
    // 1. is_ending_soon 업데이트
    // 값이 바뀔 수 있는 이벤트만 처리:
    //   - 이미 true인 것 (종료되거나 구간 벗어나면 false로 바꿔야 함)
    //   - end_at이 마감 임박 구간에 막 진입한 것 (최대 4일 여유)
    const endingSoonResult = await pool.query(`
      UPDATE canonical_events
      SET is_ending_soon = (
        end_at IS NOT NULL AND
        end_at >= CURRENT_DATE AND
        end_at <= CURRENT_DATE + INTERVAL '3 days'
      )
      WHERE is_deleted = false
        AND (
          is_ending_soon = true
          OR end_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '4 days'
        )
      RETURNING id
    `);

    console.log(`[UpdateMetadata] Updated is_ending_soon: ${endingSoonResult.rowCount} rows`);

    // 3. popularity_score 업데이트 (개선된 공식 - 임박 행사 강조)
    // 점수가 바뀔 수 있는 이벤트만 처리:
    //   - 최신성: 등록 후 30일 이내 (created_at 기반 점수가 매일 감소)
    //   - 긴급도: 시작일 90일 이내 (구간 전환 시 점수 변동)
    //   - 종료 임박 구간: end_at 4일 이내
    // 나머지(오래되고 먼 미래 이벤트)는 점수가 고정되므로 스킵
    const popularityResult = await pool.query(`
      UPDATE canonical_events
      SET popularity_score = LEAST(1000, GREATEST(0, (
        -- 기본 점수
        CASE WHEN is_featured THEN 100 ELSE 0 END +
        CASE source_priority_winner
          WHEN 'kopis' THEN 50
          WHEN 'culture' THEN 30
          ELSE 10
        END +

        -- 최신성 점수 (등록 후 30일간 점수 유지, 이후 감소)
        GREATEST(0, 30 - EXTRACT(DAY FROM (CURRENT_DATE - created_at))::INTEGER) +

        -- 긴급도 점수 (시작일이 가까울수록 높은 점수) - 대폭 상향
        CASE
          WHEN start_at <= CURRENT_DATE + INTERVAL '7 days' THEN 300
          WHEN start_at <= CURRENT_DATE + INTERVAL '14 days' THEN 150
          WHEN start_at <= CURRENT_DATE + INTERVAL '30 days' THEN 50
          ELSE 0
        END +

        -- 먼 미래 행사 페널티 (90일 이후 행사는 HOT에서 제외)
        CASE
          WHEN start_at > CURRENT_DATE + INTERVAL '90 days' THEN -500
          ELSE 0
        END +

        -- 종료 임박 페널티 (거의 끝난 이벤트는 HOT에서 제외)
        CASE
          WHEN end_at <= CURRENT_DATE + INTERVAL '3 days' THEN -20
          ELSE 0
        END
      )))
      WHERE is_deleted = false
        AND (
          created_at >= CURRENT_DATE - INTERVAL '30 days'
          OR start_at <= CURRENT_DATE + INTERVAL '90 days'
          OR end_at <= CURRENT_DATE + INTERVAL '4 days'
        )
      RETURNING id
    `);

    console.log(`[UpdateMetadata] Updated popularity_score: ${popularityResult.rowCount} rows`);

    // 4. collection_logs 완료 업데이트
    await pool.query(`
      UPDATE collection_logs
      SET status = 'success', completed_at = NOW(), items_count = $1, success_count = $1
      WHERE id = $2
    `, [popularityResult.rowCount, logId]);

    console.log('[UpdateMetadata] ✓ Metadata update completed successfully');

  } catch (error: any) {
    console.error('[UpdateMetadata] ✗ Failed:', error);

    // 실패 로그 업데이트
    try {
      await pool.query(`
        UPDATE collection_logs
        SET status = 'failed', completed_at = NOW(), failed_count = 1, error_message = $1
        WHERE id = $2
      `, [error.message, logId]);
    } catch (logError) {
      console.error('[UpdateMetadata] Failed to update error log:', logError);
    }

    throw error;
  }
}

/**
 * CLI 실행용 main 함수
 */
async function main() {
  try {
    await updateMetadata();
    console.log('[UpdateMetadata] Job completed');
    process.exit(0);
  } catch (error) {
    console.error('[UpdateMetadata] Fatal error:', error);
    process.exit(1);
  }
}

// CLI에서 직접 실행 시
if (require.main === module) {
  main();
}
