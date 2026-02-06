/**
 * 네이버 Search API 클라이언트
 * 
 * 사용 API:
 * - 블로그 검색: 이벤트 리뷰, 운영시간, 가격 정보
 * - 웹 검색: 공식 페이지, 추가 정보
 */

import axios from 'axios';

/**
 * 네이버 API 인증 정보 조회
 *
 * 함수 내부에서 환경 변수를 읽어서 반환
 * (모듈 로드 시점이 아닌 함수 실행 시점에 읽음 → dotenv 로딩 타이밍 문제 해결)
 */
function getNaverCredentials() {
  return {
    clientId: process.env.NAVER_CLIENT_ID || '',
    clientSecret: process.env.NAVER_CLIENT_SECRET || '',
  };
}

const BASE_URL = 'https://openapi.naver.com/v1/search';

interface NaverSearchOptions {
  query: string;
  display?: number; // 검색 결과 개수 (최대 100)
  start?: number;   // 시작 위치 (1~1000)
  sort?: 'sim' | 'date'; // sim: 유사도순, date: 날짜순
}

interface NaverBlogItem {
  title: string;
  link: string;
  description: string;
  bloggername: string;
  bloggerlink: string;
  postdate: string; // YYYYMMDD
}

interface NaverWebItem {
  title: string;
  link: string;
  description: string;
}

interface NaverPlaceItem {
  title: string;
  link: string;
  category: string;
  description: string;
  telephone: string;
  address: string;
  roadAddress: string;
  mapx: string; // 경도
  mapy: string; // 위도
}

interface NaverCafeItem {
  title: string;
  link: string;
  description: string;
  cafename: string;
  cafeurl: string;
}

interface NaverSearchResult<T> {
  lastBuildDate: string;
  total: number;
  start: number;
  display: number;
  items: T[];
}

/**
 * 네이버 블로그 검색
 */
export async function searchNaverBlog(
  options: NaverSearchOptions
): Promise<NaverSearchResult<NaverBlogItem>> {
  const { clientId, clientSecret } = getNaverCredentials();

  if (!clientId || !clientSecret) {
    console.warn('[NaverAPI] NAVER_CLIENT_ID or NAVER_CLIENT_SECRET not set. Returning empty result.');
    return {
      lastBuildDate: new Date().toISOString(),
      total: 0,
      start: 1,
      display: 0,
      items: [],
    };
  }

  const params = new URLSearchParams({
    query: options.query,
    display: String(options.display || 10),
    start: String(options.start || 1),
    sort: options.sort || 'sim',
  });

  try {
    const response = await axios.get<NaverSearchResult<NaverBlogItem>>(
      `${BASE_URL}/blog.json?${params}`,
      {
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret,
        },
      }
    );

    return response.data;
  } catch (error: any) {
    console.error('[NaverAPI] Blog search error:', {
      query: options.query,
      error: error.message,
      status: error.response?.status,
    });
    throw error;
  }
}

/**
 * 네이버 웹 검색
 */
export async function searchNaverWeb(
  options: NaverSearchOptions
): Promise<NaverSearchResult<NaverWebItem>> {
  const { clientId, clientSecret } = getNaverCredentials();

  if (!clientId || !clientSecret) {
    console.warn('[NaverAPI] NAVER_CLIENT_ID or NAVER_CLIENT_SECRET not set. Returning empty result.');
    return {
      lastBuildDate: new Date().toISOString(),
      total: 0,
      start: 1,
      display: 0,
      items: [],
    };
  }

  const params = new URLSearchParams({
    query: options.query,
    display: String(options.display || 10),
    start: String(options.start || 1),
  });

  try {
    const response = await axios.get<NaverSearchResult<NaverWebItem>>(
      `${BASE_URL}/webkr.json?${params}`,
      {
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret,
        },
      }
    );

    return response.data;
  } catch (error: any) {
    console.error('[NaverAPI] Web search error:', {
      query: options.query,
      error: error.message,
      status: error.response?.status,
    });
    throw error;
  }
}

/**
 * 네이버 플레이스(지역) 검색
 */
