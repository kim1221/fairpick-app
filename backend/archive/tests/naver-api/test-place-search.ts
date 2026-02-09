/**
 * 네이버 플레이스 검색 단독 테스트
 */

import { searchNaverPlace } from '../../../src/lib/naverApi';

async function testPlaceSearch() {
  console.log('\n🔍 네이버 플레이스 검색 테스트\n');

  const queries = [
    'VIP매직쇼 초록마술극장',
    '스노우 잠실 롯데월드몰',
    '고미의 여행 토마토소극장',
  ];

  for (const query of queries) {
    console.log(`\n📍 검색어: "${query}"`);
    console.log('─'.repeat(50));

    try {
      const result = await searchNaverPlace({ query, display: 3 });
      
      if (result.items.length === 0) {
        console.log('❌ 결과 없음');
      } else {
        result.items.forEach((item, idx) => {
          console.log(`\n[${idx + 1}] ${item.title.replace(/<[^>]*>/g, '')}`);
          console.log(`    카테고리: ${item.category}`);
          console.log(`    주소: ${item.address}`);
          console.log(`    전화: ${item.telephone || '없음'}`);
          console.log(`    링크: ${item.link}`);
        });
      }
    } catch (error: any) {
      console.error('❌ 에러:', error.message);
    }

    await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
  }

  console.log('\n✅ 테스트 완료!\n');
}

testPlaceSearch().catch(console.error);


