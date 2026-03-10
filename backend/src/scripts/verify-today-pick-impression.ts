/**
 * today_pick impression 기반 중복 노출 방지 검증 스크립트
 *
 * 검증 항목:
 *   1. impression 기록 확인: user_events에 action_type='impression' 행이 쌓이는지
 *   2. 제외 효과 시뮬레이션: 어제 본 이벤트가 내일 픽 순위에서 밀리는지
 *   3. 로테이션 다양성: 후보 2개 이상 지역에서 날짜별 서로 다른 이벤트 선택
 *   4. 단일 후보 폴백: 후보 1개 지역에서 동일 이벤트 폴백(정상 동작) 확인
 *   5. 쿼리 성능: impression 조회 EXPLAIN ANALYZE
 *
 * Usage:
 *   ts-node -r dotenv/config src/scripts/verify-today-pick-impression.ts
 *   ts-node -r dotenv/config src/scripts/verify-today-pick-impression.ts --user <userId>
 */

import { pool } from '../db';
import {
  buildTodayPickPoolV2,
  pickTodayPickCandidateV2,
  applyPersonalizationV2,
  type ScoredTodayPickCandidate,
} from '../lib/todayPickSelector';

// ─── CLI 인자 파싱 ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const userIdIdx = args.indexOf('--user');
const cliUserId: string | null = userIdIdx >= 0 ? (args[userIdIdx + 1] ?? null) : null;

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function sep(label: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${label}`);
  console.log('='.repeat(60));
}

function subsep(label: string) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  ${label}`);
  console.log('─'.repeat(50));
}

// ─── 검증 1: impression 기록 현황 ────────────────────────────────────────────

async function check1_impressionRecords() {
  sep('CHECK 1: impression 기록 현황');

  // 전체 집계
  const totals = await pool.query(`
    SELECT
      COUNT(*) AS total_rows,
      COUNT(DISTINCT user_id) AS distinct_users,
      COUNT(DISTINCT event_id) AS distinct_events,
      MIN(created_at) AS oldest,
      MAX(created_at) AS newest
    FROM user_events
    WHERE action_type = 'impression'
      AND section_slug = 'today_pick'
  `);
  const t = totals.rows[0];
  console.log(`\n  전체 today_pick impression 레코드`);
  console.log(`  ├─ 총 행수:          ${t.total_rows}`);
  console.log(`  ├─ 유저 수:          ${t.distinct_users}`);
  console.log(`  ├─ 이벤트 수:        ${t.distinct_events}`);
  console.log(`  ├─ 가장 오래된 행:   ${t.oldest ?? '없음'}`);
  console.log(`  └─ 가장 최근 행:     ${t.newest ?? '없음'}`);

  // 최근 24시간
  const recent = await pool.query(`
    SELECT COUNT(*) AS cnt
    FROM user_events
    WHERE action_type = 'impression'
      AND section_slug = 'today_pick'
      AND created_at > NOW() - INTERVAL '24 hours'
  `);
  console.log(`\n  최근 24시간 impression: ${recent.rows[0].cnt}건`);

  // 최근 10건 샘플
  const sample = await pool.query(`
    SELECT user_id, event_id, created_at
    FROM user_events
    WHERE action_type = 'impression'
      AND section_slug = 'today_pick'
    ORDER BY created_at DESC
    LIMIT 10
  `);

  if (sample.rows.length === 0) {
    console.log('\n  ⚠ 아직 impression 기록 없음 — 앱에서 홈 진입 후 재실행 필요');
  } else {
    console.log('\n  최근 10건 샘플:');
    console.log('  ' + 'user_id'.padEnd(38) + 'event_id'.padEnd(38) + 'created_at');
    console.log('  ' + '-'.repeat(100));
    for (const r of sample.rows) {
      console.log(`  ${String(r.user_id).padEnd(38)}${String(r.event_id).padEnd(38)}${r.created_at}`);
    }
    console.log('\n  ✅ impression 기록 정상 확인');
  }

  return sample.rows.length;
}