export async function searchNaverPlace(
  options: NaverSearchOptions
): Promise<NaverSearchResult<NaverPlaceItem>> {
  const { clientId, clientSecret } = getNaverCredentials();

  if (!clientId || !clientSecret) {
    console.warn('[NaverAPI] NAVER_CLIENT_ID or NAVER_CLIENT_SECRET not set. Returning empty result.');
    return {
      lastBuildDate: new Date().toISOString(),
      total: 0,
      start: 1,
      display: 0,
      items: [],
    };
  }

  const params = new URLSearchParams({
    query: options.query,
    display: String(options.display || 5),
    start: String(options.start || 1),
  });

  try {
    const response = await axios.get<NaverSearchResult<NaverPlaceItem>>(
      `${BASE_URL}/local.json?${params}`,
      {
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret,
        },
      }
    );

    return response.data;
  } catch (error: any) {
    console.error('[NaverAPI] Place search error:', {
      query: options.query,
      error: error.message,
      status: error.response?.status,
    });
    throw error;
  }
}

/**
 * 네이버 카페 검색
 */
export async function searchNaverCafe(
  options: NaverSearchOptions
): Promise<NaverSearchResult<NaverCafeItem>> {
  const { clientId, clientSecret } = getNaverCredentials();

  if (!clientId || !clientSecret) {
    console.warn('[NaverAPI] NAVER_CLIENT_ID or NAVER_CLIENT_SECRET not set. Returning empty result.');
    return {
      lastBuildDate: new Date().toISOString(),
      total: 0,
      start: 1,
      display: 0,
      items: [],
    };
  }

  const params = new URLSearchParams({
    query: options.query,
    display: String(options.display || 10),
    start: String(options.start || 1),
    sort: options.sort || 'date',
  });

  try {
    const response = await axios.get<NaverSearchResult<NaverCafeItem>>(
      `${BASE_URL}/cafearticle.json?${params}`,
      {
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret,
        },
      }
    );

    return response.data;
  } catch (error: any) {
    console.error('[NaverAPI] Cafe search error:', {
      query: options.query,
      error: error.message,
      status: error.response?.status,
    });
    
    // 429 에러 시 빈 결과 반환
    if (error.response?.status === 429) {
      return {
        lastBuildDate: new Date().toISOString(),
        total: 0,
        start: 1,
        display: 0,
        items: [],
      };
    }
    
    throw error;
  }
}

/**
 * 이벤트 관련 정보 검색 (블로그 + 웹)
 */
export async function searchEventInfo(eventTitle: string, venue?: string) {
  // 제목과 장소 정제 (괄호 제거, 중복 제거)
  const cleanTitle = eventTitle.replace(/\[.*?\]/g, '').trim(); // [부산], [서울] 등 제거
  const cleanVenue = venue ? venue.replace(/\(.*?\)/g, '').trim() : ''; // (초록마술극장) 같은 중복 제거
  
  const searchQuery = cleanVenue ? `${cleanTitle} ${cleanVenue}` : cleanTitle;

  console.log('[NaverAPI] Searching event info:', { 
    eventTitle, 
    venue, 
    cleanTitle,
    cleanVenue,
    searchQuery 
  });

  // 플레이스, 블로그, 웹을 병렬로 검색
  const [placeResult, blogResult, webResult] = await Promise.allSettled([
    searchNaverPlace({ query: searchQuery, display: 5 }), // 플레이스 검색 (장소 정보) - 3→5 증가
    searchNaverBlog({ 
      query: searchQuery,  // 핵심 키워드만 (관련도 높은 결과)
      display: 10,  // 5→10 증가 (더 많은 리뷰에서 운영시간 추출)
      sort: 'sim'  // ⭐ 유사도순 (date → sim)
    }),
    searchNaverWeb({ 
      query: searchQuery,  // 핵심 키워드만
      display: 10  // 5→10 증가 (더 많은 예매 사이트 정보)
    }),
  ]);

  return {
    place: placeResult.status === 'fulfilled' ? placeResult.value : null,
    blog: blogResult.status === 'fulfilled' ? blogResult.value : null,
    web: webResult.status === 'fulfilled' ? webResult.value : null,
  };
}

/**
 * 통합된 검색 결과 타입
 */
export interface UnifiedSearchResult {
  title: string;
  link: string;
  description: string;
  source: 'place' | 'blog' | 'web';
  postdate?: string; // blog only
  category?: string; // place only
  address?: string; // place only
  roadAddress?: string; // place only
}

