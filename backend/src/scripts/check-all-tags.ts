import { pool } from '../db';

async function main() {
  // 1. 카테고리별 태그/개요 현황
  const r = await pool.query(`
    SELECT main_category,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE derived_tags IS NULL OR jsonb_array_length(derived_tags::jsonb) = 0) as tags_missing,
      COUNT(*) FILTER (WHERE derived_tags IS NOT NULL AND jsonb_array_length(derived_tags::jsonb) > 0) as tags_ok,
      COUNT(*) FILTER (WHERE overview IS NULL OR overview = '') as overview_missing
    FROM canonical_events
    WHERE is_deleted=false AND status IN ('scheduled','ongoing')
    GROUP BY main_category ORDER BY total DESC
  `);
  console.log('카테고리별 태그/개요 현황:');
  r.rows.forEach((row: any) => {
    const pct = (parseInt(row.tags_ok) / parseInt(row.total) * 100).toFixed(1);
    console.log(`  ${row.main_category}: 전체=${row.total}, 태그없음=${row.tags_missing}, 태그있음=${row.tags_ok}(${pct}%), 개요없음=${row.overview_missing}`);
  });

  // 2. derived_tags 컬럼 타입 확인
  const col = await pool.query(`
    SELECT data_type FROM information_schema.columns
    WHERE table_name='canonical_events' AND column_name='derived_tags'
  `);
  console.log('\nderived_tags 컬럼 타입:', col.rows[0]?.data_type);

  // 3. 공연 개요+태그 둘다 없음
  const both = await pool.query(`
    SELECT COUNT(*) as c FROM canonical_events
    WHERE is_deleted=false AND status IN ('scheduled','ongoing')
      AND main_category='공연'
      AND (overview IS NULL OR overview='')
      AND (derived_tags IS NULL OR jsonb_array_length(derived_tags::jsonb) = 0)
  `);
  console.log('\n공연 개요+태그 둘다 없음:', both.rows[0].c);

  // 4. 최근 backfill 업데이트 결과 샘플
  const recent = await pool.query(`
    SELECT title, derived_tags, overview IS NOT NULL AND overview != '' as has_overview,
           updated_at
    FROM canonical_events
    WHERE is_deleted=false AND main_category='공연'
      AND derived_tags IS NOT NULL AND jsonb_array_length(derived_tags::jsonb) > 0
    ORDER BY updated_at DESC
    LIMIT 5
  `);
  console.log('\n공연 최근 태그 업데이트 샘플:');
  recent.rows.forEach((row: any) => {
    console.log(`  ${row.title.slice(0, 40)} | tags=${JSON.stringify(row.derived_tags)} | ${row.updated_at}`);
  });

  // 5. 공연 중 태그 없는 이벤트의 updated_at 분포
  const updDist = await pool.query(`
    SELECT
      DATE(updated_at) as date,
      COUNT(*) as cnt
    FROM canonical_events
    WHERE is_deleted=false AND main_category='공연'
      AND (derived_tags IS NULL OR jsonb_array_length(derived_tags::jsonb) = 0)
    GROUP BY DATE(updated_at)
    ORDER BY date DESC
    LIMIT 10
  `);
  console.log('\n공연 태그없는 이벤트 updated_at 분포 (최근 10일):');
  updDist.rows.forEach((row: any) => {
    console.log(`  ${row.date}: ${row.cnt}개`);
  });

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
