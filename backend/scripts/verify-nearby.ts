/**
 * /events/nearby API 검증 스크립트
 */
import { pool } from '../src/db';
import { calculateBoundingBox, getHaversineDistanceSQL } from '../src/utils/geo';

async function verifyNearby() {
  const testLat = 37.5665; // 서울 시청
  const testLng = 126.978;
  const testRadius = 5000; // 5km

  console.log(`[Verify] 테스트 좌표: lat=${testLat}, lng=${testLng}, radius=${testRadius}m\n`);

  const bbox = calculateBoundingBox(testLat, testLng, testRadius);
  console.log('[Verify] Bounding Box:', bbox, '\n');

  const distanceSQL = getHaversineDistanceSQL('$1', '$2');

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM (
      SELECT ${distanceSQL} AS distance
      FROM canonical_events
      WHERE end_at >= CURRENT_DATE
        AND lat IS NOT NULL
        AND lng IS NOT NULL
        AND lat BETWEEN $3 AND $4
        AND lng BETWEEN $5 AND $6
    ) AS events_with_distance
    WHERE distance <= $7;
  `;

  const params = [testLat, testLng, bbox.latMin, bbox.latMax, bbox.lngMin, bbox.lngMax, testRadius];

  console.log('[Verify] 쿼리 실행 중...\n');
  
  const result = await pool.query(countQuery, params);
  const count = result.rows[0]?.total ?? 0;

  console.log(`[Verify] ✅ 결과: ${count}개 이벤트가 ${testRadius}m 내에 존재\n`);

  // 샘플 5개 조회
  const sampleQuery = `
    SELECT * FROM (
      SELECT
        id,
        title,
        region,
        lat,
        lng,
        ${distanceSQL} AS distance_meters
      FROM canonical_events
      WHERE end_at >= CURRENT_DATE
        AND lat IS NOT NULL
        AND lng IS NOT NULL
        AND lat BETWEEN $3 AND $4
        AND lng BETWEEN $5 AND $6
    ) AS events_with_distance
    WHERE distance_meters <= $7
    ORDER BY distance_meters ASC
    LIMIT 5;
  `;

  const sampleResult = await pool.query(sampleQuery, params);

  console.log('[Verify] 샘플 5개 (거리순):');
  sampleResult.rows.forEach((row: any, i: number) => {
    console.log(`  ${i + 1}. ${row.title.substring(0, 40).padEnd(40)} | ${Math.round(row.distance_meters)}m | ${row.region}`);
  });

  await pool.end();
  console.log('\n[Verify] ✓ 검증 완료');
}

verifyNearby().catch(err => {
  console.error('[Verify] 에러:', err);
  process.exit(1);
});