/**
 * 향상된 이벤트 정보 검색 (카테고리별 특화 쿼리 포함)
 * Phase A: 검색 확장
 */
export async function searchEventInfoEnhanced(
  eventTitle: string, 
  venue: string, 
  startYear: number,
  endYear: number,
  category?: string  // 🆕 카테고리 추가
) {
  // 제목과 장소 정제
  const cleanTitle = eventTitle.replace(/\[.*?\]/g, '').trim();
  const cleanVenue = venue.replace(/\(.*?\)/g, '').trim();
  const yearTokens = startYear === endYear ? `${startYear}` : `${startYear} ${endYear}`;

  console.log('[NaverAPI] Enhanced search:', { 
    cleanTitle, 
    cleanVenue, 
    yearTokens,
    category
  });

  // 기본 쿼리 3개 + 카테고리별 특화 쿼리
  const queries: Promise<any>[] = [
    // 1. 메인 검색: 제목 + 장소 + 연도
    (async () => {
      const query = `${cleanTitle} ${cleanVenue} ${yearTokens}`;
      const [place, blog, web] = await Promise.allSettled([
        searchNaverPlace({ query, display: 5 }),
        searchNaverBlog({ query, display: 10, sort: 'sim' }),
        searchNaverWeb({ query, display: 10 }),
      ]);
      return {
        place: place.status === 'fulfilled' ? place.value : null,
        blog: blog.status === 'fulfilled' ? blog.value : null,
        web: web.status === 'fulfilled' ? web.value : null,
      };
    })(),

    // 2. 티켓 집중 검색: 제목 + 예매 + 연도
    (async () => {
      const query = `${cleanTitle} 예매 티켓 ${yearTokens}`;
      const web = await searchNaverWeb({ query, display: 15 });
      return { web };
    })(),

    // 3. 장소 집중 검색: 장소 + 위치 + 운영시간
    (async () => {
      const query = `${cleanVenue} 위치 운영시간`;
      const [place, blog, web] = await Promise.allSettled([
        searchNaverPlace({ query, display: 10 }),
        searchNaverBlog({ query, display: 10, sort: 'sim' }),
        searchNaverWeb({ query, display: 10 }),
      ]);
      return {
        place: place.status === 'fulfilled' ? place.value : null,
        blog: blog.status === 'fulfilled' ? blog.value : null,
        web: web.status === 'fulfilled' ? web.value : null,
      };
    })(),
  ];

  // 🎨 카테고리별 특화 검색 쿼리 추가
  if (category === '팝업') {
    // 🏪 팝업 특화 검색 (5개)
    queries.push(
      // 4. 시그니처 메뉴
      (async () => {
        const query = `${cleanTitle} 시그니처 메뉴 대표`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })(),
      
      // 5. 웨이팅/대기 시간
      (async () => {
        const query = `${cleanTitle} 웨이팅 대기 줄 오픈런`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })(),
      
      // 6. 품절/소진 시간
      (async () => {
        const query = `${cleanTitle} 품절 소진 조기마감`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })(),
      
      // 7. 콜라보/협업 브랜드
      (async () => {
        const query = `${cleanTitle} 콜라보 협업 브랜드`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })(),
      
      // 8. 포토존/주차
      (async () => {
        const query = `${cleanTitle} 포토존 주차 위치`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })()
    );
  } else if (category === '전시') {
    // 🎨 전시 특화 검색 (4개)
    queries.push(
      // 4. 작가/아티스트
      (async () => {
        const query = `${cleanTitle} 작가 아티스트 전시`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })(),
      
      // 5. 포토존/굿즈샵
      (async () => {
        const query = `${cleanTitle} 포토존 굿즈 기념품샵`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })(),
      
      // 6. 도슨트/오디오가이드
      (async () => {
        const query = `${cleanTitle} 도슨트 오디오가이드 투어`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })(),
      
      // 7. 촬영 가능 여부
      (async () => {
        const query = `${cleanTitle} 촬영 사진 플래시`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })()
    );
  } else if (category === '공연') {
    // 🎭 공연 특화 검색 (4개)
    queries.push(
      // 4. 출연진/배우
      (async () => {
        const query = `${cleanTitle} 출연진 배우 캐스팅`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })(),
      
      // 5. 러닝타임/인터미션
      (async () => {
        const query = `${cleanTitle} 러닝타임 공연시간 인터미션`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })(),
      
      // 6. 할인 정보
      (async () => {
        const query = `${cleanTitle} 할인 조기예매 학생할인`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })(),
      
      // 7. 좌석/관람팁
      (async () => {
        const query = `${cleanTitle} 좌석 추천 관람 후기`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })()
    );
  } else if (category === '축제') {
    // 🎪 축제 특화 검색 (4개)
    queries.push(
      // 4. 프로그램/공연
      (async () => {
        const query = `${cleanTitle} 프로그램 공연 일정`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })(),
      
      // 5. 먹거리/부스
      (async () => {
        const query = `${cleanTitle} 먹거리 음식 부스`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })(),
      
      // 6. 주차/교통
      (async () => {
        const query = `${cleanTitle} 주차 셔틀버스 교통`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })(),
      
      // 7. 규모/혼잡도
      (async () => {
        const query = `${cleanTitle} 규모 인파 혼잡`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })()
    );
  } else if (category === '행사') {
    // 📋 행사 특화 검색 (3개)
    queries.push(
      // 4. 참가 대상/자격
      (async () => {
        const query = `${cleanTitle} 참가대상 신청자격`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })(),
      
      // 5. 사전 등록
      (async () => {
        const query = `${cleanTitle} 사전등록 신청 마감`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })(),
      
      // 6. 정원/선착순
      (async () => {
        const query = `${cleanTitle} 정원 선착순 인원`;
        const blog = await searchNaverBlog({ query, display: 10, sort: 'sim' });
        return { blog };
      })()
    );
  }

  console.log(`[NaverAPI] Total queries: ${queries.length} (base: 3, category-specific: ${queries.length - 3})`);

  // 모든 쿼리 병렬 실행
  const results = await Promise.allSettled(queries);

  // 결과 통합
  const allResults: UnifiedSearchResult[] = [];

  // 모든 검색 결과 통합 (기본 + 카테고리 특화)
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { place, blog, web } = result.value;
      
      if (place?.items) {
        allResults.push(...place.items.map((item: NaverPlaceItem) => ({
          title: stripHtmlTags(item.title),
          link: item.link,
          description: stripHtmlTags(item.description),
          source: 'place' as const,
          category: item.category,
          address: item.address,
          roadAddress: item.roadAddress,
        })));
      }
      
      if (blog?.items) {
        allResults.push(...blog.items.map((item: NaverBlogItem) => ({
          title: stripHtmlTags(item.title),
          link: item.link,
          description: stripHtmlTags(item.description),
          source: 'blog' as const,
          postdate: item.postdate,
        })));
      }
      
      if (web?.items) {
        allResults.push(...web.items.map((item: NaverWebItem) => ({
          title: stripHtmlTags(item.title),
          link: item.link,
          description: stripHtmlTags(item.description),
          source: 'web' as const,
        })));
      }
    }
  }

  console.log(`[NaverAPI] Total results collected: ${allResults.length} from ${results.length} queries`);

  return allResults;
}

