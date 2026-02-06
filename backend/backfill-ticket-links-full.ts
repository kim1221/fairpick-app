/**
 * 전체 이벤트 예매 링크 수집 (KOPIS → 네이버 AI)
 * 
 * 1단계: KOPIS 이벤트는 Detail API에서 relates 추출
 * 2단계: 나머지 이벤트는 네이버 API + Gemini AI로 추출
 */

import { pool } from './src/db';
import { searchEventInfo } from './src/lib/naverApi';
import { extractEventInfo } from './src/lib/aiExtractor';
import { fetchPerformanceDetail } from './src/collectors/kopisCollector';

interface EventRow {
  id: string;
  title: string;
  venue: string | null;
  main_category: string;
  overview: string | null;
  sources: Array<{ source: string; sourceEventId: string }>;
  external_links: {
    official?: string;
    ticket?: string;
    reservation?: string;
  } | null;
  status: string;
}

const KOPIS_API_CALL_INTERVAL_MS = 300; // Rate limiting
const AI_CALL_INTERVAL_MS = 1000; // Gemini rate limiting

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function backfillTicketLinks() {
  console.log('\n' + '='.repeat(80));
  console.log('🎫 예매 링크 전체 수집 (KOPIS → 네이버 AI)');
  console.log('='.repeat(80) + '\n');

  const limitArg = process.argv[2];
  const limit = limitArg ? parseInt(limitArg, 10) : null;

  try {
    // 진행 중/예정 이벤트 중 예매 링크 없는 것만
    let query = `
      SELECT id, title, venue, main_category, overview, sources, external_links, status
      FROM canonical_events
      WHERE (status = 'ongoing' OR status = 'scheduled')
        AND (
          external_links->>'ticket' IS NULL 
          OR external_links->>'ticket' = ''
          OR external_links->>'ticket' LIKE '%pblprfrView%'
        )
      ORDER BY 
        CASE 
          WHEN sources::text LIKE '%kopis%' THEN 1
          ELSE 2
        END,
        updated_at DESC
    `;

    if (limit) {
      query += ` LIMIT ${limit}`;
    }

    const result = await pool.query<EventRow>(query);
    console.log(`📊 수집 대상: ${result.rows.length}개\n`);

    if (result.rows.length === 0) {
      console.log('✅ 수집할 이벤트가 없습니다.');
      await pool.end();
      return;
    }

    let kopisSuccess = 0;
    let aiSuccess = 0;
    let failed = 0;

    for (let i = 0; i < result.rows.length; i++) {
      const event = result.rows[i];
      console.log(`\n[${i + 1}/${result.rows.length}] ${event.title}`);

      try {
        const kopisSource = event.sources?.find(s => s.source === 'kopis');

        // 1단계: KOPIS Detail API
        if (kopisSource?.sourceEventId) {
          console.log(`  📡 KOPIS Detail API 호출 중...`);
          const detail = await fetchPerformanceDetail(kopisSource.sourceEventId);

          if (detail?.relates && detail.relates.length > 0) {
            const ticketLink = detail.relates[0].relateurl;
            const kopisDetailPage = `https://www.kopis.or.kr/por/db/pblprfr/pblprfrView.do?menuId=MNU_00028&mt20Id=${kopisSource.sourceEventId}`;

            const updatedLinks = {
              ...(event.external_links || {}),
              ticket: ticketLink,
              official: kopisDetailPage,
            };

            await pool.query(`
              UPDATE canonical_events
              SET external_links = $1::jsonb,
                  updated_at = NOW()
              WHERE id = $2
            `, [JSON.stringify(updatedLinks), event.id]);

            console.log(`  ✅ KOPIS: ${detail.relates[0].relatenm}`);
            kopisSuccess++;
            await sleep(KOPIS_API_CALL_INTERVAL_MS);
            continue;
          } else {
            console.log(`  ⚠️  KOPIS에 예매처 정보 없음`);
          }

          await sleep(KOPIS_API_CALL_INTERVAL_MS);
        }

        // 2단계: 네이버 API + Gemini AI
        console.log(`  🔍 네이버 검색 + AI 추출 중...`);
        const searchResult = await searchEventInfo(event.title, event.venue || undefined);
        
        const searchText = [
          searchResult.place ? `=== 네이버 플레이스 ===\n${JSON.stringify(searchResult.place.items?.[0] || {}, null, 2)}` : '',
          searchResult.blog ? `=== 블로그 ===\n${searchResult.blog.items?.map((item: any) => item.description).join('\n')}` : '',
          searchResult.web ? `=== 웹 ===\n${searchResult.web.items?.map((item: any) => item.description).join('\n')}` : '',
        ].filter(Boolean).join('\n\n');

        if (searchText.trim()) {
          const extracted = await extractEventInfo(
            event.title,
            event.main_category,
            event.overview,
            searchText
          );

          if (extracted && (extracted.external_links?.ticket || extracted.external_links?.official || extracted.external_links?.reservation)) {
            const updatedLinks = {
              ...(event.external_links || {}),
              ...extracted.external_links,
            };

            // 네이버 플레이스 링크를 official로 보완
            if (!updatedLinks.official && searchResult.place?.items?.[0]?.link) {
              updatedLinks.official = searchResult.place.items[0].link;
            }

            await pool.query(`
              UPDATE canonical_events
              SET external_links = $1::jsonb,
                  updated_at = NOW()
              WHERE id = $2
            `, [JSON.stringify(updatedLinks), event.id]);

            console.log(`  ✅ AI: ${extracted.external_links?.ticket ? 'ticket' : ''} ${extracted.external_links?.official ? 'official' : ''} ${extracted.external_links?.reservation ? 'reservation' : ''}`);
            aiSuccess++;
          } else {
            console.log(`  ⚠️  AI 추출 실패 (링크 없음)`);
            failed++;
          }

          await sleep(AI_CALL_INTERVAL_MS);
        } else {
          console.log(`  ⚠️  검색 결과 없음`);
          failed++;
        }

      } catch (error: any) {
        console.error(`  ❌ 에러: ${error.message}`);
        failed++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 수집 완료');
    console.log('='.repeat(80));
    console.log(`✅ KOPIS: ${kopisSuccess}개`);
    console.log(`✅ AI: ${aiSuccess}개`);
    console.log(`❌ 실패: ${failed}개`);
    console.log(`📈 전체: ${result.rows.length}개`);
    console.log('='.repeat(80) + '\n');

    await pool.end();
    console.log('✅ 작업 완료!');

  } catch (error) {
    console.error('❌ 에러 발생:', error);
    await pool.end();
    process.exit(1);
  }
}

backfillTicketLinks();

