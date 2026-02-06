/**
 * Phase 2: AI 제안 시스템 테스트
 * /admin/events/:id/enrich 엔드포인트가 제안을 생성하는지 확인
 */

import { pool } from '../db';
import axios from 'axios';

const API_BASE = 'http://localhost:5001';
const ADMIN_TOKEN = 'fairpick-admin-2024'; // Admin 토큰 (실제 환경에 맞게 수정)

async function testPhase2Suggestions() {
  console.log('🧪 Phase 2: AI 제안 시스템 테스트\n');

  // 1. 테스트할 이벤트 선택 (공연 카테고리)
  console.log('📋 Step 1: 테스트 이벤트 조회...');
  const eventResult = await pool.query(`
    SELECT id, title, main_category, overview, metadata
    FROM canonical_events
    WHERE main_category = '공연'
    AND (ai_suggestions IS NULL OR ai_suggestions = '{}'::jsonb)
    LIMIT 1;
  `);

  if (eventResult.rows.length === 0) {
    console.log('⚠️ 테스트할 이벤트가 없습니다. ai_suggestions가 있는 이벤트도 포함하여 재검색...');
    
    const altEventResult = await pool.query(`
      SELECT id, title, main_category, overview, metadata
      FROM canonical_events
      WHERE main_category = '공연'
      LIMIT 1;
    `);
    
    if (altEventResult.rows.length === 0) {
      console.error('❌ 테스트할 공연 이벤트가 없습니다.');
      await pool.end();
      process.exit(1);
    }
    
    const event = altEventResult.rows[0];
    console.log(`\n테스트 이벤트: ${event.title}`);
    console.log(`  ID: ${event.id}`);
    console.log(`  카테고리: ${event.main_category}`);
    console.log(`  기존 ai_suggestions: ${event.metadata?.ai_suggestions ? '있음' : '없음'}`);
    
    // 기존 제안 초기화
    await pool.query(`
      UPDATE canonical_events
      SET ai_suggestions = '{}'::jsonb
      WHERE id = $1;
    `, [event.id]);
    console.log('  ✅ 기존 제안 초기화 완료\n');
    
    await testEnrichEndpoint(event.id);
  } else {
    const event = eventResult.rows[0];
    console.log(`\n테스트 이벤트: ${event.title}`);
    console.log(`  ID: ${event.id}`);
    console.log(`  카테고리: ${event.main_category}\n`);
    
    await testEnrichEndpoint(event.id);
  }

  await pool.end();
}

async function testEnrichEndpoint(eventId: string) {
  console.log('📋 Step 2: /admin/events/:id/enrich 호출...');
  
  try {
    const response = await axios.post(
      `${API_BASE}/admin/events/${eventId}/enrich`,
      {
        forceFields: [], // 빈 필드만 채우기 모드
      },
      {
        headers: {
          'x-admin-key': ADMIN_TOKEN,
        },
        timeout: 60000, // 60초 타임아웃
      }
    );

    console.log('\n✅ API 호출 성공!');
    console.log(`  Message: ${response.data.message}`);
    
    const suggestions = response.data.suggestions;
    if (!suggestions) {
      console.error('❌ 응답에 suggestions가 없습니다.');
      console.log('Response:', JSON.stringify(response.data, null, 2));
      return;
    }

    console.log(`\n📊 생성된 제안: ${Object.keys(suggestions).length}개`);
    
    // 제안 상세 출력
    for (const [fieldName, suggestion] of Object.entries(suggestions)) {
      const s = suggestion as any;
      const conf = s.confidence;
      const emoji = conf >= 85 ? '🟢' : conf >= 70 ? '🟡' : conf >= 40 ? '🟠' : '🔴';
      
      console.log(`\n${fieldName}:`);
      console.log(`  신뢰도: ${conf}% ${emoji}`);
      console.log(`  출처: ${s.source} (${s.source_detail})`);
      
      if (s.warning) {
        console.log(`  ⚠️ 경고: ${s.warning}`);
      }
      
      // 값 미리보기
      let valuePreview = s.value;
      if (typeof valuePreview === 'string' && valuePreview.length > 100) {
        valuePreview = valuePreview.substring(0, 100) + '...';
      } else if (typeof valuePreview === 'object') {
        valuePreview = JSON.stringify(valuePreview, null, 2).substring(0, 200) + '...';
      }
      console.log(`  값: ${valuePreview}`);
    }

    // DB에 저장 확인
    console.log('\n📋 Step 3: DB 저장 확인...');
    const dbResult = await pool.query(`
      SELECT ai_suggestions
      FROM canonical_events
      WHERE id = $1;
    `, [eventId]);

    const savedSuggestions = dbResult.rows[0]?.ai_suggestions;
    if (!savedSuggestions || Object.keys(savedSuggestions).length === 0) {
      console.error('❌ DB에 제안이 저장되지 않았습니다.');
    } else {
      console.log(`✅ DB에 ${Object.keys(savedSuggestions).length}개 제안 저장됨`);
      
      // 신뢰도 통계
      const confidences = Object.values(savedSuggestions as any).map((s: any) => s.confidence);
      const avgConfidence = confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
      const highConf = confidences.filter(c => c >= 85).length;
      const mediumConf = confidences.filter(c => c >= 70 && c < 85).length;
      const lowConf = confidences.filter(c => c >= 40 && c < 70).length;
      const veryLowConf = confidences.filter(c => c < 40).length;
      
      console.log('\n📊 신뢰도 통계:');
      console.log(`  평균 신뢰도: ${avgConfidence.toFixed(1)}%`);
      console.log(`  🟢 High (85%+): ${highConf}개`);
      console.log(`  🟡 Medium (70-84%): ${mediumConf}개`);
      console.log(`  🟠 Low (40-69%): ${lowConf}개`);
      console.log(`  🔴 Very Low (<40%): ${veryLowConf}개`);
    }

    console.log('\n🎉 Phase 2 테스트 완료!');
    console.log('\n다음 단계: Admin UI에서 제안 표시 및 적용 버튼 구현 (Phase 3)');

  } catch (error: any) {
    if (error.response) {
      console.error('❌ API 오류:', error.response.status, error.response.statusText);
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('❌ 요청 실패 (서버 응답 없음)');
      console.error('Error:', error.message);
    } else {
      console.error('❌ 오류:', error.message);
    }
    throw error;
  }
}

testPhase2Suggestions().catch(error => {
  console.error('\n❌ 테스트 실패:', error);
  process.exit(1);
});

