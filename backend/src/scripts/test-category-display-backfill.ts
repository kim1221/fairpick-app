/**
 * 축제/행사/팝업 특화 정보 백필 테스트
 * 
 * 실행: npx tsx src/scripts/test-category-display-backfill.ts
 */

import { pool } from '../db';
import { aiEnrichmentBackfill } from '../jobs/aiEnrichmentBackfill';

async function testCategoryDisplayBackfill() {
  console.log('\n🧪 축제/행사/팝업 특화 정보 백필 테스트');
  console.log('========================================\n');

  try {
    // 1. 카테고리별로 1개씩만 선택
    const categories = ['축제', '행사', '팝업'];
    
    for (const category of categories) {
      console.log(`\n🔍 ${category} 카테고리 이벤트 검색 중...`);
      
      const result = await pool.query(`
        SELECT id, title, main_category, venue
        FROM canonical_events
        WHERE main_category = $1
          AND status IN ('scheduled', 'ongoing')
          AND (metadata->>'display' IS NULL OR metadata->'display'->$1 IS NULL)
        LIMIT 1
      `, [category]);

      if (result.rows.length === 0) {
        console.log(`  ⚠️  ${category} 카테고리에 처리할 이벤트가 없습니다.`);
        continue;
      }

      const event = result.rows[0];
      console.log(`  ✅ 발견: ${event.title} (ID: ${event.id})`);
      console.log(`     장소: ${event.venue || 'N/A'}\n`);

      // 2. AI Enrichment 실행 (이 이벤트만)
      console.log(`  🤖 AI 분석 시작...`);
      
      // 이벤트 ID를 WHERE 조건에 넣기 위해 임시로 limit=1로 실행
      // 실제로는 해당 이벤트만 처리하도록 수정 필요
      await aiEnrichmentBackfill({
        limit: 1,
        testMode: true,
        useNaverSearch: true,
        onlyMissingTags: false,
        onlyRecent: false,
      });

      // 3. 결과 확인
      const updatedResult = await pool.query(`
        SELECT 
          id, 
          title, 
          main_category,
          metadata->'display' as display_data,
          field_sources
        FROM canonical_events
        WHERE id = $1
      `, [event.id]);

      const updated = updatedResult.rows[0];
      const displayData = updated.display_data;

      console.log(`\n  📊 결과:`);
      console.log(`     카테고리: ${updated.main_category}`);
      
      if (displayData) {
        if (displayData.popup) {
          console.log(`     🏪 팝업 정보:`);
          console.log(`        - 브랜드: ${displayData.popup.brands?.join(', ') || 'N/A'}`);
          console.log(`        - F&B: ${displayData.popup.is_fnb ? 'Yes' : 'No'}`);
          if (displayData.popup.fnb_items?.signature_menu) {
            console.log(`        - 시그니처 메뉴: ${displayData.popup.fnb_items.signature_menu.join(', ')}`);
          }
        } else if (displayData.festival) {
          console.log(`     🎪 축제 정보:`);
          console.log(`        - 주최: ${displayData.festival.organizer || 'N/A'}`);
          console.log(`        - 프로그램: ${displayData.festival.program_highlights?.substring(0, 50) || 'N/A'}...`);
        } else if (displayData.event) {
          console.log(`     📅 행사 정보:`);
          console.log(`        - 참가 대상: ${displayData.event.target_audience || 'N/A'}`);
          console.log(`        - 정원: ${displayData.event.capacity || 'N/A'}`);
        }
      } else {
        console.log(`     ⚠️  display 데이터가 생성되지 않았습니다.`);
      }

      // Field Sources 확인
      if (updated.field_sources) {
        const sources = Object.keys(updated.field_sources).filter(key => key.startsWith('metadata.display.'));
        console.log(`\n     🔖 Field Sources (${sources.length}개):`);
        sources.slice(0, 3).forEach(key => {
          const source = updated.field_sources[key];
          console.log(`        - ${key}: ${source.source} (신뢰도: ${source.confidence}%)`);
        });
        if (sources.length > 3) {
          console.log(`        ... 외 ${sources.length - 3}개`);
        }
      }

      console.log(`\n  ✅ ${category} 테스트 완료!`);
      console.log('  ─────────────────────────────────────');
    }

    console.log('\n\n✅ 모든 카테고리 테스트 완료!');
    console.log('========================================');

  } catch (error) {
    console.error('\n❌ 테스트 실패:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// 실행
if (require.main === module) {
  testCategoryDisplayBackfill()
    .then(() => {
      console.log('\n✅ 테스트 성공');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ 테스트 실패:', error);
      process.exit(1);
    });
}

export { testCategoryDisplayBackfill };

