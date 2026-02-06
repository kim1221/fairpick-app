/**
 * 백필 스크립트: metadata.display 필드에 대한 field_sources 추가
 * 
 * KOPIS/Culture/TourAPI에서 추출된 performance/exhibition 특화 정보에 대해
 * field_sources를 생성하여 DB에 업데이트합니다.
 */

import { pool } from '../db';

/**
 * field_sources 매핑 함수
 */
function mapSourceToFieldSource(source: string): string {
  const mapping: Record<string, string> = {
    'kopis': 'KOPIS',
    'culture': 'Culture',
    'tour': 'TourAPI',
  };
  return mapping[source.toLowerCase()] || 'PUBLIC_API';
}

/**
 * metadata.display 필드에 대한 field_sources 생성
 */
function buildMetadataFieldSources(
  metadata: any,
  sourcePriorityWinner: string
): Record<string, any> {
  const fieldSources: Record<string, any> = {};
  const source = mapSourceToFieldSource(sourcePriorityWinner);
  const sourceDetail = `${source} public API`;
  const timestamp = new Date().toISOString();

  const addSource = (fieldPath: string, value: any) => {
    if (value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) {
      fieldSources[fieldPath] = { source, sourceDetail, confidence: 100, updatedAt: timestamp };
    }
  };

  // metadata.display.performance
  if (metadata?.display?.performance) {
    const perf = metadata.display.performance;
    addSource('metadata.display.performance.cast', perf.cast);
    addSource('metadata.display.performance.genre', perf.genre);
    addSource('metadata.display.performance.duration_minutes', perf.duration_minutes);
    addSource('metadata.display.performance.intermission', perf.intermission);
    addSource('metadata.display.performance.age_limit', perf.age_limit);
    addSource('metadata.display.performance.showtimes', perf.showtimes);
    addSource('metadata.display.performance.runtime', perf.runtime);
    if (perf.crew) {
      addSource('metadata.display.performance.crew.director', perf.crew.director);
      addSource('metadata.display.performance.crew.writer', perf.crew.writer);
      addSource('metadata.display.performance.crew.composer', perf.crew.composer);
    }
    addSource('metadata.display.performance.discounts', perf.discounts);
    addSource('metadata.display.performance.last_admission', perf.last_admission);
  }

  // metadata.display.exhibition
  if (metadata?.display?.exhibition) {
    const exh = metadata.display.exhibition;
    addSource('metadata.display.exhibition.artists', exh.artists);
    addSource('metadata.display.exhibition.genre', exh.genre);
    addSource('metadata.display.exhibition.duration_minutes', exh.duration_minutes);
    addSource('metadata.display.exhibition.type', exh.type);
    addSource('metadata.display.exhibition.discounts', exh.discounts);
    addSource('metadata.display.exhibition.last_admission', exh.last_admission);
  }

  return fieldSources;
}

async function backfillMetadataFieldSources() {
  console.log('[Backfill] Starting metadata field_sources backfill...');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // metadata.display가 있는 이벤트 조회
    const eventsResult = await client.query(`
      SELECT id, canonical_key, source_priority_winner, metadata, field_sources
      FROM canonical_events
      WHERE metadata->'display' IS NOT NULL
        AND (metadata->'display'->'performance' IS NOT NULL OR metadata->'display'->'exhibition' IS NOT NULL)
    `);

    const eventsToUpdate = eventsResult.rows;
    console.log(`[Backfill] Found ${eventsToUpdate.length} events with metadata.display`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const event of eventsToUpdate) {
      // metadata 필드에 대한 field_sources 생성
      const newFieldSources = buildMetadataFieldSources(event.metadata, event.source_priority_winner);

      // 기존 field_sources가 있으면 병합 (기존 값 보존)
      const mergedFieldSources = { ...(event.field_sources || {}), ...newFieldSources };

      // 업데이트 (기존 field_sources를 덮어쓰지 않고 병합)
      await client.query(
        `UPDATE canonical_events SET field_sources = $1, updated_at = NOW() WHERE id = $2`,
        [mergedFieldSources, event.id]
      );
      updatedCount++;

      if (updatedCount % 100 === 0) {
        console.log(`[Backfill] Processed ${updatedCount} events...`);
      }
    }

    await client.query('COMMIT');
    console.log(`[Backfill] Backfill complete!`);
    console.log(`  - Updated: ${updatedCount}`);
    console.log(`  - Skipped: ${skippedCount}`);

    // 검증
    const verificationResult = await client.query(`
      SELECT COUNT(*) AS total_with_display,
             COUNT(*) FILTER (
               WHERE field_sources ? 'metadata.display.performance.cast' 
                  OR field_sources ? 'metadata.display.exhibition.artists'
             ) AS with_metadata_field_sources
      FROM canonical_events
      WHERE metadata->'display' IS NOT NULL
    `);
    const verification = verificationResult.rows[0];
    console.log(`\n[Backfill] Verification:`);
    console.log(`  - Total events with metadata.display: ${verification.total_with_display}`);
    console.log(`  - With metadata field_sources: ${verification.with_metadata_field_sources}`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Backfill] Transaction failed:', error);
    throw error;
  } finally {
    client.release();
    console.log('[Backfill] Done!');
    await pool.end();
  }
}

backfillMetadataFieldSources()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Backfill] Fatal error:', err);
    process.exit(1);
  });

