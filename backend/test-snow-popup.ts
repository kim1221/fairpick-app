/**
 * 스노우 팝업 단일 테스트
 */

import { pool } from './src/db';
import { searchEventInfo, mergeSearchResults } from './src/lib/naverApi';
import { extractEventInfo } from './src/lib/aiExtractor';

interface Event {
  id: string;
  title: string;
  main_category: string;
  venue: string | null;
  overview: string | null;
}

async function testSnowPopup() {
  console.log('\n🍦 스노우 팝업 단일 테스트\n');

  try {
    // 스노우 팝업 조회
    const result = await pool.query<Event>(`
      SELECT id, title, main_category, venue, overview
      FROM canonical_events
      WHERE title LIKE '%스노우%롯데월드몰%'
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      console.log('❌ 스노우 팝업을 찾을 수 없습니다.');
      process.exit(1);
    }

    const event = result.rows[0];
    console.log('📌 이벤트 정보:');
    console.log('   - 제목:', event.title);
    console.log('   - 카테고리:', event.main_category);
    console.log('   - 장소:', event.venue);
    console.log('');

    // 네이버 검색
    console.log('🔍 네이버 검색 중...');
    const searchResult = await searchEventInfo(event.title, event.venue || undefined);
    const searchText = mergeSearchResults(searchResult.place, searchResult.blog, searchResult.web);
    
    console.log('📄 검색 결과 전체:');
    console.log(searchText);
    console.log('\n' + '='.repeat(80) + '\n');

    // 네이버 플레이스 링크 추출
    let naverPlaceLink: string | null = null;
    if (searchResult.place && searchResult.place.items && searchResult.place.items.length > 0) {
      const firstPlace = searchResult.place.items[0];
      if (firstPlace.link && firstPlace.link.trim()) {
        naverPlaceLink = firstPlace.link.trim();
        console.log(`📎 네이버 플레이스 링크: ${naverPlaceLink}\n`);
      }
    }

    // AI 추출
    console.log('🤖 AI 정보 추출 중...');
    const extractedInfo = await extractEventInfo(
      event.title,
      event.main_category,
      event.overview,
      searchText
    );

    if (!extractedInfo) {
      console.log('❌ AI 추출 실패');
      process.exit(1);
    }

    console.log('\n✅ 추출 결과:');
    console.log('');
    console.log('🏷️  Derived Tags:', extractedInfo.derived_tags);
    console.log('🕐 Opening Hours:', JSON.stringify(extractedInfo.opening_hours, null, 2));
    console.log('💰 Price:', {
      min: extractedInfo.price_min,
      max: extractedInfo.price_max,
      notes: extractedInfo.price_notes,
    });
    console.log('🔗 External Links:', JSON.stringify(extractedInfo.external_links, null, 2));
    console.log('📝 Reservation:', {
      required: extractedInfo.reservation_required,
      link: extractedInfo.reservation_link,
    });
    console.log('🎫 Age Restriction:', extractedInfo.age_restriction);
    console.log('');

    // DB 업데이트
    console.log('💾 DB 업데이트 중...');
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramIndex = 1;

    if (extractedInfo.opening_hours && Object.keys(extractedInfo.opening_hours).length > 0) {
      updateFields.push(`opening_hours = $${paramIndex++}`);
      updateValues.push(JSON.stringify(extractedInfo.opening_hours));
    }

    if (extractedInfo.price_min !== undefined && extractedInfo.price_min !== null) {
      updateFields.push(`price_min = $${paramIndex++}`);
      updateValues.push(extractedInfo.price_min);
    }

    if (extractedInfo.price_max !== undefined && extractedInfo.price_max !== null) {
      updateFields.push(`price_max = $${paramIndex++}`);
      updateValues.push(extractedInfo.price_max);
    }

    if (extractedInfo.derived_tags && extractedInfo.derived_tags.length > 0) {
      updateFields.push(`derived_tags = $${paramIndex++}`);
      updateValues.push(JSON.stringify(extractedInfo.derived_tags));
    }

    // external_links 업데이트 (네이버 플레이스 링크 자동 추가)
    const externalLinks: any = { ...(extractedInfo.external_links || {}) };
    if (naverPlaceLink && !externalLinks.official) {
      externalLinks.official = naverPlaceLink;
      console.log(`📎 네이버 플레이스 링크를 official로 설정`);
    }
    if (Object.keys(externalLinks).length > 0) {
      updateFields.push(`external_links = COALESCE(external_links, '{}'::jsonb) || $${paramIndex++}::jsonb`);
      updateValues.push(JSON.stringify(externalLinks));
    }

    if (updateFields.length > 0) {
      updateValues.push(event.id);
      const updateSQL = `
        UPDATE canonical_events
        SET ${updateFields.join(', ')}, updated_at = NOW()
        WHERE id = $${paramIndex}
      `;
      await pool.query(updateSQL, updateValues);
      console.log(`✅ ${updateFields.length}개 필드 업데이트 완료!`);
    } else {
      console.log('⚠️  업데이트할 필드 없음');
    }

    // 최종 확인
    const finalResult = await pool.query(`
      SELECT title, derived_tags, opening_hours, price_min, price_max, external_links
      FROM canonical_events
      WHERE id = $1
    `, [event.id]);

    console.log('\n📊 최종 결과:');
    console.log(JSON.stringify(finalResult.rows[0], null, 2));

    await pool.end();
    console.log('\n✅ 테스트 완료!');
  } catch (error) {
    console.error('❌ 에러 발생:', error);
    await pool.end();
    process.exit(1);
  }
}

testSnowPopup();

