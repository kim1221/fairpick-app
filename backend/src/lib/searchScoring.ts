/**
 * 검색 결과 스코어링 및 필터링 시스템
 * Phase A: 방어 + 공격 파이프라인
 */

import dayjs from 'dayjs';
import { UnifiedSearchResult } from './naverApi';

/**
 * 티켓 사이트 도메인 목록
 */
export const TICKET_DOMAINS = [
  'interpark.com',
  'tickets.interpark.com',
  'ticket.interpark.com',
  'tickets.yes24.com',
  'ticket.yes24.com',
  'ticket.melon.com',
  'ticketlink.co.kr',
  'ticketbis.co.kr',
  'ticket.11st.co.kr',
  'booking.naver.com',
  'store.naver.com',
  'tabling.co.kr',
  'catchtable.co.kr',
  'wemakeprice.com',
  'ticketbay.co.kr',
  'kopis.or.kr',
];

/**
 * 스코어 상세 내역
 */
export interface ScoreBreakdown {
  total: number;
  details: string[];
}

/**
 * 스코어링된 검색 결과
 */
export interface ScoredSearchResult extends UnifiedSearchResult {
  score: number;
  scoreBreakdown: string[];
  isFiltered?: boolean;
  filterReason?: string;
}

/**
 * Phase 2: 방어 필터링 (hard drop)
 * AI에게 전달하기 전에 명백히 나쁜 데이터 제거
 */
export function filterSearchResults(
  results: UnifiedSearchResult[],
  eventYears: number[]
): ScoredSearchResult[] {
  return results.map(result => {
    const text = `${result.title} ${result.description} ${result.link}`.toLowerCase();
    const breakdown: string[] = [];
    let isFiltered = false;
    let filterReason = '';

    // 1. 종료 키워드 체크 (hard drop)
    const expiredKeywords = ['지난공연', '판매종료', '공연종료', '예매종료', '전시종료'];
    for (const keyword of expiredKeywords) {
      if (text.includes(keyword)) {
        isFiltered = true;
        filterReason = `종료 키워드 감지: ${keyword}`;
        console.log(`[FILTER] ${filterReason} - ${result.link}`);
        break;
      }
    }

    // 2. 과거 연도 날짜 패턴 체크 (hard drop for obvious past dates)
    if (!isFiltered) {
      // 2024.03.15, 2025-06-20 같은 명확한 날짜 패턴
      const datePattern = /20(2[0-5]|1[0-9])[년.\-/](0[1-9]|1[0-2])[.\-/](0[1-9]|[12][0-9]|3[01])/g;
      const foundDates = [...text.matchAll(datePattern)];

      for (const match of foundDates) {
        const year = parseInt(`20${match[1]}`);
        // 이벤트 연도가 아니고, 명백히 과거이면 제거
        if (!eventYears.includes(year) && year < Math.min(...eventYears)) {
          isFiltered = true;
          filterReason = `과거 날짜 감지: 20${match[1]}`;
          console.log(`[FILTER] ${filterReason} - ${result.link}`);
          break;
        }
      }
    }

    return {
      ...result,
      score: 0,
      scoreBreakdown: breakdown,
      isFiltered,
      filterReason,
    };
  }).filter(r => !r.isFiltered); // 필터링된 것 제거
}

/**
 * Phase 3: 우선순위 스코어링 (공격 + soft penalty)
 */
