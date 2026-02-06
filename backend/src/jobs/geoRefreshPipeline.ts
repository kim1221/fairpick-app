/**
 * Geo Refresh Pipeline - 수동 실행용
 *
 * 스케줄러와 동일한 Full Pipeline을 즉시 실행합니다.
 *
 * 실행 방법:
 * - npm run pipeline:geoRefresh
 *
 * 실행 순서:
 * STEP 1: runCollectionJob (KOPIS, Culture, TourAPI + Dedupe + Normalize)
 * STEP 2: runGeoBackfill (주소 기반 지오코딩)
 * STEP 3: runGeoVenueBackfill (venue 기반 지오코딩)
 * STEP 4: dedupeCanonicalEvents (Canonical 재동기화)
 * STEP 5: report:geoV2 (결과 출력)
 */

import { runCollectionJob } from './collect';
import { runGeoBackfill } from './geoBackfill';
import { runGeoVenueBackfill } from './geoVenueBackfill';
import { dedupeCanonicalEvents } from './dedupeCanonicalEvents';
import { pool } from '../db';

/**
 * Geo Report 조회 (report:geoV2와 동일)
 */
async function getGeoReport(): Promise<{
  canonical_total_live: number;
  canonical_with_geo_live: number;
  canonical_pct_with_geo_live: number;
}> {
  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE end_at >= CURRENT_DATE) AS total_live,
      COUNT(*) FILTER (WHERE end_at >= CURRENT_DATE AND lat IS NOT NULL AND lng IS NOT NULL) AS with_geo_live
    FROM canonical_events
  `);

  const row = result.rows[0];
  const total = parseInt(row.total_live) || 0;
  const withGeo = parseInt(row.with_geo_live) || 0;
  const pct = total > 0 ? (withGeo / total * 100) : 0;

  return {
    canonical_total_live: total,
    canonical_with_geo_live: withGeo,
    canonical_pct_with_geo_live: parseFloat(pct.toFixed(2)),
  };
}

/**
 * Full Geo Refresh Pipeline 실행
 */
export async function runGeoRefreshPipeline(): Promise<void> {
  const pipelineStart = Date.now();
  const startTime = new Date().toISOString();
  const nodeEnv = process.env.NODE_ENV || 'development';

  // Step 결과 추적
  let okSteps = 0;
  let failedSteps = 0;
  const stepResults: { name: string; status: 'OK' | 'FAILED'; elapsed: number }[] = [];

  console.log('═'.repeat(80));
  console.log(`[GeoRefreshPipeline] START (timestamp=${startTime}, NODE_ENV=${nodeEnv})`);
  console.log('[GeoRefreshPipeline] Starting Full Geo Refresh Pipeline');
  console.log('═'.repeat(80));
  console.log();

  // BEFORE: 현재 상태 확인
  console.log('[GeoRefreshPipeline] BEFORE - Checking current geo coverage...');
  const before = await getGeoReport();
  console.log(`[GeoRefreshPipeline] BEFORE: canonical_live=${before.canonical_total_live}, with_geo=${before.canonical_with_geo_live}, pct=${before.canonical_pct_with_geo_live}%`);
  console.log();

  try {
    // STEP 1: Collection (실패해도 STEP 2~4 계속)
    console.log('[GeoRefreshPipeline][STEP1] collect START');
    const step1Start = Date.now();
    const step1MemStart = Math.round(process.memoryUsage().rss / 1024 / 1024);
    console.log(`[INSTRUMENT][PIPELINE][STEP1] START ts=${new Date().toISOString()} mem=${step1MemStart}MB`);
    let step1Status: 'OK' | 'FAILED' = 'OK';

    // DEV_FORCE_COLLECT_FAIL 환경변수로 강제 실패 테스트 가능 (DEV/TEST 환경에서만)
    const forceFailEnabled = process.env.DEV_FORCE_COLLECT_FAIL === 'true' && process.env.NODE_ENV !== 'production';
    if (forceFailEnabled) {
      console.warn('[GeoRefreshPipeline][STEP1] ⚠️ DEV_FORCE_COLLECT_FAIL=true detected (NODE_ENV=' + nodeEnv + ')');
      console.warn('[GeoRefreshPipeline][STEP1] Simulating collection failure for testing pipeline resilience...');
      const error = new Error('Forced collection failure for testing');
      (error as any).type = 'TEST_ERROR';
      const elapsed = ((Date.now() - step1Start) / 1000).toFixed(1);
      console.error(`[GeoRefreshPipeline][STEP1] collect FAILED (${elapsed}s)`);
      console.error(`[GeoRefreshPipeline][STEP1] Error: ${error.message}`);
      console.error(`[GeoRefreshPipeline][STEP1] Error Type: TEST_ERROR`);
      console.warn('[GeoRefreshPipeline][STEP1] ⚠️ Collection failed, but continuing with STEP 2~4...');
      step1Status = 'FAILED';
      failedSteps++;
      stepResults.push({ name: 'STEP1-collect', status: 'FAILED', elapsed: parseFloat(elapsed) });
    } else {
      try {
        await runCollectionJob();
        const elapsed = ((Date.now() - step1Start) / 1000).toFixed(1);
        const elapsedMs = Date.now() - step1Start;
        const step1MemEnd = Math.round(process.memoryUsage().rss / 1024 / 1024);
        console.log(`[INSTRUMENT][PIPELINE][STEP1] END   ts=${new Date().toISOString()} elapsed=${elapsedMs}ms mem=${step1MemEnd}MB`);
        console.log(`[GeoRefreshPipeline][STEP1] collect OK (${elapsed}s)`);
        okSteps++;
        stepResults.push({ name: 'STEP1-collect', status: 'OK', elapsed: parseFloat(elapsed) });
      } catch (error: any) {
        const elapsed = ((Date.now() - step1Start) / 1000).toFixed(1);
        const elapsedMs = Date.now() - step1Start;
        const step1MemEnd = Math.round(process.memoryUsage().rss / 1024 / 1024);
        console.log(`[INSTRUMENT][PIPELINE][STEP1] END   ts=${new Date().toISOString()} elapsed=${elapsedMs}ms mem=${step1MemEnd}MB`);
        console.error(`[GeoRefreshPipeline][STEP1] collect FAILED (${elapsed}s)`);
        console.error(`[GeoRefreshPipeline][STEP1] Error: ${error?.message || String(error)}`);
        console.warn('[GeoRefreshPipeline][STEP1] ⚠️ Collection failed, but continuing with STEP 2~4...');
        step1Status = 'FAILED';
        failedSteps++;
        stepResults.push({ name: 'STEP1-collect', status: 'FAILED', elapsed: parseFloat(elapsed) });
      }
    }
    console.log();

    // STEP 2: GeoBackfill (Address-based)
    console.log('[GeoRefreshPipeline][STEP2] geoBackfill START (address-based, live-only, limit=2000)');
    const step2Start = Date.now();
    const step2MemStart = Math.round(process.memoryUsage().rss / 1024 / 1024);
    console.log(`[INSTRUMENT][PIPELINE][STEP2] START ts=${new Date().toISOString()} mem=${step2MemStart}MB`);
    try {
      await runGeoBackfill({
        liveOnly: true,
        limit: 2000,
      });
      const elapsed = ((Date.now() - step2Start) / 1000).toFixed(1);
      const elapsedMs = Date.now() - step2Start;
      const step2MemEnd = Math.round(process.memoryUsage().rss / 1024 / 1024);
      console.log(`[INSTRUMENT][PIPELINE][STEP2] END   ts=${new Date().toISOString()} elapsed=${elapsedMs}ms mem=${step2MemEnd}MB`);
      console.log(`[GeoRefreshPipeline][STEP2] geoBackfill OK (${elapsed}s)`);
      okSteps++;
      stepResults.push({ name: 'STEP2-geoBackfill', status: 'OK', elapsed: parseFloat(elapsed) });
    } catch (error: any) {
      const elapsed = ((Date.now() - step2Start) / 1000).toFixed(1);
      const elapsedMs = Date.now() - step2Start;
      const step2MemEnd = Math.round(process.memoryUsage().rss / 1024 / 1024);
      console.log(`[INSTRUMENT][PIPELINE][STEP2] END   ts=${new Date().toISOString()} elapsed=${elapsedMs}ms mem=${step2MemEnd}MB`);
      console.error(`[GeoRefreshPipeline][STEP2] geoBackfill FAILED (${elapsed}s)`);
      console.error(`[GeoRefreshPipeline][STEP2] Error: ${error?.message || String(error)}`);
      failedSteps++;
      stepResults.push({ name: 'STEP2-geoBackfill', status: 'FAILED', elapsed: parseFloat(elapsed) });
    }
    console.log();

    // STEP 3: GeoVenueBackfill (Venue Name-based)
    console.log('[GeoRefreshPipeline][STEP3] geoVenueBackfill START (venue-based, live-only, limit=1500, minConf=0.5)');
    const step3Start = Date.now();
    const step3MemStart = Math.round(process.memoryUsage().rss / 1024 / 1024);
    console.log(`[INSTRUMENT][PIPELINE][STEP3] START ts=${new Date().toISOString()} mem=${step3MemStart}MB`);
    try {
      await runGeoVenueBackfill({
        liveOnly: true,
        limit: 1500,
        minConfidence: 0.5,
      });
      const elapsed = ((Date.now() - step3Start) / 1000).toFixed(1);
      const elapsedMs = Date.now() - step3Start;
      const step3MemEnd = Math.round(process.memoryUsage().rss / 1024 / 1024);
      console.log(`[INSTRUMENT][PIPELINE][STEP3] END   ts=${new Date().toISOString()} elapsed=${elapsedMs}ms mem=${step3MemEnd}MB`);
      console.log(`[GeoRefreshPipeline][STEP3] geoVenueBackfill OK (${elapsed}s)`);
      okSteps++;
      stepResults.push({ name: 'STEP3-geoVenueBackfill', status: 'OK', elapsed: parseFloat(elapsed) });
    } catch (error: any) {
      const elapsed = ((Date.now() - step3Start) / 1000).toFixed(1);
      const elapsedMs = Date.now() - step3Start;
      const step3MemEnd = Math.round(process.memoryUsage().rss / 1024 / 1024);
      console.log(`[INSTRUMENT][PIPELINE][STEP3] END   ts=${new Date().toISOString()} elapsed=${elapsedMs}ms mem=${step3MemEnd}MB`);
      console.error(`[GeoRefreshPipeline][STEP3] geoVenueBackfill FAILED (${elapsed}s)`);
      console.error(`[GeoRefreshPipeline][STEP3] Error: ${error?.message || String(error)}`);
      failedSteps++;
      stepResults.push({ name: 'STEP3-geoVenueBackfill', status: 'FAILED', elapsed: parseFloat(elapsed) });
    }
    console.log();

    // STEP 4: Dedupe
    console.log('[GeoRefreshPipeline][STEP4] dedupe START (sync geo to canonical)');
    const step4Start = Date.now();
    const step4MemStart = Math.round(process.memoryUsage().rss / 1024 / 1024);
    console.log(`[INSTRUMENT][PIPELINE][STEP4] START ts=${new Date().toISOString()} mem=${step4MemStart}MB`);
    try {
      await dedupeCanonicalEvents();
      const elapsed = ((Date.now() - step4Start) / 1000).toFixed(1);
      const elapsedMs = Date.now() - step4Start;
      const step4MemEnd = Math.round(process.memoryUsage().rss / 1024 / 1024);
      console.log(`[INSTRUMENT][PIPELINE][STEP4] END   ts=${new Date().toISOString()} elapsed=${elapsedMs}ms mem=${step4MemEnd}MB`);
      console.log(`[GeoRefreshPipeline][STEP4] dedupe OK (${elapsed}s)`);
      okSteps++;
      stepResults.push({ name: 'STEP4-dedupe', status: 'OK', elapsed: parseFloat(elapsed) });
    } catch (error: any) {
      const elapsed = ((Date.now() - step4Start) / 1000).toFixed(1);
      const elapsedMs = Date.now() - step4Start;
      const step4MemEnd = Math.round(process.memoryUsage().rss / 1024 / 1024);
      console.log(`[INSTRUMENT][PIPELINE][STEP4] END   ts=${new Date().toISOString()} elapsed=${elapsedMs}ms mem=${step4MemEnd}MB`);
      console.error(`[GeoRefreshPipeline][STEP4] dedupe FAILED (${elapsed}s)`);
      console.error(`[GeoRefreshPipeline][STEP4] Error: ${error?.message || String(error)}`);
      failedSteps++;
      stepResults.push({ name: 'STEP4-dedupe', status: 'FAILED', elapsed: parseFloat(elapsed) });
    }
    console.log();

    // 🤖 STEP 5: AI Enrichment (신규 이벤트 자동 보완)
    console.log('[GeoRefreshPipeline][STEP5] AI enrichment START');
    const step5Start = Date.now();
    const step5MemStart = Math.round(process.memoryUsage().rss / 1024 / 1024);
    console.log(`[INSTRUMENT][PIPELINE][STEP5] START ts=${new Date().toISOString()} mem=${step5MemStart}MB`);
    let step5Status: 'OK' | 'FAILED' = 'OK';
    
    try {
      // AI Enrichment 실행 (최근 24시간 생성/업데이트 이벤트만)
      const { aiEnrichmentBackfill } = await import('./aiEnrichmentBackfill');
      await aiEnrichmentBackfill({
        limit: null,
        testMode: false,
        useNaverSearch: true,
        onlyMissingTags: false,  // 모든 빈 필드 처리
        onlyRecent: true,        // 최근 24시간만
      });
      
      const step5End = Date.now();
      const step5MemEnd = Math.round(process.memoryUsage().rss / 1024 / 1024);
      const elapsed = ((step5End - step5Start) / 1000).toFixed(1);
      const elapsedMs = step5End - step5Start;
      console.log(`[INSTRUMENT][PIPELINE][STEP5] END   ts=${new Date().toISOString()} elapsed=${elapsedMs}ms mem=${step5MemEnd}MB`);
      console.log(`[GeoRefreshPipeline][STEP5] AI enrichment OK (${elapsed}s)`);
      okSteps++;
      stepResults.push({ name: 'STEP5-ai-enrichment', status: 'OK', elapsed: parseFloat(elapsed) });
    } catch (error: any) {
      const step5End = Date.now();
      const step5MemEnd = Math.round(process.memoryUsage().rss / 1024 / 1024);
      const elapsed = ((step5End - step5Start) / 1000).toFixed(1);
      const elapsedMs = step5End - step5Start;
      console.log(`[INSTRUMENT][PIPELINE][STEP5] END   ts=${new Date().toISOString()} elapsed=${elapsedMs}ms mem=${step5MemEnd}MB`);
      console.error(`[GeoRefreshPipeline][STEP5] AI enrichment FAILED (${elapsed}s)`);
      console.error(`[GeoRefreshPipeline][STEP5] Error: ${error?.message || String(error)}`);
      failedSteps++;
      stepResults.push({ name: 'STEP5-ai-enrichment', status: 'FAILED', elapsed: parseFloat(elapsed) });
    }
    console.log();

    // AFTER: 결과 확인
    console.log('[GeoRefreshPipeline] AFTER - Checking updated geo coverage...');
    const after = await getGeoReport();
    console.log(`[GeoRefreshPipeline] AFTER:  canonical_live=${after.canonical_total_live}, with_geo=${after.canonical_with_geo_live}, pct=${after.canonical_pct_with_geo_live}%`);
    console.log();

    // 변화 계산
    const diffCount = after.canonical_with_geo_live - before.canonical_with_geo_live;
    const diffPct = after.canonical_pct_with_geo_live - before.canonical_pct_with_geo_live;

    console.log('═'.repeat(80));
    console.log('[GeoRefreshPipeline] RESULT:');
    console.log(`  - Geo coverage change: ${diffCount >= 0 ? '+' : ''}${diffCount} events (${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(2)} pp)`);
    console.log(`  - Final coverage: ${after.canonical_pct_with_geo_live}%`);

  } finally {
    // 무조건 COMPLETED 로그 출력 (성공/실패 관계없이)
    const totalSeconds = ((Date.now() - pipelineStart) / 1000).toFixed(1);
    console.log(`  - Total elapsed: ${totalSeconds}s`);
    console.log('═'.repeat(80));
    console.log(`[GeoRefreshPipeline] COMPLETED (totalSeconds=${totalSeconds}, okSteps=${okSteps}, failedSteps=${failedSteps})`);
    console.log('Step Summary:');
    stepResults.forEach((step, idx) => {
      const statusSymbol = step.status === 'OK' ? '✓' : '✗';
      console.log(`  ${idx + 1}. ${step.name}: ${statusSymbol} ${step.status} (${step.elapsed.toFixed(1)}s)`);
    });
    console.log('═'.repeat(80));
  }
}

// CLI 실행
if (require.main === module) {
  runGeoRefreshPipeline()
    .then(() => {
      console.log('[GeoRefreshPipeline] Process completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[GeoRefreshPipeline] Process failed:', error);
      process.exit(1);
    });
}
