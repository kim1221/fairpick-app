/**
 * Popularity Score 실데이터 분석 스크립트
 * 
 * 목적: popularity_score의 실제 DB 분포를 분석하여 
 *       계산된 점수인지 더미값인지 검증
 */

import { pool } from '../src/db';

interface DistributionStats {
  total: number;
  nullCount: number;
  zeroCount: number;
  fixed500Count: number;
  minScore: number | null;
  maxScore: number | null;
  avgScore: number | null;
}

interface FrequencyStats {
  score: number;
  count: number;
}

interface SourceStats {
  source: string;
  count: number;
  avgScore: number;
  minScore: number;
  maxScore: number;
}

interface CategoryStats {
  category: string;
  count: number;
  avgScore: number;
}

// ============================================
// 1. 전체 분포
// ============================================

async function getDistribution(): Promise<DistributionStats> {
  const result = await pool.query(`
    SELECT
      COUNT(*)                       AS total,
      COUNT(*) FILTER (WHERE popularity_score IS NULL) AS null_count,
      COUNT(*) FILTER (WHERE popularity_score = 0)    AS zero_count,
      COUNT(*) FILTER (WHERE popularity_score = 500)  AS fixed_500_count,
      MIN(popularity_score)          AS min_score,
      MAX(popularity_score)          AS max_score,
      AVG(popularity_score)          AS avg_score
    FROM canonical_events
  `);

  const row = result.rows[0];
  return {
    total: parseInt(row.total, 10),
    nullCount: parseInt(row.null_count, 10),
    zeroCount: parseInt(row.zero_count, 10),
    fixed500Count: parseInt(row.fixed_500_count, 10),
    minScore: row.min_score !== null ? parseFloat(row.min_score) : null,
    maxScore: row.max_score !== null ? parseFloat(row.max_score) : null,
    avgScore: row.avg_score !== null ? parseFloat(row.avg_score) : null,
  };
}

// ============================================
// 2. 상위 빈도값 TOP 10
// ============================================

async function getTopFrequencies(): Promise<FrequencyStats[]> {
  const result = await pool.query(`
    SELECT popularity_score AS score, COUNT(*) AS count
    FROM canonical_events
    GROUP BY popularity_score
    ORDER BY count DESC
    LIMIT 10
  `);

  return result.rows.map(row => ({
    score: parseInt(row.score, 10),
    count: parseInt(row.count, 10),
  }));
}

// ============================================
// 3. 소스별 평균/분포
// ============================================

async function getSourceStats(): Promise<SourceStats[]> {
  const result = await pool.query(`
    SELECT 
      source_priority_winner AS source,
      COUNT(*) AS count,
      AVG(popularity_score) AS avg_score,
      MIN(popularity_score) AS min_score,
      MAX(popularity_score) AS max_score
    FROM canonical_events
    GROUP BY source_priority_winner
    ORDER BY count DESC
  `);

  return result.rows.map(row => ({
    source: row.source,
    count: parseInt(row.count, 10),
    avgScore: parseFloat(row.avg_score),
    minScore: parseInt(row.min_score, 10),
    maxScore: parseInt(row.max_score, 10),
  }));
}

// ============================================
// 4. 카테고리별 평균
// ============================================

async function getCategoryStats(): Promise<CategoryStats[]> {
  const result = await pool.query(`
    SELECT 
      main_category AS category,
      COUNT(*) AS count,
      AVG(popularity_score) AS avg_score
    FROM canonical_events
    WHERE main_category IS NOT NULL
    GROUP BY main_category
    ORDER BY count DESC
  `);

  return result.rows.map(row => ({
    category: row.category,
    count: parseInt(row.count, 10),
    avgScore: parseFloat(row.avg_score),
  }));
}

// ============================================
// 5. 샘플 데이터 (각 구간별)
// ============================================

async function getSamples(): Promise<any[]> {
  const result = await pool.query(`
    (
      SELECT '0점' as range, id, title, popularity_score, source_priority_winner, created_at
      FROM canonical_events
      WHERE popularity_score = 0
      ORDER BY created_at DESC
      LIMIT 3
    )
    UNION ALL
    (
      SELECT '1-100점' as range, id, title, popularity_score, source_priority_winner, created_at
      FROM canonical_events
      WHERE popularity_score BETWEEN 1 AND 100
      ORDER BY created_at DESC
      LIMIT 3
    )
    UNION ALL
    (
      SELECT '101-300점' as range, id, title, popularity_score, source_priority_winner, created_at
      FROM canonical_events
      WHERE popularity_score BETWEEN 101 AND 300
      ORDER BY created_at DESC
      LIMIT 3
    )
    UNION ALL
    (
      SELECT '301-500점' as range, id, title, popularity_score, source_priority_winner, created_at
      FROM canonical_events
      WHERE popularity_score BETWEEN 301 AND 500
      ORDER BY created_at DESC
      LIMIT 3
    )
    UNION ALL
    (
      SELECT '500점 이상' as range, id, title, popularity_score, source_priority_winner, created_at
      FROM canonical_events
      WHERE popularity_score > 500
      ORDER BY created_at DESC
      LIMIT 3
    )
    ORDER BY range, created_at DESC
  `);

  return result.rows;
}

