/**
 * is_free 필드 보유율 검증 스크립트
 * 
 * 목적: canonical_events 테이블의 is_free 필드가 Core Data로서 신뢰 가능한지 검증
 * 
 * 검증 항목:
 * 1. 전체/소스별/카테고리별 is_free 커버리지
 * 2. is_free IS NULL 샘플 분석 (payload 원문 포함)
 * 3. NULL 원인 유형 분류
 * 4. 보강 로직 제안
 */

import { pool } from '../src/db';

// ============================================
// 1. 전체 is_free 커버리지
// ============================================

interface IsFreeStats {
  total: number;
  is_free_true: number;
  is_free_false: number;
  is_free_null: number;
  coverage_percent: number;
}

async function getOverallStats(): Promise<IsFreeStats> {
  const result = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE is_free = true) as is_free_true,
      COUNT(*) FILTER (WHERE is_free = false) as is_free_false,
      COUNT(*) FILTER (WHERE is_free IS NULL) as is_free_null
    FROM canonical_events
  `);

  const row = result.rows[0];
  const total = parseInt(row.total, 10);
  const is_free_null = parseInt(row.is_free_null, 10);

  return {
    total,
    is_free_true: parseInt(row.is_free_true, 10),
    is_free_false: parseInt(row.is_free_false, 10),
    is_free_null,
    coverage_percent: total > 0 ? ((total - is_free_null) / total) * 100 : 0,
  };
}

// ============================================
// 2. 소스별 is_free 커버리지
// ============================================

interface SourceStats extends IsFreeStats {
  source: string;
}

async function getStatsBySource(): Promise<SourceStats[]> {
  const result = await pool.query(`
    SELECT
      source_priority_winner as source,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE is_free = true) as is_free_true,
      COUNT(*) FILTER (WHERE is_free = false) as is_free_false,
      COUNT(*) FILTER (WHERE is_free IS NULL) as is_free_null
    FROM canonical_events
    GROUP BY source_priority_winner
    ORDER BY source_priority_winner
  `);

  return result.rows.map(row => {
    const total = parseInt(row.total, 10);
    const is_free_null = parseInt(row.is_free_null, 10);

    return {
      source: row.source,
      total,
      is_free_true: parseInt(row.is_free_true, 10),
      is_free_false: parseInt(row.is_free_false, 10),
      is_free_null,
      coverage_percent: total > 0 ? ((total - is_free_null) / total) * 100 : 0,
    };
  });
}

// ============================================
// 3. 카테고리별 is_free 커버리지
// ============================================

interface CategoryStats extends IsFreeStats {
  category: string;
}

async function getStatsByCategory(): Promise<CategoryStats[]> {
  const result = await pool.query(`
    SELECT
      main_category as category,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE is_free = true) as is_free_true,
      COUNT(*) FILTER (WHERE is_free = false) as is_free_false,
      COUNT(*) FILTER (WHERE is_free IS NULL) as is_free_null
    FROM canonical_events
    GROUP BY main_category
    ORDER BY main_category
  `);

  return result.rows.map(row => {
    const total = parseInt(row.total, 10);
    const is_free_null = parseInt(row.is_free_null, 10);

    return {
      category: row.category,
      total,
      is_free_true: parseInt(row.is_free_true, 10),
      is_free_false: parseInt(row.is_free_false, 10),
      is_free_null,
      coverage_percent: total > 0 ? ((total - is_free_null) / total) * 100 : 0,
    };
  });
}

// ============================================
// 4. is_free IS NULL 샘플 추출
// ============================================

interface NullSample {
  id: string;
  title: string;
  main_category: string;
  source_priority_winner: string;
  sources: any;
}

async function getNullSamples(limit: number = 20): Promise<NullSample[]> {
  const result = await pool.query(`
    SELECT
      id,
      title,
      main_category,
      source_priority_winner,
      sources
    FROM canonical_events
    WHERE is_free IS NULL
    ORDER BY RANDOM()
    LIMIT $1
  `, [limit]);

  return result.rows;
}

// ============================================
// 5. Raw payload에서 가격 필드 추출
// ============================================

async function getRawPayload(source: string, rawId: string): Promise<any> {
  const tableMap: Record<string, string> = {
    kopis: 'raw_kopis_events',
    culture: 'raw_culture_events',
    tour: 'raw_tour_events',
  };

  const tableName = tableMap[source];
  if (!tableName) {
    return null;
  }

  const result = await pool.query(`SELECT payload FROM ${tableName} WHERE id = $1`, [rawId]);
  return result.rows[0]?.payload || null;
}

function extractPriceFields(payload: any): Record<string, any> {
  if (!payload) return {};

  const priceKeys = [
    'price', 'fee', 'ticket', 'cost', 'charge', 'admission',
    'pcseguidance', // KOPIS
    'useTimeFestival', 'useFee', 'usetimefestival', 'usefee', // TourAPI
    'serviceFee', // Culture
  ];

  const extracted: Record<string, any> = {};

  for (const key of priceKeys) {
    // Case-insensitive search
    const matchedKey = Object.keys(payload).find(k => k.toLowerCase() === key.toLowerCase());
    if (matchedKey && payload[matchedKey]) {
      extracted[matchedKey] = payload[matchedKey];
    }
  }

  return extracted;
}

// ============================================
// 6. NULL 원인 분류
// ============================================

type NullReason =
  | 'NO_PRICE_FIELD'          // payload에 가격 필드 자체가 없음
  | 'EMPTY_PRICE_FIELD'       // 가격 필드는 있지만 빈 값
  | 'COMPLEX_TEXT'            // "전석 30,000원" 같은 복잡한 문자열
  | 'MIXED_TEXT'              // "무료(사전예약)" 같은 혼합형
  | 'HTML_ENTITY'             // HTML 태그/엔티티
  | 'NEEDS_DETAIL_API'        // 목록 API에 없고 상세 API에만 있을 가능성
  | 'OTHER';                  // 기타

interface NullReasonAnalysis {
  reason: NullReason;
  description: string;
  example?: string;
}

function classifyNullReason(priceFields: Record<string, any>): NullReasonAnalysis {
  // 1. 가격 필드 자체가 없음
  if (Object.keys(priceFields).length === 0) {
    return {
      reason: 'NO_PRICE_FIELD',
      description: 'payload에 가격 관련 필드 자체가 없음',
    };
  }

  // 2. 가격 필드는 있지만 빈 값
  const values = Object.values(priceFields);
  const allEmpty = values.every(v => !v || (typeof v === 'string' && v.trim() === ''));
  
  if (allEmpty) {
    return {
      reason: 'EMPTY_PRICE_FIELD',
      description: '가격 필드는 있지만 빈 값',
      example: JSON.stringify(priceFields),
    };
  }

  // 3. 실제 값이 있는 경우
  const firstValue = values.find(v => v && (typeof v !== 'string' || v.trim() !== ''));
  const valueStr = typeof firstValue === 'string' ? firstValue : JSON.stringify(firstValue);

  // HTML 태그/엔티티 체크
  if (/<[^>]+>|&[a-z]+;|&#\d+;/i.test(valueStr)) {
    return {
      reason: 'HTML_ENTITY',
      description: 'HTML 태그 또는 엔티티 포함',
      example: valueStr.slice(0, 100),
    };
  }

  // 혼합형 체크 ("무료(조건)")
  if (/무료.*[\(\[]|[\(\[].*무료/i.test(valueStr)) {
    return {
      reason: 'MIXED_TEXT',
      description: '무료 + 조건부 문구 혼합',
      example: valueStr.slice(0, 100),
    };
  }

  // 복잡한 가격 구조 ("VIP석 50,000원 / R석 30,000원")
  if (/\d{1,3}(,\d{3})*원/.test(valueStr) && valueStr.length > 20) {
    return {
      reason: 'COMPLEX_TEXT',
      description: '좌석별 가격 등 복잡한 구조',
      example: valueStr.slice(0, 100),
    };
  }

  // 상세 API 필요 (짧은 텍스트지만 파싱 안 됨)
  if (valueStr.length < 50) {
    return {
      reason: 'NEEDS_DETAIL_API',
      description: '목록 API 정보 부족, 상세 API 필요 가능성',
      example: valueStr,
    };
  }

  // 기타
  return {
    reason: 'OTHER',
    description: '기타 원인',
    example: valueStr.slice(0, 100),
  };
}

// ============================================
// 7. 보고서 출력
// ============================================

async function printReport() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║            is_free 필드 보유율 검증 보고서                    ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');

  // 1. 전체 통계
  console.log('========================================');
  console.log('1. 전체 is_free 커버리지');
  console.log('========================================\n');

  const overall = await getOverallStats();

  console.log(`📊 전체 이벤트: ${overall.total.toLocaleString()}건`);
  console.log(`  - is_free = true:   ${overall.is_free_true.toLocaleString()}건 (${((overall.is_free_true / overall.total) * 100).toFixed(2)}%)`);
  console.log(`  - is_free = false:  ${overall.is_free_false.toLocaleString()}건 (${((overall.is_free_false / overall.total) * 100).toFixed(2)}%)`);
  console.log(`  - is_free IS NULL:  ${overall.is_free_null.toLocaleString()}건 (${((overall.is_free_null / overall.total) * 100).toFixed(2)}%)`);
  console.log(`\n✅ 커버리지: ${overall.coverage_percent.toFixed(2)}%`);

  // 2. 소스별 통계
  console.log('\n========================================');
  console.log('2. 소스별 is_free 커버리지');
  console.log('========================================\n');

  const bySource = await getStatsBySource();

  console.log('┌──────────┬────────┬──────────┬───────────┬──────────┬────────────┐');
  console.log('│ Source   │ Total  │ True     │ False     │ NULL     │ Coverage % │');
  console.log('├──────────┼────────┼──────────┼───────────┼──────────┼────────────┤');
  
  for (const stat of bySource) {
    const source = stat.source.padEnd(8);
    const total = String(stat.total).padStart(6);
    const isTrue = String(stat.is_free_true).padStart(8);
    const isFalse = String(stat.is_free_false).padStart(9);
    const isNull = String(stat.is_free_null).padStart(8);
    const coverage = stat.coverage_percent.toFixed(2).padStart(10);
    console.log(`│ ${source} │ ${total} │ ${isTrue} │ ${isFalse} │ ${isNull} │ ${coverage} │`);
  }
  console.log('└──────────┴────────┴──────────┴───────────┴──────────┴────────────┘');

  // 3. 카테고리별 통계
  console.log('\n========================================');
  console.log('3. 카테고리별 is_free 커버리지');
  console.log('========================================\n');

  const byCategory = await getStatsByCategory();

  console.log('┌──────────┬────────┬──────────┬───────────┬──────────┬────────────┐');
  console.log('│ Category │ Total  │ True     │ False     │ NULL     │ Coverage % │');
  console.log('├──────────┼────────┼──────────┼───────────┼──────────┼────────────┤');
  
  for (const stat of byCategory) {
    const category = (stat.category || '(null)').padEnd(8);
    const total = String(stat.total).padStart(6);
    const isTrue = String(stat.is_free_true).padStart(8);
    const isFalse = String(stat.is_free_false).padStart(9);
    const isNull = String(stat.is_free_null).padStart(8);
    const coverage = stat.coverage_percent.toFixed(2).padStart(10);
    console.log(`│ ${category} │ ${total} │ ${isTrue} │ ${isFalse} │ ${isNull} │ ${coverage} │`);
  }
  console.log('└──────────┴────────┴──────────┴───────────┴──────────┴────────────┘');

  // 4. is_free IS NULL 샘플 분석
  if (overall.is_free_null > 0) {
    console.log('\n========================================');
    console.log('4. is_free IS NULL 샘플 분석 (20건)');
    console.log('========================================\n');

    const samples = await getNullSamples(20);
    const reasonCounts: Record<NullReason, number> = {
      NO_PRICE_FIELD: 0,
      EMPTY_PRICE_FIELD: 0,
      COMPLEX_TEXT: 0,
      MIXED_TEXT: 0,
      HTML_ENTITY: 0,
      NEEDS_DETAIL_API: 0,
      OTHER: 0,
    };

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      console.log(`\n[${i + 1}/${samples.length}] ${sample.id}`);
      console.log(`  제목: ${sample.title}`);
      console.log(`  카테고리: ${sample.main_category}`);
      console.log(`  소스: ${sample.source_priority_winner}`);

      // sources에서 rawId 추출
      const sources = typeof sample.sources === 'string' 
        ? JSON.parse(sample.sources) 
        : sample.sources;
      
      const rawId = sources[0]?.rawId;
      
      if (rawId) {
        const payload = await getRawPayload(sample.source_priority_winner, rawId);
        const priceFields = extractPriceFields(payload);

        if (Object.keys(priceFields).length > 0) {
          console.log(`  가격 필드:`);
          for (const [key, value] of Object.entries(priceFields)) {
            const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
            console.log(`    - ${key}: ${valueStr.slice(0, 100)}${valueStr.length > 100 ? '...' : ''}`);
          }
        } else {
          console.log(`  가격 필드: (없음)`);
        }

        // 원인 분류
        const analysis = classifyNullReason(priceFields);
        console.log(`  원인: ${analysis.reason} - ${analysis.description}`);
        if (analysis.example) {
          console.log(`  예시: ${analysis.example}`);
        }

        reasonCounts[analysis.reason]++;
      } else {
        console.log(`  ⚠️ rawId를 찾을 수 없음`);
      }
    }

    // 5. 원인 유형별 통계
    console.log('\n========================================');
    console.log('5. NULL 원인 유형 분류');
    console.log('========================================\n');

    console.log('┌──────────────────────┬────────┬────────────┐');
    console.log('│ 원인 유형            │ 건수   │ 비율 (%)   │');
    console.log('├──────────────────────┼────────┼────────────┤');

    const totalSamples = samples.length;
    for (const [reason, count] of Object.entries(reasonCounts)) {
      if (count > 0) {
        const reasonLabel = reason.padEnd(20);
        const countStr = String(count).padStart(6);
        const percent = ((count / totalSamples) * 100).toFixed(2).padStart(10);
        console.log(`│ ${reasonLabel} │ ${countStr} │ ${percent} │`);
      }
    }
    console.log('└──────────────────────┴────────┴────────────┘');

    // 원인 유형 설명
    console.log('\n원인 유형 상세:');
    console.log('  - NO_PRICE_FIELD:    payload에 가격 필드 자체가 없음');
    console.log('  - EMPTY_PRICE_FIELD: 가격 필드는 있지만 빈 값');
    console.log('  - COMPLEX_TEXT:      "VIP석 50,000원 / R석 30,000원" 등 복잡한 구조');
    console.log('  - MIXED_TEXT:        "무료(사전예약)" 등 조건부 문구 혼합');
    console.log('  - HTML_ENTITY:       HTML 태그 또는 엔티티 포함');
    console.log('  - NEEDS_DETAIL_API:  목록 API 정보 부족, 상세 API 필요 가능성');
    console.log('  - OTHER:             기타 원인');
  }

  // 6. 최종 결론
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                         최종 결론                              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log('🔍 is_free는 현재 Core Data로서 신뢰 가능한가?');
  
  if (overall.coverage_percent >= 95) {
    console.log('  ✅ YES - 커버리지 95% 이상, Core Data로 신뢰 가능');
  } else if (overall.coverage_percent >= 80) {
    console.log('  🟡 PARTIAL - 커버리지 80% 이상, 일부 보강 필요');
  } else {
    console.log('  ❌ NO - 커버리지 80% 미만, 대규모 보강 필요');
  }

  console.log(`\n📊 현재 커버리지: ${overall.coverage_percent.toFixed(2)}%`);
  console.log(`  - NULL 건수: ${overall.is_free_null.toLocaleString()}건 (${((overall.is_free_null / overall.total) * 100).toFixed(2)}%)`);

  console.log('\n💡 100% 보장을 위한 보강 로직:');
  
  // 소스별 커버리지가 낮은 곳 식별
  const lowCoverageSources = bySource.filter(s => s.coverage_percent < 90);
  if (lowCoverageSources.length > 0) {
    console.log('\n  1️⃣ 소스별 보강:');
    for (const source of lowCoverageSources) {
      console.log(`     - ${source.source}: 커버리지 ${source.coverage_percent.toFixed(2)}%`);
      console.log(`       → ${source.is_free_null}건 보강 필요`);
    }
  }

  console.log('\n  2️⃣ 파싱 로직 개선:');
  console.log('     - KOPIS pcseguidance 파서 강화 (복잡한 가격 구조 처리)');
  console.log('     - Culture/Tour API의 useFee 필드 추가 파싱');
  console.log('     - HTML 엔티티 디코딩 추가');
  console.log('     - "무료(조건)" 형태 패턴 매칭 개선');

  console.log('\n  3️⃣ 상세 API 활용:');
  console.log('     - 목록 API에 가격 정보가 없는 경우 상세 API 호출');
  console.log('     - detailBackfill과 유사한 priceBackfill 작업 고려');

  console.log('\n  4️⃣ 기본값 전략:');
  console.log('     - NULL인 경우 → is_free = false (기본값)');
  console.log('     - 단, 무료 이벤트를 놓치는 리스크 있음');
  console.log('     - 대안: "가격 정보 미확인" 플래그 추가');

  console.log('\n🎯 원인 판정:');
  
  if (overall.coverage_percent >= 95) {
    console.log('  ✅ 파싱 로직 대부분 정상 작동');
    console.log('  ✅ 일부 NULL은 원천 API 한계');
  } else if (overall.coverage_percent >= 80) {
    console.log('  🟡 파싱 로직 개선 + API 한계 혼합');
    console.log('  🟡 특정 소스/패턴에서 파싱 실패');
  } else {
    console.log('  ❌ 파싱 로직에 문제 있음');
    console.log('  ❌ 대규모 개선 필요');
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


