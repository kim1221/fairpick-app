/**
 * Geo Venue Backfill - Venue Name-based Geocoding
 * 
 * 공연장/장소명(venue) 기반으로 lat/lng를 채우는 Job
 * - raw_kopis_events, raw_culture_events, raw_tour_events 대상
 * - address가 없고 venue만 있으며 lat/lng가 NULL인 이벤트 처리
 * - Kakao Local API 키워드 검색 사용
 */

import { pool } from '../db';
import http from '../lib/http';
import { config } from '../config';
import pLimit from 'p-limit';

interface VenueBackfillOptions {
  liveOnly?: boolean;
  limit?: number;
  minConfidence?: number;
}

interface EventToGeocode {
  id: string;
  table: string;
  source: string;
  title: string;
  venue: string;
  region?: string;
}

/**
 * Kakao Local API로 장소명 키워드 검색
 */
async function geocodeVenueWithKakao(
  venue: string,
  region?: string
): Promise<{ lat: number; lng: number; confidence: number } | null> {
  if (!config.kakaoRestApiKey) {
    return null;
  }

  try {
    // region이 있으면 "region venue" 형태로 검색
    const query = region ? `${region} ${venue}` : venue;

    const response = await http.get<any>(
      'https://dapi.kakao.com/v2/local/search/keyword.json',
      {
        params: {
          query,
          size: 1,
        },
        headers: {
          Authorization: `KakaoAK ${config.kakaoRestApiKey}`,
        },
      }
    );

    const documents = response?.documents ?? [];
    if (documents.length === 0) {
      return null;
    }

    const place = documents[0];
    const lat = parseFloat(place.y);
    const lng = parseFloat(place.x);

    if (isNaN(lat) || isNaN(lng)) {
      return null;
    }

    // 신뢰도 계산: category_name이 있고 place_name이 venue와 유사하면 높은 신뢰도
    let confidence = 0.5; // 기본 신뢰도

    if (place.category_name) {
      confidence += 0.2;
    }

    const venueLower = venue.toLowerCase().replace(/\s+/g, '');
    const placeLower = (place.place_name || '').toLowerCase().replace(/\s+/g, '');

    if (placeLower.includes(venueLower) || venueLower.includes(placeLower)) {
      confidence += 0.3;
    }

    return { lat, lng, confidence };
  } catch (error) {
    console.warn('[VenueBackfill] Kakao API failed:', error);
    return null;
  }
}

/**
 * 좌표 없는 이벤트 조회 (venue만 있고 address 없는 것)
 */
async function fetchEventsWithoutGeo(options: VenueBackfillOptions): Promise<EventToGeocode[]> {
  const { liveOnly = false, limit = 500 } = options;

  const tables = [
    { table: 'raw_kopis_events', source: 'kopis' },
    { table: 'raw_culture_events', source: 'culture' },
    { table: 'raw_tour_events', source: 'tour' },
  ];

  const events: EventToGeocode[] = [];

  for (const { table, source } of tables) {
    const liveFilter = liveOnly ? 'AND end_at >= CURRENT_DATE' : '';
    
    const query = `
      SELECT 
        id,
        title,
        venue,
        region
      FROM ${table}
      WHERE (lat IS NULL OR lng IS NULL)
        AND venue IS NOT NULL
        AND venue != ''
        AND (address IS NULL OR address = '')
        ${liveFilter}
      ORDER BY end_at DESC NULLS LAST
      LIMIT $1
    `;

    try {
      const result = await pool.query(query, [Math.floor(limit / 3)]);
      
      events.push(
        ...result.rows.map((row) => ({
          id: row.id,
          table,
          source,
          title: row.title,
          venue: row.venue,
          region: row.region,
        }))
      );
    } catch (error) {
      console.error(`[VenueBackfill] Failed to fetch from ${table}:`, error);
    }
  }

  return events;
}

/**
 * 이벤트 좌표 업데이트
 */
async function updateEventGeo(
  table: string,
  id: string,
  lat: number,
  lng: number
): Promise<void> {
  const query = `
    UPDATE ${table}
    SET 
      lat = $1,
      lng = $2,
      updated_at = NOW()
    WHERE id = $3
  `;

  await pool.query(query, [lat, lng, id]);
}

/**
 * Geo Venue Backfill 메인 함수 (Venue Name-based)
 */
