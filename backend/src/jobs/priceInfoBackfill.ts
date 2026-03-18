/**
 * Price Info Backfill Job
 * 
 * 목적: 원천 API payload의 가격 관련 필드를 추출하여
 *       canonical_events.price_info를 채웁니다.
 * 
 * 원천 필드:
 * - KOPIS: payload.pcseguidance
 * - Culture: payload.price
 * - Tour: payload.usefee
 */

import { pool } from '../db';
import he from 'he'; // HTML entity decode
import { deriveIsFree } from '../utils/priceUtils';

// ============================================
// 설정
// ============================================

const CONFIG = {
  BATCH_SIZE: 100,
  MIN_LENGTH: 5,
  MAX_LENGTH: 300,
};

// ============================================
// 타입 정의
// ============================================

interface CanonicalEventForPriceInfo {
  id: string;
  title: string;
  source_priority_winner: string;
  sources: string; // JSONB string
  price_info: string | null;
}

interface PriceInfoStats {
  totalEvents: number;
  alreadyFilled: number;
  targetCount: number;
  attempted: number;
  succeeded: number;
  failed: number;
  newlyFilled: number;
}

// ============================================
// HTML 정제
// ============================================

/**
 * HTML 태그 제거
 */
function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, '');
}

/**
 * HTML entity 디코딩
 */
function decodeHtmlEntities(text: string): string {
  try {
    return he.decode(text);
  } catch {
    return text;
  }
}

/**
 * 메타 텍스트 제거
 */
