/**
 * 제목 정규화 유틸리티
 * 
 * 중복 이벤트 감지를 위해 제목을 정규화합니다.
 * 
 * 정규화 규칙:
 * 1. HTML entity decode: &lt; → <, &gt; → >, &amp; → &
 * 2. 지역 prefix/suffix 제거: [부산], (서울) 등
 * 3. 소문자화 (영문)
 * 4. 다중 공백 → 단일 공백
 * 5. 특수문자 정리: 따옴표, 중점, 구분자 → 공백
 */

/**
 * HTML entity를 실제 문자로 변환
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

/**
 * 지역 prefix/suffix 제거
 * 예: [부산] 행쇼 → 행쇼
 * 예: 행쇼 [부산] → 행쇼
 * 예: (서울) 공연 → 공연
 */
function removeRegionPrefixSuffix(text: string): string {
  // 지역 목록 (정규식에 사용)
  const regions = [
    '서울', '경기', '인천', '부산', '대구', '대전', '광주', '울산', '세종',
    '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
    '서울시', '경기도', '인천시', '부산시', '대구시', '대전시', '광주시', '울산시', '세종시',
    '강원도', '충청북도', '충청남도', '전라북도', '전라남도', '경상북도', '경상남도', '제주도',
    '충북', '충남', '전북', '전남', '경북', '경남',
  ];

  let result = text;

  // [지역] prefix 제거: ^\[[^\]]+\]\s*
  result = result.replace(/^\[[^\]]+\]\s*/g, '');

  // [지역] suffix 제거: \s*\[[^\]]+\]$
  result = result.replace(/\s*\[[^\]]+\]$/g, '');

  // (지역) prefix 제거: ^\([^)]+\)\s*
  result = result.replace(/^\([^)]+\)\s*/g, '');

  // (지역) suffix 제거: \s*\([^)]+\)$
  result = result.replace(/\s*\([^)]+\)$/g, '');

  // 지역명 단독 prefix 제거: ^{지역}\s+ (공백 뒤에 내용이 있어야 함)
  for (const region of regions) {
    const prefixPattern = new RegExp(`^${region}\\s+`, 'i');
    result = result.replace(prefixPattern, '');
  }

  return result.trim();
}

/**
 * 장르 prefix 제거
 * 예: 뮤지컬 판 → 판
 * 예: 가족뮤지컬 넘버블록스 → 넘버블록스
 * 예: 연극 햄릿 → 햄릿
 */
function removeGenrePrefix(text: string): string {
  const genres = [
    '가족뮤지컬',
    '넌버벌뮤지컬',
    '창작뮤지컬',
    '뮤지컬',
    '넌버벌',
    '창작연극',
    '연극',
    '오페라',
    '무용',
    '콘서트',
    '공연',
    '전시',
    '축제',
    '행사',
    '페스티벌',
    'festival',
    'musical',
    'concert',
  ];

  let result = text;

  // 장르 prefix 제거 (공백 또는 문장 끝)
  for (const genre of genres) {
    const pattern = new RegExp(`^${genre}\\s+`, 'i');
    result = result.replace(pattern, '');
  }

  return result.trim();
}

/**
 * 특수문자 정리
 * 따옴표, 중점, 구분자 등을 공백으로 치환
 */
function normalizeSpecialChars(text: string): string {
  return text
    // 따옴표 종류 → 공백
    .replace(/['"'""`´]/g, ' ')
    // 중점, 구분자 → 공백
    .replace(/[·•|/\-–—:：]/g, ' ')
    // 꺾쇠괄호 → 공백 (HTML 태그 아닌 것)
    .replace(/[<>《》「」『』【】〈〉]/g, ' ')
    // 연속 공백 → 단일 공백
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 제목 정규화 함수 (메인)
 *
 * @param rawTitle 원본 제목
 * @param _region 지역 (현재 미사용, 향후 확장용)
 * @returns 정규화된 제목
 */
export function normalizeTitle(rawTitle: string | null | undefined, _region?: string): string {
  if (!rawTitle) return '';

  let result = rawTitle;

  // 1. HTML entity decode
  result = decodeHtmlEntities(result);

  // 2. 트림 및 다중 공백 정리
  result = result.trim().replace(/\s+/g, ' ');

  // 3. 지역 prefix/suffix 제거
  result = removeRegionPrefixSuffix(result);

  // 4. 장르 prefix 제거 (뮤지컬, 연극 등)
  result = removeGenrePrefix(result);

  // 5. 특수문자 정리
  result = normalizeSpecialChars(result);

  // 6. 소문자화 (영문)
  result = result.toLowerCase();

  // 7. 최종 트림
  result = result.trim();

  return result;
}

/**
 * 핵심 토큰 추출 (유사도 계산용)
 * 정규화된 제목에서 공백으로 분리한 토큰 Set
 */
export function extractTokens(normalizedTitle: string): Set<string> {
  if (!normalizedTitle) return new Set();

  return new Set(
    normalizedTitle
      .split(/\s+/)
      .filter(token => token.length > 0)
  );
}

/**
 * Jaccard 유사도 계산
 * 
 * @param setA 토큰 Set A
 * @param setB 토큰 Set B
 * @returns 유사도 (0~1)
 */
export function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  return intersection.size / union.size;
}

/**
 * 두 제목의 정규화 후 유사도 계산
 * 
 * @param titleA 제목 A
 * @param titleB 제목 B
 * @returns 유사도 (0~1)
 */
export function titleSimilarity(titleA: string | null | undefined, titleB: string | null | undefined): number {
  const normA = normalizeTitle(titleA);
  const normB = normalizeTitle(titleB);

  // 정규화 후 완전 일치
  if (normA === normB) return 1;

  // Jaccard 유사도
  const tokensA = extractTokens(normA);
  const tokensB = extractTokens(normB);

  return jaccardSimilarity(tokensA, tokensB);
}

/**
 * 두 제목이 "같은 이벤트"인지 판정
 * 
 * @param titleA 제목 A
 * @param titleB 제목 B
 * @param threshold 유사도 임계값 (기본 0.8)
 * @returns 같은 이벤트 여부
 */
export function isSameTitle(
  titleA: string | null | undefined,
  titleB: string | null | undefined,
  threshold = 0.8
): boolean {
  const similarity = titleSimilarity(titleA, titleB);
  return similarity >= threshold;
}

/**
 * placeholder 이미지 여부 확인
 */
export function isPlaceholderImage(imageUrl: string | null | undefined): boolean {
  if (!imageUrl) return true;
  
  const placeholderPatterns = [
    'placeholder',
    'default',
    'no-image',
    'noimage',
    'no_image',
  ];

  const lowerUrl = imageUrl.toLowerCase();
  return placeholderPatterns.some(pattern => lowerUrl.includes(pattern));
}


