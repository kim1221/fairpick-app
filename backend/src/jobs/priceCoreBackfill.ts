/**
 * Price Core Backfill Job
 * 
 * 목적: canonical_events의 가격 Core 필드(is_free, price_info)를
 *       공공 API 원천 데이터로 정확하게 채웁니다.
 * 
 * 핵심 원칙:
 * - is_free: 공식 가격 텍스트에서 "무료"가 명확한 경우만 true
 * - price_info: 사용자 노출 가능한 가격 텍스트만 저장
 * - 불확실하면 false/NULL (보수적 접근)
 * 
 * 소스별 원천 필드:
 * - KOPIS: payload.pcseguidance
 * - Culture: payload.price
 * - Tour: payload.usetimefestival 또는 payload.usefee
 */

import { pool } from '../db';
import {
  extractPriceBySource,
  deriveIsFree,
  normalizePriceText,
} from '../utils/priceUtils';

// ============================================
// 설정
// ============================================

interface BackfillOptions {
  dryRun?: boolean;
  max?: number;
  onlySource?: 'kopis' | 'culture' | 'tour';
  noDowngradeFree?: boolean; // 기존 is_free=true를 false로 내리지 않음
}

interface CanonicalEventForBackfill {
  id: string;
  title: string;
  source_priority_winner: string;
  sources: string; // JSONB string
  is_free: boolean | null;
  price_info: string | null;
}

interface BackfillStats {
  totalEvents: number;
  targetCount: number;
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
  
  // 세부 통계
  priceInfoUpdated: number;
  priceInfoCleared: number;
  isFreeSetTrue: number;
  isFreeSetFalse: number;
  isFreeKept: number;
  
  // 소스별 통계
  bySource: Record<string, {
    processed: number;
    updated: number;
    priceInfoFound: number;
    isFreeTrue: number;
  }>;
}

// ============================================
// Raw payload 조회
// ============================================

async function getRawPayload(source: string, rawId: string): Promise<any> {
  const tableMap: Record<string, string> = {
    kopis: 'raw_kopis_events',
    culture: 'raw_culture_events',
    tour: 'raw_tour_events',
  };

  const tableName = tableMap[source.toLowerCase()];
  if (!tableName) {
    return null;
  }

  const result = await pool.query(`SELECT payload FROM ${tableName} WHERE id = $1`, [rawId]);
  return result.rows[0]?.payload || null;
}

// ============================================
// 대상 이벤트 조회
// ============================================

async function getTargetEvents(options: BackfillOptions): Promise<CanonicalEventForBackfill[]> {
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  // 소스 필터
  if (options.onlySource) {
    conditions.push(`source_priority_winner = $${paramIndex++}`);
    params.push(options.onlySource);
  }

  // WHERE 절 구성
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // LIMIT 절
  const limitClause = options.max ? `LIMIT ${options.max}` : '';

  const query = `
    SELECT
      id,
      title,
      source_priority_winner,
      sources,
      is_free,
      price_info
    FROM canonical_events
    ${whereClause}
    ORDER BY 
      CASE 
        WHEN end_at >= NOW() THEN 0  -- Live 이벤트 우선
        WHEN end_at >= NOW() - INTERVAL '7 days' THEN 1  -- 최근 종료 이벤트
        ELSE 2
      END,
      updated_at DESC
    ${limitClause}
  `;

  const result = await pool.query(query, params);
  return result.rows;
}

// ============================================
// 단일 이벤트 처리
// ============================================

interface ProcessResult {
  success: boolean;
  updated: boolean;
  priceInfo: string | null;
  isFree: boolean;
  error?: string;
}

