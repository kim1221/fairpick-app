/**
 * Gemini API 간단 테스트 (google_search 없이)
 */

import * as dotenv from 'dotenv';
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY not found in .env');
  process.exit(1);
}

console.log(`✅ API Key 확인: ${GEMINI_API_KEY.substring(0, 10)}...\n`);

async function testGemini() {
  console.log('[Test] Gemini API 테스트 시작...\n');
  
  // 1. google_search 없이 간단한 질문
  console.log('1️⃣  google_search 없이 테스트...');
  try {
    const response1 = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{ text: '안녕하세요. 간단히 "Hello!"라고만 답해주세요.' }]
          }],
          generationConfig: {
            temperature: 0.2,
          }
        })
      }
    );
    
    if (!response1.ok) {
      const errorData = await response1.json();
      console.error('❌ 에러:', JSON.stringify(errorData, null, 2));
    } else {
      const data1 = await response1.json();
      const text1 = data1.candidates?.[0]?.content?.parts?.[0]?.text;
      console.log(`✅ 응답: "${text1}"\n`);
    }
  } catch (error: any) {
    console.error('❌ 에러:', error.message);
  }
  
  // 2. google_search 사용
  console.log('2️⃣  google_search 포함 테스트...');
  try {
    const response2 = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{ text: '서울 성수동 팝업스토어 3개만 알려주세요. (실제 현재 진행중인 것)' }]
          }],
          tools: [{
            google_search: {}
          }],
          generationConfig: {
            temperature: 0.2,
          }
        })
      }
    );
    
    if (!response2.ok) {
      const errorData = await response2.json();
      console.error('❌ 에러:', JSON.stringify(errorData, null, 2));
    } else {
      const data2 = await response2.json();
      console.log('✅ 응답 받음:', JSON.stringify(data2, null, 2).substring(0, 500) + '...');
    }
  } catch (error: any) {
    console.error('❌ 에러:', error.message);
  }
  
  console.log('\n[Test] 완료!');
}

testGemini();

