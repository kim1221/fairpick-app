/**
 * Buzz Score Noise Suppression 검증 스크립트
 *
 * 목표:
 * 1. noise 10개 + normal 10개 샘플링
 * 2. consensusLight, structuralTotal, finalHotScore의 old/new/delta 비교
 * 3. 샘플링 편향 (blog vs web 비율) 분석
 */

import { pool } from '../db';
import {
  calculateConsensusLight,
  calculateStructuralScore,
} from '../lib/hotScoreCalculator';

interface TestEvent {
  id: string;
  title: string;
  main_category: string;
  venue: string | null;
  region: string | null;
  start_at: Date;
  end_at: Date;
  source: string | null;
  lat: number | null;
  lng: number | null;
  image_url: string | null;
  external_links: Record<string, unknown> | null;
  is_featured: boolean | null;

  // 분류용
  is_noise: boolean;
}

interface ScoreComparison {
  id: string;
  title: string;
  category: string;
  is_noise: boolean;

  old_consensus: number;
  new_consensus: number;
  delta_consensus: number;

  old_structural: number;
  new_structural: number;
  delta_structural: number;

  old_final: number;
  new_final: number;
  delta_final: number;
}

// ============================================
// 샘플링 전략
// ============================================

/**
 * Noise 이벤트 샘플링
 *
 * 기준: 제목에 노이즈성 키워드 포함
 */
async function sampleNoiseEvents(limit: number): Promise<TestEvent[]> {
  const noisePatterns = [
    '%중고%', '%당근%', '%부동산%', '%구인%',
    '%판매종료%', '%공연종료%', '%전시종료%',
    '%후기%', '%리뷰%', '%다녀왔어요%',
  ];

  const whereClauses = noisePatterns.map((_, idx) => `title ILIKE $${idx + 1}`).join(' OR ');

  const result = await pool.query<TestEvent>(`
    SELECT
      id,
      title,
      main_category,
      venue,
      region,
      start_at,
      end_at,
      (sources->0->>'source') as source,
      lat,
      lng,
      image_url,
      external_links,
      is_featured,
      true as is_noise
    FROM canonical_events
    WHERE is_deleted = false
      AND end_at >= NOW()
      AND (${whereClauses})
    ORDER BY RANDOM()
    LIMIT $${noisePatterns.length + 1}
  `, [...noisePatterns, limit]);

  return result.rows;
}

/**
 * Normal 이벤트 샘플링
 *
 * 기준: 정상적인 이벤트 (noise 패턴 제외)
 */
async function sampleNormalEvents(limit: number): Promise<TestEvent[]> {
  const result = await pool.query<TestEvent>(`
    SELECT
      id,
      title,
      main_category,
      venue,
      region,
      start_at,
      end_at,
      (sources->0->>'source') as source,
      lat,
      lng,
      image_url,
      external_links,
      is_featured,
      false as is_noise
    FROM canonical_events
    WHERE is_deleted = false
      AND end_at >= NOW()
      AND title NOT ILIKE '%중고%'
      AND title NOT ILIKE '%당근%'
      AND title NOT ILIKE '%부동산%'
      AND title NOT ILIKE '%구인%'
      AND title NOT ILIKE '%판매종료%'
      AND title NOT ILIKE '%공연종료%'
      AND title NOT ILIKE '%전시종료%'
      AND title NOT ILIKE '%후기%'
      AND title NOT ILIKE '%리뷰%'
      AND main_category IN ('전시', '공연', '축제', '팝업')
    ORDER BY RANDOM()
    LIMIT $1
  `, [limit]);

  return result.rows;
}

// ============================================
// Old Score 계산 (블로그 편향 있음)
// ============================================

/**
 * Old Consensus (블로그 편향 - 패치 전 로직)
 *
 * allItems = [...blogItems, ...webItems].slice(0, 12)
 * → 블로그 30개 + 웹 30개 중 앞 12개만 = 블로그만 샘플링
 */
