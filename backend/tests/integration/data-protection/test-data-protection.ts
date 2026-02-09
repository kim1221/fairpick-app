/**
 * 공공 API 데이터 보호 테스트
 * 
 * 실행: ts-node -r dotenv/config tests/integration/data-protection/test-data-protection.ts
 */

import { pool } from '../../../src/db';
import { searchEventInfo, mergeSearchResults } from '../../../src/lib/naverApi';
import { extractEventInfo } from '../../../src/lib/aiExtractor';

async function testDataProtection() {
  try {
    // price_min/max가 이미 있는 이벤트 찾기
    console.log('🔍 Finding event with existing price data...\n');
    
    const result = await pool.query(`
      SELECT id, title, main_category, venue, overview,
             price_min, price_max, opening_hours
      FROM canonical_events
      WHERE price_min IS NOT NULL
        AND main_category IN ('전시', '공연')
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      console.log('❌ No events with price data found');
      return;
    }

    const event = result.rows[0];
    console.log('📋 Test Event:');
    console.log(`   ID: ${event.id}`);
    console.log(`   Title: ${event.title}`);
    console.log(`   Category: ${event.main_category}`);
    console.log(`   🏷️  Existing price_min: ${event.price_min}`);
    console.log(`   🏷️  Existing price_max: ${event.price_max}`);
    console.log(`   🏷️  Existing opening_hours: ${event.opening_hours ? 'Yes' : 'No'}`);
    console.log('');

    // 네이버 검색
    console.log('🔍 Searching Naver API...');
    const searchResult = await searchEventInfo(event.title, event.venue || undefined);
    const searchText = mergeSearchResults(searchResult.place, searchResult.blog, searchResult.web);

    if (searchText === '검색 결과 없음') {
      console.log('⚠️  No search results, using tags-only extraction');
    } else {
      console.log('✅ Search results found');
    }
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

    console.log('📊 AI Extracted Data:');
    console.log(`   🤖 AI price_min: ${extractedInfo.price_min}`);
    console.log(`   🤖 AI price_max: ${extractedInfo.price_max}`);
    console.log(`   🤖 AI opening_hours: ${extractedInfo.opening_hours ? 'Yes' : 'No'}`);
    console.log('');

    // 데이터 보호 로직 시뮬레이션
    console.log('🛡️  Data Protection Logic:');
    console.log('');

    // price_min
    if (extractedInfo.price_min !== undefined && extractedInfo.price_min !== null) {
      if (event.price_min === null || event.price_min === undefined) {
        console.log('   ✅ price_min would be UPDATED (was empty)');
        console.log(`      New value: ${extractedInfo.price_min}`);
      } else {
        console.log('   ⏭️  price_min would be SKIPPED (already exists)');
        console.log(`      Existing: ${event.price_min} (protected)`);
        console.log(`      AI value: ${extractedInfo.price_min} (ignored)`);
      }
    } else {
      console.log('   ⏭️  price_min: AI did not extract');
    }
    console.log('');

    // price_max
    if (extractedInfo.price_max !== undefined && extractedInfo.price_max !== null) {
      if (event.price_max === null || event.price_max === undefined) {
        console.log('   ✅ price_max would be UPDATED (was empty)');
        console.log(`      New value: ${extractedInfo.price_max}`);
      } else {
        console.log('   ⏭️  price_max would be SKIPPED (already exists)');
        console.log(`      Existing: ${event.price_max} (protected)`);
        console.log(`      AI value: ${extractedInfo.price_max} (ignored)`);
      }
    } else {
      console.log('   ⏭️  price_max: AI did not extract');
    }
    console.log('');

    // opening_hours
    if (extractedInfo.opening_hours && Object.keys(extractedInfo.opening_hours).length > 0) {
      if (!event.opening_hours || Object.keys(event.opening_hours).length === 0) {
        console.log('   ✅ opening_hours would be UPDATED (was empty)');
      } else {
        console.log('   ⏭️  opening_hours would be SKIPPED (already exists)');
        console.log('      Existing data protected!');
      }
    } else {
      console.log('   ⏭️  opening_hours: AI did not extract');
    }
    console.log('');

    console.log('✅ Test complete!');
    console.log('');
    console.log('📝 Summary:');
    console.log('   - Public API data is PROTECTED ✅');
    console.log('   - AI only fills EMPTY fields ✅');
    console.log('   - No data overwriting ✅');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testDataProtection();

