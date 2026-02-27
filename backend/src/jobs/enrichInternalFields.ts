/**
 * Enrich Internal Fields Job (Phase 2)
 * 
 * 모든 canonical_events의 metadata.internal 생성/업데이트
 * - derived_tags → matching fields
 * - opening_hours → timing fields
 * - lat/lng → location fields
 */

import { pool } from '../db';
import { generateInternalFields, type EventDataForInternal } from '../lib/internalFieldsGenerator';

interface CanonicalEventRow {
  id: string;
  title: string;
  main_category: string;
  derived_tags: string[] | null;
  opening_hours: any;
  lat: number | null;
  lng: number | null;
  address: string | null;
  region: string | null;
  metadata: any;
}

/**
 * 단일 이벤트의 internal fields 재계산
 * Admin에서 수동 수정 시 호출
 */
export async function enrichSingleEvent(eventId: string): Promise<boolean> {
  try {
    console.log(`[Phase 2] Enriching single event: ${eventId}`);
    
    // 이벤트 조회
    const result = await pool.query<CanonicalEventRow>(`
      SELECT 
        id, title, main_category,
        derived_tags, opening_hours,
        lat, lng, address, region,
        metadata
      FROM canonical_events
      WHERE id = $1
    `, [eventId]);

    if (result.rows.length === 0) {
      console.warn(`[Phase 2] Event not found: ${eventId}`);
      return false;
    }

    const event = result.rows[0];
    
    // Internal fields 생성
    const eventData: EventDataForInternal = {
      derived_tags: event.derived_tags || [],
      opening_hours: event.opening_hours,
      lat: event.lat,
      lng: event.lng,
      address: event.address,
      region: event.region,
      main_category: event.main_category,
    };
    
    const internalFields = generateInternalFields(eventData);
    
    // metadata 업데이트
    await pool.query(`
      UPDATE canonical_events
      SET metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{internal}',
        $1::jsonb
      )
      WHERE id = $2
    `, [JSON.stringify(internalFields), eventId]);
    
    console.log(`[Phase 2] ✅ Event ${eventId} updated successfully`);
    return true;
  } catch (error) {
    console.error(`[Phase 2] ❌ Error enriching event ${eventId}:`, error);
    return false;
  }
}

/**
 * 메인 함수: internal fields 생성 (incremental)
 * - metadata.internal이 없는 이벤트 (신규)
 * - 최근 25시간 내 updated_at이 변경된 이벤트 (소스 데이터 변경)
 * - enrichInternalFields 자체는 updated_at을 수정하지 않음
 */
export async function enrichInternalFields() {
  console.log('[Phase 2] Starting enrichInternalFields job (incremental)...');

  const startTime = Date.now();
  let processedCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  try {
    // 1. 마지막 성공한 수집 파이프라인 시각 조회 (없으면 25시간 전 폴백)
    const lastRunRes = await pool.query(`
      SELECT started_at FROM collection_logs
      WHERE type IN ('geo_refresh', 'collection')
        AND status = 'success'
      ORDER BY started_at DESC
      LIMIT 1
    `);
    const cutoff: string = lastRunRes.rows.length > 0
      ? lastRunRes.rows[0].started_at.toISOString()
      : new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    console.log(`[Phase 2] Using cutoff: ${cutoff}`);

    // 2. 처리 대상: 미처리 또는 마지막 수집 이후 변경된 이벤트만
    const result = await pool.query<CanonicalEventRow>(`
      SELECT
        id, title, main_category,
        derived_tags, opening_hours,
        lat, lng, address, region,
        metadata
      FROM canonical_events
      WHERE is_deleted = false
        AND end_at >= CURRENT_DATE
        AND (
          metadata->'internal' IS NULL
          OR updated_at >= $1::timestamptz
        )
      ORDER BY created_at DESC
    `, [cutoff]);

    const events = result.rows;
    console.log(`[Phase 2] Found ${events.length} events to process (new or recently updated)`);

    // 2. 각 이벤트에 대해 internal fields 생성
    for (const event of events) {
      processedCount++;

      try {
        // internal fields 생성
        const internal = generateInternalFields({
          derived_tags: event.derived_tags || [],
          opening_hours: event.opening_hours,
          lat: event.lat,
          lng: event.lng,
          address: event.address,
          region: event.region,
          main_category: event.main_category,
        });

        // 기존 metadata에 internal 추가 (display는 유지)
        const updatedMetadata = {
          ...(event.metadata || {}),
          internal,
        };

        // DB 업데이트 (updated_at은 건드리지 않음 — 소스 데이터 변경 시각 보존)
        await pool.query(
          `UPDATE canonical_events
           SET metadata = $1
           WHERE id = $2`,
          [JSON.stringify(updatedMetadata), event.id]
        );

        updatedCount++;

        // 진행상황 로그 (100개마다)
        if (processedCount % 100 === 0) {
          console.log(`[Phase 2] Processed ${processedCount}/${events.length} events...`);
        }

      } catch (error: any) {
        errorCount++;
        console.error(`[Phase 2] Error processing event ${event.id} (${event.title}):`, error.message);
      }
    }

    // 3. 결과 요약
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`
[Phase 2] Enrichment completed!
  - Total events: ${events.length}
  - Processed: ${processedCount}
  - Updated: ${updatedCount}
  - Errors: ${errorCount}
  - Duration: ${duration}s
    `);

    // 4. 샘플 확인
    await printSampleResults(5);

    return {
      success: true,
      total: events.length,
      processed: processedCount,
      updated: updatedCount,
      errors: errorCount,
      duration: parseFloat(duration),
    };

  } catch (error: any) {
    console.error('[Phase 2] Job failed:', error);
    throw error;
  }
}

