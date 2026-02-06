/**
 * 기존 canonical_events의 field_sources 백필 스크립트
 * 
 * 목적: 이미 수집된 이벤트들의 공공API 필드에 대해 field_sources를 자동으로 설정
 * 
 * 실행 방법:
 * npx tsx backend/src/scripts/backfill-field-sources.ts
 */

import { pool } from '../db';

/**
 * 소스명을 field_sources의 source로 변환
 */
function mapSourceToFieldSource(source: string): string {
  if (source === 'kopis') return 'KOPIS';
  if (source === 'culture') return 'Culture';
  if (source === 'tour') return 'TourAPI';
  return source.toUpperCase();
}

/**
 * 공공API에서 수집한 필드의 field_sources 생성
 */
function buildFieldSources(event: any, winnerSource: string): Record<string, any> {
  const fieldSources: Record<string, any> = {};
  const source = mapSourceToFieldSource(winnerSource);
  const sourceDetail = `${source} public API`;
  const timestamp = new Date().toISOString();
  
  // 공공API에서 수집한 기본 필드들
  const publicApiFields = [
    { field: 'title', value: event.title },
    { field: 'start_at', value: event.start_at },
    { field: 'end_at', value: event.end_at },
    { field: 'venue', value: event.venue },
    { field: 'main_category', value: event.main_category },
    { field: 'sub_category', value: event.sub_category },
    { field: 'image_url', value: event.image_url },
    { field: 'address', value: event.address },
    { field: 'lat', value: event.lat },
    { field: 'lng', value: event.lng },
    { field: 'region', value: event.region },
    { field: 'is_free', value: event.is_free },
    { field: 'price_min', value: event.price_min },
    { field: 'price_max', value: event.price_max },
  ];
  
  for (const { field, value } of publicApiFields) {
    // 필드에 값이 있고, 이미 field_sources에 없는 경우만 추가
    if (value !== null && value !== undefined && value !== '') {
      // 이미 field_sources에 있는 경우 (AI나 Manual로 수정된 경우) 덮어쓰지 않음
      const existingSource = event.field_sources?.[field];
      if (!existingSource) {
        fieldSources[field] = {
          source,
          sourceDetail: field.includes('price') ? `${source} public API (extracted from payload)` : sourceDetail,
          confidence: 100,
          updatedAt: timestamp,
        };
      }
    }
  }
  
  // 외부 링크
  if (event.external_links) {
    const links = event.external_links;
    if (links.official && !event.field_sources?.['external_links.official']) {
      fieldSources['external_links.official'] = {
        source,
        sourceDetail: `${source} public API`,
        confidence: 100,
        updatedAt: timestamp,
      };
    }
    if (links.ticket && !event.field_sources?.['external_links.ticket']) {
      fieldSources['external_links.ticket'] = {
        source,
        sourceDetail: `${source} public API (ticket link)`,
        confidence: 100,
        updatedAt: timestamp,
      };
    }
    if (links.reservation && !event.field_sources?.['external_links.reservation']) {
      fieldSources['external_links.reservation'] = {
        source,
        sourceDetail: `${source} public API`,
        confidence: 100,
        updatedAt: timestamp,
      };
    }
  }
  
  // 소스 태그
  if (event.source_tags && event.source_tags.length > 0 && !event.field_sources?.source_tags) {
    fieldSources.source_tags = {
      source,
      sourceDetail: `${source} public API`,
      confidence: 100,
      updatedAt: timestamp,
    };
  }
  
  return fieldSources;
}

async function backfillFieldSources() {
  console.log('[Backfill] Starting field_sources backfill...');
  
  try {
    // 1. 모든 이벤트 조회 (field_sources 업데이트)
    const result = await pool.query(`
      SELECT 
        id, 
        title, 
        start_at, 
        end_at, 
        venue, 
        address, 
        lat, 
        lng, 
        region, 
        main_category, 
        sub_category, 
        image_url, 
        is_free,
        price_min,
        price_max,
        external_links,
        source_tags,
        source_priority_winner,
        field_sources
      FROM canonical_events
      ORDER BY updated_at DESC
    `);
    
    const events = result.rows;
    console.log(`[Backfill] Found ${events.length} events to update`);
    
    // 2. 각 이벤트에 대해 field_sources 생성 및 업데이트
    let updatedCount = 0;
    let skippedCount = 0;
    
    for (const event of events) {
      try {
        const winnerSource = event.source_priority_winner;
        
        if (!winnerSource) {
          console.log(`[Backfill] Skip event ${event.id}: no source_priority_winner`);
          skippedCount++;
          continue;
        }
        
        // field_sources 생성
        const newFieldSources = buildFieldSources(event, winnerSource);
        
        // 기존 field_sources와 병합 (기존 값 보존)
        const mergedFieldSources = {
          ...newFieldSources,
          ...(event.field_sources || {}),
        };
        
        // DB 업데이트
        await pool.query(
          `UPDATE canonical_events 
           SET field_sources = $1, updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(mergedFieldSources), event.id]
        );
        
        updatedCount++;
        
        if (updatedCount % 100 === 0) {
          console.log(`[Backfill] Processed ${updatedCount} events...`);
        }
      } catch (error) {
        console.error(`[Backfill] Failed to update event ${event.id}:`, error);
        skippedCount++;
      }
    }
    
    console.log('[Backfill] Backfill complete!');
    console.log(`  - Updated: ${updatedCount}`);
    console.log(`  - Skipped: ${skippedCount}`);
    
    // 3. 결과 검증
    const verifyResult = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(field_sources) FILTER (WHERE field_sources IS NOT NULL AND field_sources != '{}'::jsonb) as with_sources,
        COUNT(*) FILTER (WHERE field_sources IS NULL OR field_sources = '{}'::jsonb) as without_sources
      FROM canonical_events
    `);
    
    const stats = verifyResult.rows[0];
    console.log('\n[Backfill] Verification:');
    console.log(`  - Total events: ${stats.total}`);
    console.log(`  - With field_sources: ${stats.with_sources}`);
    console.log(`  - Without field_sources: ${stats.without_sources}`);
    
  } catch (error) {
    console.error('[Backfill] Fatal error:', error);
    throw error;
  }
}

// CLI 실행 모드
if (require.main === module) {
  backfillFieldSources()
    .then(() => {
      console.log('[Backfill] Done!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Backfill] Fatal error:', err);
      process.exit(1);
    });
}

export { backfillFieldSources };

