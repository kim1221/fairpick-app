import { pool, getRawEventPayload } from '../db';

/**
 * Overview Backfill Job
 * canonical_events.overview가 비어있는 이벤트를 대상으로
 * raw payload에서 소개글을 추출하여 채웁니다.
 */

/**
 * HTML entity 디코딩 (간단 버전)
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
  };

  return text.replace(/&[a-z]+;|&#\d+;/gi, match => entities[match] || match);
}

// 설정 상수
const CONFIG = {
  MIN_OVERVIEW_LENGTH: 30, // 최소 품질 기준 (30자 이상)
  MAX_OVERVIEW_LENGTH: 800, // 최대 길이 제한
  BATCH_SIZE: 50, // 배치 처리 단위
  RATE_LIMIT_MS: 50, // Rate limiting (ms)
};

/**
 * HTML 태그 제거 및 텍스트 클렌징
 */
function cleanOverviewText(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // 1. HTML 태그 제거 (여러 패스로 철저히)
  let cleaned = text
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // style 태그 전체 제거
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // script 태그 전체 제거
    .replace(/<br\s*\/?>/gi, '\n') // br 태그를 줄바꿈으로
    .replace(/<\/p>/gi, '\n') // 닫는 p 태그를 줄바꿈으로
    .replace(/<\/div>/gi, '\n') // 닫는 div 태그를 줄바꿈으로
    .replace(/<[^>]+>/g, ''); // 나머지 모든 HTML 태그 제거

  // 2. HTML entity 디코딩 (&nbsp;, &amp; 등)
  cleaned = decodeHtmlEntities(cleaned);

  // 3. 추가 HTML 엔티티 처리 (숫자 코드 포함)
  cleaned = cleaned
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));

  // 4. 특수문자 · 구분자 제거/정리
  cleaned = cleaned.replace(/·/g, ' '); // 중간점 제거
  cleaned = cleaned.replace(/소개:/g, ''); // "소개:" 문자열 제거
  cleaned = cleaned.replace(/홈페이지:/g, ''); // 불필요한 메타 정보 제거
  cleaned = cleaned.replace(/문의:/g, '');
  cleaned = cleaned.replace(/주소:/g, '');
  cleaned = cleaned.replace(/장소:/g, '');
  cleaned = cleaned.replace(/이용요금:/g, '');
  cleaned = cleaned.replace(/시간:/g, '');
  cleaned = cleaned.replace(/주최:/g, '');

  // 5. 의미 없는 문자열 필터링
  const meaninglessPatterns = [
    /^[-–—]+$/, // 대시만 있는 경우
    /^(내용없음|내용 없음|준비중|준비 중|미정|추후공지|추후 공지)$/i,
    /^\s*$/,
  ];
  for (const pattern of meaninglessPatterns) {
    if (pattern.test(cleaned)) {
      return '';
    }
  }

  // 6. 줄바꿈/공백 정리
  cleaned = cleaned
    .replace(/\r\n/g, '\n') // Windows 줄바꿈 통일
    .replace(/\n{3,}/g, '\n\n') // 연속 줄바꿈 2개로 제한
    .replace(/[ \t]+/g, ' ') // 연속 공백/탭을 하나로
    .trim();

  // 7. 최대 길이 제한
  if (cleaned.length > CONFIG.MAX_OVERVIEW_LENGTH) {
    // 문장 단위로 자르기 (마지막 마침표 기준)
    const truncated = cleaned.substring(0, CONFIG.MAX_OVERVIEW_LENGTH);
    const lastPeriod = truncated.lastIndexOf('.');
    if (lastPeriod > CONFIG.MIN_OVERVIEW_LENGTH) {
      cleaned = truncated.substring(0, lastPeriod + 1);
    } else {
      cleaned = truncated + '...';
    }
  }

  return cleaned;
}

/**
 * Payload에서 overview 추출
 * 소스별 필드 매핑:
 *   - KOPIS: sty (줄거리/프로그램)
 *   - Culture: contents1 (행사/공연 소개)
 *   - Tour: overview > detailText
 */
