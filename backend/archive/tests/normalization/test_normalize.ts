/**
 * normalizeTitle 로직 테스트
 */

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function removeRegionPrefixSuffix(text: string): string {
  let result = text;

  // [지역] prefix 제거
  result = result.replace(/^\[[^\]]+\]\s*/g, '');

  // [지역] suffix 제거
  result = result.replace(/\s*\[[^\]]+\]$/g, '');

  // (지역) prefix 제거
  result = result.replace(/^\([^)]+\)\s*/g, '');

  // (지역) suffix 제거
  result = result.replace(/\s*\([^)]+\)$/g, '');

  return result.trim();
}

function normalizeTitle(title: string | null): string {
  if (!title) return '';

  let result = title;

  // 1. HTML entity decode
  result = decodeHtmlEntities(result);

  // 2. 트림 및 다중 공백 정리
  result = result.trim().replace(/\s+/g, ' ');

  // 3. 지역 prefix/suffix 제거
  result = removeRegionPrefixSuffix(result);

  // 4. 소문자화 (영문)
  result = result.toLowerCase();

  // 5. 괄호 내용 제거 (소괄호, 대괄호 모두)
  result = result.replace(/\([^)]*\)/g, ''); // 소괄호
  result = result.replace(/\[[^\]]*\]/g, ''); // 대괄호

  // 6. 특수문자 제거 (한글, 영문, 숫자만 남김)
  result = result.replace(/[^\w가-힣]/g, '');

  return result.trim();
}

// 테스트 케이스
const testCases = [
  {
    title1: '판 [대학로]',
    title2: '[대학로] 뮤지컬 &lt;판&gt;',
    description: '판 이벤트',
  },
  {
    title1: '넘버블록스 [서울 (앵콜) ]',
    title2: '가족뮤지컬 &lt;넘버블록스&gt; - 앵콜',
    description: '넘버블록스 이벤트',
  },
  {
    title1: '크리스마스 판타지아 Christmas Fantasia [인천]',
    title2: '[수봉pick] 크리스마스 판타지아 Christmas Fantasia',
    description: '크리스마스 판타지아',
  },
];

console.log('=== normalizeTitle 테스트 ===\n');

for (const testCase of testCases) {
  const norm1 = normalizeTitle(testCase.title1);
  const norm2 = normalizeTitle(testCase.title2);
  const isMatch = norm1 === norm2;

  console.log(`[${testCase.description}]`);
  console.log(`  원본1: ${testCase.title1}`);
  console.log(`  원본2: ${testCase.title2}`);
  console.log(`  정규화1: ${norm1}`);
  console.log(`  정규화2: ${norm2}`);
  console.log(`  일치: ${isMatch ? '✅' : '❌'}`);
  console.log('');
}