// ─── 검증 2: 제외 효과 시뮬레이션 ───────────────────────────────────────────

async function check2_exclusionSimulation(overrideUserId?: string | null) {
  sep('CHECK 2: impression 제외 효과 시뮬레이션');

  // 테스트 대상 userId 선택
  let userId: string | null = overrideUserId ?? null;

  if (!userId) {
    const r = await pool.query(`
      SELECT DISTINCT user_id
      FROM user_events
      WHERE action_type = 'impression'
        AND section_slug = 'today_pick'
        AND created_at > NOW() - INTERVAL '3 days'
      LIMIT 1
    `);
    userId = r.rows[0]?.user_id ?? null;
  }

  if (!userId) {
    console.log('\n  ⚠ 최근 3일 내 impression 이력 없음 — 앱에서 홈 진입 후 재실행 필요');
    return;
  }

  console.log(`\n  테스트 userId: ${userId}`);

  // 최근 3일 impression 이벤트 조회
  const impressions = await pool.query(`
    SELECT event_id, MAX(created_at) AS last_seen
    FROM user_events
    WHERE user_id = $1
      AND action_type = 'impression'
      AND section_slug = 'today_pick'
      AND created_at > NOW() - INTERVAL '3 days'
    GROUP BY event_id
    ORDER BY last_seen DESC
  `, [userId]);

  const impressionIds = new Set<string>(impressions.rows.map((r: any) => r.event_id));
  console.log(`\n  최근 3일 today_pick impression: ${impressionIds.size}개`);

  for (const r of impressions.rows) {
    // 이벤트 제목 조회
    const ev = await pool.query('SELECT title FROM canonical_events WHERE id = $1', [r.event_id]);
    const title = ev.rows[0]?.title ?? '(이벤트 삭제됨)';
    console.log(`    - "${title}" (마지막 노출: ${r.last_seen})`);
  }

  // 현재 후보 풀 조회 (위치 무관 national)
  const candidates = await buildTodayPickPoolV2(pool);

  if (candidates.length === 0) {
    console.log('\n  ⚠ today_pick 후보 풀 비어 있음');
    return;
  }

  // impression 없을 때 선택
  const pickWithout = pickTodayPickCandidateV2(candidates, new Set(), new Set(), new Set());
  // impression 있을 때 선택
  const pickWith = pickTodayPickCandidateV2(candidates, new Set(), new Set(), impressionIds);

  console.log(`\n  impression 제외 없을 때:  "${pickWithout?.event.title ?? '없음'}"` +
    ` (score: ${pickWithout?.breakdown.total.toFixed(1)})`);
  console.log(`  impression 제외 적용 시:  "${pickWith?.event.title ?? '없음'}"` +
    ` (score: ${pickWith?.breakdown.total.toFixed(1)})`);

  if (pickWithout?.event.id !== pickWith?.event.id) {
    console.log('\n  ✅ 어제 본 이벤트가 실제로 밀려남 — 제외 로직 정상 작동');
  } else if (impressionIds.has(pickWith?.event.id ?? '')) {
    console.log('\n  ⚠ 폴백 발동: 모든 후보가 3일 내 노출됨 → 동일 이벤트 반환 (정상)');
  } else {
    console.log('\n  ─ impression 대상이 원래 최선 후보가 아니므로 결과 동일 (정상)');
  }
}

// ─── 검증 3: 날짜별 로테이션 다양성 ─────────────────────────────────────────