function extractOverviewFromPayload(
  payload: Record<string, unknown>,
  source: string,
): string | null {
  if (!payload) return null;

  // KOPIS: sty (줄거리) 필드에서 추출
  if (source === 'kopis') {
    const sty = payload.sty as string;
    if (sty && sty.trim()) {
      const cleaned = cleanOverviewText(sty);
      if (cleaned.length >= CONFIG.MIN_OVERVIEW_LENGTH) {
        return cleaned;
      }
    }
    return null;
  }

  // Culture: contents1 필드에서 추출
  if (source === 'culture') {
    const contents1 = payload.contents1 as string;
    if (contents1 && contents1.trim()) {
      const cleaned = cleanOverviewText(contents1);
      if (cleaned.length >= CONFIG.MIN_OVERVIEW_LENGTH) {
        return cleaned;
      }
    }
    return null;
  }

  // Tour: overview > detailText 순서
  if (source === 'tour') {
    // 우선순위 1: overview 필드
    const overview = payload.overview as string;
    if (overview && overview.trim()) {
      const cleaned = cleanOverviewText(overview);
      if (cleaned.length >= CONFIG.MIN_OVERVIEW_LENGTH) {
        return cleaned;
      }
    }

    // 우선순위 2: detailText 필드 (overview보다 더 상세하지만 메타정보 포함)
    // detailText는 "소개:...", "홈페이지:...", "문의:..." 등이 포함되어 있음
    // 첫 번째 "·" 전까지만 사용
    const detailText = payload.detailText as string;
    if (detailText && detailText.trim()) {
      // "소개:" 이후 첫 번째 "·" 전까지 추출
      const introMatch = detailText.match(/소개:(.+?)(?:·|$)/s);
      if (introMatch && introMatch[1]) {
        const cleaned = cleanOverviewText(introMatch[1]);
        if (cleaned.length >= CONFIG.MIN_OVERVIEW_LENGTH) {
          return cleaned;
        }
      }

      // fallback: detailText 전체 클렌징
      const cleaned = cleanOverviewText(detailText);
      if (cleaned.length >= CONFIG.MIN_OVERVIEW_LENGTH) {
        return cleaned;
      }
    }
  }

  return null;
}

/**
 * Overview backfill 대상 이벤트 조회
 */
interface EventWithoutOverview {
  id: string;
  title: string;
  source_priority_winner: string;
  sources: string | unknown[]; // JSONB string or parsed array
  end_at: string | null;
}

async function getEventsWithoutOverview(limit?: number): Promise<EventWithoutOverview[]> {
  const query = `
    SELECT id, title, source_priority_winner, sources, end_at
    FROM canonical_events
    WHERE is_deleted = false
      AND (overview IS NULL OR TRIM(overview) = '')
    ORDER BY
      CASE
        WHEN end_at IS NULL THEN 0
        WHEN end_at >= CURRENT_DATE THEN 1
        ELSE 2
      END,
      end_at DESC NULLS LAST,
      created_at DESC
    ${limit ? `LIMIT ${limit}` : ''}
  `;

  const result = await pool.query(query);
  return result.rows;
}

/**
 * Overview 업데이트
 */
async function updateCanonicalEventOverview(id: string, overview: string): Promise<void> {
  await pool.query(
    `
      UPDATE canonical_events
      SET overview = $1, updated_at = NOW()
      WHERE id = $2
    `,
    [overview, id],
  );
}

/**
 * Overview backfill 메인 로직
 */
