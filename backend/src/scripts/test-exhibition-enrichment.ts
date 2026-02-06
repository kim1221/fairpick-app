/**
 * 전시 이벤트 Phase 3 필드 테스트 스크립트
 * 
 * 실행: ts-node -r dotenv/config src/scripts/test-exhibition-enrichment.ts
 */

import { pool } from '../db';
import { searchEventInfo, mergeSearchResults } from '../lib/naverApi';
import { extractEventInfo } from '../lib/aiExtractor';

async function testExhibitionEnrichment() {
  try {
    // 전시 이벤트 1개 조회
    const result = await pool.query(`
      SELECT id, title, main_category, venue, overview
      FROM canonical_events
      WHERE main_category = '전시'
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      console.log('❌ No exhibition events found');
      return;
    }

    const event = result.rows[0];
    console.log('📋 Testing exhibition event:');
    console.log(`   ID: ${event.id}`);
    console.log(`   Title: ${event.title}`);
    console.log(`   Venue: ${event.venue}`);
    console.log('');

    // 네이버 검색
    console.log('🔍 Searching Naver API...');
    const searchResult = await searchEventInfo(event.title, event.venue || undefined);
    const searchText = mergeSearchResults(searchResult.place, searchResult.blog, searchResult.web);

    if (searchText === '검색 결과 없음') {
      console.log('❌ No search results found');
      return;
    }

    console.log('✅ Search results found');
    console.log('');

    // AI 추출
    console.log('🤖 Extracting with AI...');
    const extractedInfo = await extractEventInfo(
      event.title,
      event.main_category,
      event.overview,
      searchText
    );

    if (!extractedInfo) {
      console.log('❌ AI extraction failed');
      return;
    }

    console.log('✅ AI extraction complete');
    console.log('');

    // Phase 3 필드 확인
    console.log('📊 Phase 3 Exhibition Display Fields:');
    console.log(JSON.stringify(extractedInfo.exhibition_display, null, 2));
    console.log('');

    // DB 업데이트 (선택 사항)
    console.log('💾 Updating database...');
    const displayData = {
      exhibition: extractedInfo.exhibition_display
    };

    await pool.query(`
      UPDATE canonical_events
      SET metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{display}',
        $1::jsonb,
        true
      ),
      updated_at = NOW()
      WHERE id = $2
    `, [JSON.stringify(displayData), event.id]);

    console.log('✅ Database updated');
    console.log('');

    // 최종 확인
    const finalResult = await pool.query(`
      SELECT jsonb_pretty(metadata->'display') as display_data
      FROM canonical_events
      WHERE id = $1
    `, [event.id]);

    console.log('🎨 Final Display Data:');
    console.log(finalResult.rows[0].display_data);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testExhibitionEnrichment();