/**
 * 샘플 결과 출력
 */
async function printSampleResults(limit: number = 5) {
  console.log(`\n[Phase 2] Sample results (${limit} events):\n`);

  const result = await pool.query(`
    SELECT 
      id, title, main_category,
      metadata->'internal'->'matching' as matching,
      metadata->'internal'->'timing' as timing,
      metadata->'internal'->'location' as location
    FROM canonical_events
    WHERE metadata->'internal' IS NOT NULL
      AND is_deleted = false
    ORDER BY updated_at DESC
    LIMIT $1
  `, [limit]);

  for (const row of result.rows) {
    console.log(`
📌 ${row.title} (${row.main_category})
   Matching:
     - companions: ${JSON.stringify(row.matching?.companions || [])}
     - age_groups: ${JSON.stringify(row.matching?.age_groups || [])}
     - mood: ${JSON.stringify(row.matching?.mood || [])}
     - indoor: ${row.matching?.indoor}
   Timing:
     - morning: ${row.timing?.morning_available}, afternoon: ${row.timing?.afternoon_available}, evening: ${row.timing?.evening_available}
     - best_days: ${JSON.stringify(row.timing?.best_days || [])}
   Location:
     - metro_nearby: ${row.location?.metro_nearby}
     - downtown: ${row.location?.downtown}
    `);
  }
}

/**
 * 통계 조회
 */
export async function getInternalFieldsStats() {
  console.log('\n[Phase 2] Internal Fields Statistics:\n');

  // 1. 전체 현황
  const totalResult = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE metadata->'internal' IS NOT NULL) as has_internal,
      COUNT(*) FILTER (WHERE metadata->'internal'->'matching'->'companions' IS NOT NULL) as has_companions,
      COUNT(*) FILTER (WHERE metadata->'internal'->'timing'->'evening_available' IS NOT NULL) as has_timing,
      COUNT(*) FILTER (WHERE metadata->'internal'->'location'->'metro_nearby' IS NOT NULL) as has_location
    FROM canonical_events
    WHERE is_deleted = false AND end_at >= CURRENT_DATE
  `);

  const stats = totalResult.rows[0];
  console.log(`Total live events: ${stats.total}`);
  console.log(`Has internal fields: ${stats.has_internal} (${((stats.has_internal / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Has companions data: ${stats.has_companions} (${((stats.has_companions / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Has timing data: ${stats.has_timing} (${((stats.has_timing / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Has location data: ${stats.has_location} (${((stats.has_location / stats.total) * 100).toFixed(1)}%)`);

  // 2. Companions 분포
  const companionsResult = await pool.query(`
    SELECT 
      jsonb_array_elements_text(metadata->'internal'->'matching'->'companions') as companion,
      COUNT(*) as count
    FROM canonical_events
    WHERE is_deleted = false 
      AND end_at >= CURRENT_DATE
      AND metadata->'internal'->'matching'->'companions' IS NOT NULL
    GROUP BY companion
    ORDER BY count DESC
    LIMIT 10
  `);

  console.log('\nTop Companions:');
  for (const row of companionsResult.rows) {
    console.log(`  ${row.companion}: ${row.count}`);
  }

  // 3. 시간대 분포
  const timingResult = await pool.query(`
    SELECT 
      COUNT(*) FILTER (WHERE (metadata->'internal'->'timing'->>'morning_available')::boolean = true) as morning,
      COUNT(*) FILTER (WHERE (metadata->'internal'->'timing'->>'afternoon_available')::boolean = true) as afternoon,
      COUNT(*) FILTER (WHERE (metadata->'internal'->'timing'->>'evening_available')::boolean = true) as evening,
      COUNT(*) FILTER (WHERE (metadata->'internal'->'timing'->>'night_available')::boolean = true) as night
    FROM canonical_events
    WHERE is_deleted = false 
      AND end_at >= CURRENT_DATE
      AND metadata->'internal'->'timing' IS NOT NULL
  `);

  const timing = timingResult.rows[0];
  console.log('\nTime Availability:');
  console.log(`  Morning (06:00-12:00): ${timing.morning}`);
  console.log(`  Afternoon (12:00-18:00): ${timing.afternoon}`);
  console.log(`  Evening (18:00-22:00): ${timing.evening}`);
  console.log(`  Night (22:00-06:00): ${timing.night}`);

  // 4. Location 분포
  const locationResult = await pool.query(`
    SELECT 
      COUNT(*) FILTER (WHERE (metadata->'internal'->'location'->>'metro_nearby')::boolean = true) as metro_nearby,
      COUNT(*) FILTER (WHERE (metadata->'internal'->'location'->>'downtown')::boolean = true) as downtown,
      COUNT(*) FILTER (WHERE (metadata->'internal'->'location'->>'tourist_area')::boolean = true) as tourist_area
    FROM canonical_events
    WHERE is_deleted = false 
      AND end_at >= CURRENT_DATE
      AND metadata->'internal'->'location' IS NOT NULL
  `);

  const location = locationResult.rows[0];
  console.log('\nLocation Attributes:');
  console.log(`  Metro nearby: ${location.metro_nearby}`);
  console.log(`  Downtown: ${location.downtown}`);
  console.log(`  Tourist area: ${location.tourist_area}`);
}

// CLI 실행 지원
if (require.main === module) {
  (async () => {
    try {
      await enrichInternalFields();
      await getInternalFieldsStats();
      process.exit(0);
    } catch (error) {
      console.error('Job failed:', error);
      process.exit(1);
    }
  })();
}

