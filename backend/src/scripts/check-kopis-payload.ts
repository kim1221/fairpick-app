/**
 * 특정 이벤트의 KOPIS raw payload 확인
 */

import { pool } from '../db';

async function checkKopisPayload() {
  try {
    console.log('[Check] Checking KOPIS payload for "캐빈 [서울]"...\n');
    
    // 1. Canonical event 조회
    const canonicalResult = await pool.query(`
      SELECT id, title, sources, metadata
      FROM canonical_events
      WHERE title LIKE '%캐빈%'
      LIMIT 1
    `);
    
    if (canonicalResult.rows.length === 0) {
      console.log('Event not found');
      return;
    }
    
    const event = canonicalResult.rows[0];
    console.log('Event ID:', event.id);
    console.log('Title:', event.title);
    console.log('Sources:', JSON.stringify(event.sources, null, 2));
    
    // 2. KOPIS raw payload 조회
    const kopisSource = event.sources.find((s: any) => s.source === 'kopis');
    if (!kopisSource) {
      console.log('No KOPIS source found');
      return;
    }
    
    const rawResult = await pool.query(`
      SELECT id, source, payload
      FROM raw_kopis_events
      WHERE id = $1
    `, [kopisSource.rawId]);
    
    if (rawResult.rows.length === 0) {
      console.log('Raw KOPIS data not found');
      return;
    }
    
    const rawData = rawResult.rows[0];
    const payload = rawData.payload;
    
    console.log('\n='.repeat(80));
    console.log('KOPIS Raw Payload:');
    console.log('='.repeat(80));
    console.log(JSON.stringify(payload, null, 2));
    
    console.log('\n='.repeat(80));
    console.log('Specific Fields:');
    console.log('='.repeat(80));
    console.log('prfcast (출연진):', payload.prfcast);
    console.log('genrenm (장르):', payload.genrenm);
    console.log('prfruntime (공연시간):', payload.prfruntime);
    console.log('prfage (연령제한):', payload.prfage);
    console.log('pcseguidance (가격안내):', payload.pcseguidance);
    
    console.log('\n='.repeat(80));
    console.log('Metadata from DB:');
    console.log('='.repeat(80));
    if (event.metadata?.display?.performance) {
      console.log('Performance metadata:', JSON.stringify(event.metadata.display.performance, null, 2));
    } else {
      console.log('No performance metadata');
    }
    
  } catch (error) {
    console.error('[Check] Error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

checkKopisPayload()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Check] Fatal error:', err);
    process.exit(1);
  });