// ============================================
// 출력
// ============================================

function printDistribution(stats: DistributionStats): void {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  1. 전체 분포 통계                     ║');
  console.log('╚════════════════════════════════════════╝\n');
  
  console.log(`  Total events:          ${stats.total.toLocaleString()}`);
  console.log(`  NULL count:            ${stats.nullCount.toLocaleString()} (${((stats.nullCount / stats.total) * 100).toFixed(2)}%)`);
  console.log(`  Zero (0) count:        ${stats.zeroCount.toLocaleString()} (${((stats.zeroCount / stats.total) * 100).toFixed(2)}%)`);
  console.log(`  Fixed 500 count:       ${stats.fixed500Count.toLocaleString()} (${((stats.fixed500Count / stats.total) * 100).toFixed(2)}%)`);
  console.log(`  Min score:             ${stats.minScore !== null ? stats.minScore : 'N/A'}`);
  console.log(`  Max score:             ${stats.maxScore !== null ? stats.maxScore : 'N/A'}`);
  console.log(`  Average score:         ${stats.avgScore !== null ? stats.avgScore.toFixed(2) : 'N/A'}`);
}

function printTopFrequencies(frequencies: FrequencyStats[]): void {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  2. 상위 빈도값 TOP 10                 ║');
  console.log('╚════════════════════════════════════════╝\n');
  
  console.log('  Rank  Score       Count        Percentage');
  console.log('  ──────────────────────────────────────────');
  
  const total = frequencies.reduce((sum, f) => sum + f.count, 0);
  
  frequencies.forEach((freq, index) => {
    const percentage = ((freq.count / total) * 100).toFixed(2);
    console.log(
      `  ${(index + 1).toString().padStart(2)}    ${freq.score.toString().padStart(5)}    ${freq.count.toString().padStart(8)}    ${percentage.padStart(6)}%`
    );
  });
}

function printSourceStats(stats: SourceStats[]): void {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  3. 소스별 평균/분포                   ║');
  console.log('╚════════════════════════════════════════╝\n');
  
  console.log('  Source      Count       Avg Score    Min    Max');
  console.log('  ─────────────────────────────────────────────────');
  
  stats.forEach(stat => {
    console.log(
      `  ${stat.source.padEnd(10)} ${stat.count.toString().padStart(6)}    ${stat.avgScore.toFixed(2).padStart(9)}    ${stat.minScore.toString().padStart(4)}   ${stat.maxScore.toString().padStart(4)}`
    );
  });
}

function printCategoryStats(stats: CategoryStats[]): void {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  4. 카테고리별 평균                    ║');
  console.log('╚════════════════════════════════════════╝\n');
  
  console.log('  Category    Count       Avg Score');
  console.log('  ────────────────────────────────────');
  
  stats.forEach(stat => {
    console.log(
      `  ${stat.category.padEnd(10)} ${stat.count.toString().padStart(6)}    ${stat.avgScore.toFixed(2).padStart(9)}`
    );
  });
}

function printSamples(samples: any[]): void {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  5. 샘플 데이터 (구간별)               ║');
  console.log('╚════════════════════════════════════════╝\n');
  
  let currentRange = '';
  
  samples.forEach(sample => {
    if (sample.range !== currentRange) {
      currentRange = sample.range;
      console.log(`\n  [${currentRange}]`);
      console.log('  ───────────────────────────────────────────────');
    }
    
    console.log(`    ${sample.id.slice(0, 8)} | ${sample.popularity_score.toString().padStart(4)} | ${sample.source_priority_winner.padEnd(8)} | ${sample.title.slice(0, 40)}`);
  });
}

// ============================================
// Main
// ============================================

async function main() {
  try {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  Popularity Score 실데이터 분석        ║');
    console.log('╚════════════════════════════════════════╝');

    // 1. 전체 분포
    const distribution = await getDistribution();
    printDistribution(distribution);

    // 2. 상위 빈도값
    const frequencies = await getTopFrequencies();
    printTopFrequencies(frequencies);

    // 3. 소스별 통계
    const sourceStats = await getSourceStats();
    printSourceStats(sourceStats);

    // 4. 카테고리별 통계
    const categoryStats = await getCategoryStats();
    printCategoryStats(categoryStats);

    // 5. 샘플 데이터
    const samples = await getSamples();
    printSamples(samples);

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  ✅ 분석 완료                          ║');
    console.log('╚════════════════════════════════════════╝\n');

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 분석 실패:', error);
    await pool.end();
    process.exit(1);
  }
}

// 실행
main();


