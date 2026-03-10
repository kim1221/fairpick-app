import { pool } from '../db';
import crypto from 'crypto';
import { getKopisBoxOfficeScore } from '../lib/kopisApi';
import {
  calculateConsensusLight,
  calculateStructuralScore,
  calculateTimeBoost,
  calculatePopupCandidateScore,
  calculateValidityScore,
} from '../lib/hotScoreCalculator';

/**
 * Buzz Score 자동 업데이트 Job (Hot Score 통합)
 *
 * buzz_score = hot_score_total (재활용)
 * 
 * 구성:
 * - Internal Buzz: 사용자 행동 (조회/찜/공유)
 * - Consensus: 네이버 검색 합의 (전시/축제/행사/공연)
 * - Structural: 구조적 특징 (모든 카테고리)
 *
 * 카테고리별 공식:
 * - 공연: internal*0.3 + consensus*0.4 + structural*0.3  (KOPIS 비활성화로 consensus 대체)
 * - 전시: internal*0.25 + consensus*0.40 + structural*0.25 + time_boost
 * - 축제: internal*0.20 + consensus*0.35 + structural*0.30
 * - 행사: validity*0.40 + consensus*0.25 + structural*0.15 + internal*0.20
 * - 팝업: candidate*0.40 + internal*0.20
 *
 * 범위: 0~1000 클램핑
 */

// ============================================
// 설정
// ============================================

const CONFIG = {
  LOOKBACK_DAYS: 7, // 집계 기간 (7일)
  WEIGHTS: {
    VIEWS: 0.4,
    ENGAGEMENT: 0.3,
    POPULARITY: 0.3,
  },
  ACTION_MULTIPLIERS: {
    like: 5,
    share: 10,
    ticket_click: 15,
  },
  MIN_SCORE: 0,
  MAX_SCORE: 1000,
  // Naver consensus 캐시 TTL (일 단위)
  // 이벤트당 3일에 1회만 Naver API 호출 → 일일 호출량 ~89% 감소
  CONSENSUS_CACHE_DAYS: 3,
};

// ============================================
// 타입 정의
// ============================================

interface EventBuzzData {
  event_id: string;
  views_7d: number;
  likes_7d: number;
  shares_7d: number;
  ticket_clicks_7d: number;
  popularity_score: number;
  // Hot Score 계산용 추가 필드
  title: string;
  main_category: string;
  venue: string | null;
  region: string | null;
  start_at: Date;
  end_at: Date;
  source: string | null;
  kopis_id: string | null; // external_links.ticket URL에서 추출
  lat: number | null;
  lng: number | null;
  image_url: string | null;
  external_links: Record<string, unknown> | null;
  is_featured: boolean | null;
  created_at: Date;
  // consensus 캐시 확인용 — buzz_components의 기존 값 재사용
  buzz_components: Record<string, any> | null;
}

interface BuzzComponents {
  views_7d: number;
  likes_7d: number;
  shares_7d: number;
  ticket_clicks_7d: number;
  popularity_score: number;
  final_score: number;
  weights: {
    views: number;
    engagement: number;
    popularity: number;
  };
  updated_at: string;
}

// ============================================
// Hot Score 헬퍼 함수들
// ============================================

/**
 * KOPIS 점수 계산 (공연만)
 * 
 * external_links.ticket URL에서 KOPIS ID (mt20Id) 추출하여 사용
 */
async function calculateKopisScore(event: EventBuzzData): Promise<number> {
  if (event.main_category !== '공연' || !event.kopis_id) return 0;
  
  try {
    const score = await getKopisBoxOfficeScore(event.kopis_id);
    console.log(`[KOPIS] ${event.title}: ${score}`);
    return score;
  } catch (error) {
    console.error(`[KOPIS] Error for ${event.title}:`, error);
    return 0;
  }
}

/**
 * Consensus 점수 계산 - light 버전 (Q1만, Naver 2 call/이벤트)
 *
 * 전략: buzz_components에 consensus_updated_at을 캐싱해 3일에 1회만 Naver 호출
 * - 캐시 유효 시: 저장된 consensus 재사용 (Naver 호출 없음)
 * - 캐시 만료 시: calculateConsensusLight (Q1 only, 2 call) 호출 후 타임스탬프 갱신
 *
 * 기존 calculateConsensusScore (Q1+Q2+Q3, 6 call/이벤트) 대비 Naver 호출 ~89% 감소
 */