export async function runGeoVenueBackfill(options: VenueBackfillOptions = {}): Promise<void> {
  const startTime = Date.now();
  const { minConfidence = 0.5 } = options;
  
  console.log('='.repeat(80));
  console.log('[VenueBackfill] Venue-based geocoding started');
  console.log('='.repeat(80));
  console.log(`Options:`, options);
  console.log(`Min confidence: ${minConfidence}`);
  console.log();

  const stats = {
    scanned: 0,
    updated: 0,
    failed: 0,
    lowConfidence: 0,
    bySource: {} as Record<string, { scanned: number; updated: number; failed: number }>,
  };

  try {
    console.log('[VenueBackfill] Fetching events with venue but no coordinates...');
    const events = await fetchEventsWithoutGeo(options);
    stats.scanned = events.length;
    
    console.log(`[VenueBackfill] Found ${events.length} events to process`);
    console.log();

    if (events.length === 0) {
      console.log('[VenueBackfill] No events to process. Done!');
      return;
    }

    // 동시성 제어
    const GEOCODE_CONCURRENCY = parseInt(process.env.GEOCODE_CONCURRENCY || '5', 10);
    const limit = pLimit(GEOCODE_CONCURRENCY);

    console.log(`[VenueBackfill] Starting venue geocoding with concurrency=${GEOCODE_CONCURRENCY}...`);
    console.log(`[VenueBackfill] Estimated time: ~${((events.length / GEOCODE_CONCURRENCY) * 0.3 / 60).toFixed(1)} minutes`);

    // 병렬 처리 (제한 동시성)
    const tasks = events.map((event, index) => limit(async () => {
      // stats 초기화
      if (!stats.bySource[event.source]) {
        stats.bySource[event.source] = { scanned: 0, updated: 0, failed: 0 };
      }
      stats.bySource[event.source].scanned++;

      try {
        const result = await geocodeVenueWithKakao(event.venue, event.region);

        if (result && result.confidence >= minConfidence) {
          await updateEventGeo(event.table, event.id, result.lat, result.lng);
          stats.updated++;
          stats.bySource[event.source].updated++;

          if (stats.updated <= 10) {
            const shortTitle = event.title.substring(0, 40);
            const shortVenue = event.venue.substring(0, 20);
            console.log(
              `✓ [${event.source}] ${shortTitle} | ` +
              `venue="${shortVenue}" | ` +
              `${result.lat.toFixed(6)}, ${result.lng.toFixed(6)} | ` +
              `conf=${result.confidence.toFixed(2)}`
            );
          }
        } else if (result && result.confidence < minConfidence) {
          stats.lowConfidence++;
          stats.bySource[event.source].failed++;
        } else {
          stats.failed++;
          stats.bySource[event.source].failed++;
        }

        // Rate limit (동시성 있으므로 sleep 감소)
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`[VenueBackfill] Failed to geocode event ${event.id}:`, error);
        stats.failed++;
        stats.bySource[event.source].failed++;
      }

      // 진행률 로그 (100개마다)
      if ((index + 1) % 100 === 0) {
        console.log(`[VenueBackfill] Progress: ${index + 1}/${events.length} events queued`);
      }
    }));

    await Promise.all(tasks);

    console.log();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('='.repeat(80));
    console.log('[VenueBackfill] Venue-based geocoding completed');
    console.log(`  - Scanned: ${stats.scanned}`);
    console.log(`  - Updated: ${stats.updated}`);
    console.log(`  - Failed: ${stats.failed}`);
    console.log(`  - Low confidence (skipped): ${stats.lowConfidence}`);
    console.log(`  - Success rate: ${stats.scanned > 0 ? ((stats.updated / stats.scanned) * 100).toFixed(1) : '0.0'}%`);
    console.log(`  - Elapsed: ${elapsed}s`);
    console.log();
    console.log('[VenueBackfill] By source:');
    for (const [source, sourceStats] of Object.entries(stats.bySource)) {
      const successRate = sourceStats.scanned > 0
        ? ((sourceStats.updated / sourceStats.scanned) * 100).toFixed(1)
        : '0.0';
      console.log(
        `  - ${source.toUpperCase()}: scanned=${sourceStats.scanned}, ` +
        `updated=${sourceStats.updated}, failed=${sourceStats.failed}, ` +
        `success=${successRate}%`
      );
    }
    console.log('='.repeat(80));

  } catch (error) {
    console.error('[VenueBackfill] Fatal error:', error);
    throw error;
  }
}

// CLI 실행
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: VenueBackfillOptions = {};

  for (const arg of args) {
    if (arg === '--live-only') {
      options.liveOnly = true;
    }
    if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1], 10);
    }
    if (arg.startsWith('--min-confidence=')) {
      options.minConfidence = parseFloat(arg.split('=')[1]);
    }
  }

  runGeoVenueBackfill(options)
    .then(() => {
      console.log('[VenueBackfill] Job completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[VenueBackfill] Job failed:', error);
      process.exit(1);
    });
}