function removeMetaText(text: string): string {
  // "문의", "홈페이지", "URL" 같은 메타 텍스트 제거
  const metaPatterns = [
    /^문의\s*:\s*/i,
    /^홈페이지\s*:\s*/i,
    /^URL\s*:\s*/i,
    /^링크\s*:\s*/i,
    /^웹사이트\s*:\s*/i,
  ];

  let cleaned = text;
  for (const pattern of metaPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  return cleaned;
}

/**
 * 가격 정보 정제
 */
function sanitizePriceInfo(rawText: string | null | undefined): string | null {
  if (!rawText) return null;

  let cleaned = rawText;

  // 1. HTML 태그 제거
  cleaned = stripHtmlTags(cleaned);

  // 2. HTML entity 디코딩
  cleaned = decodeHtmlEntities(cleaned);

  // 3. 앞뒤 공백 제거
  cleaned = cleaned.trim();

  // 4. 메타 텍스트 제거
  cleaned = removeMetaText(cleaned);

  // 5. 다시 trim
  cleaned = cleaned.trim();

  // 6. 너무 짧은 값 제거 (<5자)
  if (cleaned.length < CONFIG.MIN_LENGTH) {
    return null;
  }

  // 7. 최대 길이 제한 (300자)
  if (cleaned.length > CONFIG.MAX_LENGTH) {
    cleaned = cleaned.slice(0, CONFIG.MAX_LENGTH);
  }

  // 8. 빈 문자열 체크
  if (cleaned === '') {
    return null;
  }

  return cleaned;
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

  const tableName = tableMap[source];
  if (!tableName) {
    return null;
  }

  const result = await pool.query(`SELECT payload FROM ${tableName} WHERE id = $1`, [rawId]);
  return result.rows[0]?.payload || null;
}

// ============================================
// 소스별 가격 필드 추출
// ============================================

/**
 * KOPIS payload에서 가격 정보 추출
 */
function extractKopisPrice(payload: any): string | null {
  // pcseguidance: 티켓 가격 (예: "전석 30,000원")
  return sanitizePriceInfo(payload?.pcseguidance);
}

/**
 * Culture payload에서 가격 정보 추출
 */
function extractCulturePrice(payload: any): string | null {
  // price: 티켓요금 (예: "무료", "성인 10,000원")
  return sanitizePriceInfo(payload?.price);
}

/**
 * Tour payload에서 가격 정보 추출
 */
function extractTourPrice(payload: any): string | null {
  // usefee: 이용요금
  return sanitizePriceInfo(payload?.usefee);
}

// ============================================
// Backfill 로직
// ============================================

/**
 * 대상 이벤트 조회 (price_info가 NULL인 것들)
 */
async function getTargetEvents(): Promise<CanonicalEventForPriceInfo[]> {
  const result = await pool.query(`
    SELECT
      id,
      title,
      source_priority_winner,
      sources,
      price_info
    FROM canonical_events
    WHERE price_info IS NULL
    ORDER BY created_at DESC
  `);

  return result.rows;
}

/**
 * price_info와 field_sources 업데이트
 */
async function updatePriceInfo(id: string, priceInfo: string, source: string): Promise<void> {
  const fieldSource = source === 'kopis' ? 'KOPIS' :
                      source === 'culture' ? 'Culture' :
                      source === 'tour' ? 'TourAPI' :
                      'PUBLIC_API';
  
  const sourceDetail = `${fieldSource} public API`;
  const timestamp = new Date().toISOString();
  
  const fieldSources = {
    price_info: {
      source: fieldSource,
      sourceDetail,
      confidence: 100,
      updatedAt: timestamp
    }
  };
  
  // price_info가 유료임을 나타내는데 is_free=true이면 교정
  // manually_edited_fields->>'is_free' 보호 플래그가 있는 이벤트는 건드리지 않음
  const derivedIsFree = deriveIsFree(priceInfo);

  await pool.query(
    `UPDATE canonical_events
     SET price_info = $1,
         field_sources = COALESCE(field_sources, '{}'::jsonb) || $2::jsonb,
         is_free = CASE
           WHEN $3 = false AND is_free = true
                AND (manually_edited_fields->>'is_free') IS NULL
           THEN false
           ELSE is_free
         END,
         updated_at = NOW()
     WHERE id = $4`,
    [priceInfo, JSON.stringify(fieldSources), derivedIsFree, id]
  );
}

/**
 * 단일 이벤트 처리
 */
async function processEvent(event: CanonicalEventForPriceInfo): Promise<{
  success: boolean;
  priceInfo: string | null;
  error?: string;
}> {
  try {
    // sources에서 rawId 추출
    const sources = typeof event.sources === 'string' 
      ? JSON.parse(event.sources) 
      : event.sources;
    
    const rawId = sources[0]?.rawId;
    
    if (!rawId) {
      return { success: false, priceInfo: null, error: 'No rawId' };
    }

    // payload 조회
    const payload = await getRawPayload(event.source_priority_winner, rawId);
    
    if (!payload) {
      return { success: false, priceInfo: null, error: 'No payload' };
    }

    // 소스별 가격 추출
    let priceInfo: string | null = null;

    switch (event.source_priority_winner) {
      case 'kopis':
        priceInfo = extractKopisPrice(payload);
        break;
      case 'culture':
        priceInfo = extractCulturePrice(payload);
        break;
      case 'tour':
        priceInfo = extractTourPrice(payload);
        break;
      default:
        return { success: false, priceInfo: null, error: 'Unknown source' };
    }

    if (!priceInfo) {
      return { success: true, priceInfo: null, error: 'No price data in payload' };
    }

    return { success: true, priceInfo };
  } catch (error: any) {
    return { success: false, priceInfo: null, error: error.message };
  }
}

/**
 * Backfill 실행
 */
async function runBackfill(options: { dryRun?: boolean } = {}): Promise<PriceInfoStats> {
  const { dryRun = false } = options;

  console.log('[PriceInfoBackfill] Starting...');
  console.log(`[PriceInfoBackfill] Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);

  // geoRefreshPipeline이 아직 실행 중이면 이번 회차 skip (잡 겹침 방지)
  const geoRunning = await pool.query(`
    SELECT id FROM collection_logs
    WHERE type IN ('geo_refresh', 'collection')
      AND status = 'running'
      AND started_at >= NOW() - INTERVAL '2 hours'
    LIMIT 1
  `);
  if (geoRunning.rowCount! > 0) {
    console.log('[PriceInfoBackfill] geoRefreshPipeline 실행 중 — 이번 회차 skip (다음 스케줄에서 처리)');
    return {
      totalEvents: 0, alreadyFilled: 0, targetCount: 0,
      attempted: 0, succeeded: 0, failed: 0, newlyFilled: 0,
    };
  }

  const stats: PriceInfoStats = {
    totalEvents: 0,
    alreadyFilled: 0,
    targetCount: 0,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    newlyFilled: 0,
  };

  // 전체 이벤트 수
  const totalResult = await pool.query('SELECT COUNT(*) as count FROM canonical_events');
  stats.totalEvents = parseInt(totalResult.rows[0].count, 10);

  // 이미 채워진 이벤트 수
  const filledResult = await pool.query(
    'SELECT COUNT(*) as count FROM canonical_events WHERE price_info IS NOT NULL'
  );
  stats.alreadyFilled = parseInt(filledResult.rows[0].count, 10);

  // 대상 이벤트 조회
  const targets = await getTargetEvents();
  stats.targetCount = targets.length;

  console.log(`[PriceInfoBackfill] Total events: ${stats.totalEvents}`);
  console.log(`[PriceInfoBackfill] Already filled: ${stats.alreadyFilled}`);
  console.log(`[PriceInfoBackfill] Target (NULL): ${stats.targetCount}`);

  if (dryRun) {
    console.log('[PriceInfoBackfill] Dry-run mode - no DB updates');
    return stats;
  }

  // 배치 처리
  for (let i = 0; i < targets.length; i++) {
    const event = targets[i];
    stats.attempted++;

    const result = await processEvent(event);

    if (!result.success) {
      stats.failed++;
      if (stats.failed <= 10) {
        console.log(`[PriceInfoBackfill] ❌ Failed: ${event.id} - ${result.error}`);
      }
      continue;
    }

    if (!result.priceInfo) {
      stats.succeeded++;
      // No price data in payload - not an error
      continue;
    }

    // 업데이트
    await updatePriceInfo(event.id, result.priceInfo, event.source_priority_winner);
    stats.succeeded++;
    stats.newlyFilled++;

    if (stats.newlyFilled <= 20 || stats.newlyFilled % 100 === 0) {
      console.log(
        `[PriceInfoBackfill] ✅ ${stats.newlyFilled}. ${event.title.slice(0, 30)} | ${result.priceInfo.slice(0, 50)}`
      );
    }
  }

  return stats;
}

// ============================================
// 결과 출력
// ============================================

function printStats(stats: PriceInfoStats): void {
  console.log('\n========================================');
  console.log('[PriceInfoBackfill] Summary');
  console.log('========================================');
  console.log(`  Total events:          ${stats.totalEvents.toLocaleString()}`);
  console.log(`  Already filled:        ${stats.alreadyFilled.toLocaleString()}`);
  console.log(`  Target (NULL):         ${stats.targetCount.toLocaleString()}`);
  console.log(`  Attempted:             ${stats.attempted.toLocaleString()}`);
  console.log(`  Succeeded:             ${stats.succeeded.toLocaleString()}`);
  console.log(`  Failed:                ${stats.failed.toLocaleString()}`);
  console.log(`  Newly filled:          ${stats.newlyFilled.toLocaleString()}`);
  
  const finalFilled = stats.alreadyFilled + stats.newlyFilled;
  const coverage = stats.totalEvents > 0 ? (finalFilled / stats.totalEvents) * 100 : 0;
  
  console.log(`\n  Final filled:          ${finalFilled.toLocaleString()}`);
  console.log(`  Coverage:              ${coverage.toFixed(2)}%`);
  console.log('========================================\n');
}

// ============================================
// CLI 실행
// ============================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  try {
    const stats = await runBackfill({ dryRun });
    printStats(stats);

    console.log('[PriceInfoBackfill] Job completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('[PriceInfoBackfill] Fatal error:', error);
    process.exit(1);
  }
}

// CLI에서 직접 실행 시
if (require.main === module) {
  main();
}

// Export for programmatic use
export { runBackfill };


