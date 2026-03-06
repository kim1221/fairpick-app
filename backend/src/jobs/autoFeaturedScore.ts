import { pool } from '../db';

/**
 * featured_score 자동 계산 배치
 *
 * 매일 새벽 진행 중인 이벤트의 featured_score를 자동 계산.
 * 관리자가 admin에서 featured_score 높은 이벤트를 정렬해 빠르게 피처링 후보를 찾을 수 있도록 지원.
 *
 * 점수 공식:
 *   buzz_score * 0.5          (인기도 50%)
 *   + 신규 14일 이내 ? 20 : 0 (신선도 20%)
 *   + 마감 14일 이상 ? 15 : 0 (마감 여유 15%)
 *   + 이미지 있음 ? 10 : 0    (이미지 10%)
 *   + 무료 ? 5 : 0            (무료 보너스 5%)
 */
export async function runAutoFeaturedScore(): Promise<void> {
  console.log('[AutoFeaturedScore] Starting job...');
  console.log(`[AutoFeaturedScore] Execution time: ${new Date().toISOString()}`);

  const result = await pool.query(`
    UPDATE canonical_events SET featured_score = ROUND(
      COALESCE(buzz_score, 0) * 0.5
      + CASE WHEN created_at > NOW() - INTERVAL '14 days' THEN 20 ELSE 0 END
      + CASE WHEN end_at > NOW() + INTERVAL '14 days' THEN 15 ELSE 0 END
      + CASE WHEN image_url IS NOT NULL AND image_url NOT LIKE '%placeholder%' THEN 10 ELSE 0 END
      + CASE WHEN is_free THEN 5 ELSE 0 END
    )::integer
    WHERE is_deleted = false
      AND status != 'cancelled'
      AND end_at >= NOW()
  `);

  console.log(`[AutoFeaturedScore] Updated ${result.rowCount} events.`);
  console.log('[AutoFeaturedScore] Job completed.');
}
