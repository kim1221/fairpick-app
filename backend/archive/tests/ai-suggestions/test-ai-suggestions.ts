/**
 * AI 제안 시스템 테스트 스크립트
 * Phase 1: Migration 확인 및 기본 기능 테스트
 */

import { pool } from '../../../src/db';
import { createSuggestion, getConfidenceLevel } from '../../../src/lib/confidenceCalculator';

async function testAISuggestions() {
  console.log('🧪 AI 제안 시스템 Phase 1 테스트\n');

  // 1. 컬럼 존재 확인
  console.log('📋 Step 1: 컬럼 존재 확인...');
  try {
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'canonical_events' 
      AND column_name IN ('ai_suggestions', 'field_sources')
      ORDER BY column_name;
    `);
    
    console.log('✅ 컬럼 확인 완료:');
    result.rows.forEach(row => {
      console.log(`   - ${row.column_name}: ${row.data_type}`);
    });
    console.log();
  } catch (error: any) {
    console.error('❌ 컬럼 확인 실패:', error.message);
    process.exit(1);
  }

  // 2. 신뢰도 계산 테스트
  console.log('📋 Step 2: 신뢰도 계산 테스트...');
  
  const testCases = [
    {
      name: '출연진 (공공API)',
      field: 'cast',
      value: ['김호영', '이재환', '신재범'],
      source: 'PUBLIC_API' as const,
      sourceDetail: 'KOPIS prfcast field',
    },
    {
      name: '공연 시간 35분 (AI, 비정상)',
      field: 'duration_minutes',
      value: 35,
      source: 'AI' as const,
      sourceDetail: 'Gemini extraction from overview',
    },
    {
      name: '공연 시간 150분 (AI, 정상)',
      field: 'duration_minutes',
      value: 150,
      source: 'AI' as const,
      sourceDetail: 'Gemini extraction from overview',
    },
    {
      name: '가격 80,000원 (Naver API)',
      field: 'price_min',
      value: 80000,
      source: 'NAVER_API' as const,
      sourceDetail: 'Naver Place price info',
    },
  ];

  testCases.forEach(test => {
    const suggestion = createSuggestion(
      test.value,
      test.source,
      test.sourceDetail,
      test.field
    );
    
    const level = getConfidenceLevel(suggestion.confidence);
    const emoji = level === 'high' ? '🟢' : level === 'medium' ? '🟡' : level === 'low' ? '🟠' : '🔴';
    
    console.log(`\n${test.name}:`);
    console.log(`  Value: ${JSON.stringify(test.value)}`);
    console.log(`  Source: ${test.source}`);
    console.log(`  Confidence: ${suggestion.confidence}% ${emoji} (${level})`);
    if (suggestion.warning) {
      console.log(`  ⚠️ Warning: ${suggestion.warning}`);
    }
  });
  console.log();

  // 3. 실제 이벤트에 제안 저장 테스트
  console.log('📋 Step 3: 실제 이벤트에 제안 저장 테스트...');
  
  // 첫 번째 이벤트 가져오기
  const eventResult = await pool.query(`
    SELECT id, title, main_category, ai_suggestions, field_sources
    FROM canonical_events
    WHERE main_category = '공연'
    LIMIT 1;
  `);

  if (eventResult.rows.length === 0) {
    console.log('⚠️ 테스트할 공연 이벤트가 없습니다.');
  } else {
    const event = eventResult.rows[0];
    console.log(`\n테스트 이벤트: ${event.title} (${event.id})`);
    
    // AI 제안 생성
    const suggestions = {
      cast: createSuggestion(
        ['김호영', '이재환', '신재범'],
        'PUBLIC_API',
        'KOPIS prfcast field',
        'cast'
      ),
      duration_minutes: createSuggestion(
        35,
        'AI',
        'Gemini extraction from overview',
        'duration_minutes'
      ),
      overview: createSuggestion(
        '브로드웨이의 감동이 살아있는 대작 뮤지컬...',
        'AI',
        'Gemini generated from search results',
        'overview'
      ),
    };

    // DB에 저장
    await pool.query(`
      UPDATE canonical_events
      SET ai_suggestions = $1
      WHERE id = $2;
    `, [JSON.stringify(suggestions), event.id]);

    console.log('✅ AI 제안 저장 완료');
    console.log('   저장된 제안:');
    Object.entries(suggestions).forEach(([field, suggestion]) => {
      const level = getConfidenceLevel(suggestion.confidence);
      const emoji = level === 'high' ? '🟢' : level === 'medium' ? '🟡' : level === 'low' ? '🟠' : '🔴';
      console.log(`   - ${field}: ${suggestion.confidence}% ${emoji}`);
      if (suggestion.warning) {
        console.log(`     ⚠️ ${suggestion.warning}`);
      }
    });

    // 저장된 데이터 확인
    const verifyResult = await pool.query(`
      SELECT ai_suggestions
      FROM canonical_events
      WHERE id = $1;
    `, [event.id]);

    console.log('\n✅ 저장 확인 완료');
    console.log('   ai_suggestions 필드:', verifyResult.rows[0].ai_suggestions ? '데이터 있음' : '데이터 없음');
  }

  console.log('\n🎉 Phase 1 테스트 완료!\n');
  console.log('다음 단계:');
  console.log('  1. Admin UI에서 이벤트 상세 페이지 열기');
  console.log('  2. ai_suggestions 데이터가 표시되는지 확인');
  console.log('  3. Phase 2 진행 (Backend 로직 수정)');

  await pool.end();
}

testAISuggestions().catch(error => {
  console.error('❌ 테스트 실패:', error);
  process.exit(1);
});

