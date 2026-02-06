/**
 * field_sources 실제 값 확인 스크립트
 */

import { pool } from '../db';

async function checkFieldSources() {
  try {
    console.log('[Check] Checking field_sources values...\n');
    
    // 1. field_sources가 있는 이벤트 1개 조회
    const result = await pool.query(`
      SELECT 
        id, 
        title,
        venue,
        field_sources
      FROM canonical_events
      WHERE field_sources IS NOT NULL 
        AND field_sources != '{}'::jsonb
      LIMIT 1
    `);
    
    if (result.rows.length === 0) {
      console.log('[Check] No events with field_sources found.');
      return;
    }
    
    const event = result.rows[0];
    console.log('Event ID:', event.id);
    console.log('Title:', event.title);
    console.log('Venue:', event.venue);
    console.log('\nfield_sources:', JSON.stringify(event.field_sources, null, 2));
    
    // 2. venue의 source 값만 추출
    if (event.field_sources?.venue) {
      console.log('\n[Venue Source Details]:');
      console.log('  source:', event.field_sources.venue.source);
      console.log('  sourceDetail:', event.field_sources.venue.sourceDetail);
      console.log('  confidence:', event.field_sources.venue.confidence);
    }
    
    // 3. 모든 필드의 source 값 확인
    console.log('\n[All Field Sources]:');
    for (const [fieldName, sourceInfo] of Object.entries(event.field_sources || {})) {
      const info = sourceInfo as any;
      console.log(`  ${fieldName}: ${info.source}`);
    }
    
  } catch (error) {
    console.error('[Check] Error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

checkFieldSources()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Check] Fatal error:', err);
    process.exit(1);
  });