async function overviewBackfill(options: { dryRun?: boolean; limit?: number } = {}) {
  const { dryRun = false, limit } = options;

  console.log('[OverviewBackfill] Starting overview backfill job...');
  console.log(`[OverviewBackfill] Mode: ${dryRun ? 'DRY-RUN (no updates)' : 'LIVE'}`);
  if (limit) {
    console.log(`[OverviewBackfill] Limit: ${limit} events`);
  }

  // 1. 대상 이벤트 조회
  console.log('[OverviewBackfill] Fetching events without overview...');
  const events = await getEventsWithoutOverview(limit);

  console.log(`[OverviewBackfill] Found ${events.length} events without overview`);

  if (events.length === 0) {
    console.log('[OverviewBackfill] No events to process. Exiting.');
    return {
      total: 0,
      enriched: 0,
      skipped: 0,
      successRate: 0,
    };
  }

  let enrichedCount = 0;
  let skippedCount = 0;
  const samples: Array<{
    id: string;
    title: string;
    source: string;
    overview: string;
    extractedFrom: string;
  }> = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    try {
      // sources는 DB에서 가져올 때 이미 객체일 수도 있고, 문자열일 수도 있음
      const sources = (typeof event.sources === 'string'
        ? JSON.parse(event.sources)
        : event.sources
      ) as Array<{
        source: string;
        rawTable: string;
        rawId: string;
        sourceEventId: string;
        sourceUrl: string | null;
        imageUrl: string | null;
        title: string | null;
        startAt: string | null;
        endAt: string | null;
      }>;

      let candidateOverview: string | null = null;
      let extractedFrom: string | null = null;

      // 우선순위 1: source_priority_winner의 payload
      const winnerSource = sources.find(s => s.source === event.source_priority_winner);
      if (winnerSource && !candidateOverview) {
        const payload = await getRawEventPayload(winnerSource.rawTable, winnerSource.rawId);
        if (payload) {
          const extracted = extractOverviewFromPayload(payload, winnerSource.source);
          if (extracted) {
            candidateOverview = extracted;
            extractedFrom = `${winnerSource.source}.overview (winner)`;
          }
        }
      }

      // 우선순위 2: sources 내 다른 소스의 payload
      if (!candidateOverview) {
        for (const source of sources) {
          if (source.source === event.source_priority_winner) continue; // 이미 확인함

          const payload = await getRawEventPayload(source.rawTable, source.rawId);
          if (payload) {
            const extracted = extractOverviewFromPayload(payload, source.source);
            if (extracted) {
              candidateOverview = extracted;
              extractedFrom = `${source.source}.overview`;
              break;
            }
          }
        }
      }

      // 업데이트
      if (candidateOverview) {
        if (!dryRun) {
          await updateCanonicalEventOverview(event.id, candidateOverview);
        }

        enrichedCount++;

        // 샘플 수집 (처음 10개만)
        if (samples.length < 10) {
          samples.push({
            id: event.id,
            title: event.title.slice(0, 40),
            source: event.source_priority_winner,
            overview: candidateOverview.slice(0, 100) + (candidateOverview.length > 100 ? '...' : ''),
            extractedFrom: extractedFrom || 'unknown',
          });
        }

        console.log(
          `[OverviewBackfill] ${dryRun ? '[DRY-RUN] ' : ''}✅ Enriched (${i + 1}/${events.length}): ${event.title.slice(0, 40)} -> ${candidateOverview.slice(0, 60)}...`,
        );
      } else {
        skippedCount++;
        console.log(
          `[OverviewBackfill] ⚠️  No overview found (${i + 1}/${events.length}): ${event.title.slice(0, 40)} (source: ${event.source_priority_winner})`,
        );
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, CONFIG.RATE_LIMIT_MS));
    } catch (error) {
      console.error(`[OverviewBackfill] Error processing event: ${event.title}`, error);
      skippedCount++;
    }
  }

  // 결과 리포트
  console.log('\n========================================');
  console.log('[OverviewBackfill] Overview backfill complete!');
  console.log(`  - Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);
  console.log(`  - Total events: ${events.length}`);
  console.log(`  - Enriched: ${enrichedCount}`);
  console.log(`  - Skipped: ${skippedCount}`);
  console.log(`  - Success rate: ${((enrichedCount / events.length) * 100).toFixed(1)}%`);
  console.log('========================================\n');

  // 샘플 출력
  if (samples.length > 0) {
    console.log('[OverviewBackfill] Sample enriched events (first 10):');
    samples.forEach((sample, idx) => {
      console.log(`\n${idx + 1}. ${sample.title}`);
      console.log(`   Source: ${sample.source}`);
      console.log(`   Extracted from: ${sample.extractedFrom}`);
      console.log(`   Overview: ${sample.overview}`);
    });
    console.log('\n');
  }

  return {
    total: events.length,
    enriched: enrichedCount,
    skipped: skippedCount,
    successRate: (enrichedCount / events.length) * 100,
  };
}

/**
 * CLI 실행용 main 함수
 */
async function main() {
  // CLI 인자 파싱
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;

  try {
    const result = await overviewBackfill({ dryRun, limit });

    console.log('[OverviewBackfill] Job completed successfully');
    console.log(`Final stats: ${JSON.stringify(result, null, 2)}`);

    process.exit(0);
  } catch (error) {
    console.error('[OverviewBackfill] Fatal error:', error);
    process.exit(1);
  }
}

// CLI에서 직접 실행 시
if (require.main === module) {
  main();
}

export { overviewBackfill };
