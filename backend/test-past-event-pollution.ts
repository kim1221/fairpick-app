/**
 * 과거 이벤트 오염 테스트
 * 
 * "라흐마니노프의 위로" 검색 시 과거 공연이 포함되는지 확인
 */

import { searchNaverBlog } from './src/lib/naverApi';

async function testPastEventPollution() {
  console.log('========================================');
  console.log('과거 이벤트 오염 테스트');
  console.log('========================================');
  console.log('');

  const title = '라흐마니노프의 위로';
  const venue = '예술의전당';
  const eventDate = '2026-03-10'; // 아직 한 달 후!

  console.log(`📅 이벤트 정보:`);
  console.log(`   제목: ${title}`);
  console.log(`   장소: ${venue}`);
  console.log(`   날짜: ${eventDate} (아직 시작 안 함)`);
  console.log('');

  // Test 1: 현재 쿼리 (연도만)
  console.log('📊 Test 1: 현재 쿼리 (제목 + venue + 연도)');
  const query1 = `${title} ${venue} 2026`;
  console.log(`   쿼리: "${query1}"`);
  console.log('');
  
  const result1 = await searchNaverBlog({
    query: query1,
    display: 20,
    sort: 'date' // 날짜순으로 확인
  });
  
  console.log(`   total: ${result1.total.toLocaleString()}건`);
  console.log('   최근 10개 블로그 (날짜순):');
  result1.items.slice(0, 10).forEach((item, i) => {
    const cleanTitle = item.title.replace(/<[^>]*>/g, '');
    const postDate = `${item.postdate.slice(0, 4)}-${item.postdate.slice(4, 6)}-${item.postdate.slice(6, 8)}`;
    const isPast = postDate < '2026-02-05';
    const marker = isPast ? '❌' : '✅';
    console.log(`     ${marker} ${postDate}: ${cleanTitle.slice(0, 60)}...`);
  });
  console.log('');
  console.log('');

  // Test 2: 개선 쿼리 (연도 + 월)
  console.log('📊 Test 2: 개선 쿼리 (제목 + venue + 연도 + 월)');
  const query2 = `${title} ${venue} 2026년 3월`;
  console.log(`   쿼리: "${query2}"`);
  console.log('');
  
  const result2 = await searchNaverBlog({
    query: query2,
    display: 20,
    sort: 'date'
  });
  
  console.log(`   total: ${result2.total.toLocaleString()}건`);
  console.log('   최근 10개 블로그 (날짜순):');
  result2.items.slice(0, 10).forEach((item, i) => {
    const cleanTitle = item.title.replace(/<[^>]*>/g, '');
    const postDate = `${item.postdate.slice(0, 4)}-${item.postdate.slice(4, 6)}-${item.postdate.slice(6, 8)}`;
    const isPast = postDate < '2026-02-05';
    const marker = isPast ? '❌' : '✅';
    console.log(`     ${marker} ${postDate}: ${cleanTitle.slice(0, 60)}...`);
  });
  console.log('');
  console.log('');

  // 비교
  console.log('========================================');
  console.log('📈 비교 결과');
  console.log('========================================');
  console.log(`기존 (연도만):        ${result1.total.toLocaleString()}건`);
  console.log(`개선 (연도 + 월):     ${result2.total.toLocaleString()}건`);
  console.log('');
  
  const reduction = ((1 - result2.total / result1.total) * 100).toFixed(1);
  console.log(`과거 이벤트 오염 감소: ${reduction}%`);
  console.log('');
  console.log('💡 결론:');
  if (parseFloat(reduction) > 50) {
    console.log('   "연도 + 월"을 추가하면 과거 이벤트 오염이 크게 감소합니다! ✅');
  } else {
    console.log('   연도 + 월 추가 효과가 제한적입니다.');
  }
}

testPastEventPollution().catch(console.error);

