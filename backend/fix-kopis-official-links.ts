/**
 * KOPIS 이벤트의 official 링크를 KOPIS 상세 페이지로 수정
 * (현재 ticket과 official이 같은 예매처 링크인 문제 해결)
 */

import { pool } from './src/db';

async function fixKopisOfficialLinks() {
  console.log('\n' + '='.repeat(80));
  console.log('🔧 KOPIS Official 링크 수정');
  console.log('='.repeat(80) + '\n');

  try {
    // official이 KOPIS 상세 페이지가 아닌 모든 KOPIS 이벤트 조회
    const result = await pool.query(`
      SELECT id, title, sources, external_links
      FROM canonical_events
      WHERE sources::text LIKE '%kopis%'
        AND (
          external_links->>'official' NOT LIKE '%pblprfrView%'
          OR external_links->>'official' IS NULL
        )
    `);

    console.log(`📊 수정 대상: ${result.rows.length}개\n`);

    if (result.rows.length === 0) {
      console.log('✅ 수정할 이벤트가 없습니다.');
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
          console.log(`⚠️  [${event.title}] mt20id 없음`);
          failCount++;
          continue;
        }

        const mt20id = kopisSource.sourceEventId;
        const kopisDetailPage = `https://www.kopis.or.kr/por/db/pblprfr/pblprfrView.do?menuId=MNU_00028&mt20Id=${mt20id}`;

        // official을 KOPIS 상세 페이지로 변경
        const currentLinks = event.external_links || {};
        const updatedLinks = {
          ...currentLinks,
          official: kopisDetailPage,
        };

        await pool.query(`
          UPDATE canonical_events
          SET external_links = $1::jsonb,
              updated_at = NOW()
          WHERE id = $2
        `, [JSON.stringify(updatedLinks), event.id]);

        console.log(`✅ [${event.title.slice(0, 50)}...]`);
        successCount++;

      } catch (error: any) {
        console.error(`❌ [${event.title}] 에러: ${error.message}`);
        failCount++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 수정 완료');
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

fixKopisOfficialLinks();

