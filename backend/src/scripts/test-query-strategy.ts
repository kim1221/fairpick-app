/**
 * 필드별 쿼리 전략 테스트 스크립트
 *
 * Usage: npx ts-node -r dotenv/config src/scripts/test-query-strategy.ts
 */

import { buildNaverQueryForField, buildNaverSearchUrl, getQueryStrategy } from '../lib/queryBuilder';

const testContext = {
  title: '백설공주 [서울 구로]',
  venue: '구로아트밸리 예술극장',
  address: '서울 구로구 구로동 3-10',
  region: '서울',
  category: '공연',
};

console.log('\n=== 필드별 쿼리 전략 테스트 ===\n');
console.log('이벤트 정보:', testContext);
console.log('');

// venue-first 필드 테스트
const venueFirstFields = [
  'address',
  'parking_available',
  'parking_info',
  'public_transport_info',
];

console.log('🏢 venue-first 전략 필드:');
venueFirstFields.forEach(fieldKey => {
  const strategy = getQueryStrategy(fieldKey);
  const { query } = buildNaverQueryForField(fieldKey, testContext);
  const url = buildNaverSearchUrl(fieldKey, testContext);

  console.log(`  ${fieldKey}:`);
  console.log(`    - strategy: ${strategy}`);
  console.log(`    - query: "${query}"`);
  console.log(`    - url: ${url.substring(0, 100)}...`);
  console.log('');
});

// title-first 필드 테스트
const titleFirstFields = [
  'external_links.ticket',
  'external_links.official',
  'price_min',
  'overview',
  'opening_hours',
];

console.log('📝 title-first 전략 필드:');
titleFirstFields.forEach(fieldKey => {
  const strategy = getQueryStrategy(fieldKey);
  const { query } = buildNaverQueryForField(fieldKey, testContext);
  const url = buildNaverSearchUrl(fieldKey, testContext);

  console.log(`  ${fieldKey}:`);
  console.log(`    - strategy: ${strategy}`);
  console.log(`    - query: "${query}"`);
  console.log(`    - url: ${url.substring(0, 100)}...`);
  console.log('');
});

console.log('=== 테스트 완료 ===\n');

console.log('✅ 예상 결과:');
console.log('  - address: "구로아트밸리 예술극장 서울 주소" (venue + region)');
console.log('  - parking_info: "구로아트밸리 예술극장 서울 구로구 구로동 3-10 주차" (venue + address)');
console.log('  - external_links.ticket: "백설공주 예매" (title only)');
console.log('  - price_min: "백설공주 가격" (title only)');
console.log('');

// 전략 분류 통계
const allTestFields = [...venueFirstFields, ...titleFirstFields];
const venueCount = allTestFields.filter(f => getQueryStrategy(f) === 'venue-first').length;
const titleCount = allTestFields.filter(f => getQueryStrategy(f) === 'title-first').length;

console.log(`📊 전략 분류 통계:`);
console.log(`  - venue-first: ${venueCount}개 필드`);
console.log(`  - title-first: ${titleCount}개 필드`);
console.log(`  - 총합: ${allTestFields.length}개 필드`);
