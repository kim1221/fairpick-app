/**
 * verify-ingest-metadata.ts
 * 1단계 MVP 인제스트 메타데이터 검증 스크립트
 *
 * 실행: npx ts-node -r dotenv/config src/scripts/verify-ingest-metadata.ts
 */

import { pool } from '../db';
import { computeNeedsReview } from '../jobs/dedupeCanonicalEvents';
import { upsertCanonicalEvent, CanonicalEvent } from '../db';

// ─────────────────────────────────────────────
// 1. 백필 결과 검증
// ─────────────────────────────────────────────
async function verifyBackfill() {
  console.log('\n══════════════════════════════════════');
  console.log('① 백필 결과 검증');
  console.log('══════════════════════════════════════');

  const r = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(created_source) AS has_created_source,
      COUNT(ingest_change_type) AS has_ingest_type,
      COUNT(first_collected_at) AS has_first_collected,
      COUNT(last_collected_at) AS has_last_collected,
      COUNT(*) FILTER (WHERE created_source = 'public_api') AS public_api_count,
      COUNT(*) FILTER (WHERE ingest_change_type = 'unchanged') AS unchanged_count,
      COUNT(*) FILTER (WHERE ingest_change_type = 'new') AS new_count,
      COUNT(*) FILTER (WHERE ingest_change_type = 'updated') AS updated_count,
      COUNT(*) FILTER (WHERE last_collected_at IS NULL) AS null_last_collected,
      COUNT(*) FILTER (WHERE needs_review = true) AS needs_review_true
    FROM canonical_events
  `);
  const row = r.rows[0];

  console.log(`  전체: ${row.total}`);
  console.log(`  created_source 세팅: ${row.has_created_source} (public_api: ${row.public_api_count})`);
  console.log(`  ingest_change_type: unchanged=${row.unchanged_count}, new=${row.new_count}, updated=${row.updated_count}`);
  console.log(`  first_collected_at 세팅: ${row.has_first_collected}`);
  console.log(`  last_collected_at 세팅: ${row.has_last_collected} (NULL: ${row.null_last_collected})`);
  console.log(`  needs_review=true (백필 직후 0이어야 함): ${row.needs_review_true}`);

  const ok = (
    Number(row.total) === Number(row.has_created_source) &&
    Number(row.total) === Number(row.has_ingest_type) &&
    Number(row.total) === Number(row.has_first_collected) &&
    Number(row.total) === Number(row.has_last_collected) &&
    Number(row.null_last_collected) === 0 &&
    Number(row.new_count) === 0 // 백필 직후 new는 없어야 함
  );
  console.log(`  결과: ${ok ? '✅ PASS' : '❌ FAIL'}`);
  return ok;
}

// ─────────────────────────────────────────────
// 2. computeNeedsReview 함수 단위 테스트
// ─────────────────────────────────────────────
function verifyComputeNeedsReview() {
  console.log('\n══════════════════════════════════════');
  console.log('② computeNeedsReview 단위 테스트');
  console.log('══════════════════════════════════════');

  const cases = [
    {
      label: '이미지·좌표·설명 모두 없음 → 3개 이상 이유',
      input: { imageUrl: null, isFree: null, lat: null, lng: null, overview: null },
      expectedReasons: ['no_image', 'no_price', 'no_geo', 'short_overview'],
    },
    {
      label: '정상 이벤트 → needsReview=false',
      input: {
        imageUrl: 'https://cdn.example.com/img.jpg',
        isFree: false,
        lat: 37.5665,
        lng: 126.9780,
        overview: '이 전시는 현대 미술을 주제로 다양한 작품을 선보입니다. 총 50여점의 작품이 전시됩니다.',
      },
      expectedReasons: [],
    },
    {
      label: 'lat=0 (좌표 0 falsy 오판 방지) — no_geo 없어야 함',
      input: {
        imageUrl: 'https://cdn.example.com/img.jpg',
        isFree: false,
        lat: 0,    // 0이지만 null이 아님 → no_geo 없어야 함
        lng: 0,
        // overview는 30자 이상으로 명시 (short_overview 미유발)
        overview: '이 전시는 현대 미술을 주제로 다양한 작품을 선보입니다. 총 50여점의 작품이 전시됩니다.',
      },
      expectedReasons: [],  // no_geo 없음 확인이 목적
    },
    {
      label: 'ai_discovery → ai_discovery 이유 포함',
      input: {
        imageUrl: 'https://cdn.example.com/img.jpg',
        isFree: false,
        lat: 37.5,
        lng: 127.0,
        overview: '이 전시는 현대 미술을 주제로 다양한 작품을 선보입니다. 총 50여점의 작품이 전시됩니다.',
        createdSource: 'ai_discovery',
      },
      expectedReasons: ['ai_discovery'],
    },
  ];

  let allPass = true;
  for (const c of cases) {
    const { needsReview, reviewReason } = computeNeedsReview(c.input);
    const expectedSet = new Set(c.expectedReasons);
    const actualSet = new Set(reviewReason);
    const pass =
      needsReview === (c.expectedReasons.length > 0) &&
      c.expectedReasons.every(r => actualSet.has(r)) &&
      reviewReason.every(r => expectedSet.has(r));

    console.log(`  ${pass ? '✅' : '❌'} ${c.label}`);
    if (!pass) {
      console.log(`     기대: ${JSON.stringify(c.expectedReasons)}`);
      console.log(`     실제: ${JSON.stringify(reviewReason)}`);
      allPass = false;
    }
  }
  return allPass;
}

// ─────────────────────────────────────────────
// 3. upsertCanonicalEvent — INSERT(new) + UPDATE(updated) 검증
// ─────────────────────────────────────────────
async function verifyUpsert() {
  console.log('\n══════════════════════════════════════');
  console.log('③ upsertCanonicalEvent INSERT→new / UPDATE→updated 검증');
  console.log('══════════════════════════════════════');

  const testKey = `verify_test:INGEST_META_${Date.now()}`;

  const baseEvent: CanonicalEvent = {
    canonicalKey: testKey,
    title: '[VERIFY] 인제스트 메타 테스트 이벤트',
    startAt: '2026-04-01',
    endAt: '2026-04-30',
    venue: '테스트 장소',
    region: '서울',
    mainCategory: '행사',
    subCategory: null,
    imageUrl: null,          // no_image 유발
    isFree: undefined,       // no_price 유발
    lat: undefined,          // no_geo 유발
    lng: undefined,
    sourcePriorityWinner: 'kopis',
    sources: [{
      source: 'kopis',
      rawTable: 'raw_kopis_events',
      rawId: 'VERIFY_TEST',
      sourceEventId: 'VERIFY_TEST',
      sourceUrl: null,
      imageUrl: null,
      title: '[VERIFY] 테스트',
      startAt: '2026-04-01',
      endAt: '2026-04-30',
    }],
    createdSource: 'public_api',
    lastCollectorSource: 'kopis',
    ingestChangeType: 'new',
    needsReview: true,
    reviewReason: ['no_image', 'no_price', 'no_geo', 'short_overview'],
  };

  // INSERT
  await upsertCanonicalEvent(baseEvent);

  const after1 = await pool.query(
    `SELECT ingest_change_type, created_source, last_collector_source,
            needs_review, review_reason, first_collected_at, last_collected_at
     FROM canonical_events WHERE canonical_key = $1`,
    [testKey]
  );
  const r1 = after1.rows[0];
  const insertOk =
    r1.ingest_change_type === 'new' &&
    r1.created_source === 'public_api' &&
    r1.last_collector_source === 'kopis' &&
    r1.needs_review === true &&
    r1.review_reason?.includes('no_image') &&
    r1.first_collected_at != null &&
    r1.last_collected_at != null;

  console.log(`  INSERT 후 ingest_change_type: ${r1.ingest_change_type} (기대: 'new')`);
  console.log(`  INSERT 후 created_source: ${r1.created_source}`);
  console.log(`  INSERT 후 needs_review: ${r1.needs_review}`);
  console.log(`  INSERT 후 review_reason: ${JSON.stringify(r1.review_reason)}`);
  console.log(`  INSERT 결과: ${insertOk ? '✅ PASS' : '❌ FAIL'}`);

  // 잠깐 대기 후 UPDATE (last_collected_at 갱신 확인)
  await new Promise(r => setTimeout(r, 500));
  const firstLca = r1.last_collected_at;

  // UPDATE (같은 key, needs_review 해소된 상태로)
  const updatedEvent: CanonicalEvent = {
    ...baseEvent,
    imageUrl: 'https://cdn.example.com/fixed.jpg',
    isFree: false,
    lat: 37.5665,
    lng: 126.9780,
    ingestChangeType: 'new', // caller는 항상 'new' → SQL이 'updated'로 바꿔야 함
    needsReview: false,
    reviewReason: [],
  };
  await upsertCanonicalEvent(updatedEvent);

  const after2 = await pool.query(
    `SELECT ingest_change_type, created_source, needs_review, review_reason,
            first_collected_at, last_collected_at
     FROM canonical_events WHERE canonical_key = $1`,
    [testKey]
  );
  const r2 = after2.rows[0];
  const updateOk =
    r2.ingest_change_type === 'updated' &&
    r2.created_source === 'public_api' && // COALESCE 보존
    r2.needs_review === false &&
    r2.first_collected_at?.toISOString() === r1.first_collected_at?.toISOString(); // 보존

  console.log(`  UPDATE 후 ingest_change_type: ${r2.ingest_change_type} (기대: 'updated')`);
  console.log(`  UPDATE 후 created_source: ${r2.created_source} (보존 확인)`);
  console.log(`  UPDATE 후 needs_review: ${r2.needs_review}`);
  console.log(`  UPDATE 후 first_collected_at 보존: ${r2.first_collected_at?.toISOString() === r1.first_collected_at?.toISOString()}`);
  console.log(`  UPDATE 결과: ${updateOk ? '✅ PASS' : '❌ FAIL'}`);

  // 테스트 데이터 정리
  await pool.query(`DELETE FROM canonical_events WHERE canonical_key = $1`, [testKey]);
  console.log('  테스트 데이터 삭제 완료');

  return insertOk && updateOk;
}

// ─────────────────────────────────────────────
// 4. 필터 SQL 검증 (GET /admin/events 필터 로직)
// ─────────────────────────────────────────────
async function verifyFilters() {
  console.log('\n══════════════════════════════════════');
  console.log('④ 필터 SQL 검증');
  console.log('══════════════════════════════════════');

  let allPass = true;

  // 4-1. 최근 24h 필터: last_collected_at IS NOT NULL AND >= NOW()-24h
  const r1 = await pool.query(`
    SELECT COUNT(*) AS cnt
    FROM canonical_events
    WHERE last_collected_at IS NOT NULL
      AND last_collected_at >= NOW() - INTERVAL '24 hours'
  `);
  console.log(`  최근 24h 필터 (last_collected_at 기준): ${r1.rows[0].cnt}건`);
  // 백필 직후 기준: updated_at이 24h 이내인 것만 걸려야 함 (created_at fallback 없음)
  const r1b = await pool.query(`
    SELECT COUNT(*) AS cnt FROM canonical_events
    WHERE created_at >= NOW() - INTERVAL '24 hours'
  `);
  console.log(`  created_at 기준으로 24h이내 건수 (비교): ${r1b.rows[0].cnt}건`);
  // last_collected_at 기준이 created_at 기준보다 <= 여야 함 (더 엄격)
  const filterOk = Number(r1.rows[0].cnt) <= Number(r1b.rows[0].cnt);
  console.log(`  last_collected_at 필터가 created_at보다 엄격: ${filterOk ? '✅ PASS' : '❌ FAIL'}`);
  if (!filterOk) allPass = false;

  // 4-2. needs_review=true 필터
  const r2 = await pool.query(`
    SELECT COUNT(*) AS cnt FROM canonical_events WHERE needs_review = true
  `);
  console.log(`  needs_review=true 필터: ${r2.rows[0].cnt}건 (백필 후 0 기대)`);

  // 4-3. created_source 필터
  const r3 = await pool.query(`
    SELECT created_source, COUNT(*) AS cnt
    FROM canonical_events
    GROUP BY created_source
    ORDER BY cnt DESC
    LIMIT 5
  `);
  console.log(`  created_source 분포: ${r3.rows.map(r => `${r.created_source}=${r.cnt}`).join(', ')}`);

  // 4-4. ingest_change_type 필터 — new/updated 존재 여부 (백필 후에는 unchanged만 있어야 함)
  const r4 = await pool.query(`
    SELECT ingest_change_type, COUNT(*) AS cnt
    FROM canonical_events
    GROUP BY ingest_change_type
    ORDER BY cnt DESC
  `);
  console.log(`  ingest_change_type 분포: ${r4.rows.map(r => `${r.ingest_change_type}=${r.cnt}`).join(', ')}`);
  const onlyUnchanged = r4.rows.every(r => r.ingest_change_type === 'unchanged');
  console.log(`  백필 후 전부 unchanged: ${onlyUnchanged ? '✅ PASS' : '⚠️ 혼재 (dedupe 실행됐을 경우 정상)'}`);

  return allPass;
}

// ─────────────────────────────────────────────
// 5. 샘플 데이터 확인
// ─────────────────────────────────────────────
async function verifySample() {
  console.log('\n══════════════════════════════════════');
  console.log('⑤ 실제 DB 샘플 확인');
  console.log('══════════════════════════════════════');

  const r = await pool.query(`
    SELECT
      title,
      created_source,
      ingest_change_type,
      last_collector_source,
      needs_review,
      review_reason,
      to_char(first_collected_at, 'YYYY-MM-DD') AS first_collected,
      to_char(last_collected_at,  'YYYY-MM-DD') AS last_collected
    FROM canonical_events
    WHERE is_deleted = false
    ORDER BY last_collected_at DESC
    LIMIT 5
  `);
  for (const row of r.rows) {
    console.log(`  [${row.ingest_change_type}][${row.created_source}] ${row.title?.slice(0,30)}`);
    console.log(`    last_collector=${row.last_collector_source || '-'} needs_review=${row.needs_review} reasons=${JSON.stringify(row.review_reason)}`);
    console.log(`    first=${row.first_collected} last=${row.last_collected}`);
  }
}

// ─────────────────────────────────────────────
// main
// ─────────────────────────────────────────────
async function main() {
  console.log('=================================================');
  console.log('인제스트 메타데이터 검증 시작');
  console.log('=================================================');

  const results: Record<string, boolean> = {};

  results['백필'] = await verifyBackfill();
  results['computeNeedsReview'] = verifyComputeNeedsReview();
  results['upsert INSERT→new/UPDATE→updated'] = await verifyUpsert();
  results['필터 SQL'] = await verifyFilters();
  await verifySample();

  console.log('\n══════════════════════════════════════');
  console.log('최종 결과');
  console.log('══════════════════════════════════════');
  let allPass = true;
  for (const [name, ok] of Object.entries(results)) {
    console.log(`  ${ok ? '✅' : '❌'} ${name}`);
    if (!ok) allPass = false;
  }
  console.log(`\n  종합: ${allPass ? '✅ 전체 PASS' : '❌ 일부 FAIL'}`);

  await pool.end();
  process.exit(allPass ? 0 : 1);
}

main().catch(e => {
  console.error('Fatal:', e);
  pool.end();
  process.exit(1);
});