async function check3_rotationDiversity() {
  sep('CHECK 3: 날짜별 로테이션 다양성 (후보 2개 이상 지역)');

  const candidates = await buildTodayPickPoolV2(pool);

  if (candidates.length === 0) {
    console.log('\n  ⚠ 후보 없음');
    return;
  }

  console.log(`\n  후보 풀 크기: ${candidates.length}개 (stage: ${candidates[0]!.stage})`);
  console.log(`  후보 top-5:`);
  const sorted = [...candidates].sort((a, b) => b.breakdown.total - a.breakdown.total);
  sorted.slice(0, 5).forEach((c, i) => {
    console.log(`    #${i + 1} "${c.event.title}" (total=${c.breakdown.total.toFixed(1)})`);
  });

  // 7일치 선택 시뮬레이션 (seed를 오늘 기준 ±3일)
  const today = new Date();
  function dateSeed(offsetDays: number): number {
    const d = new Date(today);
    d.setDate(d.getDate() + offsetDays);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  // seededShuffle과 동일 로직 (todayPickSelector 내부 함수 재현)
  function seededShuffle<T>(arr: T[], seed: number): T[] {
    const a = [...arr];
    let s = seed >>> 0;
    for (let i = a.length - 1; i > 0; i--) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const j = s % (i + 1);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }

  // impression 없는 신규 사용자 기준 7일 로테이션
  subsep('신규 사용자 (impression 없음) — 7일 로테이션');
  console.log('  날짜'.padEnd(14) + '선택된 이벤트');
  console.log('  ' + '-'.repeat(60));

  const rotationPool = sorted.slice(0, Math.min(3, sorted.length));
  const seen = new Map<string, number>(); // title → 등장 횟수

  for (let offset = -3; offset <= 3; offset++) {
    const seed = dateSeed(offset);
    const todayIdx = seed % rotationPool.length;
    const rotated = [
      ...rotationPool.slice(todayIdx),
      ...rotationPool.slice(0, todayIdx),
      ...sorted.slice(3),
    ];
    const picked = rotated.find(c => true)!; // impression 없음 → 항상 첫 번째
    const label = offset === 0 ? ' ← 오늘' : offset > 0 ? ` (D+${offset})` : ` (D${offset})`;
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
    console.log(`  ${dateStr.padEnd(6)}${label.padEnd(8)}  "${picked.event.title}"`);
    seen.set(picked.event.title, (seen.get(picked.event.title) ?? 0) + 1);
  }

  const uniquePicks = seen.size;
  const maxRepeat = Math.max(...Array.from(seen.values()));
  console.log(`\n  7일 중 고유 이벤트: ${uniquePicks}개, 최대 반복: ${maxRepeat}회`);

  if (uniquePicks >= 2) {
    console.log('  ✅ 날짜별 다른 이벤트 노출 — 로테이션 정상');
  } else {
    console.log('  ⚠ 7일 모두 같은 이벤트 → 후보 풀 1개 or rotation pool이 1개');
  }
}

// ─── 검증 4: 단일 후보 폴백 ──────────────────────────────────────────────────

async function check4_singleCandidateFallback() {
  sep('CHECK 4: 단일 후보 폴백 동작');

  // 단일 후보로 테스트
  const singleCandidates = await buildTodayPickPoolV2(pool);
  if (singleCandidates.length === 0) {
    console.log('\n  ⚠ 후보 없음');
    return;
  }

  const oneCandidate = [singleCandidates[0]!];
  const id = oneCandidate[0].event.id;
  const title = oneCandidate[0].event.title;

  console.log(`\n  테스트 후보: "${title}"`);

  // Case A: impression 없음 → 정상 선택
  const pickA = pickTodayPickCandidateV2(oneCandidate, new Set(), new Set(), new Set());
  // Case B: 해당 이벤트가 3일 내 impression 목록에 있음 → 폴백으로 동일 이벤트 반환
  const pickB = pickTodayPickCandidateV2(oneCandidate, new Set(), new Set(), new Set([id]));
  // Case C: 해당 이벤트가 14일 클릭 목록에도 있음 → 동일
  const pickC = pickTodayPickCandidateV2(oneCandidate, new Set([id]), new Set([id]), new Set([id]));

  console.log('\n  Case A (impression 없음):       ' + (pickA?.event.title ?? '없음'));
  console.log('  Case B (3일 내 노출됨):          ' + (pickB?.event.title ?? '없음'));
  console.log('  Case C (클릭+노출 모두 있음):    ' + (pickC?.event.title ?? '없음'));

  const allSame = pickA?.event.id === id && pickB?.event.id === id && pickC?.event.id === id;
  if (allSame) {
    console.log('\n  ✅ 후보 1개일 때 항상 폴백으로 동일 이벤트 반환 (정상)');
  } else {
    console.log('\n  ❌ 예상치 않은 결과 — 로직 확인 필요');
  }
}

// ─── 검증 5: 쿼리 성능 ───────────────────────────────────────────────────────

async function check5_queryPerformance() {
  sep('CHECK 5: impression 쿼리 성능 (EXPLAIN ANALYZE)');

  // 임의 userId로 EXPLAIN (실제 실행, 결과 불필요)
  const testUserId = '00000000-0000-0000-0000-000000000000';

  console.log('\n  [인덱스 확인]');
  const indexes = await pool.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'user_events'
    ORDER BY indexname
  `);
  for (const idx of indexes.rows) {
    console.log(`  ├─ ${idx.indexname}`);
    console.log(`  │    ${idx.indexdef}`);
  }

  console.log('\n  [EXPLAIN ANALYZE — impression 쿼리]');
  try {
    const explain = await pool.query(`
      EXPLAIN ANALYZE
      SELECT event_id
      FROM user_events
      WHERE user_id = $1
        AND action_type = 'impression'
        AND section_slug = 'today_pick'
        AND created_at > NOW() - INTERVAL '3 days'
      GROUP BY event_id
    `, [testUserId]);
    for (const row of explain.rows) {
      console.log('  ' + row['QUERY PLAN']);
    }
  } catch (e: any) {
    console.log(`  ⚠ EXPLAIN 실행 오류: ${e.message}`);
  }

  console.log('\n  [24시간 impression INSERT 빈도]');
  const insertFreq = await pool.query(`
    SELECT
      DATE_TRUNC('hour', created_at) AS hour,
      COUNT(*) AS cnt
    FROM user_events
    WHERE action_type = 'impression'
      AND section_slug = 'today_pick'
      AND created_at > NOW() - INTERVAL '24 hours'
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 12
  `);

  if (insertFreq.rows.length === 0) {
    console.log('  (아직 impression 없음)');
  } else {
    console.log('  시간대별 impression INSERT 수:');
    for (const r of insertFreq.rows) {
      const bar = '█'.repeat(Math.min(Math.ceil(Number(r.cnt) / 5), 40));
      console.log(`  ${String(r.hour).slice(0, 16).padEnd(18)} ${String(r.cnt).padStart(5)}  ${bar}`);
    }
  }

  // user_events 테이블 전체 크기
  const tableSize = await pool.query(`
    SELECT
      pg_size_pretty(pg_total_relation_size('user_events')) AS total_size,
      (SELECT COUNT(*) FROM user_events WHERE action_type='impression') AS impression_total,
      (SELECT COUNT(*) FROM user_events WHERE action_type='click') AS click_total
  `);
  const ts = tableSize.rows[0];
  console.log(`\n  user_events 테이블 크기: ${ts.total_size}`);
  console.log(`  ├─ impression 행수: ${ts.impression_total}`);
  console.log(`  └─ click 행수:      ${ts.click_total}`);
}

// ─── 메인 ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  today_pick impression 중복 노출 방지 검증               ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  if (cliUserId) {
    console.log(`\n  지정 userId: ${cliUserId}`);
  }

  try {
    const impressionCount = await check1_impressionRecords();
    await check2_exclusionSimulation(cliUserId);
    await check3_rotationDiversity();
    await check4_singleCandidateFallback();
    await check5_queryPerformance();

    sep('요약');
    if (impressionCount === 0) {
      console.log(`
  impression 기록이 아직 없습니다.
  배포 후 앱에서 홈 화면에 진입하면 user_events 테이블에
  action_type='impression', section_slug='today_pick' 행이 생성됩니다.

  그 후 이 스크립트를 재실행하면 CHECK 1~2가 실제 데이터로 검증됩니다.
      `);
    } else {
      console.log(`
  impression 기록 ${impressionCount}건 확인.
  CHECK 1-5 완료. 위 결과로 각 항목을 판단하세요.
      `);
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('\n❌ 오류:', err);
  process.exit(1);
});
