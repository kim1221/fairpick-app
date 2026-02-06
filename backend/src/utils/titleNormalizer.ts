import { createHash } from 'crypto';

/**
 * HTML entity를 실제 문자로 변환
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return '';

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
 * 지역 목록 (한국 시/도)
 */
const REGIONS = [
  '서울', '경기', '인천', '부산', '대구', '대전', '광주', '울산', '세종',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
  '서울시', '경기도', '인천시', '부산시', '대구시', '대전시', '광주시', '울산시', '세종시',
  '강원도', '충청북도', '충청남도', '전라북도', '전라남도', '경상북도', '경상남도', '제주도',
  '대학로', '홍대', '강남', '신촌', '명동', '이태원', '성수', '압구정', '여의도',
];

/**
 * 장르 목록
 */
const GENRES = [
  '가족뮤지컬', '넌버벌뮤지컬', '창작뮤지컬', '뮤지컬',
  '넌버벌', '창작연극', '연극', '오페라', '무용', '콘서트',
  '공연', '전시', '축제', '행사', '페스티벌',
  '펫프렌들리연극', '펫프렌들리',
  'festival', 'musical', 'concert', 'opera',
];

/**
 * displayTitle 생성 (사용자에게 보여줄 제목)
 *
 * 규칙:
 * 1. HTML entity decode
 * 2. 괄호 안 핵심 제목 추출 (<팬레터>, 《팬레터》 등)
 * 3. 지역/장소 prefix/suffix 제거 ([서울], (대학로) 등)
 * 4. 장르 prefix 제거 (뮤지컬, 연극 등)
 * 5. 불필요한 공백/특수문자 정리
 */
export function generateDisplayTitle(rawTitle: string | null | undefined): string {
  if (!rawTitle) return '';

  let result = rawTitle;

  // 1. HTML entity decode
  result = decodeHtmlEntities(result);

  // 2. 괄호 안 핵심 제목 추출 시도
  // <...>, 《...》, 「...」, 『...』 형태에서 내부 텍스트 추출
  const angleBracketMatch = result.match(/<([^>]+)>/);
  const doubleAngleBracketMatch = result.match(/《([^》]+)》/);
  const cornerBracketMatch = result.match(/「([^」]+)」/);
  const doubleCornerBracketMatch = result.match(/『([^』]+)』/);

  const extractedTitle =
    angleBracketMatch?.[1] ||
    doubleAngleBracketMatch?.[1] ||
    cornerBracketMatch?.[1] ||
    doubleCornerBracketMatch?.[1];

  if (extractedTitle && extractedTitle.length >= 2) {
    // 추출된 제목이 유효하면 사용
    result = extractedTitle;
  } else {
    // 추출 실패 시 원본에서 정리
    // 괄호 자체만 제거
    result = result.replace(/<[^>]*>/g, '');
    result = result.replace(/《[^》]*》/g, '');
    result = result.replace(/「[^」]*」/g, '');
    result = result.replace(/『[^』]*』/g, '');
  }

  // 3. 지역 prefix/suffix 제거
  // [지역] prefix
  result = result.replace(/^\[[^\]]+\]\s*/g, '');
  // [지역] suffix
  result = result.replace(/\s*\[[^\]]+\]$/g, '');
  // (지역) prefix
  result = result.replace(/^\([^)]+\)\s*/g, '');
  // (지역) suffix
  result = result.replace(/\s*\([^)]+\)$/g, '');

  // 지역명 단독 prefix 제거 (공백 뒤에 내용이 있어야 함)
  for (const region of REGIONS) {
    const prefixPattern = new RegExp(`^${region}\\s+`, 'i');
    result = result.replace(prefixPattern, '');
  }

  // 4. 장르 prefix 제거
  for (const genre of GENRES) {
    const pattern = new RegExp(`^${genre}\\s+`, 'i');
    result = result.replace(pattern, '');
  }

  // 5. 특수문자 정리
  // 따옴표, 중점, 구분자 등을 공백으로
  result = result
    .replace(/['"""'`´]/g, ' ')
    .replace(/[·•|/\-–—:：]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 최종 결과가 너무 짧거나 빈 문자열이면 원본 사용
  if (result.length < 2) {
    return decodeHtmlEntities(rawTitle).trim();
  }

  return result;
}

/**
 * content_key 생성용 정규화
 * (중복 감지용, displayTitle보다 더 공격적으로 정규화)
 */
export function normalizeForContentKey(displayTitle: string): string {
  if (!displayTitle) return '';

  let result = displayTitle;

  // 1. 소문자화
  result = result.toLowerCase();

  // 2. 모든 공백/특수문자 제거
  result = result.replace(/[^a-z0-9가-힣]/g, '');

  return result.trim();
}

/**
 * venue 정규화 (content_key용)
 */
export function normalizeVenueForContentKey(venue: string | null | undefined): string {
  if (!venue) return '';

  let result = decodeHtmlEntities(venue).toLowerCase();

  // "(구. ...)" 패턴 제거 (구 명칭은 노이즈로 처리)
  result = result.replace(/\(구\.[^)]+\)/g, '');
  result = result.replace(/\[구\.[^\]]+\]/g, '');

  // 괄호는 제거하되, 내부 텍스트는 유지
  result = result.replace(/\(([^)]*)\)/g, '$1');
  result = result.replace(/\[([^\]]*)\]/g, '$1');

  // "구." 텍스트 제거
  result = result.replace(/구\./g, '');

  // 지역/장소 접두어 제거
  for (const region of REGIONS) {
    const pattern = new RegExp(region, 'gi');
    result = result.replace(pattern, '');
  }

  const venueStopWords = [
    '아트센터',
    '아트홀',
    '아트하우스',
    '문화회관',
    '예술회관',
    '예술의전당',
    '전당',
    '극장',
    '홀',
    '센터',
    '씨어터',
    '시어터',
    '공연장',
    '스튜디오',
    '갤러리',
    'kt&g',
    'kt',
    '링크',
  ];

  for (const word of venueStopWords) {
    const pattern = new RegExp(word, 'gi');
    result = result.replace(pattern, '');
  }

  // 구분자/특수문자 제거
  result = result.replace(/[·•|/\-–—:：]/g, ' ');

  // 층/관/호수 등 숫자 토큰 제거
  result = result.replace(/\d+(관|층|호|관람)/g, '');

  // 공백 제거
  result = result.replace(/\s+/g, '');

  // 전체 문자열 반복 제거 (A+A 패턴)
  if (result.length >= 2 && result.length % 2 === 0) {
    const half = result.length / 2;
    const first = result.slice(0, half);
    const second = result.slice(half);
    if (first === second) {
      result = first;
    }
  }

  // 티켓링크 1975 씨어터 계열은 동일 장소로 정규화
  if (result.includes('티켓1975')) {
    return '티켓1975';
  }

  return result.trim();
}

/**
 * content_key 생성
 * MD5(normalized_title + start_date + end_date + normalized_venue + region + main_category)
 */
export function generateContentKey(
  title: string | null | undefined,
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  venue: string | null | undefined,
  region: string | null | undefined,
  mainCategory: string | null | undefined,
): string {
  const displayTitle = generateDisplayTitle(title);
  const normalizedTitle = normalizeForContentKey(displayTitle);
  const normalizedVenue = normalizeVenueForContentKey(venue);

  const key = [
    normalizedTitle,
    startDate || '',
    endDate || '',
    normalizedVenue,
    (region || '').toLowerCase(),
    (mainCategory || '').toLowerCase(),
  ].join('||');

  return createHash('md5').update(key).digest('hex');
}
