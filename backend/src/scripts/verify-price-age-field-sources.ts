/**
 * 검증: price_info와 age_limit 필드의 field_sources 확인
 */

import { pool } from '../db';

async function verifyPriceAndAgeFieldSources() {
  try {
    console.log('[Verify] Checking price_info and age_limit field_sources...\n');
    
    // price_info가 있는 공연 이벤트 3개 조회
    const eventsResult = await pool.query(`
      SELECT 
        id, 
        title,
        source_priority_winner,
        price_info,
        metadata->'display'->'performance'->'age_limit' AS age_limit,
        field_sources
      FROM canonical_events
      WHERE main_category = '공연'
        AND price_info IS NOT NULL
        AND metadata->'display'->'performance'->'age_limit' IS NOT NULL
      LIMIT 3
    `);
    
    console.log('='.repeat(80));
    console.log('🎭 공연 이벤트 (가격 상세 & 연령 제한)');
    console.log('='.repeat(80));
    
    for (const event of eventsResult.rows) {
      console.log('\nEvent ID:', event.id);
      console.log('Title:', event.title);
      console.log('Source:', event.source_priority_winner);
      
      console.log('\n[Data]');
      console.log('  Price Info:', event.price_info);
      console.log('  Age Limit:', event.age_limit);
      
      console.log('\n[field_sources]');
      if (event.field_sources) {
        // price_info
        if (event.field_sources.price_info) {
          const source = event.field_sources.price_info;
          console.log(`  ✅ price_info:`);
          console.log(`      source: ${source.source}`);
          console.log(`      sourceDetail: ${source.sourceDetail}`);
          console.log(`      confidence: ${source.confidence}%`);
        } else {
          console.log('  ❌ price_info: NO SOURCE');
        }
        
        // age_limit
        if (event.field_sources['metadata.display.performance.age_limit']) {
          const source = event.field_sources['metadata.display.performance.age_limit'];
          console.log(`  ✅ metadata.display.performance.age_limit:`);
          console.log(`      source: ${source.source}`);
          console.log(`      sourceDetail: ${source.sourceDetail}`);
          console.log(`      confidence: ${source.confidence}%`);
        } else {
          console.log('  ❌ metadata.display.performance.age_limit: NO SOURCE');
        }
      } else {
        console.log('  ❌ No field_sources at all');
      }
      console.log('-'.repeat(80));
    }
    
    // 전체 통계
    console.log('\n\n' + '='.repeat(80));
    console.log('📊 Overall Statistics');
    console.log('='.repeat(80));
    
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE price_info IS NOT NULL) AS total_with_price_info,
        COUNT(*) FILTER (WHERE price_info IS NOT NULL AND field_sources ? 'price_info') AS price_info_with_source,
        COUNT(*) FILTER (
          WHERE metadata->'display'->'performance'->'age_limit' IS NOT NULL
        ) AS total_with_age_limit,
        COUNT(*) FILTER (
          WHERE metadata->'display'->'performance'->'age_limit' IS NOT NULL 
            AND field_sources ? 'metadata.display.performance.age_limit'
        ) AS age_limit_with_source
      FROM canonical_events
      WHERE main_category = '공연'
    `);
    
    const stats = statsResult.rows[0];
    console.log('\n가격 상세 (price_info):');
    console.log(`  Total with price_info: ${stats.total_with_price_info}`);
    console.log(`  With field_sources: ${stats.price_info_with_source}`);
    const pricePercentage = ((stats.price_info_with_source / stats.total_with_price_info) * 100).toFixed(1);
    console.log(`  Coverage: ${pricePercentage}%`);
    
    console.log('\n연령 제한 (age_limit):');
    console.log(`  Total with age_limit: ${stats.total_with_age_limit}`);
    console.log(`  With field_sources: ${stats.age_limit_with_source}`);
    const agePercentage = ((stats.age_limit_with_source / stats.total_with_age_limit) * 100).toFixed(1);
    console.log(`  Coverage: ${agePercentage}%`);
    
  } catch (error) {
    console.error('[Verify] Error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

verifyPriceAndAgeFieldSources()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Verify] Fatal error:', err);
    process.exit(1);
  });

