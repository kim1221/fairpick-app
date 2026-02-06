/**
 * 특정 축제 이벤트로 AI 추출 테스트
 */

import { pool } from '../db';
import { searchEventInfo, mergeSearchResults } from '../lib/naverApi';
import { extractEventInfo } from '../lib/aiExtractor';

async function testFestivalAI() {
  const festivalId = '9721e6e7-ab51-4e2d-89b3-0026c50276a2'; // 대관령눈꽃축제
  
  console.log('\n🎪 축제 AI 추출 테스트');
  console.log('========================================\n');

  try {
    // 1. 이벤트 조회
    const result = await pool.query(`
      SELECT id, title, main_category, sub_category, venue, overview
      FROM canonical_events
      WHERE id = $1
    `, [festivalId]);

    if (result.rows.length === 0) {
      console.error('이벤트를 찾을 수 없습니다.');
      return;
    }

    const event = result.rows[0];
    console.log(`📋 이벤트: ${event.title}`);
    console.log(`   카테고리: ${event.main_category}`);
    console.log(`   장소: ${event.venue || 'N/A'}\n`);

    // 2. 네이버 API 검색
    console.log('🔍 네이버 검색 중...');
    const searchResult = await searchEventInfo(event.title, event.venue || undefined);
    const searchText = mergeSearchResults(searchResult.place, searchResult.blog, searchResult.web);

    if (searchText === '검색 결과 없음') {
      console.error('네이버 검색 결과가 없습니다.');
      return;
    }

    console.log(`   검색 결과 길이: ${searchText.length}자\n`);

    // 3. AI 추출
    console.log('🤖 Gemini AI 추출 중...');
    const extractedInfo = await extractEventInfo(
      event.title,
      event.main_category,
      event.sub_category || event.main_category,
      event.overview || null,
      searchText
    );

    console.log('\n✅ AI 추출 완료!\n');
    console.log('📊 추출 결과:');
    console.log('─────────────────────────────────────');

    // 기본 정보
    console.log('\n🎯 기본 정보:');
    if (extractedInfo.start_date) console.log(`   시작일: ${extractedInfo.start_date}`);
    if (extractedInfo.end_date) console.log(`   종료일: ${extractedInfo.end_date}`);
    if (extractedInfo.venue) console.log(`   장소: ${extractedInfo.venue}`);
    if (extractedInfo.address) console.log(`   주소: ${extractedInfo.address}`);

    // 개요
    if (extractedInfo.overview) {
      console.log(`\n📝 개요:\n   ${extractedInfo.overview}`);
    }

    // 운영시간
    if (extractedInfo.opening_hours) {
      console.log('\n🕐 운영시간:');
      if (extractedInfo.opening_hours.weekday) console.log(`   평일: ${extractedInfo.opening_hours.weekday}`);
      if (extractedInfo.opening_hours.weekend) console.log(`   주말: ${extractedInfo.opening_hours.weekend}`);
      if (extractedInfo.opening_hours.notes) console.log(`   비고: ${extractedInfo.opening_hours.notes}`);
    }

    // 가격
    if (extractedInfo.price_min !== undefined || extractedInfo.price_max !== undefined) {
      console.log('\n💰 가격:');
      console.log(`   최소: ${extractedInfo.price_min?.toLocaleString() || 'N/A'}원`);
      console.log(`   최대: ${extractedInfo.price_max?.toLocaleString() || 'N/A'}원`);
      if (extractedInfo.price_notes) console.log(`   상세: ${extractedInfo.price_notes}`);
    }

    // 추천 태그
    if (extractedInfo.derived_tags && extractedInfo.derived_tags.length > 0) {
      console.log(`\n🏷️  추천 태그: ${extractedInfo.derived_tags.join(', ')}`);
    }

    // ⭐⭐⭐ 축제 특화 정보
    if (extractedInfo.festival_display) {
      console.log('\n🎪 축제 특화 정보:');
      console.log('═══════════════════════════════════════');
      
      const festival = extractedInfo.festival_display;
      
      if (festival.organizer) {
        console.log(`   주최/주관: ${festival.organizer}`);
      }
      
      if (festival.program_highlights) {
        console.log(`   주요 프로그램:\n      ${festival.program_highlights}`);
      }
      
      if (festival.food_and_booths) {
        console.log(`   먹거리/부스: ${festival.food_and_booths}`);
      }
      
      if (festival.scale_text) {
        console.log(`   규모: ${festival.scale_text}`);
      }
      
      if (festival.parking_tips) {
        console.log(`   주차 정보:\n      ${festival.parking_tips}`);
      }
      
      console.log('═══════════════════════════════════════');
    } else {
      console.log('\n⚠️  축제 특화 정보가 추출되지 않았습니다.');
    }

    // 다른 카테고리 필드 확인
    console.log('\n🔍 다른 카테고리 필드:');
    console.log(`   exhibition_display: ${extractedInfo.exhibition_display ? 'O' : 'X'}`);
    console.log(`   performance_display: ${extractedInfo.performance_display ? 'O' : 'X'}`);
    console.log(`   event_display: ${extractedInfo.event_display ? 'O' : 'X'}`);
    console.log(`   popup_display: ${extractedInfo.popup_display ? 'O' : 'X'}`);

    console.log('\n✅ 테스트 완료!');
    console.log('========================================\n');

  } catch (error: any) {
    console.error('\n❌ 오류 발생:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

// 실행
if (require.main === module) {
  testFestivalAI()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('테스트 실패:', error);
      process.exit(1);
    });
}

