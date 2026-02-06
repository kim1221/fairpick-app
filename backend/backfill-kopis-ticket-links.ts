/**
 * KOPIS 이벤트에 티켓 링크 자동 추가 (backfill)
 * 
 * raw_kopis_events의 source_event_id(mt20id)를 기반으로
 * canonical_events의 external_links에 티켓 링크를 자동 생성하여 추가합니다.
 */

import { pool } from './src/db';

interface CanonicalEventRow {
  id: string;
  title: string;
  sources: any;
  external_links: any;
}

interface KopisSourceInfo {
  mt20id: string;
  source_url: string;
}

async function backfillKopisTicketLinks() {
  console.log('\n' + '='.repeat(80));
  console.log('🎫 KOPIS 티켓 링크 자동 추가 (Backfill)');
  console.log('='.repeat(80) + '\n');

  try {
    // 1. KOPIS 소스가 있는 canonical_events 조회
    // - ticket 링크가 없거나
    // - ticket 링크가 /ticket/ 경로를 사용하는 경우 (작동 안 함)
    const result = await pool.query<CanonicalEventRow>(`
      SELECT id, title, sources, external_links
      FROM canonical_events
      WHERE sources::text LIKE '%kopis%'
        AND (
          external_links IS NULL 
          OR NOT (external_links ? 'ticket')
          OR external_links->>'ticket' IS NULL
          OR external_links->>'ticket' LIKE '%/ticket/%'
        )
    `);

    console.log(`📊 KOPIS 이벤트 (티켓 링크 없음): ${result.rows.length}개\n`);

    if (result.rows.length === 0) {
      console.log('✅ 모든 KOPIS 이벤트에 이미 티켓 링크가 있습니다.');
      await pool.end();
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const event of result.rows) {
      try {
        // sources에서 KOPIS mt20id 추출
        const sources = event.sources || [];
        const kopisSource = sources.find((s: any) => s.source === 'kopis');

        if (!kopisSource || !kopisSource.sourceEventId) {
          console.log(`⚠️  [${event.title}] KOPIS mt20id 없음`);
          failCount++;
          continue;
        }

        const mt20id = kopisSource.sourceEventId;
        const kopisDetailPage = `https://www.kopis.or.kr/por/db/pblprfr/pblprfrView.do?menuId=MNU_00028&mt20Id=${mt20id}`;

        // external_links 업데이트
        const currentLinks = event.external_links || {};
        const updatedLinks = {
          ...currentLinks,
          // ticket: KOPIS 상세 페이지 (사용자가 예매처 선택 가능)
          ticket: kopisDetailPage,
          // official: 기존 값이 없으면 KOPIS 상세 페이지
          official: currentLinks.official || kopisDetailPage,
        };

        await pool.query(`
          UPDATE canonical_events
          SET external_links = $1::jsonb,
              updated_at = NOW()
          WHERE id = $2
        `, [JSON.stringify(updatedLinks), event.id]);

        console.log(`✅ [${event.title.slice(0, 40)}...] 티켓 링크 추가 (mt20id: ${mt20id})`);
        successCount++;

      } catch (error: any) {
        console.error(`❌ [${event.title}] 에러:`, error.message);
        failCount++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 Backfill 완료');
    console.log('='.repeat(80));
    console.log(`✅ 성공: ${successCount}개`);
    console.log(`❌ 실패: ${failCount}개`);
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

backfillKopisTicketLinks();