async function processEvent(
  event: CanonicalEventForBackfill,
  options: BackfillOptions
): Promise<ProcessResult> {
  try {
    // 1. sources에서 rawId 추출
    const sources = typeof event.sources === 'string' 
      ? JSON.parse(event.sources) 
      : event.sources;
    
    const rawId = sources[0]?.rawId;
    
    if (!rawId) {
      return { 
        success: false, 
        updated: false, 
        priceInfo: null, 
        isFree: false, 
        error: 'No rawId' 
      };
    }

    // 2. payload 조회
    const payload = await getRawPayload(event.source_priority_winner, rawId);
    
    if (!payload) {
      return { 
        success: false, 
        updated: false, 
        priceInfo: null, 
        isFree: false, 
        error: 'No payload' 
      };
    }

    // 3. 소스별 가격 추출
    const priceInfo = extractPriceBySource(event.source_priority_winner, payload);
    
    // 4. 무료 여부 판정
    const isFree = deriveIsFree(priceInfo);

    // 5. 업데이트 필요 여부 판단
    const needsUpdate = 
      event.price_info !== priceInfo || 
      event.is_free !== isFree;

    if (!needsUpdate) {
      return { 
        success: true, 
        updated: false, 
        priceInfo, 
        isFree 
      };
    }

    // 6. noDowngradeFree 옵션 체크
    if (options.noDowngradeFree && event.is_free === true && isFree === false) {
      return { 
        success: true, 
        updated: false, 
        priceInfo: event.price_info, 
        isFree: event.is_free,
        error: 'Skipped (noDowngradeFree)'
      };
    }

    return { 
      success: true, 
      updated: true, 
      priceInfo, 
      isFree 
    };
  } catch (error: any) {
    return { 
      success: false, 
      updated: false, 
      priceInfo: null, 
      isFree: false, 
      error: error.message 
    };
  }
}

// ============================================
// DB 업데이트
// ============================================

async function updatePriceCore(
  id: string, 
  priceInfo: string | null, 
  isFree: boolean,
  source: string
): Promise<void> {
  // field_sources 설정
  const fieldSource = source === 'kopis' ? 'KOPIS' :
                      source === 'culture' ? 'Culture' :
                      source === 'tour' ? 'TourAPI' :
                      'PUBLIC_API';
  
  const sourceDetail = `${fieldSource} public API`;
  const timestamp = new Date().toISOString();
  
  const fieldSources: Record<string, any> = {};
  
  if (priceInfo !== null) {
    fieldSources.price_info = {
      source: fieldSource,
      sourceDetail,
      confidence: 100,
      updatedAt: timestamp
    };
  }
  
  await pool.query(
    `
      UPDATE canonical_events 
      SET 
        price_info = $1,
        is_free = $2,
        field_sources = COALESCE(field_sources, '{}'::jsonb) || $3::jsonb,
        updated_at = NOW()
      WHERE id = $4
    `,
    [priceInfo, isFree, JSON.stringify(fieldSources), id]
  );
}

// ============================================
// Backfill 실행
// ============================================

async function runBackfill(options: BackfillOptions = {}): Promise<BackfillStats> {
  const { dryRun = false } = options;

  console.log('\n========================================');
  console.log('[PriceCoreBackfill] Starting...');
  console.log('========================================');
  console.log(`  Mode:             ${dryRun ? 'DRY-RUN' : 'LIVE'}`);
  console.log(`  Max:              ${options.max || 'ALL'}`);
  console.log(`  Source filter:    ${options.onlySource || 'ALL'}`);
  console.log(`  No downgrade:     ${options.noDowngradeFree ? 'YES' : 'NO'}`);
  console.log('========================================\n');

  const stats: BackfillStats = {
    totalEvents: 0,
    targetCount: 0,
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    priceInfoUpdated: 0,
    priceInfoCleared: 0,
    isFreeSetTrue: 0,
    isFreeSetFalse: 0,
    isFreeKept: 0,
    bySource: {},
  };

  // 전체 이벤트 수
  const totalResult = await pool.query('SELECT COUNT(*) as count FROM canonical_events');
  stats.totalEvents = parseInt(totalResult.rows[0].count, 10);

  // 대상 이벤트 조회
  const targets = await getTargetEvents(options);
  stats.targetCount = targets.length;

  console.log(`[PriceCoreBackfill] Total events: ${stats.totalEvents.toLocaleString()}`);
  console.log(`[PriceCoreBackfill] Target count: ${stats.targetCount.toLocaleString()}`);
  console.log('');

  if (dryRun) {
    console.log('[PriceCoreBackfill] ⚠️  DRY-RUN mode - no DB updates\n');
  }

  // 배치 처리
  for (let i = 0; i < targets.length; i++) {
    const event = targets[i];
    stats.processed++;

    // 소스별 통계 초기화
    const source = event.source_priority_winner.toLowerCase();
    if (!stats.bySource[source]) {
      stats.bySource[source] = {
        processed: 0,
        updated: 0,
        priceInfoFound: 0,
        isFreeTrue: 0,
      };
    }
    stats.bySource[source].processed++;

    // 처리
    const result = await processEvent(event, options);

    if (!result.success) {
      stats.errors++;
      if (stats.errors <= 10) {
        console.log(`[PriceCoreBackfill] ❌ Error: ${event.id} - ${result.error}`);
      }
      continue;
    }

    if (!result.updated) {
      stats.skipped++;
      continue;
    }

    // 통계 업데이트
    stats.updated++;
    stats.bySource[source].updated++;

    if (result.priceInfo !== null) {
      stats.bySource[source].priceInfoFound++;
      if (event.price_info === null) {
        stats.priceInfoUpdated++;
      }
    } else if (event.price_info !== null) {
      stats.priceInfoCleared++;
    }

    if (result.isFree) {
      stats.bySource[source].isFreeTrue++;
      if (event.is_free !== true) {
        stats.isFreeSetTrue++;
      }
    } else {
      if (event.is_free === true) {
        stats.isFreeSetFalse++;
      }
    }

    // DB 업데이트 (DRY-RUN이 아닐 때만)
    if (!dryRun) {
      await updatePriceCore(event.id, result.priceInfo, result.isFree, event.source_priority_winner);
    }

    // 진행 상황 출력
    if (stats.updated <= 20 || stats.updated % 100 === 0) {
      const priceDisplay = result.priceInfo 
        ? result.priceInfo.slice(0, 50) 
        : '(NULL)';
      const freeDisplay = result.isFree ? '무료' : '유료';
      console.log(
        `[PriceCoreBackfill] ${dryRun ? '📋' : '✅'} ${stats.updated}. [${freeDisplay}] ${event.title.slice(0, 30)} | ${priceDisplay}`
      );
    }
  }

  return stats;
}

