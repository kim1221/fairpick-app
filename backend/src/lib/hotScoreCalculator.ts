/**
 * Hot Score Calculator
 * 
 * Consensus + Structural 점수 계산
 * - Consensus: 네이버 검색 기반 대중 합의
 * - Structural: 이벤트 구조적 특징 (장소, 기간, 출처)
 */

import { searchNaverBlog, searchNaverWeb, stripHtmlTags } from './naverApi';

// ==================== 타입 정의 ====================

export interface Event {
  id: string;
  title: string;
  main_category: string;
  venue?: string;
  region?: string;
  start_at: Date;
  end_at: Date;
  source?: string;
  kopis_id?: string;
}

export interface ConsensusComponents {
  q1_score: number;  // 제목 + 장소 + 연도
  q2_score: number;  // 제목 + 지역 + 연도
  q3_score: number;  // 제목 + 카테고리 + 연도
  total: number;     // 가중평균
  event_like_ratio: number; // 이벤트 관련 비율
}

export interface StructuralComponents {
  venue_score: number;      // 장소 신뢰도 (0-100)
  duration_score: number;   // 기간 적절성 (0-100)
  source_score: number;     // 출처 신뢰도 (0-100)
  total: number;            // 가중평균
}

// ==================== Consensus 계산 ====================

/**
 * Consensus 점수 계산 (네이버 검색 기반)
 * 
 * Q1: "제목 + 장소 + 연도" (50%)
 * Q2: "제목 + 지역 + 연도" (30%)
 * Q3: "제목 + 카테고리 + 연도" (20%)
 */
export async function calculateConsensusScore(event: Event): Promise<ConsensusComponents> {
  const year = new Date().getFullYear();
  const categoryKeyword = getCategoryKeyword(event.main_category);

  // Q1: 제목 + 장소 + 연도
  const q1 = `"${event.title}" ${event.venue || ''} ${year}`.trim();
  const q1Score = await calculateConsensusForQuery(q1, event);

  // Q2: 제목 + 지역 + 연도
  const q2 = `"${event.title}" ${event.region || ''} ${year}`.trim();
  const q2Score = await calculateConsensusForQuery(q2, event);

  // Q3: 제목 + 카테고리 + 연도
  const q3 = `"${event.title}" ${categoryKeyword} ${year}`.trim();
  const q3Score = await calculateConsensusForQuery(q3, event);

  // 가중평균 계산
  const total = q1Score * 0.5 + q2Score * 0.3 + q3Score * 0.2;

  return {
    q1_score: Math.round(q1Score),
    q2_score: Math.round(q2Score),
    q3_score: Math.round(q3Score),
    total: Math.round(total),
    event_like_ratio: 0, // calculateConsensusForQuery에서 계산
  };
}

/**
 * Consensus 라이트 계산 (Q1만, API 비용 절감)
 */
export async function calculateConsensusLight(event: Event): Promise<number> {
  const year = new Date().getFullYear();
  const q1 = `"${event.title}" ${event.venue || ''} ${year}`.trim();
  const q1Score = await calculateConsensusForQuery(q1, event);
  return Math.round(q1Score);
}

/**
 * 단일 쿼리에 대한 Consensus 점수 계산
 */
