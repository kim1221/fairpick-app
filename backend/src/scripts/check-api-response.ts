/**
 * Admin API 응답 확인 스크립트
 * - field_sources가 포함되어 있는지 확인
 */

import { pool } from '../db';

async function checkApiResponse() {
  try {
    console.log('[Check] Fetching one event from DB...\n');
    
    // Admin API가 사용하는 쿼리와 동일하게 조회
    const result = await pool.query(`
      SELECT * FROM canonical_events 
      WHERE field_sources IS NOT NULL 
        AND field_sources != '{}'::jsonb
      LIMIT 1
    `);
    
    if (result.rows.length === 0) {
      console.log('[Check] No events found.');
      return;
    }
    
    const event = result.rows[0];
    
    console.log('='.repeat(80));
    console.log('Event ID:', event.id);
    console.log('Title:', event.title);
    console.log('='.repeat(80));
    
    console.log('\n[field_sources]');
    console.log('Has field_sources:', !!event.field_sources);
    
    if (event.field_sources) {
      console.log('field_sources keys:', Object.keys(event.field_sources));
      console.log('\nfield_sources content:');
      for (const [key, value] of Object.entries(event.field_sources)) {
        const v = value as any;
        console.log(`  ${key}: ${v.source} (confidence: ${v.confidence}%)`);
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('Sample fields from event:');
    console.log('  title:', event.title);
    console.log('  venue:', event.venue);
    console.log('  start_at:', event.start_at);
    console.log('  end_at:', event.end_at);
    console.log('  main_category:', event.main_category);
    console.log('  sub_category:', event.sub_category);
    
  } catch (error) {
    console.error('[Check] Error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

checkApiResponse()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Check] Fatal error:', err);
    process.exit(1);
  });

