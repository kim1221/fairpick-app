/**
 * 예매/티켓/예약 링크 추출 통합 테스트
 * 다양한 카테고리의 이벤트에서 external_links 추출 정확도 확인
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

interface TestResult {
  title: string;
  category: string;
  hasOfficialLink: boolean;
  hasTicketLink: boolean;
  hasReservationLink: boolean;
  reservationRequired: boolean | null;
  ageRestriction: string | null;
  naverPlaceUsed: boolean;
  externalLinks: any;
}

async function testExternalLinks() {
  console.log('\n' + '='.repeat(80));
  console.log('🔗 예매/티켓/예약 링크 추출 테스트');
  console.log('='.repeat(80) + '\n');

  const results: TestResult[] = [];

  try {
    // 다양한 카테고리의 이벤트 조회
    const events = await pool.query<Event>(`
      SELECT id, title, main_category, venue, overview
      FROM canonical_events
      WHERE 
        title LIKE '%VIP매직쇼%'  -- 공연
        OR title LIKE '%스노우%롯데월드몰%'  -- 팝업
        OR title LIKE '%전시%'  -- 전시
        OR title LIKE '%콘서트%'  -- 음악
        OR title LIKE '%축제%'  -- 축제
      LIMIT 5
    `);

    console.log(`📊 테스트 대상: ${events.rows.length}개 이벤트\n`);

    for (const event of events.rows) {
      console.log('\n' + '-'.repeat(80));
      console.log(`📌 ${event.title} (${event.main_category})`);
      console.log('-'.repeat(80));

      try {
        // 네이버 검색
        const searchResult = await searchEventInfo(event.title, event.venue || undefined);
        const searchText = mergeSearchResults(searchResult.place, searchResult.blog, searchResult.web);

        // 네이버 플레이스 링크 추출
        let naverPlaceLink: string | null = null;
        if (searchResult.place && searchResult.place.items && searchResult.place.items.length > 0) {
          const firstPlace = searchResult.place.items[0];
          if (firstPlace.link && firstPlace.link.trim()) {
            naverPlaceLink = firstPlace.link.trim();
            console.log(`📎 네이버 플레이스: ${naverPlaceLink}`);
          }
        }

        // AI 추출
        const extractedInfo = await extractEventInfo(
          event.title,
          event.main_category,
          event.overview,
          searchText
        );

        if (!extractedInfo) {
          console.log('❌ AI 추출 실패\n');
          continue;
        }

        // external_links 병합 (네이버 플레이스 자동 추가)
        const externalLinks: any = { ...(extractedInfo.external_links || {}) };
        let naverPlaceUsed = false;
        if (naverPlaceLink && !externalLinks.official) {
          externalLinks.official = naverPlaceLink;
          naverPlaceUsed = true;
        }

        // 결과 출력
        console.log('\n✅ 추출 결과:');
        console.log('🔗 External Links:');
        console.log('   - Official:', externalLinks.official || '❌ 없음');
        console.log('   - Ticket:', externalLinks.ticket || '❌ 없음');
        console.log('   - Reservation:', externalLinks.reservation || '❌ 없음');
        console.log('📝 Reservation Required:', extractedInfo.reservation_required ?? '❌ 없음');
        console.log('🎫 Age Restriction:', extractedInfo.age_restriction || '❌ 없음');
        if (naverPlaceUsed) {
          console.log('💡 네이버 플레이스 링크를 Official로 자동 설정');
        }

        // 결과 저장
        results.push({
          title: event.title,
          category: event.main_category,
          hasOfficialLink: !!externalLinks.official,
          hasTicketLink: !!externalLinks.ticket,
          hasReservationLink: !!externalLinks.reservation,
          reservationRequired: extractedInfo.reservation_required ?? null,
          ageRestriction: extractedInfo.age_restriction || null,
          naverPlaceUsed,
          externalLinks,
        });

      } catch (error: any) {
        console.error('❌ 에러:', error.message);
      }

      // API 요청 간격 (rate limit 방지)
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 종합 결과
    console.log('\n' + '='.repeat(80));
    console.log('📊 종합 결과');
    console.log('='.repeat(80) + '\n');

    const summary = {
      total: results.length,
      withOfficialLink: results.filter(r => r.hasOfficialLink).length,
      withTicketLink: results.filter(r => r.hasTicketLink).length,
      withReservationLink: results.filter(r => r.hasReservationLink).length,
      reservationRequired: results.filter(r => r.reservationRequired === true).length,
      withAgeRestriction: results.filter(r => r.ageRestriction).length,
      naverPlaceUsed: results.filter(r => r.naverPlaceUsed).length,
    };

    console.log(`✅ 테스트 완료: ${summary.total}개 이벤트\n`);
    console.log('📈 추출 성공률:');
    console.log(`   - Official Link: ${summary.withOfficialLink}/${summary.total} (${Math.round(summary.withOfficialLink/summary.total*100)}%)`);
    console.log(`   - Ticket Link: ${summary.withTicketLink}/${summary.total} (${Math.round(summary.withTicketLink/summary.total*100)}%)`);
    console.log(`   - Reservation Link: ${summary.withReservationLink}/${summary.total} (${Math.round(summary.withReservationLink/summary.total*100)}%)`);
    console.log(`   - Reservation Required: ${summary.reservationRequired}/${summary.total}`);
    console.log(`   - Age Restriction: ${summary.withAgeRestriction}/${summary.total}`);
    console.log(`   - 네이버 플레이스 사용: ${summary.naverPlaceUsed}/${summary.total}`);

    console.log('\n📝 카테고리별 상세:');
    results.forEach(r => {
      console.log(`\n[${r.category}] ${r.title}`);
      console.log(`  Official: ${r.hasOfficialLink ? '✅' : '❌'}`);
      console.log(`  Ticket: ${r.hasTicketLink ? '✅' : '❌'}`);
      console.log(`  Reservation: ${r.hasReservationLink ? '✅' : '❌'}`);
      console.log(`  예약 필수: ${r.reservationRequired === true ? '예' : r.reservationRequired === false ? '아니오' : '불명'}`);
      console.log(`  연령 제한: ${r.ageRestriction || '없음'}`);
    });

    await pool.end();
    console.log('\n✅ 모든 테스트 완료!');

  } catch (error) {
    console.error('❌ 에러 발생:', error);
    await pool.end();
    process.exit(1);
  }
}

testExternalLinks();

