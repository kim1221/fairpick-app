/**
 * Address Backfill Job (Reverse Geocoding)
 * 
 * 목적: 좌표는 있지만 address가 없는 이벤트에 대해 역지오코딩으로 주소 채우기
 * 
 * 전략:
 * - Kakao Local API coord2address (역지오코딩)
 * - lat/lng → 도로명주소 or 지번주소
 * - Rate limit: 초당 10건 (110ms 간격)
 * 
 * 실행: npm run backfill:address
 */

import { pool } from '../db';
import axios from 'axios';
import { config } from '../config';

// ============================================================
// Types
// ============================================================

interface EventToBackfill {
  id: string;
  title: string;
  lat: number;
  lng: number;
  venue?: string;
  region?: string;
}

interface ReverseGeocodeResult {
  address: string;
  type: 'road' | 'jibun'; // 도로명 or 지번
  confidence: 'high' | 'medium' | 'low';
}

// ============================================================
// Kakao Reverse Geocoding
// ============================================================

/**
 * Kakao coord2address API로 역지오코딩
 */
async function reverseGeocodeWithKakao(
  lat: number,
  lng: number
): Promise<ReverseGeocodeResult | null> {
  if (!config.kakaoRestApiKey) {
    console.error('[AddressBackfill] KAKAO_REST_API_KEY is not configured');
    return null;
  }

  try {
    const response = await axios.get(
      'https://dapi.kakao.com/v2/local/geo/coord2address.json',
      {
        params: { x: lng, y: lat },
        headers: {
          Authorization: `KakaoAK ${config.kakaoRestApiKey}`,
        },
        timeout: 5000,
      }
    );

    if (!response.data.documents || response.data.documents.length === 0) {
      return null;
    }

    const doc = response.data.documents[0];

    // 도로명주소 우선 (더 정확하고 현대적)
    if (doc.road_address) {
      return {
        address: doc.road_address.address_name,
        type: 'road',
        confidence: 'high',
      };
    }

    // 지번주소 fallback
    if (doc.address) {
      return {
        address: doc.address.address_name,
        type: 'jibun',
        confidence: 'medium',
      };
    }

    return null;
  } catch (error: any) {
    if (error.response?.status === 429) {
      console.warn('[AddressBackfill] Rate limit exceeded, will retry...');
      throw error; // Retry 가능하도록 throw
    }
    console.error('[AddressBackfill] Reverse geocode failed:', error.message);
    return null;
  }
}

// ============================================================
// Database Operations
// ============================================================

/**
 * 좌표는 있지만 address가 없는 이벤트 조회
 */
async function fetchEventsToBackfill(limit?: number): Promise<EventToBackfill[]> {
  const query = `
    SELECT 
      id,
      title,
      lat,
      lng,
      venue,
      region
    FROM canonical_events
    WHERE is_deleted = false
      AND (address IS NULL OR address = '')
      AND lat IS NOT NULL
      AND lng IS NOT NULL
    ORDER BY updated_at DESC
    ${limit ? `LIMIT ${limit}` : ''}
  `;

  const result = await pool.query(query);
  return result.rows;
}

/**
 * address 업데이트
 */
async function updateAddress(
  eventId: string,
  address: string,
  addressType: 'road' | 'jibun'
): Promise<void> {
  await pool.query(
    `UPDATE canonical_events 
     SET address = $1, 
         updated_at = NOW()
     WHERE id = $2`,
    [address, eventId]
  );
}

// ============================================================
// Main Job
// ============================================================

async function main() {
  console.log('========================================');
  console.log('Address Backfill Job (Reverse Geocoding)');
  console.log('========================================\n');

  // Dry run 모드 체크
  const isDryRun = process.argv.includes('--dry-run');
  if (isDryRun) {
    console.log('⚠️  DRY RUN MODE: No database updates will be made\n');
  }

  // Limit 옵션 체크
  const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;

  try {
    // Step 1: 대상 이벤트 조회
    console.log('Step 1: Fetching events to backfill...');
    const events = await fetchEventsToBackfill(limit);
    console.log(`Found ${events.length} events with coordinates but no address\n`);

    if (events.length === 0) {
      console.log('✅ No events to backfill. All done!');
      return;
    }

    // Step 2: 역지오코딩 및 업데이트
    console.log('Step 2: Reverse geocoding and updating...\n');

    let updated = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const progress = `[${i + 1}/${events.length}]`;

      try {
        // 역지오코딩
        const result = await reverseGeocodeWithKakao(event.lat, event.lng);

        if (result) {
          if (!isDryRun) {
            await updateAddress(event.id, result.address, result.type);
          }
          
          updated++;
          const typeLabel = result.type === 'road' ? '도로명' : '지번';
          console.log(
            `${progress} ✅ ${event.title.substring(0, 40)}\n` +
            `         → ${result.address} (${typeLabel})`
          );
        } else {
          failed++;
          console.log(
            `${progress} ❌ ${event.title.substring(0, 40)}\n` +
            `         → Reverse geocoding failed`
          );
        }
      } catch (error: any) {
        if (error.response?.status === 429) {
          // Rate limit: 대기 후 재시도
          console.log(`${progress} ⏳ Rate limit, waiting 1 second...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          i--; // 재시도
          continue;
        }

        failed++;
        console.error(
          `${progress} ❌ ${event.title.substring(0, 40)}\n` +
          `         → Error: ${error.message}`
        );
      }

      // Rate limit 준수 (Kakao: 초당 10건)
      if (i < events.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 110));
      }
    }

    // Step 3: 결과 요약
    console.log('\n========================================');
    console.log('Backfill Summary');
    console.log('========================================');
    console.log(`Total events:     ${events.length}`);
    console.log(`✅ Updated:       ${updated} (${((updated / events.length) * 100).toFixed(1)}%)`);
    console.log(`❌ Failed:        ${failed} (${((failed / events.length) * 100).toFixed(1)}%)`);
    console.log(`⏭️  Skipped:       ${skipped}`);

    if (isDryRun) {
      console.log('\n⚠️  DRY RUN: No changes were made to the database');
    }

    // Step 4: 최종 coverage 확인
    if (!isDryRun && updated > 0) {
      console.log('\n========================================');
      console.log('Final Coverage Check');
      console.log('========================================');

      const coverageResult = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE address IS NOT NULL AND address != '') as has_address,
          ROUND(100.0 * COUNT(*) FILTER (WHERE address IS NOT NULL AND address != '') / COUNT(*), 2) as coverage_pct
        FROM canonical_events
        WHERE is_deleted = false
      `);

      const { total, has_address, coverage_pct } = coverageResult.rows[0];
      console.log(`Total active events:  ${total}`);
      console.log(`Events with address:  ${has_address}`);
      console.log(`Coverage:             ${coverage_pct}%`);
    }

    console.log('\n✅ Address backfill job completed successfully\n');
  } catch (error) {
    console.error('\n❌ Address backfill job failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// ============================================================
// Execute
// ============================================================

if (require.main === module) {
  main();
}

export { reverseGeocodeWithKakao, fetchEventsToBackfill, updateAddress };