async function calculateConsensusForQuery(query: string, event: Event): Promise<number> {
  try {
    // 블로그 + 웹 검색 (병렬)
    const [blogResult, webResult] = await Promise.allSettled([
      searchNaverBlog({ query, display: 30, sort: 'sim' }),
      searchNaverWeb({ query, display: 30 }),
    ]);

    const blogItems = blogResult.status === 'fulfilled' ? blogResult.value.items : [];
    const webItems = webResult.status === 'fulfilled' ? webResult.value.items : [];

    // 이벤트 관련 필터링
    const relevantBlogItems = blogItems.filter(item => isEventLike(item, event));
    const relevantWebItems = webItems.filter(item => isEventLike(item, event));

    const totalItems = blogItems.length + webItems.length;
    const relevantItems = relevantBlogItems.length + relevantWebItems.length;

    if (totalItems === 0) return 0;

    // Event-like 비율 → 점수 변환
    const eventLikeRatio = relevantItems / totalItems;
    const score = eventLikeRatio * 100;

    console.log('[Consensus]', {
      query: query.slice(0, 50),
      totalItems,
      relevantItems,
      eventLikeRatio: (eventLikeRatio * 100).toFixed(1) + '%',
      score: Math.round(score),
    });

    // Rate Limit 방지: API 호출 후 500ms 대기 (네이버 429 에러 방지)
    await new Promise(resolve => setTimeout(resolve, 500));

    return score;
  } catch (error: any) {
    console.error('[Consensus] Error:', { query, error: error.message });
    
    // 429 에러(Rate Limit)면 더 길게 대기 후 재시도
    if (error.message.includes('429')) {
      console.warn('[Consensus] Rate limit hit, waiting 3 seconds...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    return 0;
  }
}

/**
 * 검색 결과가 이벤트 관련인지 판별
 * 
 * GPT 피드백 반영:
 * - Hard Drop: 종료/판매종료 키워드
 * - Soft Penalty: 후기/리뷰 (-10점, 전시는 완화)
 * - Positive Signals: 예매/예약/전시/공연 키워드
 */
function isEventLike(item: any, event: Event): boolean {
  const title = stripHtmlTags(item.title || '').toLowerCase();
  const description = stripHtmlTags(item.description || '').toLowerCase();
  const text = title + ' ' + description;

  // Hard Drop (즉시 제외)
  const hardDropKeywords = ['판매종료', '공연종료', '전시종료', '마감되었습니다', '종료되었습니다'];
  for (const keyword of hardDropKeywords) {
    if (text.includes(keyword)) {
      return false;
    }
  }

  let score = 0;

  // Soft Penalty (후기/리뷰)
  // GPT 제안: 전시는 -10으로 완화, 나머지는 -30
  if (/후기|리뷰|다녀왔어요|다녀옴/.test(text)) {
    if (event.main_category === '전시') {
      score -= 10;
    } else {
      score -= 30;
    }
  }

  // Positive Signals (카테고리별)
  const positiveKeywords = getPositiveKeywords(event.main_category);
  for (const keyword of positiveKeywords) {
    if (text.includes(keyword)) {
      score += 20;
    }
  }

  // 예매/예약 키워드 (강한 신호)
  if (/예매|예약|신청|티켓|입장권/.test(text)) {
    score += 30;
  }

  return score > 0;
}

/**
 * 카테고리별 Positive 키워드
 * 
 * Perplexity 피드백: 전시는 "전시", "전시회", "관람" 등 추가
 */
function getPositiveKeywords(category: string): string[] {
  switch (category) {
    case '전시':
      return [
        '전시', '전시회', '미술관', '박물관',
        '아트', '갤러리', '뮤지엄',
        '기간', '운영시간', '관람', '입장료',
      ];
    case '공연':
      return [
        '공연', '공연장', '티켓', '좌석',
        '공연시간', '러닝타임', '출연진',
      ];
    case '축제':
      return [
        '축제', '행사', '프로그램', '일정',
        '개최', '진행', '참여',
      ];
    case '팝업':
      return [
        '팝업', '팝업스토어', '운영', '위치',
        '오픈', '기간', '매장',
      ];
    case '행사':
      return [
        '행사', '신청', '접수', '모집',
        '참가', '등록', '선착순',
      ];
    default:
      return ['이벤트', '일정', '장소', '시간'];
  }
}

/**
 * 카테고리 → 검색 키워드 변환
 */
function getCategoryKeyword(category: string): string {
  const map: Record<string, string> = {
    '공연': '공연',
    '전시': '전시회',
    '축제': '축제',
    '팝업': '팝업스토어',
    '행사': '행사',
  };
  return map[category] || '이벤트';
}

// ==================== Structural 계산 ====================

/**
 * Structural 점수 계산 (이벤트 구조적 특징)
 * 
 * - Venue Score: 장소 신뢰도 (40%)
 * - Duration Score: 기간 적절성 (30%)
 * - Source Score: 출처 신뢰도 (30%)
 */
export function calculateStructuralScore(event: Event): StructuralComponents {
  const venueScore = calculateVenueScore(event.venue || '');
  const durationScore = calculateDurationScore(event.start_at, event.end_at);
  const sourceScore = calculateSourceScore(event.source || '');

  const total = venueScore * 0.4 + durationScore * 0.3 + sourceScore * 0.3;

  return {
    venue_score: Math.round(venueScore),
    duration_score: Math.round(durationScore),
    source_score: Math.round(sourceScore),
    total: Math.round(total),
  };
}

/**
 * Venue Score: 장소 신뢰도 (0-100)
 * 
 * Gemini 피드백: 백화점 추가 (필수!)
 * Perplexity 피드백: 공공기관 우대
 */
function calculateVenueScore(venue: string): number {
  if (!venue) return 50; // 기본 점수

  const venueLower = venue.toLowerCase();

  // Tier 1: 공공 기관 (100점)
  const tier1 = [
    '예술의전당', '세종문화회관', '국립',
    '시립', '구립', '도립',
  ];
  for (const keyword of tier1) {
    if (venueLower.includes(keyword)) return 100;
  }

  // Tier 2: 백화점 및 복합몰 (90점) - Gemini 피드백
  const tier2 = [
    '더현대', '롯데백화점', '신세계백화점', '현대백화점',
    '코엑스', '스타필드', 'ifc몰', '잠실',
  ];
  for (const keyword of tier2) {
    if (venueLower.includes(keyword)) return 90;
  }

  // Tier 3: 유명 민간 시설 (80점)
  const tier3 = [
    '갤러리', '아트센터', '문화센터',
    '극장', '콘서트홀', '미술관', '박물관',
  ];
  for (const keyword of tier3) {
    if (venueLower.includes(keyword)) return 80;
  }

  // Tier 4: 힙한 지역 (70점) - 팝업용
  const tier4 = [
    '성수', '한남', '연남', '이태원', '을지로',
    '압구정', '청담', '가로수길', '삼청동',
  ];
  for (const keyword of tier4) {
    if (venueLower.includes(keyword)) return 70;
  }

  return 50; // 기본 점수
}

/**
 * Duration Score: 기간 적절성 (0-100)
 */
function calculateDurationScore(startAt: Date, endAt: Date): number {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const durationDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);

  // 기간별 점수
  if (durationDays < 1) return 30;       // 1일 미만: 의심스러움
  if (durationDays <= 7) return 60;      // 1주일: 팝업 스토어
  if (durationDays <= 30) return 80;     // 1개월: 전시/팝업
  if (durationDays <= 90) return 100;    // 3개월: 전시 (최적)
  if (durationDays <= 180) return 80;    // 6개월: 장기 전시
  return 60;                             // 6개월 이상: 상설
}

/**
 * Source Score: 출처 신뢰도 (0-100)
 * 
 * Perplexity 피드백: 공공 API 우대
 */
function calculateSourceScore(source: string): number {
  if (!source) return 50;

  const sourceLower = source.toLowerCase();

  // Tier 1: 공공 API (100점)
  if (sourceLower.includes('kopis')) return 100;
  if (sourceLower.includes('문화포털')) return 100;
  if (sourceLower.includes('한국관광공사')) return 100;

  // Tier 2: Admin 수동 입력 (90점)
  if (sourceLower.includes('admin')) return 90;
  if (sourceLower.includes('manual')) return 90;

  // Tier 3: 신뢰할 수 있는 파트너 (80점)
  if (sourceLower.includes('interpark')) return 80;
  if (sourceLower.includes('yes24')) return 80;

  return 50; // 기본 점수
}

// ==================== Time Boost (전시 전용) ====================

/**
 * Time Boost: 종료 임박 부스트 (전시 전용)
 * 
 * Gemini 피드백: 7일 이내 종료 → 1.2배 부스트
 */
export function calculateTimeBoost(event: Event): number {
  if (event.main_category !== '전시') return 1.0;

  const now = new Date();
  const endAt = new Date(event.end_at);
  const daysUntilEnd = (endAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

  if (daysUntilEnd <= 7 && daysUntilEnd >= 0) {
    return 1.2; // 20% 부스트
  }

  return 1.0; // 부스트 없음
}

// ==================== 팝업 Candidate Score ====================

/**
 * 팝업 Candidate Score 계산 (후보점수)
 * 
 * GPT 재정의: "hot_score"가 아니라 "candidate_score"
 */
export function calculatePopupCandidateScore(event: Event): number {
  const recencyScore = calculateRecencyScore(event.start_at);
  const locationScore = calculateLocationHipness(event.venue || '');

  return recencyScore * 0.5 + locationScore * 0.5;
}

/**
 * Recency Score: 최신성 (0-100)
 */
function calculateRecencyScore(startAt: Date): number {
  const now = new Date();
  const start = new Date(startAt);
  const daysAgo = (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);

  if (daysAgo < 0) return 100;       // 미래 이벤트
  if (daysAgo <= 7) return 90;       // 1주일 이내
  if (daysAgo <= 14) return 70;      // 2주일 이내
  if (daysAgo <= 30) return 50;      // 1개월 이내
  return 30;                         // 1개월 이상
}

/**
 * Location Hipness: 힙한 장소 점수 (0-100)
 * 
 * Gemini 피드백: 백화점 필수 추가
 */
function calculateLocationHipness(venue: string): number {
  if (!venue) return 0;

  const venueLower = venue.toLowerCase();

  // 힙한 동네 (100점)
  const hipPlaces = [
    '성수', '한남', '연남', '이태원', '을지로',
    '압구정', '청담', '가로수길', '삼청동',
  ];
  for (const place of hipPlaces) {
    if (venueLower.includes(place)) return 100;
  }

  // 백화점 (90점) - Gemini 필수!
  const departments = [
    '더현대', '현대백화점', '롯데백화점', '신세계백화점',
    '코엑스', '스타필드', 'ifc몰',
  ];
  for (const dept of departments) {
    if (venueLower.includes(dept)) return 90;
  }

  return 50; // 기본 점수
}

// ==================== 유효성 게이트 (행사 전용) ====================

/**
 * Validity Gate: 유효성 게이트 (행사 전용)
 * 
 * GPT 피드백: 참여/신청/모집 키워드 + 일정 + 장소 필수
 */
export function calculateValidityScore(event: Event): number {
  if (event.main_category !== '행사') return 100; // 행사가 아니면 Pass

  const title = event.title.toLowerCase();
  const hasParticipation = /참여|신청|모집|등록|접수/.test(title);
  const hasSchedule = event.start_at && event.end_at;
  const hasVenue = !!event.venue;

  if (!hasParticipation || !hasSchedule || !hasVenue) {
    return 0; // 유효하지 않음
  }

  return 100; // 유효함
}

