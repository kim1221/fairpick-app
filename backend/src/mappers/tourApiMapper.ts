import { v5 as uuidv5 } from 'uuid';

export interface TourApiItem {
  contentid: string;
  title: string;
  overview?: string;
  contenttypeid?: string;
  eventstartdate?: string;
  eventenddate?: string;
  areacode?: string;
  sigungucode?: string;
  addr1?: string;
  cat1?: string;
  cat2?: string;
  cat3?: string;
  firstimage?: string;
  firstimage2?: string;
  homepage?: string;
  modifiedtime?: string;
  mapx?: string;
  mapy?: string;
  /**
   * Collector에서 detailCommon2/detailIntro2 등으로 보강한 상세 텍스트
   * (원본 응답에는 없고, 수집 파이프라인에서 주입)
   */
  detailText?: string;
  /**
   * Collector에서 detailIntro2의 eventplace로 주입 (행사 장소)
   */
  eventplace?: string;
}

export interface EventPayload {
  id: string;
  source: string;
  externalId: string;
  title: string;
  description: string;
  overview: string;
  venue: string;
  periodText: string;
  startDate: string;
  endDate: string;
  region: string;
  category: string;
  tags: string[];
  thumbnailUrl: string;
  detailImageUrl: string;
  detailLink: string;
  updatedAt: string;
}

const REGION_CODE_MAP: Record<string, string> = {
  '1': '서울',
  '31': '경기',
  '2': '인천',
  '3': '대전',
  '4': '대구',
  '5': '광주',
  '6': '부산',
  '7': '울산',
  '8': '세종',
  '32': '강원',
  '33': '충북',
  '34': '충남',
  '35': '경북',
  '36': '경남',
  '37': '전북',
  '38': '전남',
  '39': '제주',
};

const CATEGORY_MAP: Record<string, string> = {
  // A0207: 축제
  A02070200: '축제', // 지역축제/테마축제
  
  // A0208: 공연/행사
  A02080100: '공연', // 전통공연
  A02080200: '축제', // 축제 행사
  A02080300: '공연', // 넌버벌 퍼포먼스
  A02080500: '전시', // 전시
  
  // A0208: 기타행사
  A02081000: '공연', // 공연 프로그램
  A02081200: '행사', // 스포츠 행사
  A02081300: '행사', // 마켓/박람회/전시/기타행사
};

const CAT3_TAG_MAP: Record<string, string> = {
  A02070200: '지역축제',
  A02080100: '전통공연',
  A02080200: '테마축제',
  A02080300: '넌버벌',
  A02080500: '전시',
  A02081000: '공연',
  A02081200: '스포츠',
  A02081300: '마켓',
};

const KTO_NAMESPACE = 'b5d9d0da-c0f4-4c16-a2dd-1c10fba3f8c3';

/**
 * overview 텍스트에서 "운영 성격" 키워드를 추출합니다. (테마가 아니라 운영/형태 정보)
 */
function extractKeywords(overview?: string): string[] {
  if (!overview) {
    return [];
  }

  const keywords: string[] = [];
  const text = overview.toLowerCase();

  // 무료 입장
  if (text.includes('무료') || text.includes('free')) {
    keywords.push('무료');
  }

  // 실내/야외
  if (text.includes('야외') || text.includes('outdoor')) {
    keywords.push('야외');
  } else if (text.includes('실내') || text.includes('indoor')) {
    keywords.push('실내');
  }

  // 체험 가능
  if (text.includes('체험') || text.includes('참여') || text.includes('직접')) {
    keywords.push('체험');
  }

  // 가족 친화
  if (text.includes('가족') || text.includes('어린이') || text.includes('키즈')) {
    keywords.push('가족');
  }

  // 야간 행사
  if (text.includes('야간') || text.includes('밤') || text.includes('night')) {
    keywords.push('야간');
  }

  // 주말 행사
  if (text.includes('주말') || text.includes('토·일') || text.includes('토요일') || text.includes('일요일')) {
    keywords.push('주말');
  }

  return keywords;
}

/**
 * 제목/소개에서 "행사만의 테마"를 우선적으로 추출합니다.
 * - rule 기반(정확도) + 토큰 fallback(커버리지)
 */