/**
 * HTML 태그 제거 (네이버 API 응답에 포함된 <b> 태그 등)
 */
export function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}

/**
 * 공식 예매/예약 사이트 도메인 목록
 */
const TICKET_SITE_DOMAINS = [
  'interpark.com',        // 인터파크 티켓
  'tickets.interpark.com', // NOL 티켓
  'ticket.interpark.com',
  'tickets.yes24.com',    // YES24 티켓
  'ticket.yes24.com',
  'ticket.melon.com',     // 멜론티켓
  'ticketlink.co.kr',     // 티켓링크
  'ticketbis.co.kr',      // 티켓비스
  'ticket.11st.co.kr',    // 11번가 티켓
  'booking.naver.com',    // 네이버 예약
  'store.naver.com',      // 네이버 스토어
  'tabling.co.kr',        // 테이블링
  'catchtable.co.kr',     // 캐치테이블
  'wemakeprice.com',      // 위메프
  'ticketbay.co.kr',      // 티켓베이
  'kopis.or.kr',          // 공연예술통합전산망
];

/**
 * URL이 공식 예매/예약 사이트인지 확인
 */
function isTicketSite(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return TICKET_SITE_DOMAINS.some(domain => 
      urlObj.hostname.includes(domain) || urlObj.hostname === domain
    );
  } catch {
    return false;
  }
}

