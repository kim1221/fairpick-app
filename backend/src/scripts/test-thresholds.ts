import { pool } from '../db';

async function testThresholds() {
  const scoreExpr = `(
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
  )`;

  console.log('\n=== Testing Threshold: ≥30 for excellent ===\n');
  const result = await pool.query(`
    WITH score_calc AS (
      SELECT ${scoreExpr} AS score FROM canonical_events WHERE is_deleted = false
    )
    SELECT
      COUNT(*) FILTER (WHERE score < 22) as empty,
      ROUND(100.0 * COUNT(*) FILTER (WHERE score < 22) / COUNT(*), 1) as empty_pct,
      COUNT(*) FILTER (WHERE score >= 22 AND score < 27) as poor,
      ROUND(100.0 * COUNT(*) FILTER (WHERE score >= 22 AND score < 27) / COUNT(*), 1) as poor_pct,
      COUNT(*) FILTER (WHERE score >= 27 AND score < 30) as good,
      ROUND(100.0 * COUNT(*) FILTER (WHERE score >= 27 AND score < 30) / COUNT(*), 1) as good_pct,
      COUNT(*) FILTER (WHERE score >= 30) as excellent,
      ROUND(100.0 * COUNT(*) FILTER (WHERE score >= 30) / COUNT(*), 1) as excellent_pct,
      COUNT(*) as total
    FROM score_calc
  `);

  console.log('Thresholds: <22 (empty), 22-27 (poor), 27-30 (good), ≥30 (excellent)');
  console.log(result.rows[0]);

  await pool.end();
}

testThresholds().catch(console.error);
