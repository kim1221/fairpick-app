/**
 * KOPIS 이벤트에 예매처 링크(relates) 추가 (Backfill)
 * 
 * KOPIS 상세 API를 호출하여 relates 정보를 가져와서
 * canonical_events의 external_links에 실제 예매처 링크를 추가합니다.
 */

import { pool } from './src/db';
import { parseStringPromise } from 'xml2js';
import http from './src/lib/http';

const KOPIS_API_BASE = 'http://www.kopis.or.kr/openApi/restful';
const KOPIS_SERVICE_KEY = 'bbef54b0049c4570b7b1f46f52b6dd8f';

interface Relate {
  relatenm: string;
  relateurl: string;
}

interface CanonicalEventRow {
  id: string;
  title: string;
  sources: any;
  external_links: any;
  end_at: Date;
}

async function fetchKopisRelates(mt20id: string): Promise<Relate[]> {
  try {
    const response = await http.get<string>(`${KOPIS_API_BASE}/pblprfr/${mt20id}`, {
      params: {
        service: KOPIS_SERVICE_KEY,
      },
    });

    const parsed = await parseStringPromise(response);
    const db = parsed?.dbs?.db?.[0];

    if (!db || !db.relates || !db.relates[0] || !db.relates[0].relate) {
      return [];
    }

    const relateList = Array.isArray(db.relates[0].relate) ? db.relates[0].relate : [db.relates[0].relate];
    return relateList.map((relate: any) => ({
      relatenm: relate.relatenm?.[0] || '',
      relateurl: relate.relateurl?.[0] || '',
    })).filter((r: any) => r.relatenm && r.relateurl);

  } catch (error: any) {
    console.error(`  ⚠️  API 호출 실패 (${mt20id}): ${error.message}`);
    return [];
  }
}

async function backfillKopisRelates(limitCount?: number) {
  console.log('\n' + '='.repeat(80));
  console.log('🎫 KOPIS 예매처 링크 (relates) Backfill');
  console.log('='.repeat(80) + '\n');

  const limit = limitCount || null;

  try {
    // KOPIS 소스가 있는 진행 중/진행 예정 이벤트만 조회
    // (종료된 이벤트는 예매 불가능하므로 제외)
    const query = `
      SELECT id, title, sources, external_links, end_at
      FROM canonical_events
      WHERE sources::text LIKE '%kopis%'
        AND end_at >= CURRENT_DATE
      ORDER BY end_at ASC
      ${limit ? `LIMIT ${limit}` : ''}
    `;

    const result = await pool.query<CanonicalEventRow>(query);

    console.log(`📊 대상 이벤트: ${result.rows.length}개\n`);

    if (result.rows.length === 0) {
      console.log('✅ 모든 KOPIS 이벤트에 이미 예매처 링크가 있습니다.');
      await pool.end();
      return;
    }

    let successCount = 0;
    let noRelatesCount = 0;
    let failCount = 0;

    for (let i = 0; i < result.rows.length; i++) {
      const event = result.rows[i];
      
      console.log(`\n[${i + 1}/${result.rows.length}] ${event.title.slice(0, 50)}...`);

      try {
        // sources에서 KOPIS mt20id 추출
        const sources = event.sources || [];
        const kopisSource = sources.find((s: any) => s.source === 'kopis');

        if (!kopisSource || !kopisSource.sourceEventId) {
          console.log(`  ⚠️  KOPIS mt20id 없음`);
          failCount++;
          continue;
        }

        const mt20id = kopisSource.sourceEventId;
        console.log(`  📡 KOPIS API 호출 중... (mt20id: ${mt20id})`);

        // KOPIS 상세 API 호출
        const relates = await fetchKopisRelates(mt20id);

        if (relates.length === 0) {
          console.log(`  ⚠️  예매처 링크 없음 (상세 페이지 유지)`);
          noRelatesCount++;
          continue;
        }

        console.log(`  ✅ 예매처 ${relates.length}개 발견:`);
        relates.forEach((r, idx) => {
          console.log(`     [${idx + 1}] ${r.relatenm}: ${r.relateurl.substring(0, 60)}...`);
        });

        // external_links 업데이트
        const currentLinks = event.external_links || {};
        const kopisDetailPage = `https://www.kopis.or.kr/por/db/pblprfr/pblprfrView.do?menuId=MNU_00028&mt20Id=${mt20id}`;

        // ticket: 첫 번째 예매처 링크 (티켓 구매용)
        const ticketLink = relates[0].relateurl;

        // official: KOPIS 상세 페이지 (공식 홈페이지 대신)
        const officialLink = kopisDetailPage;

        const updatedLinks = {
          ...currentLinks,
          ticket: ticketLink,
          official: officialLink,
        };

        await pool.query(`
          UPDATE canonical_events
          SET external_links = $1::jsonb,
              updated_at = NOW()
          WHERE id = $2
        `, [JSON.stringify(updatedLinks), event.id]);

        console.log(`  💾 업데이트 완료`);
        console.log(`     ticket: ${relates[0].relatenm}`);
        console.log(`     official: KOPIS 상세 페이지`);
        successCount++;

        // API 요청 간격 (rate limit 방지)
        if (i < result.rows.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }

      } catch (error: any) {
        console.error(`  ❌ 에러: ${error.message}`);
        failCount++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 Backfill 완료');
    console.log('='.repeat(80));
    console.log(`✅ 성공: ${successCount}개`);
    console.log(`⚠️  예매처 없음: ${noRelatesCount}개`);
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

// 명령행 인수로 limit 지정 가능
const limitArg = process.argv[2];
const limit = limitArg ? parseInt(limitArg, 10) : undefined;

if (limit && limit > 0) {
  console.log(`⚠️  제한 모드: 최대 ${limit}개 처리`);
}

backfillKopisRelates(limit);