export function scoreSearchResults(
  results: ScoredSearchResult[],
  event: {
    title: string;
    venue: string;
    startYear: number;
    endYear: number;
    startMonth: number;
  }
): ScoredSearchResult[] {
  const eventYears = [event.startYear, event.endYear];
  
  return results.map(result => {
    const text = `${result.title} ${result.description}`.toLowerCase();
    const link = result.link.toLowerCase();
    let score = 0;
    const breakdown: string[] = [];

    // === 1. 연도 매칭 (최우선) ===
    const yearMatch = eventYears.some(year => 
      link.includes(String(year)) || text.includes(String(year))
    );
    if (yearMatch) {
      score += 50;
      breakdown.push('year:+50');
    }

    // === 2. 월 단위 근접성 (보완 #2) ===
    const eventMonth = String(event.startMonth).padStart(2, '0');
    const monthPatterns = [
      `${eventMonth}월`,
      `.${eventMonth}.`,
      `-${eventMonth}-`,
      `/${eventMonth}/`,
    ];
    if (monthPatterns.some(p => text.includes(p) || link.includes(p))) {
      score += 5;
      breakdown.push('month:+5');
    }

    // === 3. 상세 URL 패턴 (차등 적용 - 보완 #3) ===
    const hasDetailPattern = /view|detail|info|exhibition|program|event/.test(link);
    const isGovOrg = /\.go\.kr|\.or\.kr/.test(link);
    const isTicketDomain = TICKET_DOMAINS.some(d => link.includes(d));
    const isBlog = /blog|cafe|post/.test(link);

    if (hasDetailPattern) {
      if (isGovOrg) {
        score += 25;
        breakdown.push('gov-detail:+25');
      } else if (isTicketDomain) {
        score += 20;
        breakdown.push('ticket-detail:+20');
      } else if (isBlog) {
        score += 5;
        breakdown.push('blog-detail:+5');
      } else {
        score += 15;
        breakdown.push('detail:+15');
      }
    }

    // 쿼리 파라미터 (특정 이벤트 지정)
    if (/\?.*[=&]/.test(link)) {
      score += 10;
      breakdown.push('query-param:+10');
    }

    // === 4. 티켓 도메인 (조건부 가산점 - 보완 #1) ===
    if (isTicketDomain && !hasDetailPattern) {
      // 의심 키워드 체크
      const suspiciousKeywords = ['후기', '리뷰', '관람후기', '다녀왔', '다녀온'];
      const hasSuspicious = suspiciousKeywords.some(kw => text.includes(kw));

      if (!hasSuspicious) {
        score += 10;
        breakdown.push('ticket:+10');
      } else {
        // 의심 키워드 있으면 가산점 없음
        breakdown.push('ticket-review:0');
      }
    }

    // === 5. 장소 매칭 ===
    if (text.includes(event.venue.toLowerCase()) || link.includes(event.venue.toLowerCase())) {
      score += 5;
      breakdown.push('venue:+5');
    }

    // === 6. 공공기관 도메인 ===
    if (isGovOrg && !hasDetailPattern) {
      score += 8;
      breakdown.push('gov:+8');
    }

    // === 7. Soft Penalty: 과거 연도 의심 ===
    // hard drop에서 걸러지지 않았지만, 다른 연도가 우세하게 등장하는 경우
    const otherYears = [2024, 2025].filter(y => !eventYears.includes(y));
    let otherYearCount = 0;
    for (const year of otherYears) {
      const regex = new RegExp(String(year), 'g');
      const matches = text.match(regex);
      if (matches) otherYearCount += matches.length;
    }

    if (otherYearCount >= 2) {
      score -= 30;
      breakdown.push('past-year-penalty:-30');
    }

    // === 8. 정보 완성도 (snippet 분석) ===
    if (/주소|위치|찾아오시는/.test(text)) {
      score += 3;
      breakdown.push('addr-info:+3');
    }
    if (/운영시간|관람시간|오픈/.test(text)) {
      score += 3;
      breakdown.push('hours-info:+3');
    }
    if (/가격|요금|입장료|티켓/.test(text)) {
      score += 3;
      breakdown.push('price-info:+3');
    }

    // 최종 점수 기록
    console.log(`[SCORE] ${result.title.substring(0, 50)}: ${score} (${breakdown.join(', ')})`);

    return {
      ...result,
      score,
      scoreBreakdown: breakdown,
    };
  }).sort((a, b) => b.score - a.score); // 점수 높은 순
}

/**
 * 도메인별 결과 제한 (다양성 확보)
 */
export function capResultsByDomain(
  results: ScoredSearchResult[],
  options: {
    maxPerDomain?: number;
    maxWeb?: number;
    maxBlog?: number;
    maxPlace?: number;
  } = {}
): ScoredSearchResult[] {
  const {
    maxPerDomain = 2,
    maxWeb = 15,
    maxBlog = 6,
    maxPlace = 3,
  } = options;

  const domainCounts = new Map<string, number>();
  const sourceCounts = { web: 0, blog: 0, place: 0 };
  const capped: ScoredSearchResult[] = [];

  for (const result of results) {
    // 소스별 제한 체크
    if (sourceCounts[result.source] >= (
      result.source === 'web' ? maxWeb :
      result.source === 'blog' ? maxBlog :
      maxPlace
    )) {
      continue;
    }

    // 도메인 추출
    let domain = '';
    try {
      const url = new URL(result.link);
      domain = url.hostname;
    } catch {
      domain = 'unknown';
    }

    // 도메인별 제한 체크
    const count = domainCounts.get(domain) || 0;
    if (count >= maxPerDomain) {
      console.log(`[CAP] 도메인 제한 초과: ${domain} (${count + 1}번째)`);
      continue;
    }

    // 추가
    capped.push(result);
    domainCounts.set(domain, count + 1);
    sourceCounts[result.source]++;
  }

  console.log(`[CAP] ${results.length}개 → ${capped.length}개 (web:${sourceCounts.web}, blog:${sourceCounts.blog}, place:${sourceCounts.place})`);

  return capped;
}

/**
 * 결과를 섹션별로 그룹핑 (보완 #4)
 */
export function groupResultsBySection(results: ScoredSearchResult[]): {
  ticket: ScoredSearchResult[];
  official: ScoredSearchResult[];
  place: ScoredSearchResult[];
  blog: ScoredSearchResult[];
} {
  const ticket: ScoredSearchResult[] = [];
  const official: ScoredSearchResult[] = [];
  const place: ScoredSearchResult[] = [];
  const blog: ScoredSearchResult[] = [];

  for (const result of results) {
    const link = result.link.toLowerCase();
    const isTicket = TICKET_DOMAINS.some(d => link.includes(d));
    const hasDetailPattern = /view|detail|info|exhibition|program|event/.test(link);

    if (isTicket) {
      ticket.push(result);
    } else if (hasDetailPattern || result.source === 'place') {
      if (result.source === 'place') {
        place.push(result);
      } else {
        official.push(result);
      }
    } else if (result.source === 'blog') {
      blog.push(result);
    } else {
      official.push(result); // 기타는 official로
    }
  }

  return {
    ticket: ticket.slice(0, 5),
    official: official.slice(0, 5),
    place: place.slice(0, 3),
    blog: blog.slice(0, 5),
  };
}

