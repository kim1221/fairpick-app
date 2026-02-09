/**
 * 뽀로로와 신비한 여행 정확도 테스트
 * 
 * total 값 vs 실제 관련 블로그 비율 확인
 */

import { searchNaverBlog } from './src/lib/naverApi';

async function testPororoAccuracy() {
  console.log('========================================');
  console.log('뽀로로와 신비한 여행 정확도 테스트');
  console.log('========================================');
  console.log('');

  const title = '뽀로로와 신비한 여행';
  const venue = '인천문화예술회관';
  const query = `${title} ${venue} 2026`;

  console.log(`📊 쿼리: "${query}"`);
  console.log('');

  // 상위 100개 가져오기 (API 비용 증가하지만 정확도 확인 위해)
  const result = await searchNaverBlog({
    query,
    display: 100,
    sort: 'sim'
  });

  console.log(`📈 네이버 API total: ${result.total.toLocaleString()}건`);
  console.log(`📥 실제 받은 결과: ${result.items.length}개`);
  console.log('');

  // 실제로 "뽀로로와 신비한 여행"이 제목에 포함된 블로그만 카운트
  let relevantCount = 0;
  let pororoOnlyCount = 0;
  let totallyIrrelevantCount = 0;

  console.log('📋 상위 30개 분석:');
  console.log('');

  result.items.slice(0, 30).forEach((item, i) => {
    const cleanTitle = item.title.replace(/<[^>]*>/g, '');
    const lowerTitle = cleanTitle.toLowerCase();
    
    const hasFullTitle = lowerTitle.includes('뽀로로') && 
                         (lowerTitle.includes('신비한 여행') || lowerTitle.includes('신비한여행'));
    const hasPororo = lowerTitle.includes('뽀로로');
    const hasNothing = !lowerTitle.includes('뽀로로') && 
                       !lowerTitle.includes('신비한') && 
                       !lowerTitle.includes('여행');

    let marker = '❌';
    if (hasFullTitle) {
      marker = '✅';
      relevantCount++;
    } else if (hasPororo) {
      marker = '⚠️';
      pororoOnlyCount++;
    } else if (hasNothing) {
      marker = '🚫';
      totallyIrrelevantCount++;
    }

    if (i < 30) {
      console.log(`  ${String(i + 1).padStart(2)}. ${marker} ${cleanTitle.slice(0, 60)}`);
    }
  });

  console.log('');
  console.log('========================================');
  console.log('📊 정확도 분석 (상위 100개 기준)');
  console.log('========================================');
  
  // 전체 100개 중 실제 관련 블로그 비율
  result.items.forEach((item) => {
    const cleanTitle = item.title.replace(/<[^>]*>/g, '');
    const lowerTitle = cleanTitle.toLowerCase();
    
    const hasFullTitle = lowerTitle.includes('뽀로로') && 
                         (lowerTitle.includes('신비한 여행') || lowerTitle.includes('신비한여행'));
    const hasPororo = lowerTitle.includes('뽀로로');

    if (hasFullTitle) relevantCount++;
    else if (hasPororo) pororoOnlyCount++;
  });

  const relevantPercent = (relevantCount / result.items.length * 100).toFixed(1);
  const pororoPercent = (pororoOnlyCount / result.items.length * 100).toFixed(1);
  const irrelevantPercent = (100 - parseFloat(relevantPercent) - parseFloat(pororoPercent)).toFixed(1);

  console.log(`✅ 정확히 일치: ${relevantCount}개 (${relevantPercent}%)`);
  console.log(`⚠️  뽀로로만 포함: ${pororoOnlyCount}개 (${pororoPercent}%)`);
  console.log(`❌ 무관: ${irrelevantPercent}%`);
  console.log('');
  console.log('💡 결론:');
  console.log(`   네이버 API total(${result.total.toLocaleString()}건)은 부정확합니다.`);
  console.log(`   실제 정확한 언급은 ${Math.round(result.total * parseFloat(relevantPercent) / 100).toLocaleString()}건 정도로 추정됩니다.`);
  console.log('');
  console.log('⚠️  한계:');
  console.log('   - 네이버 API는 부분 일치를 광범위하게 포함');
  console.log('   - total 값은 "추정치"이며 실제와 차이 큼');
  console.log('   - 하지만 Percentile 방식이므로 상대 순위는 유효');
}

testPororoAccuracy().catch(console.error);

