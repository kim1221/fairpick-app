/**
 * 공연 특화 정보의 출처 확인
 */

import { pool } from '../db';

async function checkPerformanceMetadata() {
  try {
    console.log('[Check] Checking performance metadata sources...\n');
    
    // 출연진 정보가 있는 이벤트 조회
    const result = await pool.query(`
      SELECT 
        id, 
        title,
        source_priority_winner,
        metadata,
        field_sources
      FROM canonical_events
      WHERE main_category = '공연'
        AND metadata->'display'->'performance'->'cast' IS NOT NULL
        AND jsonb_array_length(metadata->'display'->'performance'->'cast') > 0
      LIMIT 3
    `);
    
    if (result.rows.length === 0) {
      console.log('[Check] No performance events with cast found.');
      return;
    }
    
    for (const event of result.rows) {
      console.log('='.repeat(80));
      console.log('Event ID:', event.id);
      console.log('Title:', event.title);
      console.log('Source:', event.source_priority_winner);
      console.log('\n[Metadata - Performance]');
      const performance = event.metadata?.display?.performance;
      if (performance) {
        console.log('  Cast:', performance.cast);
        console.log('  Genre:', performance.genre);
        console.log('  Duration:', performance.duration_minutes);
        console.log('  Discounts:', performance.discounts);
      }
      
      console.log('\n[field_sources]');
      if (event.field_sources) {
        const metadataKeys = Object.keys(event.field_sources).filter(k => k.startsWith('metadata'));
        if (metadataKeys.length > 0) {
          console.log('  Metadata fields:', metadataKeys);
          for (const key of metadataKeys) {
            const source = event.field_sources[key];
            console.log(`    ${key}: ${source.source}`);
          }
        } else {
          console.log('  ❌ No metadata field sources found');
        }
      } else {
        console.log('  ❌ No field_sources at all');
      }
      console.log('');
    }
    
  } catch (error) {
    console.error('[Check] Error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

checkPerformanceMetadata()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Check] Fatal error:', err);
    process.exit(1);
  });