/**
 * 네이버 검색 결과를 텍스트로 병합 (AI 입력용)
 * 공식 예매 사이트를 우선적으로 표시
 */
export function mergeSearchResults(
  place: NaverSearchResult<NaverPlaceItem> | null,
  blog: NaverSearchResult<NaverBlogItem> | null,
  web: NaverSearchResult<NaverWebItem> | null
): string {
  const lines: string[] = [];

  if (place && place.items.length > 0) {
    lines.push('=== 네이버 플레이스 (장소 정보) ===');
    place.items.forEach((item, idx) => {
      lines.push(`[${idx + 1}] ${stripHtmlTags(item.title)}`);
      lines.push(`   카테고리: ${item.category}`);
      lines.push(`   설명: ${stripHtmlTags(item.description)}`);
      if (item.telephone) lines.push(`   전화: ${item.telephone}`);
      if (item.address) lines.push(`   주소: ${item.address}`);
      if (item.roadAddress) lines.push(`   도로명: ${item.roadAddress}`);
      lines.push(`   (링크: ${item.link})`);
      lines.push('');
    });
  }

  // 웹 검색 결과를 예매 사이트와 일반 사이트로 분류
  const ticketSites: NaverWebItem[] = [];
  const otherSites: NaverWebItem[] = [];

  if (web && web.items.length > 0) {
    web.items.forEach(item => {
      if (isTicketSite(item.link)) {
        ticketSites.push(item);
      } else {
        otherSites.push(item);
      }
    });
  }

  // 1순위: 공식 예매/예약 사이트 (가장 중요!)
  if (ticketSites.length > 0) {
    lines.push('=== 🎫 공식 예매/예약 사이트 (최우선 참고!) ===');
    ticketSites.forEach((item, idx) => {
      lines.push(`[${idx + 1}] ${stripHtmlTags(item.title)}`);
      lines.push(`   ${stripHtmlTags(item.description)}`);
      lines.push(`   ✅ 예매 링크: ${item.link}`);
      lines.push('');
    });
  }

  // 2순위: 블로그 (리뷰, 후기)
  if (blog && blog.items.length > 0) {
    lines.push('=== 블로그 검색 결과 (참고용) ===');
    blog.items.forEach((item, idx) => {
      lines.push(`[${idx + 1}] ${stripHtmlTags(item.title)}`);
      lines.push(`   ${stripHtmlTags(item.description)}`);
      lines.push(`   (날짜: ${item.postdate}, 링크: ${item.link})`);
      lines.push('');
    });
  }

  // 3순위: 기타 웹사이트
  if (otherSites.length > 0) {
    lines.push('=== 기타 웹 검색 결과 ===');
    otherSites.forEach((item, idx) => {
      lines.push(`[${idx + 1}] ${stripHtmlTags(item.title)}`);
      lines.push(`   ${stripHtmlTags(item.description)}`);
      lines.push(`   (링크: ${item.link})`);
      lines.push('');
    });
  }

  if (lines.length === 0) {
    return '검색 결과 없음';
  }

  return lines.join('\n');
}

/**
 * 웹 검색 결과에서 공식 예매 사이트 URL 추출
 */
export function extractTicketLinks(web: NaverSearchResult<NaverWebItem> | null): {
  ticket?: string;
  reservation?: string;
} {
  const links: { ticket?: string; reservation?: string } = {};
  
  if (!web || !web.items || web.items.length === 0) {
    return links;
  }

  // 예매 사이트 우선 순위
  const ticketPriority = [
    'interpark.com',
    'yes24.com',
    'melon.com',
    'ticketlink.co.kr',
  ];

  const reservationPriority = [
    'booking.naver.com',
    'tabling.co.kr',
    'catchtable.co.kr',
  ];

  // 예매 링크 찾기
  for (const domain of ticketPriority) {
    const found = web.items.find(item => item.link.includes(domain));
    if (found) {
      links.ticket = found.link;
      break;
    }
  }

  // 예약 링크 찾기
  for (const domain of reservationPriority) {
    const found = web.items.find(item => item.link.includes(domain));
    if (found) {
      links.reservation = found.link;
      break;
    }
  }

  // 우선순위에 없는 예매 사이트도 포함
  if (!links.ticket) {
    const ticketSite = web.items.find(item => isTicketSite(item.link));
    if (ticketSite) {
      links.ticket = ticketSite.link;
    }
  }

  return links;
}

