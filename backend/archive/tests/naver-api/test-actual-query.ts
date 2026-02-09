/**
 * 실제 수집 쿼리 테스트
 * 
 * DB에 저장된 실제 venue를 사용하여 테스트
 */

import { searchNaverBlog } from '../../../src/lib/naverApi';

async function testActualQuery() {
  console.log('========================================');
  console.log('실제 수집 쿼리 테스트');
  console.log('========================================');
  console.log('');

  const title = '라흐마니노프의 위로';
  const venue = '예술의전당 [서울] (콘서트홀)';
  
  // Test 1: 실제 쿼리 (venue 전체 포함)
  console.log('📊 Test 1: 실제 쿼리 (venue 전체)');
  const query1 = `${title} ${venue} 2026`;
  console.log(`   쿼리: "${query1}"`);
  console.log('');
  
  const result1 = await searchNaverBlog({
    query: query1,
    display: 10,
    sort: 'date'
  });
  
  console.log(`   total: ${result1.total.toLocaleString()}건`);
  console.log('   상위 10개 (날짜순):');
  result1.items.forEach((item, i) => {
    const cleanTitle = item.title.replace(/<[^>]*>/g, '');
    const postDate = `${item.postdate.slice(0, 4)}-${item.postdate.slice(4, 6)}-${item.postdate.slice(6, 8)}`;
    const hasTitle = cleanTitle.includes('라흐마니노프');
    const marker = hasTitle ? '✅' : '❌';
    console.log(`     ${marker} ${postDate}: ${cleanTitle.slice(0, 50)}...`);
  });
  console.log('');
  console.log('');

  // Test 2: venue 단순화 (기관명만)
  console.log('📊 Test 2: venue 단순화 (기관명만)');
  const query2 = `${title} 예술의전당 2026`;
  console.log(`   쿼리: "${query2}"`);
  console.log('');
  
  const result2 = await searchNaverBlog({
    query: query2,
    display: 10,
    sort: 'date'
  });
  
  console.log(`   total: ${result2.total.toLocaleString()}건`);
  console.log('   상위 10개 (날짜순):');
  result2.items.forEach((item, i) => {
    const cleanTitle = item.title.replace(/<[^>]*>/g, '');
    const postDate = `${item.postdate.slice(0, 4)}-${item.postdate.slice(4, 6)}-${item.postdate.slice(6, 8)}`;
    const hasTitle = cleanTitle.includes('라흐마니노프');
    const marker = hasTitle ? '✅' : '❌';
    console.log(`     ${marker} ${postDate}: ${cleanTitle.slice(0, 50)}...`);
  });
  console.log('');
  console.log('');

  // Test 3: 제목만
  console.log('📊 Test 3: 제목만');
  const query3 = `${title} 2026`;
  console.log(`   쿼리: "${query3}"`);
  console.log('');
  
  const result3 = await searchNaverBlog({
    query: query3,
    display: 10,
    sort: 'date'
  });
  
  console.log(`   total: ${result3.total.toLocaleString()}건`);
  console.log('   상위 10개 (날짜순):');
  result3.items.forEach((item, i) => {
    const cleanTitle = item.title.replace(/<[^>]*>/g, '');
    const postDate = `${item.postdate.slice(0, 4)}-${item.postdate.slice(4, 6)}-${item.postdate.slice(6, 8)}`;
    const hasTitle = cleanTitle.includes('라흐마니노프');
    const marker = hasTitle ? '✅' : '❌';
    console.log(`     ${marker} ${postDate}: ${cleanTitle.slice(0, 50)}...`);
  });
  console.log('');
  console.log('');

  // 비교
  console.log('========================================');
  console.log('📈 비교 결과');
  console.log('========================================');
  console.log(`실제 쿼리 (venue 전체):  ${result1.total.toLocaleString()}건`);
  console.log(`단순화 (기관명만):       ${result2.total.toLocaleString()}건`);
  console.log(`제목만:                 ${result3.total.toLocaleString()}건`);
  console.log('');
  console.log('💡 현재 DB에 저장된 69,408건은 아마도:');
  console.log('   "라흐마니노프의 위로 2026" 검색 결과일 가능성이 높음');
  console.log('   (venue 없이 수집되었거나, 과거 수집 데이터)');
}

testActualQuery().catch(console.error);