function extractThemeTags(title?: string, overview?: string): string[] {
  const raw = `${title ?? ''} ${overview ?? ''}`.trim();
  if (!raw) {
    return [];
  }

  const text = raw.toLowerCase();

  const rules: Array<{ tag: string; patterns: RegExp[] }> = [
    { tag: '반려동물', patterns: [/반려(견|동물)/, /애견/, /\bpet\b/i, /\bdog\b/i, /도그/i] },
    { tag: '도그쇼', patterns: [/도그\s*쇼/, /\bdog\s*show\b/i, /dogshow/i] },
    { tag: '애견미용', patterns: [/애견\s*미용/, /그루밍/, /grooming/i] },
    { tag: '콘테스트', patterns: [/콘테스트/, /contest/i] },
    { tag: '체험부스', patterns: [/체험\s*부스/, /부스/, /워크숍/, /workshop/i] },
    { tag: '크리스마스', patterns: [/christmas/i, /크리스마스/, /x-?mas/i] },
    { tag: '연말', patterns: [/연말/, /송년/, /뉴이어/, /new\s*year/i] },
    { tag: '불꽃', patterns: [/불꽃/, /firework/i] },
    { tag: '빛', patterns: [/빛/, /라이트/i, /light\s*show/i, /illumination/i] },
    { tag: '마켓', patterns: [/마켓/, /플리마켓/, /야시장/, /market/i] },
    { tag: '전통', patterns: [/전통/, /국악/, /한복/, /풍물/] },
    { tag: '재즈', patterns: [/재즈/, /jazz/i] },
    { tag: '클래식', patterns: [/클래식/, /classic(al)?/i] },
    { tag: '콘서트', patterns: [/콘서트/, /\bconcert\b/i] },
    { tag: '뮤지컬', patterns: [/뮤지컬/, /musical/i] },
    { tag: '연극', patterns: [/연극/, /theatre/i, /theater/i] },
    { tag: '전시', patterns: [/전시/, /exhibition/i] },
    { tag: '미디어아트', patterns: [/미디어\s*아트/, /media\s*art/i] },
    { tag: '푸드', patterns: [/푸드/, /먹거리/, /미식/, /food/i] },
    { tag: '와인', patterns: [/와인/, /wine/i] },
    { tag: '맥주', patterns: [/맥주/, /beer/i] },
    { tag: '커피', patterns: [/커피/, /coffee/i] },
    { tag: '캠핑', patterns: [/캠핑/, /camping/i] },
    { tag: '러닝', patterns: [/러닝/, /마라톤/, /run(n?ing)?/i] },
    { tag: '드론', patterns: [/드론/, /drone/i] },
  ];

  const tags: string[] = [];
  for (const rule of rules) {
    if (tags.length >= 2) {
      break;
    }
    if (rule.patterns.some((p) => p.test(text))) {
      tags.push(rule.tag);
    }
  }

  // 토큰 fallback: 너무 일반적인 단어는 제외하고, 짧고 선명한 키워드 1~2개만 추가
  if (tags.length < 2) {
    const stopwords = new Set([
      '축제',
      '행사',
      '공연',
      '페스티벌',
      '이벤트',
      '프로그램',
      '체험',
      '전시',
      '관람',
      '안내',
      '참여',
      '모집',
      '운영',
      '일정',
      '시간',
      '장소',
      '무료',
      '유료',
    ]);

    const tokens = raw
      .replace(/<[^>]+>/g, ' ')
      .replace(/[·•]/g, ' ')
      .replace(/\s+/g, ' ')
      .match(/[가-힣a-zA-Z0-9]{2,}/g);

    const uniq = [...new Set(tokens ?? [])]
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && t.length <= 10)
      .filter((t) => !stopwords.has(t))
      // 너무 일반적인 접미어/접두어 제거 느낌(가벼운 필터)
      .filter((t) => !/(특별시|광역시|도|시|군|구|동)$/.test(t));

    for (const t of uniq) {
      if (tags.length >= 2) {
        break;
      }
      if (!tags.includes(t)) {
        tags.push(t);
      }
    }
  }

  return tags;
}

/**
 * 상세 텍스트(제목/overview/intro 등)에서 “행사 특성” 태그를 추출합니다.
 * 예: 체험부스, 예약필수, 현장참여, 반려동물, 애견미용콘테스트 등
 */
