/**
 * KOPIS 상세 API 응답 구조 확인
 * relateurl 필드가 있는지 확인
 */

import { parseStringPromise } from 'xml2js';
import http from '../../../src/lib/http';

const KOPIS_API_BASE = 'http://www.kopis.or.kr/openApi/restful';
const KOPIS_SERVICE_KEY = 'bbef54b0049c4570b7b1f46f52b6dd8f';

async function testKopisDetailAPI() {
  console.log('\n🔍 KOPIS 상세 API 응답 구조 확인\n');

  // 테스트할 mt20id (데스노트)
  const testMt20id = 'PF273019';

  try {
    console.log(`📡 KOPIS API 호출 중... (mt20id: ${testMt20id})`);
    const response = await http.get<string>(`${KOPIS_API_BASE}/pblprfr/${testMt20id}`, {
      params: {
        service: KOPIS_SERVICE_KEY,
      },
    });

    console.log('\n✅ API 호출 성공!\n');

    const parsed = await parseStringPromise(response);
    const db = parsed?.dbs?.db?.[0];

    if (!db) {
      console.log('❌ 응답 데이터가 없습니다.');
      process.exit(1);
    }

    console.log('📋 응답 필드 목록:');
    console.log('='.repeat(80));
    
    const fields = Object.keys(db).sort();
    fields.forEach(field => {
      const value = db[field]?.[0];
      const displayValue = typeof value === 'string' && value.length > 100 
        ? value.substring(0, 100) + '...' 
        : value;
      console.log(`  ${field}: ${displayValue}`);
    });

    console.log('\n' + '='.repeat(80));
    console.log('\n🎯 relateurl 필드 확인:');
    
    if (db.relates && db.relates[0] && db.relates[0].relate) {
      console.log('  ✅ relates 필드 발견!');
      console.log('\n  📝 relates 구조:');
      const relates = Array.isArray(db.relates[0].relate) ? db.relates[0].relate : [db.relates[0].relate];
      relates.forEach((relate: any, idx: number) => {
        console.log(`\n  [${idx + 1}]`);
        console.log(`     relatenm: ${relate.relatenm?.[0] || 'N/A'}`);
        console.log(`     relateurl: ${relate.relateurl?.[0] || 'N/A'}`);
      });
    } else {
      console.log('  ❌ relates 필드가 없습니다.');
    }

    if (db.styurls && db.styurls[0] && db.styurls[0].styurl) {
      console.log('\n  ✅ styurls 필드 발견!');
      const styurls = Array.isArray(db.styurls[0].styurl) ? db.styurls[0].styurl : [db.styurls[0].styurl];
      console.log(`     개수: ${styurls.length}개`);
      styurls.forEach((url: string, idx: number) => {
        console.log(`     [${idx + 1}] ${url}`);
      });
    }
    
    // 기타 홈페이지 관련 필드 확인
    const homepageFields = ['homepage', 'entrpsnm', 'entrpsnmH', 'entrpsnmP'];
    console.log('\n  📝 기타 필드:');
    homepageFields.forEach(field => {
      if (db[field] && db[field][0]) {
        console.log(`     ${field}: ${db[field][0]}`);
      }
    });

    console.log('\n✅ 테스트 완료!');

  } catch (error: any) {
    console.error('❌ 에러 발생:', error.message);
    process.exit(1);
  }
}

testKopisDetailAPI();