async function calculateOldConsensus(event: TestEvent): Promise<number> {
  // ⚠️ 패치 전 로직을 inline으로 재현 (블로그 concat 편향)
  const { searchNaverBlog, searchNaverWeb, stripHtmlTags } = await import('../lib/naverApi');

  const title = event.title;
  const yearToken = new Date(event.start_at).getFullYear();
  const venueToken = event.venue?.split(' ').slice(0, 2).join(' ') || '';
  const query = `"${title}" ${venueToken} ${yearToken}`.trim();

  try {
    const [blogResult, webResult] = await Promise.allSettled([
      searchNaverBlog({ query, display: 30, sort: 'sim' }),
      searchNaverWeb({ query, display: 30 }),
    ]);

    const blogItems = blogResult.status === 'fulfilled' ? blogResult.value.items : [];
    const webItems = webResult.status === 'fulfilled' ? webResult.value.items : [];

    // 🔴 OLD LOGIC: concat + slice (블로그 편향!)
    const allItems = [...blogItems, ...webItems];
    if (allItems.length === 0) return 0;

    const topItems = allItems.slice(0, 12);  // 앞 12개만 (거의 모두 블로그)

    // 간단한 점수 계산 (실제 로직 단순화)
    let totalScore = 0;
    for (const item of topItems) {
      const text = `${stripHtmlTags(item.title || '')} ${stripHtmlTags(item.description || '')}`.toLowerCase();

      // 제목 매칭
      if (text.includes(title.toLowerCase().slice(0, 10))) {
        totalScore += 40;
      }

      // 연도 매칭
      if (text.includes(String(yearToken))) {
        totalScore += 20;
      }

      // Positive signals
      if (/예매|예약|신청|티켓/.test(text)) {
        totalScore += 20;
      }

      // Negative signals
      if (/판매종료|공연종료|전시종료/.test(text)) {
        totalScore -= 50;
      }
      if (/후기|리뷰/.test(text)) {
        totalScore -= 15;
      }
    }

    const avgScore = totalScore / topItems.length;
    const finalScore = Math.max(0, Math.min(100, Math.round(avgScore)));

    console.log('[Old Consensus]', {
      query: query.slice(0, 50),
      blogItems: blogItems.length,
      webItems: webItems.length,
      topItems: topItems.length,
      score: finalScore,
    });

    await new Promise(resolve => setTimeout(resolve, 500));
    return finalScore;

  } catch (error: any) {
    console.error('[Old Consensus] Error:', error.message);
    return 0;
  }
}

/**
 * Old Structural (변화 없음)
 */