function extractCharacteristicTags(text: string): string[] {
  const t = text.toLowerCase();
  const tags: string[] = [];

  const has = (...patterns: RegExp[]) => patterns.some((p) => p.test(t));

  // 예약/신청
  if (has(/사전\s*신청/, /사전신청/, /예약\s*필수/, /\breservation\b/i, /booking/i, /예매/)) {
    tags.push('예약필수');
  } else if (has(/현장\s*(참여|접수)/, /현장참여/, /현장접수/)) {
    tags.push('현장참여');
  }

  // 체험부스
  if (has(/체험\s*부스/, /체험부스/, /워크숍/, /workshop/i, /부대\s*행사/, /부대행사/)) {
    tags.push('체험부스');
  }

  // 반려동물 관련
  const isPet = has(/반려(견|동물)/, /애견/, /\bpet\b/i, /\bdog\b/i, /도그/i);
  if (isPet) {
    tags.push('반려동물');
  }

  // 도그쇼 / 콘테스트 / 애견미용콘테스트
  const isContest = has(/콘테스트/, /contest/i, /경연/, /대회/);
  const isGrooming = has(/애견\s*미용/, /그루밍/, /grooming/i);
  const isDogShow = has(/도그\s*쇼/, /\bdog\s*show\b/i, /dogshow/i, /도그쇼/);

  if (isPet && isGrooming && isContest) {
    tags.push('애견미용콘테스트');
  } else {
    if (isDogShow) {
      tags.push('도그쇼');
    }
    if (isGrooming) {
      tags.push('애견미용');
    }
    if (isContest) {
      tags.push('콘테스트');
    }
  }

  // 참여 대상
  if (has(/어린이/, /키즈/, /kids/i)) {
    tags.push('키즈');
  }
  if (has(/가족/)) {
    tags.push('가족');
  }

  // 중복 제거(순서 유지)
  return [...new Set(tags)];
}

export function mapTourApiItem(item: TourApiItem): EventPayload | null {
  if (!item.contentid || !item.title) {
    return null;
  }

  const startDate = normalizeDate(item.eventstartdate);
  const endDate = normalizeDate(item.eventenddate);
  const region = REGION_CODE_MAP[item.areacode ?? ''] ?? null;
  const category = CATEGORY_MAP[item.cat3 ?? ''] ?? '축제';

  if (!startDate || !endDate || !region) {
    return null;
  }

  // Skip events that have already ended
  const today = new Date();
  today.setHours(0, 0, 0, 0); // 오늘 0시 기준
  const eventEnd = new Date(endDate);
  if (eventEnd < today) {
    return null;
  }

  // 태그 구성 원칙
  // - 지역은 UI에서 event.region으로 "항상" 표시 (tags에 넣지 않음)
  // - tags에는 "행사 테마" 위주 + 보조(운영 성격) 키워드만 담기
  const cat3Tag = CAT3_TAG_MAP[item.cat3 ?? ''];
  const tagSourceText = `${item.title ?? ''} ${item.overview ?? ''} ${item.detailText ?? ''}`.trim();
  const characteristicTags = extractCharacteristicTags(tagSourceText);
  const themeTags = extractThemeTags(item.title, item.overview);
  const keywords = extractKeywords(tagSourceText);

  // 우선순위: 특성 > 테마 > 운영성격(무료/야간 등) > 세부카테고리
  const rawTags = [...characteristicTags, ...themeTags, ...keywords, cat3Tag]
    .filter(Boolean)
    // 카테고리(축제/공연/행사)처럼 너무 일반적인 태그는 제외
    .filter((t) => t !== category);

  // 최종: 중복 제거 + 최대 4개
  const allTags = [...new Set(rawTags)].slice(0, 4);

  return {
    id: uuidv5(item.contentid, KTO_NAMESPACE),
    source: 'KTO',
    externalId: item.contentid,
    title: item.title.slice(0, 60),
    description: buildShortDescription(item.overview),
    overview: sanitize(item.overview ?? ''),
    venue: buildVenue(item),
    periodText: `${formatDisplayDate(startDate)} ~ ${formatDisplayDate(endDate)}`,
    startDate,
    endDate,
    region,
    category,
    tags: allTags,
    thumbnailUrl: normalizeImage(item.firstimage ?? item.firstimage2),
    detailImageUrl: normalizeImage(item.firstimage ?? item.firstimage2),
    detailLink: buildDetailLink(item),
    updatedAt: normalizeDateTime(item.modifiedtime) ?? new Date().toISOString(),
  };
}

/**
 * 간단한 한 줄 소개 (overview 첫 부분, 최대 80자)
 */
function buildShortDescription(overview?: string): string {
  if (!overview) {
    return '';
  }
  const cleaned = sanitize(overview);
  // 첫 문장 또는 80자까지
  const firstSentence = cleaned.split(/[.。!?]/)[0]?.trim() ?? '';
  if (firstSentence.length <= 80) {
    return firstSentence;
  }
  return cleaned.slice(0, 77) + '...';
}

/**
 * 행사 장소 (eventplace > addr1에서 간략화)
 */
