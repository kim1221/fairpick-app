/**
 * AI 제안 데이터 확인 스크립트
 */

import { pool } from '../db';

async function checkAISuggestions() {
  console.log('🔍 AI 제안 데이터 확인 중...\n');

  try {
    // ai_suggestions가 있는 이벤트 조회
    const result = await pool.query(`
      SELECT 
        id, 
        title, 
        main_category,
        ai_suggestions,
        field_sources,
        jsonb_typeof(ai_suggestions) as ai_suggestions_type,
        jsonb_typeof(field_sources) as field_sources_type
      FROM canonical_events
      WHERE ai_suggestions IS NOT NULL 
        AND ai_suggestions != '{}'::jsonb
      LIMIT 5;
    `);

    console.log(`✅ ai_suggestions가 있는 이벤트: ${result.rows.length}개\n`);

    result.rows.forEach((event, idx) => {
      console.log(`\n[${idx + 1}] ${event.title}`);
      console.log(`  ID: ${event.id}`);
      console.log(`  카테고리: ${event.main_category}`);
      console.log(`  ai_suggestions 타입: ${event.ai_suggestions_type}`);
      console.log(`  ai_suggestions 키 개수: ${event.ai_suggestions ? Object.keys(event.ai_suggestions).length : 0}`);
      
      if (event.ai_suggestions) {
        console.log(`  제안 필드: ${Object.keys(event.ai_suggestions).join(', ')}`);
        
        // 첫 번째 제안 상세 정보
        const firstKey = Object.keys(event.ai_suggestions)[0];
        if (firstKey) {
          const suggestion = event.ai_suggestions[firstKey];
          console.log(`\n  첫 번째 제안 (${firstKey}):`);
          console.log(`    - 신뢰도: ${suggestion.confidence}%`);
          console.log(`    - 출처: ${suggestion.source}`);
          console.log(`    - 출처 상세: ${suggestion.source_detail}`);
          
          let valuePreview = suggestion.value;
          if (typeof valuePreview === 'string' && valuePreview.length > 100) {
            valuePreview = valuePreview.substring(0, 100) + '...';
          } else if (typeof valuePreview === 'object') {
            valuePreview = JSON.stringify(valuePreview).substring(0, 100) + '...';
          }
          console.log(`    - 값: ${valuePreview}`);
        }
      }
      
      console.log(`  field_sources 타입: ${event.field_sources_type}`);
      console.log(`  field_sources 키 개수: ${event.field_sources ? Object.keys(event.field_sources).length : 0}`);
    });

    if (result.rows.length === 0) {
      console.log('\n⚠️ ai_suggestions가 있는 이벤트가 없습니다.');
      console.log('\n다음 중 하나를 시도해보세요:');
      console.log('1. Admin UI에서 "빈 필드만 AI 보완" 실행');
      console.log('2. npm run test:phase2 실행');
    }

  } catch (error: any) {
    console.error('❌ 오류:', error.message);
  } finally {
    await pool.end();
  }
}

checkAISuggestions();

