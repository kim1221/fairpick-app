/**
 * Fairpick 추천 QA 시뮬레이터
 *
 * ──────────────────────────────────────────────────────────────
 * [Cleanup 정책]
 *   - users 테이블: 유지 (QA 유저는 고정 UUID, 다음 실행에 재사용)
 *   - user_events:  이번 실행에서 upsert한 qaUserIds 기준으로만 삭제
 *   - 이 정책은 local / staging / prod(--allow-production) 모두 동일하게 적용
 *   - QA 유저는 name='[QA] <시나리오>' 로 식별 가능 (anonymous_id는 uuid 타입 고정값)
 *
 * [Production Safety Guard]
 *   - BASE_URL에 'railway.app|production|prod' 포함 시 차단 (--allow-production으로 우회)
 *   - DATABASE_URL에 'supabase|neon|rds' 포함 시 경고만 출력 (로컬 개발이 원격 DB 쓰는 경우 허용)
 *   - 의도: 실수로 prod URL을 지정하는 사고 방지. 개발용 원격 DB는 정상 허용.
 * ──────────────────────────────────────────────────────────────
 *
 * 사전 조건: 로컬 백엔드 실행 필요
 *
 * 실행:
 *   cd backend
 *   # 기본 (콜드스타트 + 클릭편향 + 저장편향)
 *   ts-node -r dotenv/config tests/integration/recommender/qa-simulate.ts
 *
 *   # overlap 포함 (~65초 추가)
 *   ts-node -r dotenv/config tests/integration/recommender/qa-simulate.ts --overlap
 *
 *   # 서버 URL 지정 (기본: http://localhost:5001)
 *   ts-node -r dotenv/config tests/integration/recommender/qa-simulate.ts --url http://localhost:5001
 *
 *   # 테스트 데이터 유지 (디버깅용)
 *   ts-node -r dotenv/config tests/integration/recommender/qa-simulate.ts --keep
 */

import axios from 'axios';
import { pool } from '../../../src/db';

// ─── CLI args ────────────────────────────────────────────────────────────────

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

const BASE_URL   = getArg('--url') || `http://localhost:${process.env.PORT || 5001}`;
const KEEP_DATA  = process.argv.includes('--keep');
const DO_OVERLAP = process.argv.includes('--overlap');
const ALLOW_PROD = process.argv.includes('--allow-production');

// ─── Production safety guard ─────────────────────────────────────────────────
// BASE_URL이 운영 환경을 가리키면 --allow-production 없이 차단
// DATABASE_URL이 원격 DB(supabase 등)면 경고만 출력 (로컬 개발이 원격 DB를 쓰는 경우 허용)

const DB_URL          = process.env.DATABASE_URL || '';
const isProductionUrl = /railway\.app|production|prod/i.test(BASE_URL);
const isRemoteDb      = /supabase|neon|rds|cloud/i.test(DB_URL);

if (isProductionUrl && !ALLOW_PROD) {
  console.error('🚫 Production URL이 감지됐습니다.');
  console.error('   BASE_URL:', BASE_URL);
  console.error('   DB:', DB_URL.replace(/:.*@/, ':***@'));
  console.error('   실행하려면 --allow-production 플래그를 추가하세요.');
  process.exit(1);
}
if (ALLOW_PROD) {
  console.warn('⚠️  --allow-production 활성화: production 환경에 QA 데이터를 삽입합니다.');
}
if (isRemoteDb && !isProductionUrl) {
  console.warn('⚠️  원격 DB 감지 (개발/스테이징 Supabase). QA 데이터가 원격 DB에 삽입됩니다.');
  console.warn('   DB:', DB_URL.replace(/:.*@/, ':***@'));
}

// ─── QA 유저 고정 UUID ────────────────────────────────────────────────────────
// anonymous_id 컬럼이 uuid 타입이므로 valid UUID 형식 사용
// name='[QA] <시나리오명>'으로 DB에서 QA 유저 식별 가능
const QA_ANON = {
  cold:    '00000000-0000-0000-0000-000000000001',
  click:   '00000000-0000-0000-0000-000000000002',
  save:    '00000000-0000-0000-0000-000000000003',
  overlap: '00000000-0000-0000-0000-000000000004',
} as const;