async function calculateConsensusWithCache(
  event: EventBuzzData,
): Promise<{ score: number; updatedAt: string; fromCache: boolean }> {
  const cachedScore = event.buzz_components?.consensus as number | undefined;
  const cachedAt = event.buzz_components?.consensus_updated_at as string | undefined;

  if (typeof cachedScore === 'number' && cachedAt) {
    const cacheAgeDays = (Date.now() - new Date(cachedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (cacheAgeDays < CONFIG.CONSENSUS_CACHE_DAYS) {
      return { score: cachedScore, updatedAt: cachedAt, fromCache: true };
    }
  }

  // 캐시 만료 or 최초 계산 → Naver API 호출 (light: Q1 only, 2 call)
  try {
    const score = await calculateConsensusLight({
      id: event.event_id,
      title: event.title,
      main_category: event.main_category,
      venue: event.venue || undefined,
      region: event.region || undefined,
      start_at: event.start_at,
      end_at: event.end_at,
      source: event.source || undefined,
    });
    console.log(`[Consensus] ${event.title}: ${score} (light, Naver called)`);
    return { score, updatedAt: new Date().toISOString(), fromCache: false };
  } catch (error) {
    console.error(`[Consensus] Error for ${event.title}:`, error);
    // 실패 시 캐시 값 있으면 재사용, 없으면 0
    return {
      score: typeof cachedScore === 'number' ? cachedScore : 0,
      updatedAt: cachedAt ?? new Date().toISOString(),
      fromCache: true,
    };
  }
}

/**
 * Structural 점수 계산 (모든 카테고리)
 */
function calculateStructural(event: EventBuzzData): number {
    const result = calculateStructuralScore({
      id: event.event_id,
      title: event.title,
      main_category: event.main_category,
      venue: event.venue || undefined,
      region: event.region || undefined,
      start_at: event.start_at,
      end_at: event.end_at,
      source: event.source || undefined,
      lat: event.lat,
      lng: event.lng,
      image_url: event.image_url,
      external_links: event.external_links,
      is_featured: event.is_featured,
    });
  return result.total;
}

// ============================================
// Buzz Score 계산 (기존 - 사용자 행동 기반)
// ============================================

function calculateBuzzScore(data: EventBuzzData): { score: number; components: BuzzComponents } {
  // 1. Views 기여도
  const viewContribution = data.views_7d * CONFIG.WEIGHTS.VIEWS;

  // 2. Engagement (Actions) 기여도
  const engagementScore =
    data.likes_7d * CONFIG.ACTION_MULTIPLIERS.like +
    data.shares_7d * CONFIG.ACTION_MULTIPLIERS.share +
    data.ticket_clicks_7d * CONFIG.ACTION_MULTIPLIERS.ticket_click;
  const engagementContribution = engagementScore * CONFIG.WEIGHTS.ENGAGEMENT;

  // 3. Popularity (큐레이션 점수) 기여도
  const popularityContribution = data.popularity_score * CONFIG.WEIGHTS.POPULARITY;

  // 4. 총합 계산
  const rawScore = viewContribution + engagementContribution + popularityContribution;

  // 5. 0~1000 클램핑
  const finalScore = Math.max(
    CONFIG.MIN_SCORE,
    Math.min(CONFIG.MAX_SCORE, Math.round(rawScore))
  );

  // 6. Components 구성
  const components: BuzzComponents = {
    views_7d: data.views_7d,
    likes_7d: data.likes_7d,
    shares_7d: data.shares_7d,
    ticket_clicks_7d: data.ticket_clicks_7d,
    popularity_score: data.popularity_score,
    final_score: finalScore,
    weights: {
      views: CONFIG.WEIGHTS.VIEWS,
      engagement: CONFIG.WEIGHTS.ENGAGEMENT,
      popularity: CONFIG.WEIGHTS.POPULARITY,
    },
    updated_at: new Date().toISOString(),
  };

  return { score: finalScore, components };
}

// ============================================
// 메인 업데이트 로직
// ============================================

export async function updateBuzzScore(): Promise<void> {
  const logId = crypto.randomUUID();
  const startTime = new Date();

  console.log('[UpdateBuzzScore] Starting buzz score update job...');
  console.log(`[UpdateBuzzScore] Log ID: ${logId}`);
  console.log(`[UpdateBuzzScore] Lookback period: ${CONFIG.LOOKBACK_DAYS} days`);

  try {
    // 1. view_count 캐시 업데이트 (전체 조회수)
    console.log('[UpdateBuzzScore] Step 1: Updating view_count cache...');
    const viewCountResult = await pool.query(`
      WITH view_stats AS (
        SELECT
          event_id,
          COUNT(*) as total_views
        FROM event_views
        GROUP BY event_id
      )
      UPDATE canonical_events ce
      SET view_count = COALESCE(view_stats.total_views, 0)
      FROM view_stats
      WHERE ce.id = view_stats.event_id
        AND ce.is_deleted = false
      RETURNING ce.id
    `);

    console.log(`[UpdateBuzzScore] Updated view_count: ${viewCountResult.rowCount || 0} events`);

    // 2. 7일간 집계 데이터 수집 (Hot Score 계산용 필드 추가)
    console.log('[UpdateBuzzScore] Step 2: Collecting 7-day aggregated data...');
    const aggregatedData = await pool.query<EventBuzzData>(`
      SELECT
        ce.id as event_id,
        ce.title,
        ce.main_category,
        ce.venue,
        ce.region,
        ce.start_at,
        ce.end_at,
        ce.lat,
        ce.lng,
        ce.image_url,
        ce.external_links,
        ce.is_featured,
        (ce.sources->0->>'source') as source,  -- JSONB 배열에서 첫 번째 source 추출
        -- KOPIS ID 추출: external_links.ticket URL에서 mt20Id 파라미터 추출
        (
          SELECT substring(ce.external_links->>'ticket' FROM 'mt20Id=([^&]+)')
        ) as kopis_id,
        COALESCE(view_stats.views_7d, 0)::INTEGER as views_7d,
        COALESCE(action_stats.likes_7d, 0)::INTEGER as likes_7d,
        COALESCE(action_stats.shares_7d, 0)::INTEGER as shares_7d,
        COALESCE(action_stats.ticket_clicks_7d, 0)::INTEGER as ticket_clicks_7d,
        COALESCE(ce.popularity_score, 0)::INTEGER as popularity_score,
        ce.created_at,
        ce.buzz_components  -- consensus 캐시 확인용
      FROM canonical_events ce

      -- 7일간 조회수 집계
      LEFT JOIN (
        SELECT
          event_id,
          COUNT(*) as views_7d
        FROM event_views
        WHERE viewed_at >= NOW() - ($1::int * INTERVAL '1 day')
        GROUP BY event_id
      ) view_stats ON ce.id = view_stats.event_id

      -- 7일간 액션 집계
      LEFT JOIN (
        SELECT
          event_id,
          COUNT(*) FILTER (WHERE action_type = 'like') as likes_7d,
          COUNT(*) FILTER (WHERE action_type = 'share') as shares_7d,
          COUNT(*) FILTER (WHERE action_type = 'ticket_click') as ticket_clicks_7d
        FROM event_actions
        WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
        GROUP BY event_id
      ) action_stats ON ce.id = action_stats.event_id

      WHERE ce.is_deleted = false
        AND ce.end_at >= NOW()  -- 종료되지 않은 이벤트만
        AND (ce.buzz_updated_at IS NULL OR ce.buzz_updated_at < NOW() - INTERVAL '23 hours')  -- 23시간 이내 처리된 이벤트 스킵
      ORDER BY ce.created_at DESC
    `, [CONFIG.LOOKBACK_DAYS]);

    console.log(`[UpdateBuzzScore] Collected data for ${aggregatedData.rowCount} events`);

    // 3. Hot Score 계산 및 업데이트
    console.log('[UpdateBuzzScore] Step 3: Calculating hot_score (buzz_score)...');

    let totalEventsProcessed = 0;
    let zeroScoreCount = 0;
    let maxBuzzScore = 0;
    let totalBuzzScore = 0;
    let naverCallCount = 0;    // 실제 Naver API 호출 수
    let consensusCacheHits = 0; // 캐시 재사용 수

    // 배치 UPDATE용 누적 배열 (루프 내 개별 쿼리 제거)
    const batchIds: string[] = [];
    const batchScores: number[] = [];
    const batchComponents: string[] = [];

    for (const event of aggregatedData.rows) {
      // 3-1. 기존: 내부 buzz_score (사용자 행동)
      const { score: internalBuzz, components: internalComponents } = calculateBuzzScore(event);

      // 3-2. 외부 hot score 컴포넌트
      let consensusScore = 0;
      let consensusUpdatedAt: string | null = null;
      const structuralScore = calculateStructural(event);

      if (['전시', '축제', '행사', '공연'].includes(event.main_category)) {
        const result = await calculateConsensusWithCache(event);
        consensusScore = result.score;
        consensusUpdatedAt = result.updatedAt;
        if (result.fromCache) {
          consensusCacheHits++;
        } else {
          naverCallCount++; // light = 2 Naver calls, 로그용으로 이벤트 단위 카운트
        }
      }

      // 3-3. 카테고리별 최종 점수 계산
      let finalScore = internalBuzz;
      const hotComponents: any = {
        ...internalComponents,
        consensus: consensusScore,
        consensus_updated_at: consensusUpdatedAt, // 캐시 TTL 기준점
        structural: structuralScore,
        internal: internalBuzz,
      };

      if (event.main_category === '공연') {
        // 공연: internal*0.3 + consensus*0.4 + structural*0.3
        finalScore = internalBuzz * 0.3 + consensusScore * 0.4 + structuralScore * 0.3;
        hotComponents.formula = 'performance';
      } else if (event.main_category === '전시') {
        // 전시: internal*0.25 + consensus*0.40 + structural*0.25 + time_boost
        let baseScore = internalBuzz * 0.25 + consensusScore * 0.40 + structuralScore * 0.25;

        // Gemini 제안: 종료 임박 부스트
        const timeBoost = calculateTimeBoost({
          id: event.event_id,
          title: event.title,
          main_category: event.main_category,
          start_at: event.start_at,
          end_at: event.end_at,
        });

        if (timeBoost > 1.0) {
          baseScore *= timeBoost;
          hotComponents.time_boost = timeBoost;
        }

        finalScore = baseScore;
        hotComponents.formula = 'exhibition';
      } else if (event.main_category === '축제') {
        // 축제: internal*0.20 + consensus*0.35 + structural*0.30
        finalScore = internalBuzz * 0.20 + consensusScore * 0.35 + structuralScore * 0.30;
        hotComponents.formula = 'festival';
      } else if (event.main_category === '행사') {
        // 행사: validity*0.40 + consensus*0.25 + structural*0.15 + internal*0.20
        const validityScore = calculateValidityScore({
          id: event.event_id,
          title: event.title,
          main_category: event.main_category,
          venue: event.venue || undefined,
          start_at: event.start_at,
          end_at: event.end_at,
        });

        finalScore =
          validityScore * 0.40 +
          consensusScore * 0.25 +
          structuralScore * 0.15 +
          internalBuzz * 0.20;
        hotComponents.validity = validityScore;
        hotComponents.formula = 'event';
      } else if (event.main_category === '팝업') {
        // 팝업: candidate*0.40 + internal*0.20
        const candidateScore = calculatePopupCandidateScore({
          id: event.event_id,
          title: event.title,
          main_category: event.main_category,
          venue: event.venue || undefined,
          start_at: event.start_at,
          end_at: event.end_at,
        });

        finalScore = candidateScore * 0.40 + internalBuzz * 0.20;
        hotComponents.candidate = candidateScore;
        hotComponents.formula = 'popup';
      } else {
        // 기타: internal만 사용
        finalScore = internalBuzz;
        hotComponents.formula = 'internal_only';
      }

      // 3-4. 0~1000 클램핑
      finalScore = Math.max(CONFIG.MIN_SCORE, Math.min(CONFIG.MAX_SCORE, Math.round(finalScore)));

      // 3-5. 신규 이벤트 가산점 + 시간 감쇠
      const daysInDb = (Date.now() - new Date(event.created_at).getTime()) / (1000 * 60 * 60 * 24);
      // 신규 가산점: 등록 후 14일 이내 최대 +25% (선형 감소)
      const freshnessMultiplier = daysInDb <= 14 ? 1 + (1 - daysInDb / 14) * 0.25 : 1.0;
      // 시간 감쇠: 60일 초과 시 서서히 감소, 180일 시점 최대 -25% (이후 고정)
      const staleMultiplier = daysInDb > 60 ? Math.max(0.75, 1 - (daysInDb - 60) / 480) : 1.0;
      finalScore = Math.max(CONFIG.MIN_SCORE, Math.min(CONFIG.MAX_SCORE,
        Math.round(finalScore * freshnessMultiplier * staleMultiplier)));
      hotComponents.days_in_db = Math.round(daysInDb);
      hotComponents.freshness_multiplier = parseFloat(freshnessMultiplier.toFixed(3));
      hotComponents.stale_multiplier = parseFloat(staleMultiplier.toFixed(3));

      // 3-6. 배치 UPDATE용 누적 (개별 쿼리 X)
      batchIds.push(event.event_id);
      batchScores.push(finalScore);
      batchComponents.push(JSON.stringify(hotComponents));

      totalEventsProcessed++;
      if (finalScore === 0) zeroScoreCount++;
      if (finalScore > maxBuzzScore) maxBuzzScore = finalScore;
      totalBuzzScore += finalScore;
    }

    // 3-7. 배치 UPDATE (이벤트 수와 무관하게 쿼리 1번)
    if (batchIds.length > 0) {
      await pool.query(
        `UPDATE canonical_events AS ce
         SET buzz_score      = u.score::int,
             buzz_updated_at = NOW(),
             buzz_components = u.components::jsonb
         FROM (
           SELECT UNNEST($1::text[]) AS id,
                  UNNEST($2::int[])  AS score,
                  UNNEST($3::text[]) AS components
         ) AS u
         WHERE ce.id::text = u.id`,
        [batchIds, batchScores, batchComponents],
      );
      console.log(`[UpdateBuzzScore] Batch updated ${batchIds.length} events (1 query)`);
    }

    const avgBuzzScore = totalEventsProcessed > 0
      ? (totalBuzzScore / totalEventsProcessed).toFixed(2)
      : 0;

    // 4. collection_logs에 기록
    await pool.query(
      `
      INSERT INTO collection_logs (id, scheduler_job_name, source, type, status, started_at, completed_at, items_count, success_count, failed_count)
      VALUES ($1, 'buzz-score', 'system', 'buzz_score_update', 'success', $2, NOW(), $3, 1, 0)
      `,
      [logId, startTime, totalEventsProcessed]
    );

    // 5. 통계 출력
    const consensusTotal = naverCallCount + consensusCacheHits;
    const cacheHitRate = consensusTotal > 0
      ? ((consensusCacheHits / consensusTotal) * 100).toFixed(1)
      : 'N/A';
    // light 모드는 이벤트당 2 Naver call (blog + web)
    const estimatedNaverCalls = naverCallCount * 2;

    console.log('\n========================================');
    console.log('[UpdateBuzzScore] ✓ Buzz score update completed successfully');
    console.log('========================================');
    console.log(`  total_events_processed:   ${totalEventsProcessed}`);
    console.log(`  avg_buzz_score:           ${avgBuzzScore}`);
    console.log(`  max_buzz_score:           ${maxBuzzScore}`);
    console.log(`  zero_score_count:         ${zeroScoreCount} (${((zeroScoreCount / totalEventsProcessed) * 100).toFixed(1)}%)`);
    console.log(`  lookback_period:          ${CONFIG.LOOKBACK_DAYS} days`);
    console.log(`  consensus_cache_ttl:      ${CONFIG.CONSENSUS_CACHE_DAYS} days`);
    console.log(`  consensus_naver_calls:    ${naverCallCount} events × 2 = ~${estimatedNaverCalls} API calls`);
    console.log(`  consensus_cache_hits:     ${consensusCacheHits} / ${consensusTotal} (${cacheHitRate}%)`);
    console.log('========================================\n');

  } catch (error: any) {
    console.error('[UpdateBuzzScore] ✗ Failed:', error);

    // 실패 로그 기록
    try {
      await pool.query(
        `
        INSERT INTO collection_logs (id, scheduler_job_name, source, type, status, started_at, completed_at, items_count, success_count, failed_count, error_message)
        VALUES ($1, 'buzz-score', 'system', 'buzz_score_update', 'failed', $2, NOW(), 0, 0, 1, $3)
        `,
        [logId, startTime, error.message]
      );
    } catch (logError) {
      console.error('[UpdateBuzzScore] Failed to log error:', logError);
    }

    throw error;
  }
}

// ============================================
// CLI 실행용 main 함수
// ============================================

async function main() {
  try {
    await updateBuzzScore();
    console.log('[UpdateBuzzScore] Job completed');
    process.exit(0);
  } catch (error) {
    console.error('[UpdateBuzzScore] Fatal error:', error);
    process.exit(1);
  }
}

// CLI에서 직접 실행 시
if (require.main === module) {
  main();
}
