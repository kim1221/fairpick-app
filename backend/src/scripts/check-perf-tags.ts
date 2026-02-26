import { pool } from '../db';

async function main() {
  // 1. 공연 태그/개요 현황
  const tagRes = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE derived_tags IS NULL) as tags_null,
      COUNT(*) FILTER (WHERE derived_tags IS NOT NULL AND jsonb_array_length(derived_tags::jsonb) = 0) as tags_empty,
      COUNT(*) FILTER (WHERE derived_tags IS NOT NULL AND jsonb_array_length(derived_tags::jsonb) > 0) as tags_ok,
      COUNT(*) FILTER (WHERE overview IS NULL OR overview = '') as overview_missing,
      COUNT(*) FILTER (WHERE overview IS NOT NULL AND overview != '') as overview_ok
    FROM canonical_events
    WHERE is_deleted = false AND status IN ('scheduled','ongoing') AND main_category = '공연'
  `);
  console.log('공연 태그/개요 현황:', JSON.stringify(tagRes.rows[0], null, 2));

  // 2. needsEnrichment 조건 확인 - 백필이 왜 스킵했는지
  // needsEnrichment: derived_tags 없거나, opening_hours 없거나, price_min/max 둘다 없으면 처리
  const needsEnrichRes = await pool.query(`
    SELECT
      COUNT(*) as total_no_tags,
      COUNT(*) FILTER (WHERE opening_hours IS NULL OR opening_hours = '{}'::jsonb) as also_no_hours,
      COUNT(*) FILTER (WHERE price_min IS NULL AND price_max IS NULL) as also_no_price,
      COUNT(*) FILTER (WHERE
        opening_hours IS NOT NULL AND opening_hours != '{}'::jsonb
        AND (price_min IS NOT NULL OR price_max IS NOT NULL)
      ) as skipped_by_needs_enrichment
    FROM canonical_events
    WHERE is_deleted = false AND status IN ('scheduled','ongoing')
      AND main_category = '공연'
      AND (derived_tags IS NULL OR jsonb_array_length(derived_tags::jsonb) = 0)
  `);
  console.log('\n태그 없는 공연 - needsEnrichment 분석:', JSON.stringify(needsEnrichRes.rows[0], null, 2));

  // 3. 스킵된 이유: opening_hours 있고 price_min 있으면 needsEnrichment=false로 스킵됨
  const skippedRes = await pool.query(`
    SELECT title, derived_tags, opening_hours, price_min, price_max
    FROM canonical_events
    WHERE is_deleted = false AND status IN ('scheduled','ongoing')
      AND main_category = '공연'
      AND (derived_tags IS NULL OR jsonb_array_length(derived_tags::jsonb) = 0)
      AND opening_hours IS NOT NULL AND opening_hours != '{}'::jsonb
      AND (price_min IS NOT NULL OR price_max IS NOT NULL)
    LIMIT 3
  `);
  console.log('\n스킵 예시 (hours+price 있어서 needsEnrichment=false):');
  skippedRes.rows.forEach(r => {
    console.log(' -', r.title.slice(0, 40));
    console.log('   price_min:', r.price_min, '| opening_hours:', JSON.stringify(r.opening_hours));
  });

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
