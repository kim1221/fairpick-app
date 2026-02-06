/**
 * Internal Fields Generator (Phase 2)
 * 
 * 기존 데이터(derived_tags, opening_hours, lat/lng 등)를 가공하여
 * 추천 알고리즘에 바로 사용 가능한 metadata.internal 생성
 */

// ================================================================
// 1. 태그 분류 상수
// ================================================================

const TAG_CATEGORIES = {
  COMPANION: ['혼자', '커플', '데이트', '가족', '아이와함께', '친구', '단체'],
  AGE_GROUP: ['10대', '20대', '30대', '40대', '50대', '60대+', '시니어'],
  MOOD: ['힙한', '조용한', '감성적', '활기찬', '전통적', '모던한', '아늑한', '고급스러운', '유쾌한', '로맨틱'],
  CHARACTERISTIC: ['사진맛집', '체험형', '교육적', '힐링', '인터랙티브', '기념품', '전시', '공연', '주말추천'],
  LOCATION: ['실내', '야외', '주차가능', '지하철근처'],
} as const;

// ================================================================
// 2. 카테고리별 기본 속성
// ================================================================

const CATEGORY_ATTRIBUTES = {
  '공연': { 
    indoor: true, 
    weather_dependent: false, 
    avg_duration: 120 
  },
  '전시': { 
    indoor: true, 
    weather_dependent: false, 
    avg_duration: 90 
  },
  '팝업': { 
    indoor: true, 
    weather_dependent: false, 
    avg_duration: 60 
  },
  '축제': { 
    indoor: false, 
    weather_dependent: true, 
    avg_duration: 180 
  },
  '행사': { 
    indoor: null,  // 혼합
    weather_dependent: null, 
    avg_duration: 120 
  },
} as const;

// ================================================================
// 3. Matching Fields 생성 (derived_tags 분류)
// ================================================================

interface MatchingFields {
  companions: string[];
  age_groups: string[];
  mood: string[];
  characteristics: string[];
  location_tags: string[];
  indoor?: boolean;
  weather_dependent?: boolean;
}

export function generateMatchingFields(
  derived_tags: string[] = [],
  main_category: string
): MatchingFields {
  const matching: MatchingFields = {
    companions: derived_tags.filter(t => TAG_CATEGORIES.COMPANION.includes(t as any)) as any,
    age_groups: derived_tags.filter(t => TAG_CATEGORIES.AGE_GROUP.includes(t as any)) as any,
    mood: derived_tags.filter(t => TAG_CATEGORIES.MOOD.includes(t as any)) as any,
    characteristics: derived_tags.filter(t => TAG_CATEGORIES.CHARACTERISTIC.includes(t as any)) as any,
    location_tags: derived_tags.filter(t => TAG_CATEGORIES.LOCATION.includes(t as any)) as any,
  };

  // 카테고리 기반 속성 추가
  const categoryAttrs = CATEGORY_ATTRIBUTES[main_category as keyof typeof CATEGORY_ATTRIBUTES];
  if (categoryAttrs) {
    if (categoryAttrs.indoor !== null) {
      matching.indoor = categoryAttrs.indoor;
    }
    if (categoryAttrs.weather_dependent !== null) {
      matching.weather_dependent = categoryAttrs.weather_dependent;
    }
  }

  // location_tags에서도 추론
  if (matching.location_tags.includes('실내')) {
    matching.indoor = true;
    matching.weather_dependent = false;
  }
  if (matching.location_tags.includes('야외')) {
    matching.indoor = false;
    matching.weather_dependent = true;
  }

  return matching;
}

// ================================================================
// 4. Timing Fields 생성 (opening_hours 파싱)
// ================================================================

interface TimingFields {
  morning_available: boolean;    // 06:00-12:00
  afternoon_available: boolean;  // 12:00-18:00
  evening_available: boolean;    // 18:00-22:00
  night_available: boolean;      // 22:00-06:00
  best_days: string[];
  avg_duration: number | null;
}

export function generateTimingFields(
  opening_hours: any = {},
  main_category: string
): TimingFields {
  const timing: TimingFields = {
    morning_available: false,
    afternoon_available: false,
    evening_available: false,
    night_available: false,
    best_days: [],
    avg_duration: null,
  };

  // 1. opening_hours 파싱
  const weekdayHours = parseTimeRange(opening_hours?.weekday);
  const weekendHours = parseTimeRange(opening_hours?.weekend);

  if (weekdayHours || weekendHours) {
    const hours = weekdayHours || weekendHours;
    
    if (hours) {
      timing.morning_available = hours.start <= 12;
      timing.afternoon_available = hours.end >= 12 && hours.start < 18;
      timing.evening_available = hours.end >= 18;
      timing.night_available = hours.end >= 22 || hours.end < 6;
    }
  }

  // 2. 휴무일 파싱
  const closedDays = parseClosed(opening_hours?.closed);
  const allDays = ['월', '화', '수', '목', '금', '토', '일'];
  timing.best_days = allDays.filter(day => !closedDays.includes(day));

  // 3. 평균 소요 시간 (카테고리 기본값)
  const categoryAttrs = CATEGORY_ATTRIBUTES[main_category as keyof typeof CATEGORY_ATTRIBUTES];
  timing.avg_duration = categoryAttrs?.avg_duration || 120;

  return timing;
}