// ============================================
// 결과 출력
// ============================================

function printStats(stats: BackfillStats, options: BackfillOptions): void {
  console.log('\n========================================');
  console.log('[PriceCoreBackfill] Summary');
  console.log('========================================');
  console.log(`  Mode:                  ${options.dryRun ? 'DRY-RUN' : 'LIVE'}`);
  console.log(`  Total events:          ${stats.totalEvents.toLocaleString()}`);
  console.log(`  Target count:          ${stats.targetCount.toLocaleString()}`);
  console.log(`  Processed:             ${stats.processed.toLocaleString()}`);
  console.log(`  Updated:               ${stats.updated.toLocaleString()}`);
  console.log(`  Skipped (no change):   ${stats.skipped.toLocaleString()}`);
  console.log(`  Errors:                ${stats.errors.toLocaleString()}`);
  console.log('');
  console.log('  Price Info:');
  console.log(`    - Newly filled:      ${stats.priceInfoUpdated.toLocaleString()}`);
  console.log(`    - Cleared:           ${stats.priceInfoCleared.toLocaleString()}`);
  console.log('');
  console.log('  Is Free:');
  console.log(`    - Set to TRUE:       ${stats.isFreeSetTrue.toLocaleString()}`);
  console.log(`    - Set to FALSE:      ${stats.isFreeSetFalse.toLocaleString()}`);
  console.log('');
  console.log('  By Source:');
  
  for (const [source, sourceStats] of Object.entries(stats.bySource)) {
    console.log(`    [${source.toUpperCase()}]`);
    console.log(`      - Processed:       ${sourceStats.processed.toLocaleString()}`);
    console.log(`      - Updated:         ${sourceStats.updated.toLocaleString()}`);
    console.log(`      - Price info:      ${sourceStats.priceInfoFound.toLocaleString()}`);
    console.log(`      - Free:            ${sourceStats.isFreeTrue.toLocaleString()}`);
  }
  
  console.log('========================================\n');
}

// ============================================
// CLI 실행
// ============================================

async function main() {
  const args = process.argv.slice(2);
  
  const options: BackfillOptions = {
    dryRun: args.includes('--dry-run'),
    noDowngradeFree: args.includes('--no-downgrade-free'),
  };

  // --max=N
  const maxArg = args.find(arg => arg.startsWith('--max='));
  if (maxArg) {
    options.max = parseInt(maxArg.split('=')[1], 10);
  }

  // --only-source=kopis|culture|tour
  const sourceArg = args.find(arg => arg.startsWith('--only-source='));
  if (sourceArg) {
    const source = sourceArg.split('=')[1] as 'kopis' | 'culture' | 'tour';
    if (['kopis', 'culture', 'tour'].includes(source)) {
      options.onlySource = source;
    }
  }

  try {
    const stats = await runBackfill(options);
    printStats(stats, options);

    console.log('[PriceCoreBackfill] ✅ Job completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('[PriceCoreBackfill] ❌ Fatal error:', error);
    process.exit(1);
  }
}

// CLI에서 직접 실행 시
if (require.main === module) {
  main();
}

// Export for programmatic use
export { runBackfill, BackfillOptions, BackfillStats };


