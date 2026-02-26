/**
 * Phase 3: Display Fields Backfill Job
 * 
 * canonical_events 테이블의 모든 전시/공연 이벤트에 대해
 * metadata.display 필드를 채워 넣음
 * 
 * 실행 방법:
 * npm run enrich:display
 */

import { pool } from '../db';
import { EventForDisplay, PerformanceDisplay, ExhibitionDisplay } from '../lib/displayFieldsGenerator/types';
import { extractExhibitionDisplay } from '../lib/displayFieldsGenerator/extractors/exhibitionExtractor';
import { extractPerformanceDisplay } from '../lib/displayFieldsGenerator/extractors/performanceExtractor';

interface CanonicalEventRow {
  id: string;
  title: string;
  main_category: string;
  sub_category: string | null;
  source_priority_winner: string;
  sources: Array<{
    source: string;
    rawTable: string;
    rawId: string;
  }>;
  field_sources?: Record<string, any>;
}

/**
 * Performance/Exhibition display 필드에 대한 field_sources 생성
 * (KOPIS 등 공공 API에서 추출한 경우)
 */
function buildDisplayFieldSources(
  displayData: { performance?: PerformanceDisplay; exhibition?: ExhibitionDisplay },
  sourcePriorityWinner: string
): Record<string, any> {
  const fieldSources: Record<string, any> = {};
  const source = sourcePriorityWinner === 'kopis' ? 'KOPIS' : 
                 sourcePriorityWinner === 'culture' ? 'Culture' :
                 sourcePriorityWinner === 'tour' ? 'TourAPI' : 
                 'PUBLIC_API';
  const sourceDetail = `${source} public API`;
  const timestamp = new Date().toISOString();

  const addSource = (fieldPath: string, value: any) => {
    if (value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) {
      fieldSources[fieldPath] = { source, sourceDetail, confidence: 100, updatedAt: timestamp };
    }
  };

  // Performance 필드
  if (displayData.performance) {
    const perf = displayData.performance;
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

  // Exhibition 필드
  if (displayData.exhibition) {
    const exh = displayData.exhibition;
    addSource('metadata.display.exhibition.artists', exh.artists);
    addSource('metadata.display.exhibition.genre', exh.genre);
    addSource('metadata.display.exhibition.duration_minutes', exh.duration_minutes);
    addSource('metadata.display.exhibition.type', exh.type);
    addSource('metadata.display.exhibition.discounts', (exh as any).discounts);
    addSource('metadata.display.exhibition.last_admission', exh.last_admission);
  }

  return fieldSources;
}

export async function displayFieldsBackfill() {
  console.log('[Phase 3] Starting Display Fields Backfill...');
  const startTime = Date.now();

  try {
    // 1. 전시/공연 이벤트만 조회
    const result = await pool.query<CanonicalEventRow>(`
      SELECT 
        id, 
        title, 
        main_category, 
        sub_category, 
        source_priority_winner,
        sources,
        field_sources
      FROM canonical_events
      WHERE main_category IN ('전시', '공연')
      ORDER BY created_at DESC
    `);

    console.log(`[Phase 3] Found ${result.rows.length} events (전시/공연)`);

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    // 2. 각 이벤트 처리
    for (let i = 0; i < result.rows.length; i++) {
      const event = result.rows[i];
      const progress = `[${i + 1}/${result.rows.length}]`;

      try {
        // sources가 없으면 스킵
        if (!event.sources || event.sources.length === 0) {
          console.log(`${progress} SKIP ${event.id} (${event.title}): no sources`);
          skipCount++;
          continue;
        }

        // 카테고리별 extractor 실행
        let displayData: any = null;

        if (event.main_category === '전시') {
          const exhibitionData = await extractExhibitionDisplay(event as EventForDisplay);
          displayData = { exhibition: exhibitionData };
        } else if (event.main_category === '공연') {
          const performanceData = await extractPerformanceDisplay(event as EventForDisplay);
          displayData = { performance: performanceData };
        } else {
          console.log(`${progress} SKIP ${event.id} (${event.title}): unsupported category`);
          skipCount++;
          continue;
        }

        // 3. field_sources 생성 (KOPIS 등 공공 API 출처)
        const newFieldSources = buildDisplayFieldSources(displayData, event.source_priority_winner);
        
        // 기존 field_sources와 병합 (기존 값 보존)
        const mergedFieldSources = { ...(event.field_sources || {}), ...newFieldSources };

        // 4. metadata.display + field_sources 업데이트
        await pool.query(`
          UPDATE canonical_events
          SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{display}',
            $1::jsonb,
            true
          ),
          field_sources = $2::jsonb,
          updated_at = NOW()
          WHERE id = $3
        `, [JSON.stringify(displayData), JSON.stringify(mergedFieldSources), event.id]);

        console.log(`${progress} ✅ ${event.id} (${event.title})`);
        successCount++;
      } catch (error) {
        console.error(`${progress} ❌ ${event.id} (${event.title}):`, error);
        errorCount++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`
[Phase 3] Display Fields Backfill Complete!
  ✅ Success: ${successCount}
  ⏭️  Skipped: ${skipCount}
  ❌ Errors:  ${errorCount}
  ⏱️  Duration: ${duration}ms
    `);
  } catch (error) {
    console.error('[Phase 3] Backfill failed:', error);
    throw error;
  }
}

/**
 * 단일 이벤트에 대해 display fields 재계산
 * (Admin UI에서 수동 저장 시 호출)
 */
export async function enrichSingleEventDisplay(eventId: string): Promise<void> {
  console.log(`[Phase 3] Enriching single event display: ${eventId}`);

  try {
    const result = await pool.query<CanonicalEventRow>(`
      SELECT 
        id, 
        title, 
        main_category, 
        sub_category, 
        source_priority_winner,
        sources,
        field_sources
      FROM canonical_events
      WHERE id = $1
    `, [eventId]);

    if (result.rows.length === 0) {
      console.warn(`[Phase 3] Event ${eventId} not found`);
      return;
    }

    const event = result.rows[0];

    // sources가 없으면 스킵
    if (!event.sources || event.sources.length === 0) {
      console.warn(`[Phase 3] Event ${eventId} has no sources, skipping`);
      return;
    }

    // 카테고리별 extractor 실행
    let displayData: any = null;

    if (event.main_category === '전시') {
      const exhibitionData = await extractExhibitionDisplay(event as EventForDisplay);
      displayData = { exhibition: exhibitionData };
    } else if (event.main_category === '공연') {
      const performanceData = await extractPerformanceDisplay(event as EventForDisplay);
      displayData = { performance: performanceData };
    } else {
      console.warn(`[Phase 3] Event ${eventId} unsupported category: ${event.main_category}`);
      return;
    }

    // field_sources 생성 (KOPIS 등 공공 API 출처)
    const newFieldSources = buildDisplayFieldSources(displayData, event.source_priority_winner);
    
    // 기존 field_sources와 병합 (기존 값 보존)
    const mergedFieldSources = { ...(event.field_sources || {}), ...newFieldSources };

    // metadata.display + field_sources 업데이트
    await pool.query(`
      UPDATE canonical_events
      SET metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{display}',
        $1::jsonb,
        true
      ),
      field_sources = $2::jsonb,
      updated_at = NOW()
      WHERE id = $3
    `, [JSON.stringify(displayData), JSON.stringify(mergedFieldSources), event.id]);

    console.log(`[Phase 3] ✅ Event ${eventId} display updated`);
  } catch (error) {
    console.error(`[Phase 3] Failed to enrich single event display ${eventId}:`, error);
    throw error;
  }
}