// 서울 기준 좌표
const SEOUL = { lat: 37.5665, lng: 126.9780 };

// impression 집계 대상 섹션
const TRACKED_SECTIONS = ['trending', 'budget_pick', 'date_pick', 'discovery', 'beginner'];

// ─── Types ────────────────────────────────────────────────────────────────────

interface SectionResult {
  slug: string;
  events: { id: string; category?: string; main_category?: string }[];
}

interface ScenarioResult {
  label: string;
  dist: Record<string, Record<string, number>>; // section → category → count
  eventIds: Record<string, string[]>;           // section → event ids
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function countByCategory(events: any[]): Record<string, number> {
  return events.reduce((acc, e) => {
    const cat = e.category ?? e.main_category ?? '알수없음';
    acc[cat] = (acc[cat] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

function formatDist(dist: Record<string, number>): string {
  return Object.entries(dist)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}×${v}`)
    .join('  ') || '(없음)';
}

function diffDist(base: Record<string, number>, curr: Record<string, number>): string {
  const cats = new Set([...Object.keys(base), ...Object.keys(curr)]);
  const parts: string[] = [];
  for (const cat of cats) {
    const diff = (curr[cat] ?? 0) - (base[cat] ?? 0);
    if (diff !== 0) parts.push(`${cat} ${diff > 0 ? '+' : ''}${diff}`);
  }
  return parts.length ? `콜드 대비 ${parts.join(', ')}` : '';
}

function nowKST(): string {
  return new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * QA 유저 upsert
 * - anonymous_id(uuid) 기준으로 조회 후 재사용, 없으면 생성
 * - name='[QA] <scenarioLabel>'로 DB에서 QA 유저 식별 가능
 * - users 테이블: id(uuid, NOT NULL, default gen_random_uuid()),
 *   push_notifications_enabled(bool, NOT NULL, default true) 외 모두 nullable
 *   → anonymous_id + name만으로 INSERT 안전
 */
async function upsertQaUser(anonId: string, scenarioLabel: string): Promise<string> {
  const existing = await pool.query(
    `SELECT id FROM users WHERE anonymous_id = $1::uuid`,
    [anonId],
  );
  if (existing.rows.length > 0) return existing.rows[0].id as string;

  const inserted = await pool.query(
    `INSERT INTO users (anonymous_id, name)
     VALUES ($1::uuid, $2)
     RETURNING id`,
    [anonId, `[QA] ${scenarioLabel}`],
  );
  return inserted.rows[0].id as string;
}

async function getEventsByCategory(category: string, count: number): Promise<string[]> {
  const res = await pool.query(
    `SELECT id FROM canonical_events
     WHERE main_category = $1 AND is_deleted = false
     ORDER BY RANDOM()
     LIMIT $2`,
    [category, count],
  );
  return res.rows.map((r: any) => r.id as string);
}

async function insertUserEvents(
  userId: string,
  eventIds: string[],
  actionType: 'click' | 'save',
): Promise<void> {
  for (const eventId of eventIds) {
    await pool.query(
      `INSERT INTO user_events (user_id, event_id, action_type, section_slug)
       VALUES ($1::uuid, $2::uuid, $3, 'qa_test')
       ON CONFLICT DO NOTHING`,
      [userId, eventId, actionType],
    );
  }
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function callHomeSections(userId: string): Promise<SectionResult[]> {
  const res = await axios.get(`${BASE_URL}/api/home/sections`, {
    params: { userId, lat: SEOUL.lat, lng: SEOUL.lng },
    timeout: 15_000,
  });
  const raw = res.data?.sections ?? res.data ?? [];
  return (raw as any[]).map((s: any) => ({
    slug:   s.slug ?? s.id ?? '',
    events: s.events ?? [],
  }));
}

async function checkServerAlive(): Promise<boolean> {
  try {
    // /health 먼저 시도, 없으면 실제 API로 확인
    const res = await axios.get(`${BASE_URL}/health`, { timeout: 5_000 }).catch(() => null);
    if (res && res.status < 400) return true;
    await axios.get(`${BASE_URL}/api/home/sections`, {
      params: { lat: SEOUL.lat, lng: SEOUL.lng },
      timeout: 15_000,
    });
    return true;
  } catch {
    return false;
  }
}

// ─── Scenario runner ──────────────────────────────────────────────────────────

async function runScenario(
  label: string,
  userId: string,
  setup?: () => Promise<void>,
): Promise<ScenarioResult> {
  if (setup) await setup();

  const sections = await callHomeSections(userId);

  const dist: Record<string, Record<string, number>> = {};
  const eventIds: Record<string, string[]> = {};

  for (const sec of sections) {
    if (TRACKED_SECTIONS.includes(sec.slug)) {
      dist[sec.slug]    = countByCategory(sec.events);
      eventIds[sec.slug] = sec.events.map(e => e.id);
    }
  }

  return { label, dist, eventIds };
}

// ─── Print helpers ────────────────────────────────────────────────────────────

function printScenario(
  num: string,
  result: ScenarioResult,
  cold?: ScenarioResult,
  extra?: string,
): void {
  const bar = '─'.repeat(Math.max(0, 40 - result.label.length));
  console.log(`\n[${num}] ${result.label} ${bar}`);
  if (extra) console.log(`  ${extra}`);

  for (const slug of TRACKED_SECTIONS) {
    const d = result.dist[slug];
    if (!d) continue;
    const total = Object.values(d).reduce((a, b) => a + b, 0);
    const diff  = cold ? diffDist(cold.dist[slug] ?? {}, d) : '';
    const diffStr = diff ? `  (${diff})` : '';
    console.log(`  ${slug.padEnd(12)} (${total}): ${formatDist(d)}${diffStr}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startMs = Date.now();

  // 이번 실행에서 upsert한 실제 user.id 목록 → cleanup 및 impression 집계에 사용
  const qaUserIds: string[] = [];

  console.log('══════════════════════════════════════════');
  console.log('  Fairpick 추천 QA 시뮬레이터');
  console.log(`  ${nowKST()}  |  서버: ${BASE_URL.replace(/https?:\/\//, '')}`);
  console.log('══════════════════════════════════════════');

  // 서버 연결 확인
  process.stdout.write('서버 연결 확인 중...');
  const alive = await checkServerAlive();
  if (!alive) {
    console.log(' ❌');
    console.error(`\n서버에 연결할 수 없습니다: ${BASE_URL}`);
    console.error('로컬 백엔드를 먼저 실행해 주세요:');
    console.error('  cd backend && npm run start:local');
    await pool.end();
    process.exit(1);
  }
  console.log(' ✅');

  // QA 유저 upsert (없으면 생성, 있으면 재사용)
  const coldId  = await upsertQaUser(QA_ANON.cold,  'cold-start');
  const clickId = await upsertQaUser(QA_ANON.click, 'click-bias');
  const saveId  = await upsertQaUser(QA_ANON.save,  'save-bias');
  qaUserIds.push(coldId, clickId, saveId);

  // 이전 실행의 user_events 잔재 제거 (깨끗한 상태로 시작)
  await pool.query(
    `DELETE FROM user_events WHERE user_id = ANY($1::uuid[])`,
    [qaUserIds],
  );

  // ── 시나리오 1: 콜드스타트 ────────────────────────────────────────────────
  const cold = await runScenario('콜드스타트', coldId);
  printScenario('1/3', cold, undefined, '이벤트 이력: 없음');

  // ── 시나리오 2: 공연 클릭 편향 ───────────────────────────────────────────
  const clickEventIds = await getEventsByCategory('공연', 5);
  const clickResult   = await runScenario(
    '공연 클릭 편향',
    clickId,
    async () => insertUserEvents(clickId, clickEventIds, 'click'),
  );
  printScenario('2/3', clickResult, cold, `이벤트 이력: click × 공연 ${clickEventIds.length}회`);

  // click boost 판정 (date_pick 기준)
  // slot cap 구조상 공연 4/10 = 40% 내외 → 비율 기준 대신 count + cold delta 기준 사용
  // ✅ 정상: 공연 count ≥ 2  OR  cold 대비 +1 이상
  // ⚠️ 주의: 공연 count = 1 (증가 없음)
  // ❌ 실패: 공연 count = 0
  const dpClick           = clickResult.dist['date_pick'] ?? {};
  const clickPerformCount = dpClick['공연'] ?? 0;
  const coldPerformCount  = cold.dist['date_pick']?.['공연'] ?? 0;
  const clickDelta        = clickPerformCount - coldPerformCount;
  const clickOK           = clickPerformCount >= 2 || clickDelta >= 1;
  const clickStatus       = clickOK ? '✅' : clickPerformCount === 1 && clickDelta === 0 ? '⚠️' : '❌';
  const clickDeltaStr     = clickDelta >= 0 ? `+${clickDelta}` : `${clickDelta}`;
  console.log(`  → date_pick 공연: ${clickPerformCount}개 (cold 대비 ${clickDeltaStr}) ${clickStatus}`);

  // ── 시나리오 3: 전시 저장 편향 ───────────────────────────────────────────
  const saveEventIds = await getEventsByCategory('전시', 3);
  const saveResult   = await runScenario(
    '전시 저장 편향',
    saveId,
    async () => insertUserEvents(saveId, saveEventIds, 'save'),
  );
  printScenario('3/3', saveResult, cold, `이벤트 이력: save × 전시 ${saveEventIds.length}회`);

  // save boost 판정 (date_pick 기준)
  // slot cap 구조상 전시 최대 3/10 = 30% → 비율 기준 대신 count + cold delta 기준 사용
  // ✅ 정상: 전시 count ≥ 2  OR  cold 대비 +1 이상
  // ⚠️ 주의: 전시 count = 1 (증가 없음)
  // ❌ 실패: 전시 count = 0
  const dpSave           = saveResult.dist['date_pick'] ?? {};
  const saveExhibitCount = dpSave['전시'] ?? 0;
  const coldExhibitCount = cold.dist['date_pick']?.['전시'] ?? 0;
  const saveDelta        = saveExhibitCount - coldExhibitCount;
  const saveOK           = saveExhibitCount >= 2 || saveDelta >= 1;
  const saveStatus       = saveOK ? '✅' : saveExhibitCount === 1 ? '⚠️' : '❌';
  const deltaStr         = saveDelta >= 0 ? `+${saveDelta}` : `${saveDelta}`;
  console.log(`  → date_pick 전시: ${saveExhibitCount}개 (cold 대비 ${deltaStr}) ${saveStatus}`);

  // ── 시나리오 4: 반복 진입 overlap (--overlap) ─────────────────────────────
  let overlapSummary = '(생략 — --overlap 플래그로 활성화)';
  let overlapPct     = -1;

  if (DO_OVERLAP) {
    const overlapId = await upsertQaUser(QA_ANON.overlap, 'overlap');
    qaUserIds.push(overlapId);
    await pool.query(
      `DELETE FROM user_events WHERE user_id = $1::uuid`,
      [overlapId],
    );

    console.log('\n[4/3] 반복 진입 overlap ──────────────────────────  (--overlap)');

    const first = await callHomeSections(overlapId);
    const firstIds = first.find(s => s.slug === 'trending')?.events.map(e => e.id) ?? [];
    console.log(`  1차 trending: [${firstIds.slice(0, 3).map(id => id.slice(0, 6)).join(', ')}...]`);

    console.log('  ⏳ 65초 대기 중... (getUserClickHistory 캐시 만료)');
    await sleep(65_000);

    const second  = await callHomeSections(overlapId);
    const secondIds = second.find(s => s.slug === 'trending')?.events.map(e => e.id) ?? [];
    console.log(`  2차 trending: [${secondIds.slice(0, 3).map(id => id.slice(0, 6)).join(', ')}...]`);

    const overlap = firstIds.filter(id => secondIds.includes(id)).length;
    overlapPct    = firstIds.length ? Math.round(overlap / firstIds.length * 100) : 0;
    const os      = overlapPct <= 20 ? '✅' : overlapPct <= 40 ? '⚠️' : '❌';
    overlapSummary = `${overlap}/${firstIds.length} (${overlapPct}%)  ${os}`;
    console.log(`  overlap: ${overlapSummary}`);
  }

  // ── Impression 로그량 집계 ─────────────────────────────────────────────────
  // qaUserIds는 이번 실행에서 upsert한 실제 user.id 배열 (anonymous_id 아님)
  const impRows = await pool.query(
    `SELECT section_slug, COUNT(*) AS cnt
     FROM user_events
     WHERE action_type = 'impression'
       AND user_id = ANY($1::uuid[])
       AND created_at > NOW() - INTERVAL '10 minutes'
     GROUP BY section_slug`,
    [qaUserIds],
  );

  const impMap: Record<string, number> = {};
  let impTotal = 0;
  for (const row of impRows.rows) {
    impMap[row.section_slug] = parseInt(row.cnt, 10);
    impTotal += impMap[row.section_slug];
  }

  const apiCallCount = DO_OVERLAP ? 5 : 3; // cold + click + save [+ overlap×2]
  const impLine = TRACKED_SECTIONS
    .filter(s => impMap[s])
    .map(s => `${s}: ${impMap[s]}`)
    .join('  ');

  console.log('\n══════════════════════════════════════════');
  console.log('  Impression 로그량 (이번 실행 기준)');
  console.log('  ' + '─'.repeat(37));
  console.log(`  ${impLine || '(기록 없음)'}`);
  console.log(`  합계: ${impTotal} rows / QA 유저 ${qaUserIds.length}명 / API ${apiCallCount}회 호출`);

  const impStatus = impTotal < 5000 ? '✅ 정상' : impTotal < 20000 ? '⚠️ 주의' : '❌ 과다';
  console.log(`  (${impStatus} — 기준: 100 DAU × 5회/일 ≈ 3,500 rows/day)`);

  // ── 결과 요약 ─────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log('  결과 요약');

  const clickLabel = clickOK ? '정상' : clickPerformCount === 1 ? '주의' : '실패';
  const saveLabel  = saveOK ? '정상' : saveExhibitCount === 1 ? '주의' : '실패';
  console.log(`  ${clickStatus} 클릭 편향: ${clickLabel} (date_pick 공연 ${clickPerformCount}개, cold 대비 ${clickDeltaStr})`);
  console.log(`  ${saveStatus} 저장 편향: ${saveLabel}  (date_pick 전시 ${saveExhibitCount}개, cold 대비 ${deltaStr})`);

  if (DO_OVERLAP) {
    const os = overlapPct <= 20 ? '✅' : overlapPct <= 40 ? '⚠️' : '❌';
    const overlapLabel = overlapPct <= 20 ? '정상' : overlapPct <= 40 ? '주의' : '실패';
    console.log(`  ${os} 반복 진입: ${overlapLabel} (overlap ${overlapPct}%)`);
  } else {
    console.log(`     반복 진입: ${overlapSummary}`);
  }
  console.log(`  ${impStatus}`);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  // [정책] users는 유지 (다음 실행에 재사용), user_events만 qaUserIds 기준으로 삭제
  // --keep 플래그 시 user_events도 유지 (디버깅용)
  if (!KEEP_DATA) {
    await pool.query(
      `DELETE FROM user_events WHERE user_id = ANY($1::uuid[])`,
      [qaUserIds],
    );
    console.log('\n  user_events QA 로그 정리 완료 (users는 유지)');
  } else {
    console.log('\n  --keep: QA 데이터 유지 (user_events 삭제 안 함)');
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`  QA 완료: ${elapsed}초`);
  console.log('══════════════════════════════════════════');

  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('\n[QA] 오류 발생:', err.message ?? err);
  await pool.end().catch(() => {});
  process.exit(1);
});
