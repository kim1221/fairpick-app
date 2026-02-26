/**
 * Price Core Utils
 * 
 * 가격 Core 필드(is_free, price_info) 처리를 위한 표준 유틸리티
 * 
 * 핵심 원칙:
 * 1. is_free: 공식 API에서 "무료"가 명확한 경우만 true
 * 2. price_info: 사용자 노출 가능한 가격 텍스트만 저장
 * 3. 불확실하면 false/NULL (보수적 접근)
 */

import he from 'he';

// ============================================
// 설정
// ============================================

const CONFIG = {
  MIN_LENGTH: 1,
  MAX_LENGTH: 400,
  // 가격과 무관한 메타 키워드
  META_KEYWORDS: [
    '문의',
    '홈페이지',
    'URL',
    '링크',
    '웹사이트',
    '주소',
    '바로가기',
  ] as const,
  // 무료 판정 키워드
  FREE_KEYWORDS: [
    '무료',
    '0원',
    'free',
    '무료입장',
    '입장무료',
    '관람무료',
  ] as const,
};

// ============================================
// 1. normalizePriceText: 가격 텍스트 정제
// ============================================

/**
 * HTML 태그 제거
 */
function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, '');
}

/**
 * HTML entity 디코딩
 * 예: &quot; → ", &amp; → &, &#39; → '
 */
function decodeHtmlEntities(text: string): string {
  try {
    return he.decode(text);
  } catch {
    return text;
  }
}

/**
 * 줄바꿈/공백 정리
 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')      // CRLF → LF
    .replace(/\r/g, '\n')         // CR → LF
    .replace(/\n{3,}/g, '\n\n')   // 3개 이상 줄바꿈 → 2개
    .replace(/[ \t]+/g, ' ')      // 연속 공백 → 1개
    .trim();
}

/**
 * 가격과 무관한 라인 제거
 * 예: "문의: 02-123-4567", "홈페이지: http://..." 같은 라인
 */
function removeMetaLines(text: string): string {
  const lines = text.split('\n');
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    
    // 메타 키워드로 시작하는 라인 제거
    for (const keyword of CONFIG.META_KEYWORDS) {
      if (trimmed.startsWith(keyword + ':') || trimmed.startsWith(keyword + ' :')) {
        return false;
      }
    }
    
    // URL만 있는 라인 제거
    if (/^https?:\/\//.test(trimmed)) {
      return false;
    }
    
    // 전화번호만 있는 라인 제거
    if (/^[\d\-()]+$/.test(trimmed)) {
      return false;
    }
    
    return true;
  });
  
  return filtered.join('\n').trim();
}

/**
 * 가격 텍스트 정제 (공개 API)
 * 
 * @param raw 원천 API에서 받은 가격 필드 값
 * @returns 정제된 텍스트 (1~400자) 또는 NULL
 */
export function normalizePriceText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  
  let cleaned = raw;
  
  // 1. HTML 태그 제거
  cleaned = stripHtmlTags(cleaned);
  
  // 2. HTML entity 디코딩
  cleaned = decodeHtmlEntities(cleaned);
  
  // 3. 공백/줄바꿈 정리
  cleaned = normalizeWhitespace(cleaned);
  
  // 4. 메타 라인 제거
  cleaned = removeMetaLines(cleaned);
  
  // 5. 최종 trim
  cleaned = cleaned.trim();
  
  // 6. 길이 검증
  if (cleaned.length < CONFIG.MIN_LENGTH) {
    return null;
  }
  
  if (cleaned.length > CONFIG.MAX_LENGTH) {
    cleaned = cleaned.slice(0, CONFIG.MAX_LENGTH);
  }
  
  return cleaned;
}

// ============================================
// 2. deriveIsFree: 무료 여부 판정
// ============================================

/**
 * 가격 텍스트로부터 무료 여부 판정 (공개 API)
 *
 * @param priceText 정제된 가격 텍스트 (normalizePriceText 결과)
 * @returns true = 명확히 무료, false = 유료이거나 불확실
 */
export function deriveIsFree(priceText: string | null | undefined): boolean {
  if (!priceText) return false;

  const normalized = priceText.toLowerCase().trim();

  // 숫자가 포함되어 있으면 상세 체크
  if (/\d/.test(normalized)) {
    // "0원": lookaround로 앞뒤 숫자 없는 경우만 매칭 (\b는 한글 경계 미지원)
    // "10,000원" 내 "0원" 오매칭 방지
    if (/(?<!\d)0원(?!\d)/.test(normalized)) {
      return true;
    }
    // 다른 숫자가 있으면 유료로 판정 (10,000원, 5000원 등)
    if (/\d{1,}[,\d]*원/.test(normalized)) {
      return false;
    }
  }

  // 명확한 무료 키워드 확인 ("무료", "free" 등)
  for (const keyword of CONFIG.FREE_KEYWORDS) {
    const lowerKeyword = keyword.toLowerCase();
    // "0원"은 이미 위에서 처리했으므로 제외
    if (lowerKeyword === '0원') continue;

    if (normalized.includes(lowerKeyword)) {
      return true;
    }
  }

  return false;
}

// ============================================
// 3. 소스별 원천 필드 추출
// ============================================

/**
 * KOPIS payload에서 가격 정보 추출
 * 
 * 원천 필드: pcseguidance (티켓가격 안내)
 * 예: "전석 30,000원", "R석 150,000원, S석 120,000원"
 */
export function extractKopisPrice(payload: any): string | null {
  return normalizePriceText(payload?.pcseguidance);
}

/**
 * Culture payload에서 가격 정보 추출
 * 
 * 원천 필드: price (티켓요금)
 * 예: "무료", "성인 10,000원, 청소년 5,000원"
 */
export function extractCulturePrice(payload: any): string | null {
  return normalizePriceText(payload?.price);
}

/**
 * Tour payload에서 가격 정보 추출
 * 
 * 원천 필드: usetimefestival 또는 usefee
 * 축제/행사 특성상 비어있을 가능성 높음
 */
export function extractTourPrice(payload: any): string | null {
  // usetimefestival 우선 (intro 정보)
  const usetime = normalizePriceText(payload?.usetimefestival);
  if (usetime) return usetime;
  
  // usefee fallback
  return normalizePriceText(payload?.usefee);
}

/**
 * 소스별 가격 추출 (통합 함수)
 */
export function extractPriceBySource(source: string, payload: any): string | null {
  switch (source.toLowerCase()) {
    case 'kopis':
      return extractKopisPrice(payload);
    case 'culture':
      return extractCulturePrice(payload);
    case 'tour':
      return extractTourPrice(payload);
    default:
      return null;
  }
}


