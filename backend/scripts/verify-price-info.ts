/**
 * Price Info 검증 스크립트
 * 
 * 목적: canonical_events.price_info 필드의 보유율 및 품질 검증
 */

import { pool } from '../src/db';

// ============================================
// 타입 정의
// ============================================

interface PriceInfoStats {
  total: number;
  filled: number;
  null_count: number;
  coverage_percent: number;
}

interface SourceStats extends PriceInfoStats {
  source: string;
}

interface PriceInfoSample {
  id: string;
  title: string;
  source_priority_winner: string;
  price_info: string;
  price_info_length: number;
}

interface LengthDistribution {
  range: string;
  count: number;
  percent: number;
}

// ============================================
// 1. 전체 커버리지
// ============================================

async function getOverallStats(): Promise<PriceInfoStats> {
  const result = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE price_info IS NOT NULL) as filled,
      COUNT(*) FILTER (WHERE price_info IS NULL) as null_count
    FROM canonical_events
  `);

  const row = result.rows[0];
  const total = parseInt(row.total, 10);
  const filled = parseInt(row.filled, 10);
  const null_count = parseInt(row.null_count, 10);

  return {
    total,
    filled,
    null_count,
    coverage_percent: total > 0 ? (filled / total) * 100 : 0,
  };
}

// ============================================
// 2. 소스별 커버리지
// ============================================

async function getStatsBySource(): Promise<SourceStats[]> {
  const result = await pool.query(`
    SELECT
      source_priority_winner as source,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE price_info IS NOT NULL) as filled,
      COUNT(*) FILTER (WHERE price_info IS NULL) as null_count
    FROM canonical_events
    GROUP BY source_priority_winner
    ORDER BY source_priority_winner
  `);

  return result.rows.map(row => {
    const total = parseInt(row.total, 10);
    const filled = parseInt(row.filled, 10);
    const null_count = parseInt(row.null_count, 10);

    return {
      source: row.source,
      total,
      filled,
      null_count,
      coverage_percent: total > 0 ? (filled / total) * 100 : 0,
    };
  });
}

// ============================================
// 3. 길이 분포
// ============================================

async function getLengthDistribution(): Promise<LengthDistribution[]> {
  const result = await pool.query(`
    SELECT
      CASE
        WHEN LENGTH(price_info) <= 20 THEN '1-20'
        WHEN LENGTH(price_info) <= 50 THEN '21-50'
        WHEN LENGTH(price_info) <= 100 THEN '51-100'
        WHEN LENGTH(price_info) <= 200 THEN '101-200'
        ELSE '201+'
      END as range,
      COUNT(*) as count
    FROM canonical_events
    WHERE price_info IS NOT NULL
    GROUP BY range
    ORDER BY MIN(LENGTH(price_info))
  `);

  const total = result.rows.reduce((sum, row) => sum + parseInt(row.count, 10), 0);

  return result.rows.map(row => {
    const count = parseInt(row.count, 10);
    return {
      range: row.range,
      count,
      percent: total > 0 ? (count / total) * 100 : 0,
    };
  });
}

// ============================================
// 4. 샘플 추출
// ============================================

async function getSamples(limit: number = 20): Promise<PriceInfoSample[]> {
  const result = await pool.query(`
    SELECT
      id,
      title,
      source_priority_winner,
      price_info,
      LENGTH(price_info) as price_info_length
    FROM canonical_events
    WHERE price_info IS NOT NULL
    ORDER BY RANDOM()
    LIMIT $1
  `, [limit]);

  return result.rows.map(row => ({
    id: row.id,
    title: row.title,
    source_priority_winner: row.source_priority_winner,
    price_info: row.price_info,
    price_info_length: parseInt(row.price_info_length, 10),
  }));
}

// ============================================
// 보고서 출력
// ============================================

async function printReport() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         price_info 필드 보유율 검증 보고서                    ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');

  // 1. 전체 통계
  console.log('========================================');
  console.log('1. 전체 price_info 커버리지');
  console.log('========================================\n');

  const overall = await getOverallStats();

  console.log(`📊 전체 이벤트: ${overall.total.toLocaleString()}건`);
  console.log(`  - price_info 있음:   ${overall.filled.toLocaleString()}건 (${((overall.filled / overall.total) * 100).toFixed(2)}%)`);
  console.log(`  - price_info 없음:   ${overall.null_count.toLocaleString()}건 (${((overall.null_count / overall.total) * 100).toFixed(2)}%)`);
  console.log(`\n✅ 커버리지: ${overall.coverage_percent.toFixed(2)}%`);

  // 2. 소스별 통계
  console.log('\n========================================');
  console.log('2. 소스별 price_info 커버리지');
  console.log('========================================\n');

  const bySource = await getStatsBySource();

  console.log('┌──────────┬────────┬──────────┬──────────┬────────────┐');
  console.log('│ Source   │ Total  │ Filled   │ NULL     │ Coverage % │');
  console.log('├──────────┼────────┼──────────┼──────────┼────────────┤');
  
  for (const stat of bySource) {
    const source = stat.source.padEnd(8);
    const total = String(stat.total).padStart(6);
    const filled = String(stat.filled).padStart(8);
    const nullCount = String(stat.null_count).padStart(8);
    const coverage = stat.coverage_percent.toFixed(2).padStart(10);
    console.log(`│ ${source} │ ${total} │ ${filled} │ ${nullCount} │ ${coverage} │`);
  }
  console.log('└──────────┴────────┴──────────┴──────────┴────────────┘');

  // 3. 길이 분포
  console.log('\n========================================');
  console.log('3. price_info 길이 분포');
  console.log('========================================\n');

  const distribution = await getLengthDistribution();

  if (distribution.length > 0) {
    console.log('┌───────────┬────────┬────────────┐');
    console.log('│ 길이 범위 │ 건수   │ 비율 (%)   │');
    console.log('├───────────┼────────┼────────────┤');
    
    for (const dist of distribution) {
      const range = dist.range.padEnd(9);
      const count = String(dist.count).padStart(6);
      const percent = dist.percent.toFixed(2).padStart(10);
      console.log(`│ ${range} │ ${count} │ ${percent} │`);
    }
    console.log('└───────────┴────────┴────────────┘');
  } else {
    console.log('  (price_info 데이터 없음)');
  }

  // 4. 샘플 20건
  console.log('\n========================================');
  console.log('4. price_info 샘플 (20건)');
  console.log('========================================\n');

  const samples = await getSamples(20);

  if (samples.length > 0) {
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      console.log(`\n[${i + 1}/${samples.length}] ${sample.id}`);
      console.log(`  제목: ${sample.title.slice(0, 50)}${sample.title.length > 50 ? '...' : ''}`);
      console.log(`  소스: ${sample.source_priority_winner}`);
      console.log(`  길이: ${sample.price_info_length}자`);
      console.log(`  내용: "${sample.price_info.slice(0, 100)}${sample.price_info.length > 100 ? '...' : ''}"`);
    }
  } else {
    console.log('  (샘플 없음)');
  }

  // 5. 최종 결론
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                         최종 결론                              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log('🔍 price_info는 Core Data로서 신뢰 가능한가?');
  
  if (overall.coverage_percent >= 95) {
    console.log('  ✅ YES - 커버리지 95% 이상, Core Data로 신뢰 가능');
  } else if (overall.coverage_percent >= 80) {
    console.log('  🟡 PARTIAL - 커버리지 80% 이상, 일부 보강 필요');
  } else if (overall.coverage_percent >= 50) {
    console.log('  🟠 LIMITED - 커버리지 50% 이상, 대규모 보강 필요');
  } else {
    console.log('  ❌ NO - 커버리지 50% 미만, Core Data로 부적합');
  }

  console.log(`\n📊 현재 커버리지: ${overall.coverage_percent.toFixed(2)}%`);
  console.log(`  - 보유: ${overall.filled.toLocaleString()}건`);
  console.log(`  - 미보유: ${overall.null_count.toLocaleString()}건`);

  console.log('\n💡 원천 API 한계 분석:');
  
  // 소스별 커버리지 비교
  const lowCoverageSources = bySource.filter(s => s.coverage_percent < 50);
  const highCoverageSources = bySource.filter(s => s.coverage_percent >= 80);

  if (lowCoverageSources.length > 0) {
    console.log('\n  📉 낮은 커버리지 소스:');
    for (const source of lowCoverageSources) {
      console.log(`     - ${source.source}: ${source.coverage_percent.toFixed(2)}%`);
      console.log(`       → 원천 API에 가격 필드 부족`);
    }
  }

  if (highCoverageSources.length > 0) {
    console.log('\n  📈 높은 커버리지 소스:');
    for (const source of highCoverageSources) {
      console.log(`     - ${source.source}: ${source.coverage_percent.toFixed(2)}%`);
      console.log(`       → 원천 API 가격 필드 충분`);
    }
  }

  console.log('\n🎯 보강 전략:');
  
  if (overall.coverage_percent < 80) {
    console.log('  1️⃣ 원천 API 한계 확인 완료');
    console.log('     → 추가 보강 방안 검토 필요 (Naver API, AI 생성 등)');
  } else {
    console.log('  ✅ 원천 API만으로 충분한 커버리지 확보');
  }

  console.log('\n');
}

// ============================================
// 메인 실행
// ============================================

async function main() {
  try {
    await printReport();
    process.exit(0);
  } catch (error) {
    console.error('❌ 검증 스크립트 실행 중 에러 발생:', error);
    process.exit(1);
  }
}

// 실행
if (require.main === module) {
  main();
}