function calculateOldStructural(event: TestEvent): number {
  const result = calculateStructuralScore({
    id: event.id,
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

/**
 * Old Final Score (전시 기준)
 */
function calculateOldFinalScore(consensus: number, structural: number): number {
  // 전시: consensus*0.40 + structural*0.25
  return Math.round(consensus * 0.40 + structural * 0.25);
}

// ============================================
// New Score 계산 (균형 샘플링)
// ============================================

/**
 * New Consensus (균형 샘플링 - 패치 후 로직)
 *
 * blog 6개 + web 6개 = 12개 (균형)
 */
async function calculateNewConsensus(event: TestEvent): Promise<number> {
  // ✅ 패치 후 로직: 현재 hotScoreCalculator.ts의 calculateConsensusLight 호출
  return await calculateConsensusLight({
    id: event.id,
    title: event.title,
    main_category: event.main_category,
    venue: event.venue || undefined,
    region: event.region || undefined,
    start_at: event.start_at,
    end_at: event.end_at,
    source: event.source || undefined,
  });
}

/**
 * New Structural (변화 없음)
 */
function calculateNewStructural(event: TestEvent): number {
  return calculateOldStructural(event);
}

/**
 * New Final Score (동일 공식)
 */
function calculateNewFinalScore(consensus: number, structural: number): number {
  return calculateOldFinalScore(consensus, structural);
}

// ============================================
// 메인 검증 로직
// ============================================

async function main() {
  console.log('\n========================================');
  console.log('Buzz Score Noise Suppression 검증');
  console.log('========================================\n');

  // 1. 샘플링
  console.log('1️⃣ 샘플링 (noise 10 + normal 10)...\n');

  const noiseEvents = await sampleNoiseEvents(10);
  const normalEvents = await sampleNormalEvents(10);
  const allEvents = [...noiseEvents, ...normalEvents];

  console.log(`✓ noise: ${noiseEvents.length}개`);
  console.log(`✓ normal: ${normalEvents.length}개\n`);

  // 2. 점수 계산
  console.log('2️⃣ 점수 계산 중...\n');

  const comparisons: ScoreComparison[] = [];

  for (const event of allEvents) {
    console.log(`  - ${event.title.slice(0, 40)}...`);

    // Old scores
    const oldConsensus = await calculateOldConsensus(event);
    const oldStructural = calculateOldStructural(event);
    const oldFinal = calculateOldFinalScore(oldConsensus, oldStructural);

    // New scores (패치 후 로직)
    const newConsensus = await calculateNewConsensus(event);
    const newStructural = calculateNewStructural(event);
    const newFinal = calculateNewFinalScore(newConsensus, newStructural);

    comparisons.push({
      id: event.id,
      title: event.title,
      category: event.main_category,
      is_noise: event.is_noise,

      old_consensus: oldConsensus,
      new_consensus: newConsensus,
      delta_consensus: newConsensus - oldConsensus,

      old_structural: oldStructural,
      new_structural: newStructural,
      delta_structural: newStructural - oldStructural,

      old_final: oldFinal,
      new_final: newFinal,
      delta_final: newFinal - oldFinal,
    });

    // Rate limit 방지
    await new Promise(resolve => setTimeout(resolve, 600));
  }

  // 3. 결과 출력
  console.log('\n========================================');
  console.log('📊 결과표: Old vs New vs Delta');
  console.log('========================================\n');

  // Noise 그룹
  console.log('🔴 Noise Events:\n');
  const noiseComparisons = comparisons.filter(c => c.is_noise);

  console.log('Title'.padEnd(42) + 'Category'.padEnd(10) + 'Old_C'.padEnd(8) + 'New_C'.padEnd(8) + 'Δ_C'.padEnd(8) + 'Old_S'.padEnd(8) + 'New_S'.padEnd(8) + 'Δ_S'.padEnd(8) + 'Old_F'.padEnd(8) + 'New_F'.padEnd(8) + 'Δ_F');
  console.log('-'.repeat(130));

  for (const c of noiseComparisons) {
    console.log(
      c.title.slice(0, 40).padEnd(42) +
      c.category.padEnd(10) +
      String(c.old_consensus).padEnd(8) +
      String(c.new_consensus).padEnd(8) +
      (c.delta_consensus >= 0 ? '+' : '') + String(c.delta_consensus).padEnd(7) +
      String(c.old_structural).padEnd(8) +
      String(c.new_structural).padEnd(8) +
      (c.delta_structural >= 0 ? '+' : '') + String(c.delta_structural).padEnd(7) +
      String(c.old_final).padEnd(8) +
      String(c.new_final).padEnd(8) +
      (c.delta_final >= 0 ? '+' : '') + String(c.delta_final)
    );
  }

  // Normal 그룹
  console.log('\n🟢 Normal Events:\n');
  const normalComparisons = comparisons.filter(c => !c.is_noise);

  console.log('Title'.padEnd(42) + 'Category'.padEnd(10) + 'Old_C'.padEnd(8) + 'New_C'.padEnd(8) + 'Δ_C'.padEnd(8) + 'Old_S'.padEnd(8) + 'New_S'.padEnd(8) + 'Δ_S'.padEnd(8) + 'Old_F'.padEnd(8) + 'New_F'.padEnd(8) + 'Δ_F');
  console.log('-'.repeat(130));

  for (const c of normalComparisons) {
    console.log(
      c.title.slice(0, 40).padEnd(42) +
      c.category.padEnd(10) +
      String(c.old_consensus).padEnd(8) +
      String(c.new_consensus).padEnd(8) +
      (c.delta_consensus >= 0 ? '+' : '') + String(c.delta_consensus).padEnd(7) +
      String(c.old_structural).padEnd(8) +
      String(c.new_structural).padEnd(8) +
      (c.delta_structural >= 0 ? '+' : '') + String(c.delta_structural).padEnd(7) +
      String(c.old_final).padEnd(8) +
      String(c.new_final).padEnd(8) +
      (c.delta_final >= 0 ? '+' : '') + String(c.delta_final)
    );
  }

  // 4. 통계 요약
  console.log('\n========================================');
  console.log('📈 통계 요약');
  console.log('========================================\n');

  const avgNoiseDelta = noiseComparisons.reduce((sum, c) => sum + c.delta_final, 0) / noiseComparisons.length;
  const avgNormalDelta = normalComparisons.reduce((sum, c) => sum + c.delta_final, 0) / normalComparisons.length;

  console.log(`Noise 평균 Δ_Final:  ${avgNoiseDelta.toFixed(2)}`);
  console.log(`Normal 평균 Δ_Final: ${avgNormalDelta.toFixed(2)}`);
  console.log(`차이 (Normal - Noise): ${(avgNormalDelta - avgNoiseDelta).toFixed(2)}`);

  console.log('\n✅ 검증 완료\n');

  await pool.end();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