/**
 * 시간 문자열 파싱
 * @example "10:00-20:00" → { start: 10, end: 20 }
 */
function parseTimeRange(timeStr: string | undefined): { start: number; end: number } | null {
  if (!timeStr) return null;

  const match = timeStr.match(/(\d{1,2}):?(\d{2})?\s*[-~]\s*(\d{1,2}):?(\d{2})?/);
  if (!match) return null;

  const start = parseInt(match[1], 10);
  const end = parseInt(match[3], 10);

  return { start, end };
}

/**
 * 휴무일 파싱
 * @example "월요일" → ["월"]
 * @example "월, 화" → ["월", "화"]
 */
function parseClosed(closedStr: string | undefined): string[] {
  if (!closedStr) return [];

  const dayMap: Record<string, string> = {
    '월': '월', '월요일': '월',
    '화': '화', '화요일': '화',
    '수': '수', '수요일': '수',
    '목': '목', '목요일': '목',
    '금': '금', '금요일': '금',
    '토': '토', '토요일': '토',
    '일': '일', '일요일': '일',
  };

  const closed: string[] = [];
  for (const [key, value] of Object.entries(dayMap)) {
    if (closedStr.includes(key)) {
      closed.push(value);
    }
  }

  return [...new Set(closed)]; // 중복 제거
}

// ================================================================
// 5. Location Fields 생성 (lat/lng 계산)
// ================================================================

interface LocationFields {
  metro_nearby: boolean;
  nearest_station: string | null;
  walking_distance: number | null;
  downtown: boolean;
  tourist_area: boolean;
}

/**
 * 위치 정보 계산 (Phase 2에서는 간단한 버전)
 * 
 * TODO: Phase 2.5에서 실제 지하철역 API 연동
 */
export function generateLocationFields(
  lat: number | null,
  lng: number | null,
  address: string | null,
  region: string | null
): LocationFields {
  const location: LocationFields = {
    metro_nearby: false,
    nearest_station: null,
    walking_distance: null,
    downtown: false,
    tourist_area: false,
  };

  // 좌표가 없으면 기본값 반환
  if (!lat || !lng) {
    return location;
  }

  // 1. 도심 여부 (서울/부산/대구/인천 주요 구)
  if (address) {
    const downtownPatterns = [
      // 서울
      '종로구', '중구', '강남구', '서초구', '송파구', '마포구', '용산구',
      // 부산
      '부산 중구', '부산 서구', '해운대구',
      // 대구
      '대구 중구',
      // 인천
      '인천 중구', '인천 동구',
    ];
    location.downtown = downtownPatterns.some(p => address.includes(p));
  }

  // 2. 관광지 여부 (주요 관광지 키워드)
  if (address) {
    const touristPatterns = [
      '명동', '홍대', '강남', '인사동', '이태원', '잠실', '여의도',
      '해운대', '광안리', '서면', '남포동',
      '동성로', '수성못',
    ];
    location.tourist_area = touristPatterns.some(p => address.includes(p));
  }

  // 3. 지하철 근처 여부 (간단한 추정)
  // TODO: 실제 지하철역 DB와 거리 계산 필요
  // 현재는 도심이면 true로 가정
  location.metro_nearby = location.downtown || location.tourist_area;

  return location;
}

// ================================================================
// 6. 전체 Internal Fields 생성
// ================================================================

export interface InternalFields {
  matching: MatchingFields;
  timing: TimingFields;
  location: LocationFields;
}

export interface EventDataForInternal {
  derived_tags?: string[];
  opening_hours?: any;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  region?: string | null;
  main_category: string;
}

/**
 * 메인 함수: 이벤트 데이터로부터 Internal Fields 생성
 */
export function generateInternalFields(event: EventDataForInternal): InternalFields {
  return {
    matching: generateMatchingFields(
      event.derived_tags || [],
      event.main_category
    ),
    timing: generateTimingFields(
      event.opening_hours,
      event.main_category
    ),
    location: generateLocationFields(
      event.lat ?? null,
      event.lng ?? null,
      event.address ?? null,
      event.region ?? null
    ),
  };
}