// ============================================================
// 네이버 블로그 언급 수 조회 (추천 시스템용)
// ============================================================

/**
 * venue 전처리: 검색에 적합한 형태로 변환
 * 
 * @param venue 원본 venue (예: "예술의전당 [서울] (콘서트홀)")
 * @returns 정제된 venue (예: "예술의전당")
 */
function cleanVenueForSearch(venue: string): string {
  // 1. 대괄호 [...] 제거
  let cleaned = venue.replace(/\[.*?\]/g, '');
  
  // 2. 괄호 (...) 제거
  cleaned = cleaned.replace(/\(.*?\)/g, '');
  
  // 3. 공백 정리
  cleaned = cleaned.trim().replace(/\s+/g, ' ');
  
  return cleaned;
}

/**
 * 블로그 검색 결과에서 실제 관련도 계산
 * 
 * @param items 검색 결과 아이템들
 * @param eventTitle 이벤트 제목
 * @returns 실제 관련된 블로그 비율 (0~1)
 */
function calculateRelevanceRatio(items: NaverBlogItem[], eventTitle: string): number {
  if (items.length === 0) return 0;
  
  let relevantCount = 0;
  const titleKeywords = eventTitle.toLowerCase().split(' ').filter(w => w.length > 1);
  
  for (const item of items) {
    const cleanTitle = item.title.replace(/<[^>]*>/g, '').toLowerCase();
    
    // 키워드가 2개 이상 포함되면 관련 있다고 판단
    const matchedKeywords = titleKeywords.filter(keyword => 
      cleanTitle.includes(keyword)
    );
    
    if (matchedKeywords.length >= Math.min(2, titleKeywords.length)) {
      relevantCount++;
    }
  }
  
  return relevantCount / items.length;
}

/**
 * 이벤트의 네이버 블로그 언급 수 조회 (정확도 개선)
 * 
 * 목적: 추천 알고리즘에서 이벤트 인기도 측정
 * 개선: display=100으로 실제 블로그를 확인하여 정확도 측정
 * 
 * @param title 이벤트 제목
 * @param region 지역명 (예: "서울", "부산")
 * @param venue 장소명 (예: "서울시립미술관") - 정확도 향상
 * @param useSampling true면 정확도 측정, false면 보정 계수 적용
 * @param correctionFactor 보정 계수 (이미 계산된 경우)
 * @returns { total: 보정된 언급 수, accuracy: 정확도 비율 }
 */
export async function getNaverBlogMentions(
  title: string,
  region?: string,
  venue?: string,
  useSampling: boolean = false,
  correctionFactor?: number
): Promise<{ total: number; accuracy?: number }> {
  try {
    const year = new Date().getFullYear();
    
    // venue 전처리: 대괄호, 괄호 제거
    const cleanedVenue = venue ? cleanVenueForSearch(venue) : '';
    
    // 쿼리 구성
    let query = title;
    
    if (cleanedVenue) {
      query = `${title} ${cleanedVenue} ${year}`;
    } else if (region) {
      query = `${title} ${region} ${year}`;
    } else {
      query = `${title} ${year}`;
    }

    // Sampling 모드: display=100으로 정확도 측정
    if (useSampling) {
      const result = await searchNaverBlog({
        query,
        display: 100,  // 실제 블로그 확인
        sort: 'sim'
      });
      
      // 실제 관련도 계산
      const accuracy = calculateRelevanceRatio(result.items, title);
      const correctedTotal = Math.round(result.total * accuracy);
      
      return {
        total: correctedTotal,
        accuracy: accuracy
      };
    }
    
    // 일반 모드: display=1 + 보정 계수 적용
    const result = await searchNaverBlog({
      query,
      display: 1,  // 비용 절감
      sort: 'sim'
    });
    
    // 보정 계수가 있으면 적용
    const factor = correctionFactor || 1.0;
    const correctedTotal = Math.round(result.total * factor);
    
    return {
      total: correctedTotal
    };
    
  } catch (error: any) {
    console.error('[NaverAPI] getNaverBlogMentions error:', {
      title,
      region,
      venue,
      error: error.message
    });
    return { total: 0 };
  }
}

