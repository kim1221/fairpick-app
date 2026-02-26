/**
 * venue-first 쿼리 전략 로깅 테스트
 *
 * Usage: NODE_ENV=development npx ts-node -r dotenv/config src/scripts/test-venue-first-logging.ts
 */

import { searchFieldSpecific } from '../lib/naverApi';

const testContext = {
  title: '백설공주 [서울 구로]',
  venue: '구로아트밸리 예술극장',
  address: '서울 구로구 구로동 3-10',
  region: '서울',
};

async function testVenueFirstLogging() {
  console.log('\n=== venue-first 필드 검색 로깅 테스트 ===\n');
  console.log('이벤트 정보:', testContext);
  console.log('');

  // venue-first 필드 테스트
  const venueFirstFields = ['address', 'parking_info', 'public_transport_info'];

  console.log('🏢 venue-first 필드 검색 시작...\n');

  for (const fieldKey of venueFirstFields) {
    console.log(`\n--- ${fieldKey} 검색 ---`);
    try {
      const results = await searchFieldSpecific(fieldKey, testContext, 'test-rid-123');
      console.log(`✅ 결과 ${results.length}개 수집됨`);

      // 첫 3개 결과 출력
      results.slice(0, 3).forEach((r, idx) => {
        console.log(`  [${idx}] ${r.source}: ${r.title.substring(0, 50)}...`);
      });
    } catch (error: any) {
      console.error(`❌ 오류: ${error.message}`);
    }
  }

  console.log('\n=== 테스트 완료 ===');
  console.log('\n✅ 예상 로그:');
  console.log('  - [ENRICH][NAVER_QUERY] rid=test-rid-123 fieldKey=address strategy=venue-first queryString="구로아트밸리 예술극장 서울 주소" apiType=place');
  console.log('  - [ENRICH][NAVER_QUERY] rid=test-rid-123 fieldKey=parking_info strategy=venue-first queryString="구로아트밸리 예술극장 서울 구로구 구로동 3-10 주차" apiType=place');
  console.log('  - [ENRICH][NAVER_QUERY] rid=test-rid-123 fieldKey=public_transport_info strategy=venue-first queryString="구로아트밸리 예술극장 오시는길" apiType=place');
  console.log('');
}

testVenueFirstLogging()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('테스트 실패:', error);
    process.exit(1);
  });
