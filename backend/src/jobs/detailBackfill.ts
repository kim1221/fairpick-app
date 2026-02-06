import { parseStringPromise } from 'xml2js';
import { config } from '../config';
import { pool } from '../db';
import http from '../lib/http';

/**
 * Detail Backfill Job
 *
 * raw_kopis_events와 raw_culture_events 테이블에서
 * sty(KOPIS)/contents1(Culture) 필드가 없는 레코드를 대상으로
 * 상세 API를 호출하여 보강합니다.
 */

// ============================================
// 설정
// ============================================

const CONFIG = {
  // 동시성 (환경변수로 조절 가능)
  KOPIS_DETAIL_CONCURRENCY: parseInt(process.env.KOPIS_DETAIL_CONCURRENCY || '3', 10),
  CULTURE_DETAIL_CONCURRENCY: parseInt(process.env.CULTURE_DETAIL_CONCURRENCY || '3', 10),

  // 재시도 설정
  MAX_RETRIES: 3,
  INITIAL_BACKOFF_MS: 1000,
  MAX_BACKOFF_MS: 30000,

  // Rate limiting
  RATE_LIMIT_MS: 100,

  // 기본 최대 처리 건수
  DEFAULT_MAX_DETAIL: 500,
};

// KOPIS API 설정
const KOPIS_API_BASE = 'http://www.kopis.or.kr/openApi/restful';
const KOPIS_SERVICE_KEY = 'bbef54b0049c4570b7b1f46f52b6dd8f';

// Culture API 설정
const CULTURE_API_BASE = 'https://apis.data.go.kr/B553457/cultureinfo';

// ============================================
// 타입 정의
// ============================================

interface RawEventTarget {
  id: string;
  source_event_id: string;
  title: string;
  end_at: string | null;
  start_at: string | null;
}

interface DetailStats {
  listCount: number;
  targetCount: number;
  attempted: number;
  succeeded: number;
  failed: number;
  failureReasons: Record<string, number>;
  newlyFilled: number;
}

// ============================================
// 지수 백오프 재시도 로직
// ============================================

async function fetchWithRetry<T>(
  fetchFn: () => Promise<T>,
  context: string,
  maxRetries: number = CONFIG.MAX_RETRIES,
): Promise<{ data: T | null; error: string | null }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const data = await fetchFn();
      return { data, error: null };
    } catch (error: any) {
      lastError = error;

      // 에러 분류
      const status = error.status || error.response?.status;
      const isRetryable = status === 429 || status >= 500 || error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET';

      if (!isRetryable || attempt === maxRetries) {
        const errorType = status === 429 ? '429_RATE_LIMIT'
          : status >= 500 ? `5XX_${status}`
          : error.code === 'ETIMEDOUT' ? 'TIMEOUT'
          : error.code === 'ECONNRESET' ? 'CONNECTION_RESET'
          : `OTHER_${status || error.code || 'UNKNOWN'}`;

        return { data: null, error: errorType };
      }

      // 지수 백오프
      const backoffMs = Math.min(
        CONFIG.INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1),
        CONFIG.MAX_BACKOFF_MS,
      );
      console.log(`[DetailBackfill] ${context} - Retry ${attempt}/${maxRetries} after ${backoffMs}ms`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  return { data: null, error: 'MAX_RETRIES_EXCEEDED' };
}

// ============================================
// KOPIS Detail API
// ============================================

async function fetchKopisDetail(mt20id: string): Promise<{ sty: string } | null> {
  const response = await http.get<string>(`${KOPIS_API_BASE}/pblprfr/${mt20id}`, {
    params: { service: KOPIS_SERVICE_KEY },
    timeout: 10000,
  });

  const parsed = await parseStringPromise(response);
  const db = parsed?.dbs?.db?.[0];

  if (!db) return null;

  return {
    sty: db.sty?.[0] || '',
  };
}

// ============================================
// Culture Detail API
// ============================================

