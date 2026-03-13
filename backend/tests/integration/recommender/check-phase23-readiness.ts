/**
 * Phase 2-3 진입 조건 체크
 *
 * Phase 2-2에서 수집한 dwell / cta_click / sheet_open 로그가
 * 추천 알고리즘 개선 (Phase 2-3) 에 투입할 수준인지 검증합니다.
 *
 * 진입 조건:
 *   [건수]
 *   1. dwell 로그 중 15초 이상 ≥ 50%         — 짧은 오타 진입 제거
 *   2. 최근 7일 cta_click ≥ 10건             — CTA 클릭 신호 충분
 *   3. 누적 sheet_open ≥ 20건                — 상세 탐색 신호 충분
 *
 *   [분산도 — 편향 없이 다양한 유저/이벤트에서 발생했는지]
 *   4. 유저 집중도: 1인이 전체 신호의 < 50%   — 특정 테스터 편향 방지
 *   5. 이벤트 집중도: 1개 이벤트가 전체의 < 30% — 특정 이벤트 쏠림 방지
 *
 * 실행:
 *   cd backend
 *   ts-node -r dotenv/config tests/integration/recommender/check-phase23-readiness.ts
 */

import { pool } from '../../../src/db';

// ─── 기준값 ────────────────────────────────────────────────────────────────

const THRESHOLDS = {
  dwellQualityMinPct:    50,   // dwell 중 15초 이상 비율 (%)
  ctaWeeklyMin:          10,   // 최근 7일 cta_click 건수
  sheetTotalMin:         20,   // 누적 sheet_open 건수
  userConcentrationMax:  50,   // 1인이 차지할 수 있는 최대 비율 (%)
  eventConcentrationMax: 30,   // 1개 이벤트가 차지할 수 있는 최대 비율 (%)
};

// ─── 유틸리티 ──────────────────────────────────────────────────────────────

function fmt(pass: boolean): string {
  return pass ? '✅' : '❌';
}

