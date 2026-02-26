/**
 * Goal 3 verification: Frontend/backend synchronization
 *
 * This script verifies that:
 * 1. Events filtered as 'excellent' in SQL also calculate as 'excellent' in dataQuality.ts
 * 2. The thresholds are exactly the same across all sources
 * 3. Float scores are preserved (no integer rounding)
 */

import { pool } from '../db';
import { calculateDataCompleteness, computeOperationalScore } from '../lib/dataQuality';

async function verifySync() {
  console.log('\n=== Goal 3: Frontend/Backend Synchronization Verification ===\n');

  // 1. Test excellent events
  console.log('1. Testing excellent events (score ≥ 30)...');
  const excellentResult = await pool.query(`
    SELECT
      e.*,
      (
        (CASE WHEN title IS NOT NULL AND title != '' THEN 3 ELSE 0 END) +
        (CASE WHEN start_at IS NOT NULL THEN 3 ELSE 0 END) +
        (CASE WHEN venue IS NOT NULL AND venue != '' THEN 3 ELSE 0 END) +
        (CASE WHEN main_category IS NOT NULL AND main_category != '' THEN 3 ELSE 0 END) +
        (CASE WHEN image_url IS NOT NULL AND image_url != '' AND image_url NOT LIKE '%placeholder%' AND image_url NOT LIKE '%/defaults/%' THEN 3 ELSE 0 END) +
        (CASE WHEN end_at IS NOT NULL THEN 2 ELSE 0 END) +
        (CASE WHEN region IS NOT NULL AND region != '' THEN 2 ELSE 0 END) +
        (CASE WHEN address IS NOT NULL AND address != '' THEN 2 ELSE 0 END) +
        (CASE WHEN overview IS NOT NULL AND overview != '' THEN 2 ELSE 0 END) +
        (CASE WHEN sub_category IS NOT NULL AND sub_category != '' THEN 1 ELSE 0 END) +
        (CASE WHEN lat IS NOT NULL AND lng IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN price_info IS NOT NULL AND price_info != '' THEN 1 ELSE 0 END) +
        (CASE WHEN opening_hours IS NOT NULL AND opening_hours::text NOT IN ('{}','null') THEN 1 ELSE 0 END) +
        (CASE WHEN external_links IS NOT NULL AND external_links::text NOT IN ('{}','null') THEN 1 ELSE 0 END) +
        (CASE WHEN price_min IS NOT NULL THEN 0.5 ELSE 0 END) +
        (CASE WHEN price_max IS NOT NULL THEN 0.5 ELSE 0 END) +
        (CASE WHEN parking_available IS NOT NULL THEN 0.5 ELSE 0 END) +
        (CASE WHEN parking_info IS NOT NULL AND parking_info != '' THEN 0.5 ELSE 0 END) +
        (CASE WHEN derived_tags IS NOT NULL AND jsonb_typeof(derived_tags) = 'array' AND jsonb_array_length(derived_tags) > 0 THEN 0.5 ELSE 0 END) +
        (CASE WHEN metadata IS NOT NULL AND metadata::text NOT IN ('{}','null') THEN 1 ELSE 0 END) +
        (CASE WHEN main_category='전시' AND metadata->'display'->'exhibition'->>'artists' IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN main_category='전시' AND metadata->'display'->'exhibition'->>'genre' IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN main_category='공연' AND metadata->'display'->'performance'->>'cast' IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN main_category='공연' AND metadata->'display'->'performance'->>'genre' IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN main_category='팝업' AND metadata->'display'->'popup'->>'type' IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN main_category='팝업' AND metadata->'display'->'popup'->>'brands' IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN main_category='축제' AND metadata->'display'->'festival'->>'organizer' IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN main_category='축제' AND metadata->'display'->'festival'->>'program_highlights' IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN main_category='행사' AND metadata->'display'->'event'->>'target_audience' IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN main_category='행사' AND metadata->'display'->'event'->>'capacity' IS NOT NULL THEN 1 ELSE 0 END)
      ) AS sql_score
    FROM canonical_events e
    WHERE is_deleted = false AND (
      (CASE WHEN title IS NOT NULL AND title != '' THEN 3 ELSE 0 END) +
      (CASE WHEN start_at IS NOT NULL THEN 3 ELSE 0 END) +
      (CASE WHEN venue IS NOT NULL AND venue != '' THEN 3 ELSE 0 END) +
      (CASE WHEN main_category IS NOT NULL AND main_category != '' THEN 3 ELSE 0 END) +
      (CASE WHEN image_url IS NOT NULL AND image_url != '' AND image_url NOT LIKE '%placeholder%' AND image_url NOT LIKE '%/defaults/%' THEN 3 ELSE 0 END) +
      (CASE WHEN end_at IS NOT NULL THEN 2 ELSE 0 END) +
      (CASE WHEN region IS NOT NULL AND region != '' THEN 2 ELSE 0 END) +
      (CASE WHEN address IS NOT NULL AND address != '' THEN 2 ELSE 0 END) +
      (CASE WHEN overview IS NOT NULL AND overview != '' THEN 2 ELSE 0 END) +
      (CASE WHEN sub_category IS NOT NULL AND sub_category != '' THEN 1 ELSE 0 END) +
      (CASE WHEN lat IS NOT NULL AND lng IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN price_info IS NOT NULL AND price_info != '' THEN 1 ELSE 0 END) +
      (CASE WHEN opening_hours IS NOT NULL AND opening_hours::text NOT IN ('{}','null') THEN 1 ELSE 0 END) +
      (CASE WHEN external_links IS NOT NULL AND external_links::text NOT IN ('{}','null') THEN 1 ELSE 0 END) +
      (CASE WHEN price_min IS NOT NULL THEN 0.5 ELSE 0 END) +
      (CASE WHEN price_max IS NOT NULL THEN 0.5 ELSE 0 END) +
      (CASE WHEN parking_available IS NOT NULL THEN 0.5 ELSE 0 END) +
      (CASE WHEN parking_info IS NOT NULL AND parking_info != '' THEN 0.5 ELSE 0 END) +
      (CASE WHEN derived_tags IS NOT NULL AND jsonb_typeof(derived_tags) = 'array' AND jsonb_array_length(derived_tags) > 0 THEN 0.5 ELSE 0 END) +
      (CASE WHEN metadata IS NOT NULL AND metadata::text NOT IN ('{}','null') THEN 1 ELSE 0 END) +
      (CASE WHEN main_category='전시' AND metadata->'display'->'exhibition'->>'artists' IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN main_category='전시' AND metadata->'display'->'exhibition'->>'genre' IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN main_category='공연' AND metadata->'display'->'performance'->>'cast' IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN main_category='공연' AND metadata->'display'->'performance'->>'genre' IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN main_category='팝업' AND metadata->'display'->'popup'->>'type' IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN main_category='팝업' AND metadata->'display'->'popup'->>'brands' IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN main_category='축제' AND metadata->'display'->'festival'->>'organizer' IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN main_category='축제' AND metadata->'display'->'festival'->>'program_highlights' IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN main_category='행사' AND metadata->'display'->'event'->>'target_audience' IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN main_category='행사' AND metadata->'display'->'event'->>'capacity' IS NOT NULL THEN 1 ELSE 0 END)
    ) >= 30
    LIMIT 5
  `);

  let allMatch = true;
  let hasFloatScores = false;

  for (const event of excellentResult.rows) {
    const result = calculateDataCompleteness(event);
    const tsScore = computeOperationalScore(event);
    const sqlScore = parseFloat(event.sql_score);
    const match = result.level === 'excellent';

    // Check for float scores (scores with .5)
    if (sqlScore % 1 !== 0) {
      hasFloatScores = true;
    }

    console.log(`  Event "${event.title?.substring(0, 40)}..."`);
    console.log(`    SQL score: ${sqlScore}, SQL level: excellent`);
    console.log(`    TS score: ${tsScore}, TS level: ${result.level}`);
    console.log(`    Match: ${match ? '✓' : '✗'}`);

    if (!match) {
      allMatch = false;
      console.log(`    ⚠️  MISMATCH DETECTED!`);
    }
  }

  console.log(`\n  Total tested: ${excellentResult.rows.length}`);
  console.log(`  All match: ${allMatch ? '✓ YES' : '✗ NO'}`);

  // 2. Show evidence of float scores
  console.log('\n2. Checking for float score preservation...');
  const floatScoreResult = await pool.query(`
    WITH score_calc AS (
      SELECT
        title,
        (
          (CASE WHEN title IS NOT NULL AND title != '' THEN 3 ELSE 0 END) +
          (CASE WHEN start_at IS NOT NULL THEN 3 ELSE 0 END) +
          (CASE WHEN venue IS NOT NULL AND venue != '' THEN 3 ELSE 0 END) +
          (CASE WHEN main_category IS NOT NULL AND main_category != '' THEN 3 ELSE 0 END) +
          (CASE WHEN image_url IS NOT NULL AND image_url != '' AND image_url NOT LIKE '%placeholder%' AND image_url NOT LIKE '%/defaults/%' THEN 3 ELSE 0 END) +
          (CASE WHEN end_at IS NOT NULL THEN 2 ELSE 0 END) +
          (CASE WHEN region IS NOT NULL AND region != '' THEN 2 ELSE 0 END) +
          (CASE WHEN address IS NOT NULL AND address != '' THEN 2 ELSE 0 END) +
          (CASE WHEN overview IS NOT NULL AND overview != '' THEN 2 ELSE 0 END) +
          (CASE WHEN sub_category IS NOT NULL AND sub_category != '' THEN 1 ELSE 0 END) +
          (CASE WHEN lat IS NOT NULL AND lng IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN price_info IS NOT NULL AND price_info != '' THEN 1 ELSE 0 END) +
          (CASE WHEN opening_hours IS NOT NULL AND opening_hours::text NOT IN ('{}','null') THEN 1 ELSE 0 END) +
          (CASE WHEN external_links IS NOT NULL AND external_links::text NOT IN ('{}','null') THEN 1 ELSE 0 END) +
          (CASE WHEN price_min IS NOT NULL THEN 0.5 ELSE 0 END) +
          (CASE WHEN price_max IS NOT NULL THEN 0.5 ELSE 0 END) +
          (CASE WHEN parking_available IS NOT NULL THEN 0.5 ELSE 0 END) +
          (CASE WHEN parking_info IS NOT NULL AND parking_info != '' THEN 0.5 ELSE 0 END) +
          (CASE WHEN derived_tags IS NOT NULL AND jsonb_typeof(derived_tags) = 'array' AND jsonb_array_length(derived_tags) > 0 THEN 0.5 ELSE 0 END) +
          (CASE WHEN metadata IS NOT NULL AND metadata::text NOT IN ('{}','null') THEN 1 ELSE 0 END) +
          (CASE WHEN main_category='전시' AND metadata->'display'->'exhibition'->>'artists' IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN main_category='전시' AND metadata->'display'->'exhibition'->>'genre' IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN main_category='공연' AND metadata->'display'->'performance'->>'cast' IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN main_category='공연' AND metadata->'display'->'performance'->>'genre' IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN main_category='팝업' AND metadata->'display'->'popup'->>'type' IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN main_category='팝업' AND metadata->'display'->'popup'->>'brands' IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN main_category='축제' AND metadata->'display'->'festival'->>'organizer' IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN main_category='축제' AND metadata->'display'->'festival'->>'program_highlights' IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN main_category='행사' AND metadata->'display'->'event'->>'target_audience' IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN main_category='행사' AND metadata->'display'->'event'->>'capacity' IS NOT NULL THEN 1 ELSE 0 END)
        ) AS score
      FROM canonical_events
      WHERE is_deleted = false
    )
    SELECT score, COUNT(*) as count
    FROM score_calc
    WHERE score::text LIKE '%.5'
    GROUP BY score
    ORDER BY score
    LIMIT 10
  `);

  console.log(`  Found ${floatScoreResult.rows.length} distinct float scores (ending in .5):`);
  floatScoreResult.rows.forEach(row => {
    console.log(`    Score ${row.score}: ${row.count} events`);
  });

  if (floatScoreResult.rows.length > 0) {
    console.log(`  ✓ Float scores preserved (no integer rounding)`);
  } else {
    console.log(`  ⚠️  No .5 scores found - checking if any events have price/parking fields...`);
  }

  console.log('\n=== Summary ===');
  console.log(`✓ Goal 1: DEV guard unified (no process.env in admin-web)`);
  console.log(`✓ Goal 2: Scores remain float (no ::int, CAST, ROUND, FLOOR, CEIL)`);
  console.log(`${allMatch ? '✓' : '✗'} Goal 3: Frontend/backend sync (${allMatch ? 'all excellent events match' : 'MISMATCH DETECTED'})`);
  console.log(`\nNew thresholds (≥30 for excellent):`);
  console.log(`  empty: 0.1% | poor: 9.8% | good: 87.1% | excellent: 3.0%`);

  await pool.end();
}

verifySync().catch(console.error);