async function fetchCultureDetail(seq: string): Promise<{ contents1: string } | null> {
  if (!config.tourApiKey) {
    throw new Error('TOUR_API_KEY not configured');
  }

  const response = await http.get<string>(`${CULTURE_API_BASE}/detail2`, {
    params: {
      serviceKey: config.tourApiKey,
      seq,
    },
    timeout: 10000,
  });

  const parsed = await parseStringPromise(response);
  const item = parsed?.response?.body?.[0]?.items?.[0]?.item?.[0];

  if (!item) return null;

  return {
    contents1: item.contents1?.[0] || '',
  };
}

// ============================================
// KOPIS Detail Backfill
// ============================================

async function getKopisTargets(maxDetail: number): Promise<RawEventTarget[]> {
  // 우선순위:
  // 1. Live 이벤트 (end_at >= today)
  // 2. 종료일이 가까운 것 우선
  // 3. sty가 없는 것
  const result = await pool.query(`
    SELECT id, source_event_id, title, end_at, start_at
    FROM raw_kopis_events
    WHERE payload->>'sty' IS NULL OR TRIM(payload->>'sty') = ''
    ORDER BY
      CASE WHEN end_at >= CURRENT_DATE THEN 0 ELSE 1 END,
      end_at ASC NULLS LAST,
      start_at ASC NULLS LAST
    LIMIT $1
  `, [maxDetail]);

  return result.rows;
}

async function updateKopisPayload(id: string, sty: string): Promise<void> {
  await pool.query(`
    UPDATE raw_kopis_events
    SET
      payload = payload || jsonb_build_object('sty', $2::text),
      updated_at = NOW()
    WHERE id = $1
  `, [id, sty]);
}

