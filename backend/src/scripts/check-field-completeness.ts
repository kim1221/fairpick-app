/**
 * 카테고리별 필드 완성도 진단 스크립트
 * 실행: npx ts-node src/scripts/check-field-completeness.ts
 */

import { pool } from '../db';

const CATEGORIES = ['공연', '전시', '팝업', '축제', '행사'];

async function run() {
  console.log('\n========================================');
  console.log('  Fairpick 카테고리별 필드 완성도 진단');
  console.log('========================================\n');

  // 1. 카테고리별 이벤트 수 + 기본 필드 완성도
  const categorySummary = await pool.query(`
    SELECT
      main_category,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE end_at >= NOW() OR end_at IS NULL) AS active,
      -- 필수 필드
      ROUND(COUNT(*) FILTER (WHERE title IS NOT NULL AND title != '') * 100.0 / COUNT(*)) AS pct_title,
      ROUND(COUNT(*) FILTER (WHERE image_url IS NOT NULL AND image_url != '' AND image_url NOT LIKE '%placeholder%') * 100.0 / COUNT(*)) AS pct_image,
      ROUND(COUNT(*) FILTER (WHERE start_at IS NOT NULL) * 100.0 / COUNT(*)) AS pct_start_at,
      ROUND(COUNT(*) FILTER (WHERE end_at IS NOT NULL) * 100.0 / COUNT(*)) AS pct_end_at,
      ROUND(COUNT(*) FILTER (WHERE venue IS NOT NULL AND venue != '') * 100.0 / COUNT(*)) AS pct_venue,
      -- 중요 필드
      ROUND(COUNT(*) FILTER (WHERE overview IS NOT NULL AND overview != '') * 100.0 / COUNT(*)) AS pct_overview,
      ROUND(COUNT(*) FILTER (WHERE address IS NOT NULL AND address != '') * 100.0 / COUNT(*)) AS pct_address,
      ROUND(COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) * 100.0 / COUNT(*)) AS pct_geo,
      ROUND(COUNT(*) FILTER (WHERE region IS NOT NULL AND region != '') * 100.0 / COUNT(*)) AS pct_region,
      -- 가격/무료
      ROUND(COUNT(*) FILTER (WHERE is_free = true) * 100.0 / COUNT(*)) AS pct_is_free,
      ROUND(COUNT(*) FILTER (WHERE price_min IS NOT NULL) * 100.0 / COUNT(*)) AS pct_price_min,
      ROUND(COUNT(*) FILTER (WHERE price_info IS NOT NULL AND price_info != '') * 100.0 / COUNT(*)) AS pct_price_info,
      -- 부가 필드
      ROUND(COUNT(*) FILTER (WHERE opening_hours IS NOT NULL AND opening_hours::text != '{}' AND opening_hours::text != 'null') * 100.0 / COUNT(*)) AS pct_opening_hours,
      ROUND(COUNT(*) FILTER (WHERE external_links IS NOT NULL AND external_links::text != '{}' AND external_links::text != 'null') * 100.0 / COUNT(*)) AS pct_external_links,
      ROUND(COUNT(*) FILTER (WHERE metadata IS NOT NULL AND metadata::text != '{}') * 100.0 / COUNT(*)) AS pct_metadata,
      ROUND(COUNT(*) FILTER (WHERE buzz_score IS NOT NULL AND buzz_score > 0) * 100.0 / COUNT(*)) AS pct_buzz,
      ROUND(COUNT(*) FILTER (WHERE is_featured = true) * 100.0 / COUNT(*)) AS pct_featured,
      -- 완성도 수준별 분포
      COUNT(*) FILTER (WHERE completeness_level = 'excellent') AS cnt_excellent,
      COUNT(*) FILTER (WHERE completeness_level = 'good') AS cnt_good,
      COUNT(*) FILTER (WHERE completeness_level = 'poor') AS cnt_poor,
      COUNT(*) FILTER (WHERE completeness_level = 'empty') AS cnt_empty
    FROM canonical_events
    WHERE main_category = ANY($1::text[])
    GROUP BY main_category
    ORDER BY total DESC
  `, [CATEGORIES]);

  // 2. 카테고리별 metadata 내부 필드 완성도
  const metadataCompleteness = await pool.query(`
    SELECT
      main_category,
      COUNT(*) AS total,
      -- 공연 메타
      ROUND(COUNT(*) FILTER (WHERE metadata->'display'->'performance'->'cast' IS NOT NULL) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE main_category = '공연'), 0)) AS perf_cast,
      ROUND(COUNT(*) FILTER (WHERE metadata->'display'->'performance'->'genre' IS NOT NULL) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE main_category = '공연'), 0)) AS perf_genre,
      ROUND(COUNT(*) FILTER (WHERE (metadata->'display'->'performance'->>'duration_minutes')::int > 0) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE main_category = '공연'), 0)) AS perf_duration,
      ROUND(COUNT(*) FILTER (WHERE metadata->'display'->'performance'->'discounts' IS NOT NULL) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE main_category = '공연'), 0)) AS perf_discounts,
      -- 전시 메타
      ROUND(COUNT(*) FILTER (WHERE metadata->'display'->'exhibition'->'artists' IS NOT NULL) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE main_category = '전시'), 0)) AS exh_artists,
      ROUND(COUNT(*) FILTER (WHERE metadata->'display'->'exhibition'->'genre' IS NOT NULL) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE main_category = '전시'), 0)) AS exh_genre,
      ROUND(COUNT(*) FILTER (WHERE (metadata->'display'->'exhibition'->>'duration_minutes')::int > 0) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE main_category = '전시'), 0)) AS exh_duration,
      -- 팝업 메타
      ROUND(COUNT(*) FILTER (WHERE metadata->'display'->'popup'->'type' IS NOT NULL) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE main_category = '팝업'), 0)) AS popup_type,
      ROUND(COUNT(*) FILTER (WHERE metadata->'display'->'popup'->'brands' IS NOT NULL) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE main_category = '팝업'), 0)) AS popup_brands,
      ROUND(COUNT(*) FILTER (WHERE metadata->'display'->'popup'->'waiting_hint' IS NOT NULL) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE main_category = '팝업'), 0)) AS popup_waiting,
      -- 축제 메타
      ROUND(COUNT(*) FILTER (WHERE metadata->'display'->'festival'->'organizer' IS NOT NULL) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE main_category = '축제'), 0)) AS fest_organizer,
      ROUND(COUNT(*) FILTER (WHERE metadata->'display'->'festival'->'program_highlights' IS NOT NULL) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE main_category = '축제'), 0)) AS fest_programs
    FROM canonical_events
    WHERE main_category = ANY($1::text[])
    GROUP BY main_category
    ORDER BY total DESC
  `, [CATEGORIES]);

  // 3. GPT 제안 섹션별 실현 가능 이벤트 수
  const sectionViability = await pool.query(`
    SELECT
      -- 섹션2: 팝업 (category='팝업' + is_featured + 진행중)
      COUNT(*) FILTER (WHERE main_category = '팝업' AND end_at >= NOW()) AS popup_active,
      COUNT(*) FILTER (WHERE main_category = '팝업' AND is_featured = true AND end_at >= NOW()) AS popup_featured,
      COUNT(*) FILTER (WHERE main_category = '팝업' AND end_at >= NOW() AND end_at <= NOW() + INTERVAL '7 days') AS popup_ending_soon,
      -- 섹션3: 무료/저가 (is_free OR price_min <= 15000)
      COUNT(*) FILTER (WHERE (is_free = true OR price_min <= 15000) AND end_at >= NOW()) AS free_or_cheap,
      COUNT(*) FILTER (WHERE is_free = true AND end_at >= NOW()) AS strictly_free,
      COUNT(*) FILTER (WHERE price_min IS NOT NULL AND price_min <= 15000 AND end_at >= NOW()) AS cheap_with_price,
      -- 섹션4: 몰입형 (duration >= 90)
      COUNT(*) FILTER (WHERE (metadata->'display'->'performance'->>'duration_minutes')::int >= 90 AND end_at >= NOW()) AS long_duration_perf,
      COUNT(*) FILTER (WHERE (metadata->'display'->'exhibition'->>'duration_minutes')::int >= 90 AND end_at >= NOW()) AS long_duration_exh,
      -- 섹션5: 이번 주말 (금~일)
      COUNT(*) FILTER (WHERE end_at >= NOW() AND start_at <= (NOW() + INTERVAL '7 days') AND end_at >= date_trunc('week', NOW()) + INTERVAL '4 days') AS weekend_events,
      -- 전체 활성 이벤트
      COUNT(*) FILTER (WHERE end_at >= NOW() OR end_at IS NULL) AS total_active
    FROM canonical_events
  `);

  // ── 출력 ──────────────────────────────────────────────────────────────────

  // 기본 필드 완성도
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('1. 카테고리별 이벤트 수 & 기본 필드 완성도 (%)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  for (const row of categorySummary.rows) {
    const cat = row.main_category ?? '(미분류)';
    console.log(`\n[${cat}] 전체 ${row.total}개 / 활성 ${row.active}개`);
    console.log(`  완성도: excellent=${row.cnt_excellent} good=${row.cnt_good} poor=${row.cnt_poor} empty=${row.cnt_empty}`);
    console.log('  ── 필수 필드 ──');
    console.log(`  제목       ${bar(row.pct_title)}  ${row.pct_title}%`);
    console.log(`  이미지     ${bar(row.pct_image)}  ${row.pct_image}%`);
    console.log(`  시작일     ${bar(row.pct_start_at)}  ${row.pct_start_at}%`);
    console.log(`  종료일     ${bar(row.pct_end_at)}  ${row.pct_end_at}%`);
    console.log(`  장소       ${bar(row.pct_venue)}  ${row.pct_venue}%`);
    console.log('  ── 중요 필드 ──');
    console.log(`  개요       ${bar(row.pct_overview)}  ${row.pct_overview}%`);
    console.log(`  주소       ${bar(row.pct_address)}  ${row.pct_address}%`);
    console.log(`  좌표(geo)  ${bar(row.pct_geo)}  ${row.pct_geo}%`);
    console.log(`  지역       ${bar(row.pct_region)}  ${row.pct_region}%`);
    console.log('  ── 가격 / 무료 ──');
    console.log(`  is_free    ${bar(row.pct_is_free)}  ${row.pct_is_free}%`);
    console.log(`  price_min  ${bar(row.pct_price_min)}  ${row.pct_price_min}%`);
    console.log(`  price_info ${bar(row.pct_price_info)}  ${row.pct_price_info}%`);
    console.log('  ── 부가 필드 ──');
    console.log(`  운영시간   ${bar(row.pct_opening_hours)}  ${row.pct_opening_hours}%`);
    console.log(`  외부링크   ${bar(row.pct_external_links)}  ${row.pct_external_links}%`);
    console.log(`  메타데이터 ${bar(row.pct_metadata)}  ${row.pct_metadata}%`);
    console.log(`  buzz_score ${bar(row.pct_buzz)}  ${row.pct_buzz}%`);
    console.log(`  is_featured ${bar(row.pct_featured)}  ${row.pct_featured}%`);
  }

  // metadata 내부 필드
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('2. 카테고리별 metadata 특화 필드 완성도 (%)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  for (const row of metadataCompleteness.rows) {
    const cat = row.main_category;
    if (cat === '공연') {
      console.log(`\n[공연] (전체 ${row.total}개)`);
      console.log(`  출연진(cast)     ${bar(row.perf_cast)}  ${row.perf_cast ?? 0}%`);
      console.log(`  장르(genre)      ${bar(row.perf_genre)}  ${row.perf_genre ?? 0}%`);
      console.log(`  공연시간(min)    ${bar(row.perf_duration)}  ${row.perf_duration ?? 0}%`);
      console.log(`  할인정보         ${bar(row.perf_discounts)}  ${row.perf_discounts ?? 0}%`);
    } else if (cat === '전시') {
      console.log(`\n[전시] (전체 ${row.total}개)`);
      console.log(`  작가(artists)    ${bar(row.exh_artists)}  ${row.exh_artists ?? 0}%`);
      console.log(`  장르(genre)      ${bar(row.exh_genre)}  ${row.exh_genre ?? 0}%`);
      console.log(`  관람시간(min)    ${bar(row.exh_duration)}  ${row.exh_duration ?? 0}%`);
    } else if (cat === '팝업') {
      console.log(`\n[팝업] (전체 ${row.total}개)`);
      console.log(`  팝업타입(type)   ${bar(row.popup_type)}  ${row.popup_type ?? 0}%`);
      console.log(`  브랜드(brands)   ${bar(row.popup_brands)}  ${row.popup_brands ?? 0}%`);
      console.log(`  대기안내         ${bar(row.popup_waiting)}  ${row.popup_waiting ?? 0}%`);
    } else if (cat === '축제') {
      console.log(`\n[축제] (전체 ${row.total}개)`);
      console.log(`  주최(organizer)  ${bar(row.fest_organizer)}  ${row.fest_organizer ?? 0}%`);
      console.log(`  주요프로그램     ${bar(row.fest_programs)}  ${row.fest_programs ?? 0}%`);
    }
  }

  // 섹션 실현 가능성
  const sv = sectionViability.rows[0];
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('3. GPT 제안 섹션별 실현 가능 이벤트 수 (현재 기준)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  전체 활성 이벤트                : ${sv.total_active}개`);
  console.log(`\n  [섹션2] 팝업 큐레이션`);
  console.log(`    진행중 팝업 전체              : ${sv.popup_active}개`);
  console.log(`    is_featured = true 팝업       : ${sv.popup_featured}개  ← 수동 큐레이션 가능 수`);
  console.log(`    7일 이내 마감 팝업            : ${sv.popup_ending_soon}개`);
  console.log(`\n  [섹션3] 부담 없이 가볍게 (무료/저가)`);
  console.log(`    is_free=true                  : ${sv.strictly_free}개`);
  console.log(`    price_min ≤ 15,000            : ${sv.cheap_with_price}개`);
  console.log(`    합계 (is_free OR 저가)        : ${sv.free_or_cheap}개`);
  console.log(`\n  [섹션4] 몰입해서 보기 좋은 (duration≥90min)`);
  console.log(`    공연 duration_minutes ≥ 90    : ${sv.long_duration_perf}개`);
  console.log(`    전시 duration_minutes ≥ 90    : ${sv.long_duration_exh}개`);
  console.log(`\n  [섹션5] 이번 주말`);
  console.log(`    이번 주말 해당 이벤트         : ${sv.weekend_events}개`);

  console.log('\n========================================\n');
  await pool.end();
}

function bar(pct: any): string {
  const n = Math.round(Number(pct ?? 0) / 10);
  return '[' + '█'.repeat(n) + '░'.repeat(10 - n) + ']';
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
