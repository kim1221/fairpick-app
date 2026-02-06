/**
 * Geo Backfill - Address-based Geocoding
 * 
 * 주소(address) 기반으로 lat/lng를 채우는 Job
 * - raw_kopis_events, raw_culture_events, raw_tour_events 대상
 * - address가 있고 lat/lng가 NULL인 이벤트만 처리
 * - Kakao Local API 우선, Nominatim fallback
 */

import { pool } from '../db';
import http from '../lib/http';
import { config } from '../config';
import pLimit from 'p-limit';

interface GeoBackfillOptions {
  liveOnly?: boolean;
  limit?: number;
  allowCentroid?: boolean;
}

interface EventToGeocode {
  id: string;
  table: string;
  source: string;
  title: string;
  address: string;
  venue?: string;
  region?: string;
}

/**
 * Kakao Local API로 주소 지오코딩
 */
async function geocodeWithKakao(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!config.kakaoRestApiKey) {
    return null;
  }

  try {
    const response = await http.get<any>(
      'https://dapi.kakao.com/v2/local/search/address.json',
      {
        params: { query: address },
        headers: { Authorization: `KakaoAK ${config.kakaoRestApiKey}` },
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

    return { lat, lng };
  } catch (error) {
    console.warn('[GeoBackfill] Kakao API failed:', error);
    return null;
  }
}

/**
 * Nominatim API로 주소 지오코딩
 */
async function geocodeWithNominatim(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const response = await http.get<any[]>(
      'https://nominatim.openstreetmap.org/search',
      {
        params: {
          q: `${address} 대한민국`,
          format: 'json',
          limit: 1,
        },
        headers: {
          'User-Agent': 'FairpickApp/2.0 (geocoding service)',
        },
      }
    );

    if (!Array.isArray(response) || response.length === 0) {
      return null;
    }

    const place = response[0];
    const lat = parseFloat(place.lat);
    const lng = parseFloat(place.lon);

    if (isNaN(lat) || isNaN(lng)) {
      return null;
    }

    return { lat, lng };
  } catch (error) {
    console.warn('[GeoBackfill] Nominatim API failed:', error);
    return null;
  }
}

/**
 * 주소 기반 지오코딩 (Kakao → Nominatim fallback)
 */
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  // 1. Kakao 시도
  let result = await geocodeWithKakao(address);
  if (result) {
    return result;
  }

  // 2. Nominatim fallback
  await new Promise(resolve => setTimeout(resolve, 1100)); // Rate limit
  result = await geocodeWithNominatim(address);
  
  return result;
}

/**
 * 좌표 없는 이벤트 조회 (address 있는 것만)
 */
async function fetchEventsWithoutGeo(options: GeoBackfillOptions): Promise<EventToGeocode[]> {
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
        address,
        venue,
        region
      FROM ${table}
      WHERE (lat IS NULL OR lng IS NULL)
        AND address IS NOT NULL
        AND address != ''
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
          address: row.address,
          venue: row.venue,
          region: row.region,
        }))
      );
    } catch (error) {
      console.error(`[GeoBackfill] Failed to fetch from ${table}:`, error);
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
 * Geo Backfill 메인 함수 (Address-based)
 */
export async function runGeoBackfill(options: GeoBackfillOptions = {}): Promise<void> {
  const startTime = Date.now();
  
  console.log('='.repeat(80));
  console.log('[GeoBackfill] Address-based geocoding started');
  console.log('='.repeat(80));
  console.log(`Options:`, options);
  console.log();

  const stats = {
    scanned: 0,
    updated: 0,
    failed: 0,
    bySource: {} as Record<string, { scanned: number; updated: number; failed: number }>,
  };

  try {
    console.log('[GeoBackfill] Fetching events with address but no coordinates...');
    const events = await fetchEventsWithoutGeo(options);
    stats.scanned = events.length;
    
    console.log(`[GeoBackfill] Found ${events.length} events to process`);
    console.log();

    if (events.length === 0) {
      console.log('[GeoBackfill] No events to process. Done!');
      return;
    }

    // 동시성 제어
    const GEOCODE_CONCURRENCY = parseInt(process.env.GEOCODE_CONCURRENCY || '5', 10);
    const limit = pLimit(GEOCODE_CONCURRENCY);

    console.log(`[GeoBackfill] Starting geocoding with concurrency=${GEOCODE_CONCURRENCY}...`);
    console.log(`[GeoBackfill] Estimated time: ~${((events.length / GEOCODE_CONCURRENCY) * 0.3 / 60).toFixed(1)} minutes`);

    // 병렬 처리 (제한 동시성)
    const tasks = events.map((event, index) => limit(async () => {
      // stats 초기화
      if (!stats.bySource[event.source]) {
        stats.bySource[event.source] = { scanned: 0, updated: 0, failed: 0 };
      }
      stats.bySource[event.source].scanned++;

      try {
        const result = await geocodeAddress(event.address);

        if (result) {
          await updateEventGeo(event.table, event.id, result.lat, result.lng);
          stats.updated++;
          stats.bySource[event.source].updated++;

          if (stats.updated <= 10) {
            const shortTitle = event.title.substring(0, 40);
            console.log(
              `✓ [${event.source}] ${shortTitle} | ` +
              `${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}`
            );
          }
        } else {
          stats.failed++;
          stats.bySource[event.source].failed++;
        }

        // Rate limit (동시성 있으므로 sleep 감소)
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`[GeoBackfill] Failed to geocode event ${event.id}:`, error);
        stats.failed++;
        stats.bySource[event.source].failed++;
      }

      // 진행률 로그 (100개마다)
      if ((index + 1) % 100 === 0) {
        console.log(`[GeoBackfill] Progress: ${index + 1}/${events.length} events queued`);
      }
    }));

    await Promise.all(tasks);

    console.log();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('='.repeat(80));
    console.log('[GeoBackfill] Address-based geocoding completed');
    console.log(`  - Scanned: ${stats.scanned}`);
    console.log(`  - Updated: ${stats.updated}`);
    console.log(`  - Failed: ${stats.failed}`);
    console.log(`  - Success rate: ${stats.scanned > 0 ? ((stats.updated / stats.scanned) * 100).toFixed(1) : '0.0'}%`);
    console.log(`  - Elapsed: ${elapsed}s`);
    console.log();
    console.log('[GeoBackfill] By source:');
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
    console.error('[GeoBackfill] Fatal error:', error);
    throw error;
  }
}

// CLI 실행
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: GeoBackfillOptions = {};

  for (const arg of args) {
    if (arg === '--live-only') {
      options.liveOnly = true;
    }
    if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1], 10);
    }
  }

  runGeoBackfill(options)
    .then(() => {
      console.log('[GeoBackfill] Job completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[GeoBackfill] Job failed:', error);
      process.exit(1);
    });
}
