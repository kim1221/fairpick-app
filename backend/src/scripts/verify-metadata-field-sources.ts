/**
 * 검증: metadata 필드에 대한 field_sources 확인
 */

import { pool } from '../db';

async function verifyMetadataFieldSources() {
  try {
    console.log('[Verify] Checking metadata field_sources...\n');
    
    // 공연 이벤트에서 출연진 정보가 있는 것 조회
    const performanceResult = await pool.query(`
      SELECT 
        id, 
        title,
        source_priority_winner,
        metadata->'display'->'performance' AS performance_data,
        field_sources
      FROM canonical_events
      WHERE main_category = '공연'
        AND metadata->'display'->'performance'->'cast' IS NOT NULL
        AND jsonb_array_length(metadata->'display'->'performance'->'cast') > 0
      LIMIT 3
    `);
    
    console.log('='.repeat(80));
    console.log('🎭 공연 이벤트 (Performance Events)');
    console.log('='.repeat(80));
    
    for (const event of performanceResult.rows) {
      console.log('\nEvent ID:', event.id);
      console.log('Title:', event.title);
      console.log('Source:', event.source_priority_winner);
      
      const perfData = event.performance_data;
      console.log('\n[Performance Data]');
      if (perfData) {
        console.log('  Cast:', perfData.cast || []);
        console.log('  Genre:', perfData.genre || []);
        console.log('  Duration:', perfData.duration_minutes || 'N/A');
        console.log('  Age Limit:', perfData.age_limit || 'N/A');
      }
      
      console.log('\n[field_sources for metadata.display.performance]');
      if (event.field_sources) {
        const metadataKeys = Object.keys(event.field_sources).filter(k => k.startsWith('metadata.display.performance'));
        if (metadataKeys.length > 0) {
          for (const key of metadataKeys) {
            const source = event.field_sources[key];
            console.log(`  ✅ ${key}:`);
            console.log(`      source: ${source.source}`);
            console.log(`      sourceDetail: ${source.sourceDetail}`);
            console.log(`      confidence: ${source.confidence}%`);
          }
        } else {
          console.log('  ❌ No metadata.display.performance field sources found');
        }
      } else {
        console.log('  ❌ No field_sources at all');
      }
      console.log('-'.repeat(80));
    }
    
    // 전시 이벤트에서 작가 정보가 있는 것 조회
    const exhibitionResult = await pool.query(`
      SELECT 
        id, 
        title,
        source_priority_winner,
        metadata->'display'->'exhibition' AS exhibition_data,
        field_sources
      FROM canonical_events
      WHERE main_category = '전시'
        AND metadata->'display'->'exhibition'->'artists' IS NOT NULL
        AND jsonb_array_length(metadata->'display'->'exhibition'->'artists') > 0
      LIMIT 3
    `);
    
    console.log('\n\n' + '='.repeat(80));
    console.log('🖼️  전시 이벤트 (Exhibition Events)');
    console.log('='.repeat(80));
    
    for (const event of exhibitionResult.rows) {
      console.log('\nEvent ID:', event.id);
      console.log('Title:', event.title);
      console.log('Source:', event.source_priority_winner);
      
      const exhData = event.exhibition_data;
      console.log('\n[Exhibition Data]');
      if (exhData) {
        console.log('  Artists:', exhData.artists || []);
        console.log('  Genre:', exhData.genre || []);
        console.log('  Duration:', exhData.duration_minutes || 'N/A');
        console.log('  Type:', exhData.type || 'N/A');
      }
      
      console.log('\n[field_sources for metadata.display.exhibition]');
      if (event.field_sources) {
        const metadataKeys = Object.keys(event.field_sources).filter(k => k.startsWith('metadata.display.exhibition'));
        if (metadataKeys.length > 0) {
          for (const key of metadataKeys) {
            const source = event.field_sources[key];
            console.log(`  ✅ ${key}:`);
            console.log(`      source: ${source.source}`);
            console.log(`      sourceDetail: ${source.sourceDetail}`);
            console.log(`      confidence: ${source.confidence}%`);
          }
        } else {
          console.log('  ❌ No metadata.display.exhibition field sources found');
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
        main_category,
        COUNT(*) AS total_with_display,
        COUNT(*) FILTER (
          WHERE (main_category = '공연' AND field_sources ? 'metadata.display.performance.cast')
             OR (main_category = '전시' AND field_sources ? 'metadata.display.exhibition.artists')
        ) AS with_field_sources
      FROM canonical_events
      WHERE metadata->'display' IS NOT NULL
      GROUP BY main_category
      ORDER BY main_category
    `);
    
    for (const row of statsResult.rows) {
      console.log(`\n${row.main_category}:`);
      console.log(`  Total with metadata.display: ${row.total_with_display}`);
      console.log(`  With field_sources for key fields: ${row.with_field_sources}`);
      const percentage = ((row.with_field_sources / row.total_with_display) * 100).toFixed(1);
      console.log(`  Coverage: ${percentage}%`);
    }
    
  } catch (error) {
    console.error('[Verify] Error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

verifyMetadataFieldSources()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Verify] Fatal error:', err);
    process.exit(1);
  });

