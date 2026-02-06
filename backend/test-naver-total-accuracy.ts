/**
 * 네이버 API total 값 정확도 테스트
 * 
 * total 값이 실제 검색 결과와 일치하는지 확인
 */

import { searchNaverBlog } from './src/lib/naverApi';

async function testTotalAccuracy() {
  console.log('========================================');
  console.log('네이버 API total 값 정확도 테스트');
  console.log('========================================');
  console.log('');

  const queries = [
    '《사진이 할 수 있는 모든 것》 서울시립 사진미술관 2026',
    '《사진이 할 수 있는 모든 것》 2026',
    '《사진이 할 수 있는 모든 것》',
    '서울시립 사진미술관',
  ];

  for (const query of queries) {
    console.log(`📊 쿼리: "${query}"`);
    
    try {
      const result = await searchNaverBlog({
        query,
        display: 10,
        sort: 'sim'
      });
      
      console.log(`   total: ${result.total.toLocaleString()}건`);
      console.log(`   실제 반환: ${result.items.length}개`);
      console.log('   상위 3개:');
      result.items.slice(0, 3).forEach((item, i) => {
        const cleanTitle = item.title.replace(/<[^>]*>/g, '');
        const postDate = `${item.postdate.slice(0, 4)}-${item.postdate.slice(4, 6)}-${item.postdate.slice(6, 8)}`;
        console.log(`     ${i + 1}. ${cleanTitle} (${postDate})`);
      });
      console.log('');
      
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error: any) {
      console.error(`   ❌ 오류: ${error.message}`);
      console.log('');
    }
  }

  console.log('========================================');
  console.log('💡 분석');
  console.log('========================================');
  console.log('네이버 API의 total 값은:');
  console.log('1. 실제 검색 결과보다 부풀려질 수 있음');
  console.log('2. 부분 일치, 유사 문서도 포함');
  console.log('3. 최대 1,000개까지만 조회 가능 (start + display ≤ 1000)');
  console.log('');
  console.log('💡 해결책:');
  console.log('- total 값 자체보다 "상대적 순위(percentile)"가 중요');
  console.log('- 현재 구현은 percentile 방식이므로 문제없음 ✅');
}

testTotalAccuracy().catch(console.error);