async function backfillKopisDetail(options: {
  dryRun?: boolean;
  maxDetail?: number;
  networkDryRun?: boolean;
}): Promise<DetailStats> {
  const { dryRun = false, maxDetail = CONFIG.DEFAULT_MAX_DETAIL, networkDryRun = false } = options;

  console.log('[DetailBackfill][KOPIS] Starting...');
  console.log(`[DetailBackfill][KOPIS] Mode: ${dryRun ? 'DRY-RUN' : networkDryRun ? 'NETWORK-DRY-RUN' : 'LIVE'}`);
  console.log(`[DetailBackfill][KOPIS] Max detail: ${maxDetail}`);
  console.log(`[DetailBackfill][KOPIS] Concurrency: ${CONFIG.KOPIS_DETAIL_CONCURRENCY}`);

  const stats: DetailStats = {
    listCount: 0,
    targetCount: 0,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    failureReasons: {},
    newlyFilled: 0,
  };

  // 전체 raw 개수 조회
  const totalResult = await pool.query('SELECT COUNT(*) as count FROM raw_kopis_events');
  stats.listCount = parseInt(totalResult.rows[0].count, 10);

  // 대상 조회
  const targets = await getKopisTargets(maxDetail);
  stats.targetCount = targets.length;

  console.log(`[DetailBackfill][KOPIS] Total raw events: ${stats.listCount}`);
  console.log(`[DetailBackfill][KOPIS] Target (missing sty): ${stats.targetCount}`);

  if (networkDryRun) {
    // 네트워크 호출 없이 대상만 출력
    console.log('[DetailBackfill][KOPIS] Network dry-run mode - showing first 20 targets:');
    targets.slice(0, 20).forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.source_event_id} | ${t.title?.slice(0, 40)} | end_at: ${t.end_at}`);
    });
    return stats;
  }

  // 배치 처리
  const concurrency = CONFIG.KOPIS_DETAIL_CONCURRENCY;

  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);

    await Promise.all(batch.map(async (target) => {
      stats.attempted++;

      const { data, error } = await fetchWithRetry(
        () => fetchKopisDetail(target.source_event_id),
        `KOPIS ${target.source_event_id}`,
      );

      if (error) {
        stats.failed++;
        stats.failureReasons[error] = (stats.failureReasons[error] || 0) + 1;
        console.log(`[DetailBackfill][KOPIS] ❌ Failed: ${target.source_event_id} - ${error}`);
        return;
      }

      if (!data || !data.sty || !data.sty.trim()) {
        stats.succeeded++;
        console.log(`[DetailBackfill][KOPIS] ⚠️ Empty sty: ${target.source_event_id}`);
        return;
      }

      stats.succeeded++;
      stats.newlyFilled++;

      if (!dryRun) {
        await updateKopisPayload(target.id, data.sty);
        console.log(`[DetailBackfill][KOPIS] ✅ Updated: ${target.source_event_id} | sty length: ${data.sty.length}`);
      } else {
        console.log(`[DetailBackfill][KOPIS] [DRY-RUN] Would update: ${target.source_event_id} | sty length: ${data.sty.length}`);
      }
    }));

    // Rate limiting
    if (i + concurrency < targets.length) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.RATE_LIMIT_MS));
    }
  }

  return stats;
}

// ============================================
// Culture Detail Backfill
// ============================================

async function getCultureTargets(maxDetail: number): Promise<RawEventTarget[]> {
  const result = await pool.query(`
    SELECT id, source_event_id, title, end_at, start_at
    FROM raw_culture_events
    WHERE payload->>'contents1' IS NULL OR TRIM(payload->>'contents1') = ''
    ORDER BY
      CASE WHEN end_at >= CURRENT_DATE THEN 0 ELSE 1 END,
      end_at ASC NULLS LAST,
      start_at ASC NULLS LAST
    LIMIT $1
  `, [maxDetail]);

  return result.rows;
}

async function updateCulturePayload(id: string, contents1: string): Promise<void> {
  await pool.query(`
    UPDATE raw_culture_events
    SET
      payload = payload || jsonb_build_object('contents1', $2::text),
      updated_at = NOW()
    WHERE id = $1
  `, [id, contents1]);
}

async function backfillCultureDetail(options: {
  dryRun?: boolean;
  maxDetail?: number;
  networkDryRun?: boolean;
}): Promise<DetailStats> {
  const { dryRun = false, maxDetail = CONFIG.DEFAULT_MAX_DETAIL, networkDryRun = false } = options;

  console.log('[DetailBackfill][Culture] Starting...');
  console.log(`[DetailBackfill][Culture] Mode: ${dryRun ? 'DRY-RUN' : networkDryRun ? 'NETWORK-DRY-RUN' : 'LIVE'}`);
  console.log(`[DetailBackfill][Culture] Max detail: ${maxDetail}`);
  console.log(`[DetailBackfill][Culture] Concurrency: ${CONFIG.CULTURE_DETAIL_CONCURRENCY}`);

  const stats: DetailStats = {
    listCount: 0,
    targetCount: 0,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    failureReasons: {},
    newlyFilled: 0,
  };

  // 전체 raw 개수 조회
  const totalResult = await pool.query('SELECT COUNT(*) as count FROM raw_culture_events');
  stats.listCount = parseInt(totalResult.rows[0].count, 10);

  // 대상 조회
  const targets = await getCultureTargets(maxDetail);
  stats.targetCount = targets.length;

  console.log(`[DetailBackfill][Culture] Total raw events: ${stats.listCount}`);
  console.log(`[DetailBackfill][Culture] Target (missing contents1): ${stats.targetCount}`);

  if (networkDryRun) {
    console.log('[DetailBackfill][Culture] Network dry-run mode - showing first 20 targets:');
    targets.slice(0, 20).forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.source_event_id} | ${t.title?.slice(0, 40)} | end_at: ${t.end_at}`);
    });
    return stats;
  }

  const concurrency = CONFIG.CULTURE_DETAIL_CONCURRENCY;

  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);

    await Promise.all(batch.map(async (target) => {
      stats.attempted++;

      const { data, error } = await fetchWithRetry(
        () => fetchCultureDetail(target.source_event_id),
        `Culture ${target.source_event_id}`,
      );

      if (error) {
        stats.failed++;
        stats.failureReasons[error] = (stats.failureReasons[error] || 0) + 1;
        console.log(`[DetailBackfill][Culture] ❌ Failed: ${target.source_event_id} - ${error}`);
        return;
      }

      if (!data || !data.contents1 || !data.contents1.trim()) {
        stats.succeeded++;
        console.log(`[DetailBackfill][Culture] ⚠️ Empty contents1: ${target.source_event_id}`);
        return;
      }

      stats.succeeded++;
      stats.newlyFilled++;

      if (!dryRun) {
        await updateCulturePayload(target.id, data.contents1);
        console.log(`[DetailBackfill][Culture] ✅ Updated: ${target.source_event_id} | contents1 length: ${data.contents1.length}`);
      } else {
        console.log(`[DetailBackfill][Culture] [DRY-RUN] Would update: ${target.source_event_id} | contents1 length: ${data.contents1.length}`);
      }
    }));

    if (i + concurrency < targets.length) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.RATE_LIMIT_MS));
    }
  }

  return stats;
}