function bar(pct: number, width = 20): string {
  const filled = Math.round(pct / 100 * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + `] ${pct}%`;
}

// ─── 메인 ──────────────────────────────────────────────────────────────────

async function main() {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  console.log('══════════════════════════════════════════');
  console.log('  Phase 2-3 진입 조건 체크');
  console.log(`  ${now} KST`);
  console.log('══════════════════════════════════════════\n');

  const checks: { name: string; pass: boolean; detail: string }[] = [];

  // ─── 1. Dwell 품질 ─────────────────────────────────────────────────────────

  const dwellStats = await pool.query(`
    SELECT
      COUNT(*)                                                     AS total,
      COUNT(*) FILTER (WHERE (metadata->>'dwell_seconds')::int >= 15) AS quality
    FROM user_events
    WHERE action_type = 'dwell'
  `);
  const dwellTotal   = parseInt(dwellStats.rows[0].total,   10);
  const dwellQuality = parseInt(dwellStats.rows[0].quality, 10);
  const dwellPct     = dwellTotal > 0 ? Math.round(dwellQuality / dwellTotal * 100) : 0;
  const dwellPass    = dwellPct >= THRESHOLDS.dwellQualityMinPct && dwellTotal >= 5;

  checks.push({
    name:   'dwell 품질 (15초+)',
    pass:   dwellPass,
    detail: `전체 ${dwellTotal}건 중 15초+ ${dwellQuality}건 ${bar(dwellPct)} (기준: ≥${THRESHOLDS.dwellQualityMinPct}%)`,
  });

  // ─── 2. CTA 클릭 (최근 7일) ────────────────────────────────────────────────

  const ctaStats = await pool.query(`
    SELECT COUNT(*) AS cnt
    FROM user_events
    WHERE action_type = 'cta_click'
      AND created_at > NOW() - INTERVAL '7 days'
  `);
  const ctaWeekly = parseInt(ctaStats.rows[0].cnt, 10);
  const ctaPass   = ctaWeekly >= THRESHOLDS.ctaWeeklyMin;

  // cta_type 분포
  const ctaTypes = await pool.query(`
    SELECT metadata->>'cta_type' AS cta_type, COUNT(*) AS cnt
    FROM user_events
    WHERE action_type = 'cta_click'
      AND created_at > NOW() - INTERVAL '7 days'
    GROUP BY cta_type
    ORDER BY cnt DESC
  `);
  const ctaTypeLine = ctaTypes.rows.map(r => `${r.cta_type}×${r.cnt}`).join(' ') || '없음';

  checks.push({
    name:   'cta_click (최근 7일)',
    pass:   ctaPass,
    detail: `${ctaWeekly}건 (기준: ≥${THRESHOLDS.ctaWeeklyMin}) — 유형: ${ctaTypeLine}`,
  });

  // ─── 3. Sheet Open (누적) ──────────────────────────────────────────────────

  const sheetStats = await pool.query(`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE metadata->>'sheet_type' = 'price')    AS price,
           COUNT(*) FILTER (WHERE metadata->>'sheet_type' = 'hours')    AS hours,
           COUNT(*) FILTER (WHERE metadata->>'sheet_type' = 'overview') AS overview
    FROM user_events
    WHERE action_type = 'sheet_open'
  `);
  const sheetTotal = parseInt(sheetStats.rows[0].total,    10);
  const sheetPass  = sheetTotal >= THRESHOLDS.sheetTotalMin;
  const sheetLine  = [
    `price×${sheetStats.rows[0].price}`,
    `hours×${sheetStats.rows[0].hours}`,
    `overview×${sheetStats.rows[0].overview}`,
  ].join(' ');

  checks.push({
    name:   'sheet_open (누적)',
    pass:   sheetPass,
    detail: `${sheetTotal}건 (기준: ≥${THRESHOLDS.sheetTotalMin}) — ${sheetLine}`,
  });

  // ─── 4. 유저 집중도 ────────────────────────────────────────────────────────
  // dwell + cta_click + sheet_open 전체 신호 중 1인이 차지하는 최대 비율

  const userConc = await pool.query(`
    WITH signals AS (
      SELECT user_id, COUNT(*) AS cnt
      FROM user_events
      WHERE action_type IN ('dwell', 'cta_click', 'sheet_open')
      GROUP BY user_id
    ),
    totals AS (
      SELECT SUM(cnt) AS total, MAX(cnt) AS max_user
      FROM signals
    )
    SELECT
      totals.total,
      totals.max_user,
      CASE WHEN totals.total > 0
           THEN ROUND(totals.max_user * 100.0 / totals.total)
           ELSE 0 END AS max_pct
    FROM totals
  `);

  const userTotal   = parseInt(userConc.rows[0].total    ?? '0', 10);
  const userMaxCnt  = parseInt(userConc.rows[0].max_user ?? '0', 10);
  const userMaxPct  = parseInt(userConc.rows[0].max_pct  ?? '0', 10);
  const userPass    = userMaxPct < THRESHOLDS.userConcentrationMax;

  // 상위 유저 ID (디버깅용 — 익명 user.id 표시)
  let topUserId = '';
  if (userTotal > 0) {
    const topUser = await pool.query(`
      SELECT user_id, COUNT(*) AS cnt
      FROM user_events
      WHERE action_type IN ('dwell', 'cta_click', 'sheet_open')
      GROUP BY user_id
      ORDER BY cnt DESC LIMIT 1
    `);
    if (topUser.rows.length > 0) {
      topUserId = ` (top user_id: ${String(topUser.rows[0].user_id).slice(0, 8)}…)`;
    }
  }

  checks.push({
    name:   '유저 집중도',
    pass:   userPass,
    detail: `최대 1인: ${userMaxCnt}/${userTotal}건 ${bar(userMaxPct)}${topUserId} (기준: <${THRESHOLDS.userConcentrationMax}%)`,
  });

  // ─── 5. 이벤트 집중도 ──────────────────────────────────────────────────────

  const eventConc = await pool.query(`
    WITH signals AS (
      SELECT event_id, COUNT(*) AS cnt
      FROM user_events
      WHERE action_type IN ('dwell', 'cta_click', 'sheet_open')
      GROUP BY event_id
    ),
    totals AS (
      SELECT SUM(cnt) AS total, MAX(cnt) AS max_event
      FROM signals
    )
    SELECT
      totals.total,
      totals.max_event,
      CASE WHEN totals.total > 0
           THEN ROUND(totals.max_event * 100.0 / totals.total)
           ELSE 0 END AS max_pct
    FROM totals
  `);

  const eventTotal  = parseInt(eventConc.rows[0].total     ?? '0', 10);
  const eventMaxCnt = parseInt(eventConc.rows[0].max_event ?? '0', 10);
  const eventMaxPct = parseInt(eventConc.rows[0].max_pct   ?? '0', 10);
  const eventPass   = eventMaxPct < THRESHOLDS.eventConcentrationMax;

  // 상위 이벤트 제목 (디버깅용)
  let topEventTitle = '';
  if (eventTotal > 0) {
    const topEvent = await pool.query(`
      SELECT ue.event_id, COUNT(*) AS cnt, ce.title
      FROM user_events ue
      LEFT JOIN canonical_events ce ON ce.id = ue.event_id
      WHERE ue.action_type IN ('dwell', 'cta_click', 'sheet_open')
      GROUP BY ue.event_id, ce.title
      ORDER BY cnt DESC LIMIT 1
    `);
    if (topEvent.rows.length > 0) {
      const title = topEvent.rows[0].title ?? topEvent.rows[0].event_id;
      topEventTitle = ` (top: "${String(title).slice(0, 20)}…")`;
    }
  }

  checks.push({
    name:   '이벤트 집중도',
    pass:   eventPass,
    detail: `최다 1개 이벤트: ${eventMaxCnt}/${eventTotal}건 ${bar(eventMaxPct)}${topEventTitle} (기준: <${THRESHOLDS.eventConcentrationMax}%)`,
  });

  // ─── 출력 ─────────────────────────────────────────────────────────────────

  for (const c of checks) {
    console.log(`${fmt(c.pass)} ${c.name}`);
    console.log(`   ${c.detail}`);
    console.log();
  }

  const allPass  = checks.every(c => c.pass);
  const passCount = checks.filter(c => c.pass).length;

  console.log('══════════════════════════════════════════');
  console.log(`  결과: ${passCount}/${checks.length} 조건 충족`);
  console.log();

  if (allPass) {
    console.log('  ✅ Phase 2-3 진입 가능');
    console.log('     dwell/cta_click/sheet_open 신호 품질 및 분산도 기준 통과');
  } else {
    console.log('  ❌ Phase 2-3 진입 조건 미충족');
    const failed = checks.filter(c => !c.pass).map(c => c.name).join(', ');
    console.log(`     미충족 항목: ${failed}`);
    console.log('     더 많은 실사용 데이터가 필요합니다.');
  }
  console.log('══════════════════════════════════════════');

  await pool.end();
  process.exit(allPass ? 0 : 1);
}

main().catch(async (err) => {
  console.error('\n[check-phase23] 오류:', err.message ?? err);
  await pool.end().catch(() => {});
  process.exit(1);
});