function buildVenue(item: TourApiItem): string {
  // eventplace가 있으면 우선 사용
  if (item.eventplace) {
    return sanitize(item.eventplace).slice(0, 50);
  }
  // addr1에서 간략화 (동/구까지만)
  if (item.addr1) {
    const addr = sanitize(item.addr1);
    // "서울특별시 강남구 영동대로 511 (삼성동)" → "강남구 삼성동" 또는 짧게
    const match = addr.match(/([가-힣]+[시군구])\s+([가-힣]+[동읍면로길])/);
    if (match) {
      return `${match[1]} ${match[2]}`;
    }
    // 그냥 앞부분만
    return addr.slice(0, 30);
  }
  return '';
}

function sanitize(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeDate(value?: string): string | null {
  if (!value || value.length !== 8) {
    return null;
  }
  const year = value.slice(0, 4);
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  return `${year}-${month}-${day}`;
}

function normalizeDateTime(value?: string): string | null {
  if (!value || value.length !== 14) {
    return null;
  }
  const date = normalizeDate(value.slice(0, 8));
  const hour = value.slice(8, 10);
  const min = value.slice(10, 12);
  const sec = value.slice(12, 14);
  return date ? `${date}T${hour}:${min}:${sec}Z` : null;
}

function formatDisplayDate(value: string): string {
  return value.replaceAll('-', '.');
}

function buildDetailLink(item: TourApiItem): string {
  // VisitKorea 웹 상세는 cotid(별도 ID)를 요구하는 경우가 많아서 contentid로는 404가 발생할 수 있습니다.
  // homepage가 없을 때는 "검색"으로 fallback하여 사용자가 관련 정보를 찾을 수 있게 합니다.
  const fallbackQuery = encodeURIComponent(`${item.title ?? ''} ${item.addr1 ?? ''}`.trim() || item.contentid);
  const fallback = `https://m.search.naver.com/search.naver?query=${fallbackQuery}`;

  const normalizeLink = (url?: string): string | null => {
    if (!url) {
      return null;
    }

    const decodeHtmlEntities = (value: string) =>
      value
        .replaceAll('&amp;', '&')
        .replaceAll('&quot;', '"')
        .replaceAll('&#34;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&apos;', "'")
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>');

    const unescapeSlashes = (value: string) =>
      value
        // JSON/문자열에서 https:\/\/example.com 형태로 오는 케이스 처리
        .replace(/\\\//g, '/')
        // 가끔 \\u0026 로 들어오는 케이스(ampersand)
        .replace(/\\u0026/gi, '&');

    const trimmed = unescapeSlashes(decodeHtmlEntities(url)).trim();
    if (!trimmed) {
      return null;
    }

    // TourAPI homepage가 javascript: 형태로 오는 케이스 방지
    if (/^javascript:/i.test(trimmed)) {
      return null;
    }

    // 스킴이 없는 URL 보정 (www.example.com)
    if (/^www\./i.test(trimmed)) {
      return `https://${trimmed}`;
    }

    if (trimmed.startsWith('//')) {
      return `https:${trimmed}`;
    }
    if (trimmed.startsWith('http://')) {
      return trimmed.replace('http://', 'https://');
    }
    if (trimmed.startsWith('https://')) {
      return trimmed;
    }

    // 문자열 안에 URL이 포함된 경우(HTML/텍스트 혼합) 첫 번째 https? 링크를 뽑습니다.
    const embedded = trimmed.match(/https?:\/\/[^\s"'<>()]+/i);
    if (embedded?.[0]) {
      return normalizeLink(embedded[0]);
    }

    return null;
  };

  if (item.homepage) {
    // 1) HTML anchor가 여러 개면 href들을 모두 추출해서 첫 유효 URL을 사용
    const hrefMatches = [...item.homepage.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    for (const href of hrefMatches) {
      const normalized = normalizeLink(href);
      if (normalized) {
        return normalized;
      }
    }

    // 2) 단일 URL/텍스트인 경우
    const normalized = normalizeLink(item.homepage);
    if (normalized) {
      return normalized;
    }
  }

  return fallback;
}

const PLACEHOLDER_IMAGE = 'https://static.toss.im/tds/icon/picture/default-01.png';

function normalizeImage(url?: string): string {
  if (!url) {
    return PLACEHOLDER_IMAGE;
  }

  if (url.startsWith('//')) {
    return `https:${url}`;
  }

  if (url.startsWith('http://')) {
    return url.replace('http://', 'https://');
  }

  if (!url.startsWith('http')) {
    return PLACEHOLDER_IMAGE;
  }

  return url;
}

