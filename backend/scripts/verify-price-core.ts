/**
 * Price Core Verification Script
 * 
 * 목적: canonical_events의 가격 Core 필드(is_free, price_info) 검증
 * 
 * 출력:
 * 1. 전체 통계
 * 2. 소스별 통계
 * 3. 교차표 (is_free × price_info)
 * 4. 샘플 데이터 (각 케이스별 5건)
 */

import { pool } from '../src/db';

// ============================================
// 타입 정의
// ============================================

interface GlobalStats {
  total: number;
  isFreeTrue: number;
  isFreeFalse: number;
  priceInfoFilled: number;
  priceInfoNull: number;
}

interface SourceStats {
  source: string;
  total: number;
  isFreeTrue: number;
  isFreeFalse: number;
  priceInfoFilled: number;
  priceInfoNull: number;
  coverage: number; // price_info 채움률
}

interface CrossTabStats {
  isFreeTrue_priceInfoNull: number;
  isFreeTrue_priceInfoFilled: number;
  isFreeFalse_priceInfoNull: number;
  isFreeFalse_priceInfoFilled: number;
}

interface SampleEvent {
  id: string;
  title: string;
  source: string;
  is_free: boolean;
  price_info: string | null;
}

// ============================================
// 통계 조회
// ============================================

async function getGlobalStats(): Promise<GlobalStats> {
  const result = await pool.query(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN is_free = true THEN 1 ELSE 0 END) as is_free_true,
      SUM(CASE WHEN is_free = false THEN 1 ELSE 0 END) as is_free_false,
      SUM(CASE WHEN price_info IS NOT NULL THEN 1 ELSE 0 END) as price_info_filled,
      SUM(CASE WHEN price_info IS NULL THEN 1 ELSE 0 END) as price_info_null
    FROM canonical_events
  `);

  const row = result.rows[0];
  return {
    total: parseInt(row.total, 10),
    isFreeTrue: parseInt(row.is_free_true, 10),
    isFreeFalse: parseInt(row.is_free_false, 10),
    priceInfoFilled: parseInt(row.price_info_filled, 10),
    priceInfoNull: parseInt(row.price_info_null, 10),
  };
}

async function getSourceStats(): Promise<SourceStats[]> {
  const result = await pool.query(`
    SELECT
      source_priority_winner as source,
      COUNT(*) as total,
      SUM(CASE WHEN is_free = true THEN 1 ELSE 0 END) as is_free_true,
      SUM(CASE WHEN is_free = false THEN 1 ELSE 0 END) as is_free_false,
      SUM(CASE WHEN price_info IS NOT NULL THEN 1 ELSE 0 END) as price_info_filled,
      SUM(CASE WHEN price_info IS NULL THEN 1 ELSE 0 END) as price_info_null
    FROM canonical_events
    GROUP BY source_priority_winner
    ORDER BY total DESC
  `);

  return result.rows.map((row) => {
    const total = parseInt(row.total, 10);
    const priceInfoFilled = parseInt(row.price_info_filled, 10);
    const coverage = total > 0 ? (priceInfoFilled / total) * 100 : 0;

    return {
      source: row.source,
      total,
      isFreeTrue: parseInt(row.is_free_true, 10),
      isFreeFalse: parseInt(row.is_free_false, 10),
      priceInfoFilled,
      priceInfoNull: parseInt(row.price_info_null, 10),
      coverage,
    };
  });
}

async function getCrossTabStats(): Promise<CrossTabStats> {
  const result = await pool.query(`
    SELECT
      SUM(CASE WHEN is_free = true AND price_info IS NULL THEN 1 ELSE 0 END) as free_null,
      SUM(CASE WHEN is_free = true AND price_info IS NOT NULL THEN 1 ELSE 0 END) as free_filled,
      SUM(CASE WHEN is_free = false AND price_info IS NULL THEN 1 ELSE 0 END) as paid_null,
      SUM(CASE WHEN is_free = false AND price_info IS NOT NULL THEN 1 ELSE 0 END) as paid_filled
    FROM canonical_events
  `);

  const row = result.rows[0];
  return {
    isFreeTrue_priceInfoNull: parseInt(row.free_null, 10),
    isFreeTrue_priceInfoFilled: parseInt(row.free_filled, 10),
    isFreeFalse_priceInfoNull: parseInt(row.paid_null, 10),
    isFreeFalse_priceInfoFilled: parseInt(row.paid_filled, 10),
  };
}

// ============================================
// 샘플 조회
// ============================================

async function getSamples(
  isFree: boolean,
  priceInfoNull: boolean,
  limit: number = 5
): Promise<SampleEvent[]> {
  const priceCondition = priceInfoNull ? 'IS NULL' : 'IS NOT NULL';

  const result = await pool.query(`
    SELECT
      id,
      title,
      source_priority_winner as source,
      is_free,
      price_info
    FROM canonical_events
    WHERE is_free = $1 AND price_info ${priceCondition}
    ORDER BY updated_at DESC
    LIMIT $2
  `, [isFree, limit]);

  return result.rows;
}

// ============================================
// 출력
// ============================================

function printGlobalStats(stats: GlobalStats): void {
  console.log('\n========================================');
  console.log('1. 전체 통계');
  console.log('========================================');
  console.log(`  Total events:          ${stats.total.toLocaleString()}`);
  console.log(`  is_free = TRUE:        ${stats.isFreeTrue.toLocaleString()}`);
  console.log(`  is_free = FALSE:       ${stats.isFreeFalse.toLocaleString()}`);
  console.log(`  price_info filled:     ${stats.priceInfoFilled.toLocaleString()}`);
  console.log(`  price_info NULL:       ${stats.priceInfoNull.toLocaleString()}`);
  
  const coverage = stats.total > 0 ? (stats.priceInfoFilled / stats.total) * 100 : 0;
  console.log(`  \n  Coverage:              ${coverage.toFixed(2)}%`);
}

function printSourceStats(stats: SourceStats[]): void {
  console.log('\n========================================');
  console.log('2. 소스별 통계');
  console.log('========================================');

  for (const source of stats) {
    console.log(`\n  [${source.source.toUpperCase()}]`);
    console.log(`    Total:               ${source.total.toLocaleString()}`);
    console.log(`    is_free = TRUE:      ${source.isFreeTrue.toLocaleString()}`);
    console.log(`    is_free = FALSE:     ${source.isFreeFalse.toLocaleString()}`);
    console.log(`    price_info filled:   ${source.priceInfoFilled.toLocaleString()}`);
    console.log(`    price_info NULL:     ${source.priceInfoNull.toLocaleString()}`);
    console.log(`    Coverage:            ${source.coverage.toFixed(2)}%`);
  }
}

function printCrossTab(stats: CrossTabStats, total: number): void {
  console.log('\n========================================');
  console.log('3. 교차표 (is_free × price_info)');
  console.log('========================================');
  console.log('');
  console.log('                        price_info NULL    price_info Filled');
  console.log('  ────────────────────────────────────────────────────────────');
  console.log(`  is_free = TRUE        ${stats.isFreeTrue_priceInfoNull.toString().padStart(10)}        ${stats.isFreeTrue_priceInfoFilled.toString().padStart(10)}`);
  console.log(`  is_free = FALSE       ${stats.isFreeFalse_priceInfoNull.toString().padStart(10)}        ${stats.isFreeFalse_priceInfoFilled.toString().padStart(10)}`);
  console.log('');

  // 퍼센트 표시
  const pct1 = total > 0 ? (stats.isFreeTrue_priceInfoNull / total * 100).toFixed(1) : '0.0';
  const pct2 = total > 0 ? (stats.isFreeTrue_priceInfoFilled / total * 100).toFixed(1) : '0.0';
  const pct3 = total > 0 ? (stats.isFreeFalse_priceInfoNull / total * 100).toFixed(1) : '0.0';
  const pct4 = total > 0 ? (stats.isFreeFalse_priceInfoFilled / total * 100).toFixed(1) : '0.0';

  console.log('  비율 (%)');
  console.log('  ────────────────────────────────────────────────────────────');
  console.log(`  is_free = TRUE        ${pct1.padStart(10)}%       ${pct2.padStart(10)}%`);
  console.log(`  is_free = FALSE       ${pct3.padStart(10)}%       ${pct4.padStart(10)}%`);
}

function printSamples(samples: SampleEvent[], label: string): void {
  console.log(`\n  ${label}`);
  console.log('  ────────────────────────────────────────────────────────────');
  
  if (samples.length === 0) {
    console.log('    (No samples)');
    return;
  }

  for (const sample of samples) {
    const priceDisplay = sample.price_info 
      ? sample.price_info.slice(0, 60).replace(/\n/g, ' ')
      : '(NULL)';
    console.log(`    ${sample.id.slice(0, 8)} | [${sample.source.toUpperCase()}] ${sample.title.slice(0, 30)}`);
    console.log(`             price_info: ${priceDisplay}`);
  }
}

async function printAllSamples(): Promise<void> {
  console.log('\n========================================');
  console.log('4. 샘플 데이터 (각 케이스별 최대 5건)');
  console.log('========================================');

  // Case 1: is_free=true AND price_info IS NULL
  const samples1 = await getSamples(true, true, 5);
  printSamples(samples1, 'Case 1: is_free=TRUE, price_info=NULL');

  // Case 2: is_free=true AND price_info IS NOT NULL
  const samples2 = await getSamples(true, false, 5);
  printSamples(samples2, 'Case 2: is_free=TRUE, price_info=Filled');

  // Case 3: is_free=false AND price_info IS NULL
  const samples3 = await getSamples(false, true, 5);
  printSamples(samples3, 'Case 3: is_free=FALSE, price_info=NULL');

  // Case 4: is_free=false AND price_info IS NOT NULL
  const samples4 = await getSamples(false, false, 5);
  printSamples(samples4, 'Case 4: is_free=FALSE, price_info=Filled');
}

// ============================================
// Main
// ============================================

async function main() {
  try {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  Price Core Verification Report       ║');
    console.log('╚════════════════════════════════════════╝');

    // 1. 전체 통계
    const globalStats = await getGlobalStats();
    printGlobalStats(globalStats);

    // 2. 소스별 통계
    const sourceStats = await getSourceStats();
    printSourceStats(sourceStats);

    // 3. 교차표
    const crossTab = await getCrossTabStats();
    printCrossTab(crossTab, globalStats.total);

    // 4. 샘플 데이터
    await printAllSamples();

    console.log('\n========================================');
    console.log('✅ Verification completed');
    console.log('========================================\n');

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Verification failed:', error);
    await pool.end();
    process.exit(1);
  }
}

// 실행
main();


