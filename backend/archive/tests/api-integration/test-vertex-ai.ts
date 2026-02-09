/**
 * Vertex AI 연결 테스트
 * 기존 코드를 건드리지 않고 Vertex AI 동작 확인
 */

import { VertexAI } from '@google-cloud/vertexai';

// .env에서 로드
import 'dotenv/config';

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0826736373';
const LOCATION = 'us-central1'; // Gemini 기본 리전
const MODEL = 'gemini-2.5-flash';

async function testVertexAI() {
  console.log('\n🧪 Vertex AI 연결 테스트\n');
  console.log('📍 설정:');
  console.log(`   - 프로젝트: ${PROJECT_ID}`);
  console.log(`   - 리전: ${LOCATION}`);
  console.log(`   - 모델: ${MODEL}`);
  console.log('');

  try {
    // Vertex AI 초기화
    const vertexAI = new VertexAI({
      project: PROJECT_ID,
      location: LOCATION,
    });

    // 모델 가져오기
    const generativeModel = vertexAI.getGenerativeModel({
      model: MODEL,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024,
      },
    });

    console.log('✅ Vertex AI 초기화 성공!');
    console.log('');
    console.log('🤖 간단한 테스트 실행 중...');

    // 간단한 테스트
    const prompt = 'Hello! Please respond with a simple greeting in Korean.';
    const result = await generativeModel.generateContent(prompt);
    const response = result.response;
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';

    console.log('');
    console.log('📝 응답:');
    console.log(`   ${text}`);
    console.log('');
    console.log('✅ 테스트 성공! Vertex AI가 정상 동작합니다.');
    console.log('');
    console.log('💡 다음 단계: aiExtractor.ts를 Vertex AI로 전환합니다.');
    console.log('');

    return true;
  } catch (error: any) {
    console.error('');
    console.error('❌ 에러 발생:');
    console.error('');

    if (error.message?.includes('Could not load the default credentials')) {
      console.error('🔐 인증 문제: Google Cloud 인증이 필요합니다.');
      console.error('');
      console.error('해결 방법:');
      console.error('1. Google Cloud Console → IAM → 서비스 계정');
      console.error('2. 서비스 계정 생성 (Vertex AI 사용자 권한)');
      console.error('3. 키 생성 (JSON 파일)');
      console.error('4. .env 파일에 추가:');
      console.error('   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json');
      console.error('   GOOGLE_CLOUD_PROJECT=' + PROJECT_ID);
      console.error('');
    } else if (error.message?.includes('API has not been used in project')) {
      console.error('📡 API 활성화 필요:');
      console.error('');
      console.error('https://console.cloud.google.com/apis/library/aiplatform.googleapis.com?project=' + PROJECT_ID);
      console.error('');
      console.error('위 링크에서 Vertex AI API를 활성화해주세요.');
      console.error('');
    } else {
      console.error(error.message);
      console.error('');
      console.error('전체 에러:', error);
    }

    return false;
  }
}

testVertexAI();


