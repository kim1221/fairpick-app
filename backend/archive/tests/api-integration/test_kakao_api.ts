import http from '../../../src/lib/http';
import { config } from '../../../src/config';

async function testKakaoApi() {
  console.log('[Test] KAKAO_REST_API_KEY exists:', !!config.kakaoRestApiKey);
  console.log('[Test] Key length:', config.kakaoRestApiKey?.length || 0);
  console.log('[Test] Key prefix:', config.kakaoRestApiKey?.substring(0, 10) + '...');
  
  if (!config.kakaoRestApiKey) {
    console.error('[Test] KAKAO_REST_API_KEY is not set!');
    return;
  }

  console.log('\n=== Test 1: Address Search (주소 검색) ===');
  console.log('[Test] URL: https://dapi.kakao.com/v2/local/search/address.json');
  console.log('[Test] Query: 서울특별시 종로구 세종대로 175');
  console.log('[Test] Authorization: KakaoAK ' + config.kakaoRestApiKey.substring(0, 10) + '...');
  
  try {
    const response = await http.get<any>(
      'https://dapi.kakao.com/v2/local/search/address.json',
      {
        params: { query: '서울특별시 종로구 세종대로 175' },
        headers: { Authorization: `KakaoAK ${config.kakaoRestApiKey}` },
      }
    );
    console.log('[Test] Address search SUCCESS ✅');
    console.log('[Test] Documents found:', response?.documents?.length || 0);
    if (response?.documents?.[0]) {
      console.log('[Test] First result:', {
        address_name: response.documents[0].address_name,
        x: response.documents[0].x,
        y: response.documents[0].y,
      });
    }
  } catch (error: any) {
    console.error('[Test] Address search FAILED ❌');
    console.error('[Test] Error:', error.message);
    console.error('[Test] Status:', error.status);
    console.error('[Test] Response:', typeof error.response === 'string' ? error.response.substring(0, 300) : error.response);
  }

  console.log('\n=== Test 2: Keyword Search (키워드 검색) ===');
  console.log('[Test] URL: https://dapi.kakao.com/v2/local/search/keyword.json');
  console.log('[Test] Query: 광화문');
  
  try {
    const response = await http.get<any>(
      'https://dapi.kakao.com/v2/local/search/keyword.json',
      {
        params: {
          query: '광화문',
          size: 1,
        },
        headers: {
          Authorization: `KakaoAK ${config.kakaoRestApiKey}`,
        },
      }
    );
    console.log('[Test] Keyword search SUCCESS ✅');
    console.log('[Test] Documents found:', response?.documents?.length || 0);
    if (response?.documents?.[0]) {
      console.log('[Test] First result:', {
        place_name: response.documents[0].place_name,
        address_name: response.documents[0].address_name,
        x: response.documents[0].x,
        y: response.documents[0].y,
      });
    }
  } catch (error: any) {
    console.error('[Test] Keyword search FAILED ❌');
    console.error('[Test] Error:', error.message);
    console.error('[Test] Status:', error.status);
    console.error('[Test] Response:', typeof error.response === 'string' ? error.response.substring(0, 300) : error.response);
  }
}

testKakaoApi().then(() => {
  console.log('\n[Test] ✅ All tests completed');
  process.exit(0);
}).catch((error) => {
  console.error('\n[Test] ❌ Fatal error:', error);
  process.exit(1);
});




