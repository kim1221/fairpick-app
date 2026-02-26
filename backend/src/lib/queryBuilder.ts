/**
 * 필드별 네이버 검색 쿼리 빌더
 *
 * 필드에 따라 venue-first (place 우선) vs title-first (콘텐츠 우선) 전략을 선택합니다.
 */

/**
 * 필드별 검색 전략
 */
export type QueryStrategy = 'venue-first' | 'title-first';

/**
 * venue-first 전략: 장소/주소/주차 등 물리적 정보
 * place 검색을 우선으로 venue 기반 쿼리 사용
 */
const VENUE_FIRST_FIELDS = [
  'address',
  'parking_available',
  'parking_info',
  'public_transport_info',
  'accessibility_info',
  'region',
  'lat',
  'lng',
];

/**
 * title-first 전략: 이벤트 콘텐츠 정보
 * web/blog 검색 우선으로 title 기반 쿼리 사용
 */
const TITLE_FIRST_FIELDS = [
  'external_links.official',
  'external_links.ticket',
  'external_links.reservation',
  'price_min',
  'price_max',
  'price_info',
  'is_free',
  'overview',
  'opening_hours',
  'derived_tags',
  'metadata.display',
];

/**
 * 필드 키에서 검색 전략 결정
 */
export function getQueryStrategy(fieldKey: string): QueryStrategy {
  // venue-first 그룹 체크
  if (VENUE_FIRST_FIELDS.some(f => fieldKey === f || fieldKey.startsWith(f + '.'))) {
    return 'venue-first';
  }

  // title-first 그룹 체크
  if (TITLE_FIRST_FIELDS.some(f => fieldKey === f || fieldKey.startsWith(f + '.'))) {
    return 'title-first';
  }

  // 기본값: title-first
  return 'title-first';
}

/**
 * 필드별로 최적화된 네이버 검색 쿼리 생성
 *
 * @param fieldKey - 필드 키 (예: 'address', 'parking_info', 'price_min')
 * @param context - 이벤트 컨텍스트 정보
 * @returns 네이버 검색 쿼리 문자열
 */
export function buildNaverQueryForField(
  fieldKey: string,
  context: {
    title: string;
    venue?: string;
    address?: string;
    region?: string;
    category?: string;
  }
): { query: string; strategy: QueryStrategy } {
  const strategy = getQueryStrategy(fieldKey);
  const { title, venue, address, region } = context;

  // DEV 로깅
  if (process.env.NODE_ENV === 'development') {
    console.log(`[QUERY_BUILDER] fieldKey=${fieldKey} strategy=${strategy}`);
  }

  // 공통 정제
  const cleanTitle = title.replace(/\[.*?\]/g, '').trim();
  const cleanVenue = venue ? venue.replace(/\(.*?\)/g, '').trim() : '';
  const cleanAddress = address ? address.replace(/\(.*?\)/g, '').trim() : '';

  let query: string;

  if (strategy === 'venue-first') {
    // ====== venue-first: 장소 중심 검색 ======

    if (fieldKey === 'address') {
      // 주소: venue + region 또는 venue 단독
      if (cleanVenue) {
        query = region ? `${cleanVenue} ${region} 주소` : `${cleanVenue} 주소`;
      } else {
        query = `${cleanTitle} 주소`;
      }
    } else if (fieldKey === 'parking_available' || fieldKey === 'parking_info') {
      // 주차: venue만 사용 (주소 포함하지 않음 - 검색 결과가 더 잘 나옴)
      if (cleanVenue) {
        query = `${cleanVenue} 주차`;
      } else {
        query = `${cleanTitle} 주차`;
      }
    } else if (fieldKey === 'public_transport_info') {
      // 대중교통: venue + "오시는길"
      if (cleanVenue) {
        query = `${cleanVenue} 오시는길`;
      } else {
        query = `${cleanTitle} 오시는길`;
      }
    } else if (fieldKey === 'accessibility_info') {
      // 편의시설: venue + "편의시설"
      if (cleanVenue) {
        query = `${cleanVenue} 편의시설`;
      } else {
        query = `${cleanTitle} 편의시설`;
      }
    } else {
      // 기타 venue-first 필드: venue 기반
      query = cleanVenue ? cleanVenue : cleanTitle;
    }

  } else {
    // ====== title-first: 콘텐츠 중심 검색 ======

    if (fieldKey.includes('external_links.ticket')) {
      query = `${cleanTitle} 예매`;
    } else if (fieldKey.includes('external_links.reservation')) {
      query = `${cleanTitle} 예약`;
    } else if (fieldKey.includes('external_links.official')) {
      query = `${cleanTitle} 공식`;
    } else if (fieldKey.includes('price')) {
      query = `${cleanTitle} 가격`;
    } else if (fieldKey === 'is_free') {
      query = `${cleanTitle} 무료`;
    } else if (fieldKey === 'overview') {
      query = `${cleanTitle} 소개`;
    } else if (fieldKey.includes('opening_hours')) {
      query = `${cleanTitle} 운영시간`;
    } else if (fieldKey.includes('derived_tags')) {
      query = `${cleanTitle} 특징`;
    } else {
      // 기타 title-first 필드: title 기반
      query = cleanTitle;
    }
  }

  return { query, strategy };
}

/**
 * 네이버 바로 검색 URL 생성 (실패 시 사용자에게 제공)
 *
 * @param fieldKey - 필드 키
 * @param context - 이벤트 컨텍스트 정보
 * @returns 네이버 검색 URL
 */
export function buildNaverSearchUrl(
  fieldKey: string,
  context: {
    title: string;
    venue?: string;
    address?: string;
    region?: string;
    category?: string;
  }
): string {
  const { query } = buildNaverQueryForField(fieldKey, context);
  return `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`;
}