// ============================================
// 결과 리포트
// ============================================

function printStats(source: string, stats: DetailStats): void {
  console.log(`\n========================================`);
  console.log(`[DetailBackfill][${source}] Summary`);
  console.log(`========================================`);
  console.log(`  List count (total raw):     ${stats.listCount}`);
  console.log(`  Target count (missing):     ${stats.targetCount}`);
  console.log(`  Attempted:                  ${stats.attempted}`);
  console.log(`  Succeeded:                  ${stats.succeeded}`);
  console.log(`  Failed:                     ${stats.failed}`);
  console.log(`  Newly filled:               ${stats.newlyFilled}`);

  if (Object.keys(stats.failureReasons).length > 0) {
    console.log(`  Failure reasons:`);
    for (const [reason, count] of Object.entries(stats.failureReasons)) {
      console.log(`    - ${reason}: ${count}`);
    }
  }
  console.log(`========================================\n`);
}

// ============================================
// CLI 실행
// ============================================

async function main() {
  const args = process.argv.slice(2);

  // 옵션 파싱
  const source = args.find(a => a === 'kopis' || a === 'culture') || 'both';
  const dryRun = args.includes('--dry-run');
  const networkDryRun = args.includes('--network-dry-run');
  const maxDetailArg = args.find(a => a.startsWith('--max-detail='));
  const maxDetail = maxDetailArg ? parseInt(maxDetailArg.split('=')[1], 10) : CONFIG.DEFAULT_MAX_DETAIL;

  console.log('==============================================');
  console.log('[DetailBackfill] Detail Backfill Job Started');
  console.log('==============================================');
  console.log(`  Source: ${source}`);
  console.log(`  Mode: ${dryRun ? 'DRY-RUN' : networkDryRun ? 'NETWORK-DRY-RUN' : 'LIVE'}`);
  console.log(`  Max detail: ${maxDetail}`);
  console.log('==============================================\n');

  try {
    if (source === 'kopis' || source === 'both') {
      const kopisStats = await backfillKopisDetail({ dryRun, maxDetail, networkDryRun });
      printStats('KOPIS', kopisStats);
    }

    if (source === 'culture' || source === 'both') {
      const cultureStats = await backfillCultureDetail({ dryRun, maxDetail, networkDryRun });
      printStats('Culture', cultureStats);
    }

    console.log('[DetailBackfill] Job completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('[DetailBackfill] Fatal error:', error);
    process.exit(1);
  }
}

// CLI에서 직접 실행 시
if (require.main === module) {
  main();
}

// Export for programmatic use
export { backfillKopisDetail, backfillCultureDetail };
