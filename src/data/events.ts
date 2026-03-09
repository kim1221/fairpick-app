export type EventCategory = '전체' | '축제' | '공연' | '행사' | '전시';

export type Region =
  | '전국'
  | '서울'
  | '경기'
  | '부산'
  | '강원'
  | '충북'
  | '충남'
  | '전북'
  | '전남'
  | '경북'
  | '경남'
  | '제주'
  | '인천'
  | '대구'
  | '대전'
  | '광주'
  | '울산'
  | '세종'
  | '기타';

export interface EventCardData {
  id: string;
  category: Exclude<EventCategory, '전체'>;
  region: Exclude<Region, '전국'>;
  title: string;
  displayTitle?: string;
  contentKey?: string;
  periodText: string;
  startAt?: string;
  endAt?: string;
  mainCategory?: string;
  subCategory?: string;
  venue: string;
  description: string;
  overview: string;
  tags: string[];
  thumbnailUrl: string;
  detailImageUrl: string;
  detailLink: string;
  isFree?: boolean;
  isEndingSoon?: boolean;
  popularityScore?: number;
  address?: string;
  lat?: number;
  lng?: number;
  // Phase 1 UI fields (normalized by backend)
  priceInfo?: string;
  priceMin?: number;
  priceMax?: number;
  priceText?: string;
  buzzScore?: number;
  openingHours?: {
    weekday?: string;
    weekend?: string;
    holiday?: string;
    closedDays?: string;
    notes?: string;
    [key: string]: string | undefined;
  };
  bookingLink?: string;
  externalLinks?: {
    ticket?: string;
    official?: string;
    reservation?: string;
    instagram?: string;
    [key: string]: string | undefined;
  };
  // 교통/주차
  parkingAvailable?: boolean;
  parkingInfo?: string;
  publicTransportInfo?: string;
  // 공연/전시 공용
  durationMinutes?: number;       // 관람/공연 소요 시간(분) [Tier 2]
  lastAdmission?: string;         // 마지막 입장 시간 [Tier 1]
  // 카테고리별 메타 (공연)
  cast?: string;
  genre?: string;
  crewDirector?: string;          // 연출/감독 [Tier 3 — overview 시트]
  crewWriter?: string;            // 작가/작사 [Tier 3]
  crewComposer?: string;          // 작곡가 [Tier 3]
  // 카테고리별 메타 (전시)
  artists?: string;
  photographyAllowed?: boolean;   // 촬영 허용 여부 [Tier 2]
  photoZone?: boolean;            // 포토존 유무 (팝업/전시 공용) [Tier 2]
  photoZoneDesc?: string;         // 포토존 상세 설명 [Tier 2]
  // 카테고리별 메타 (축제)
  organizer?: string;
  programHighlights?: string;
  // 카테고리별 메타 (팝업)
  popupType?: string;             // 'fnb' | 'collab' | 'general'
  brands?: string;
  bestItems?: string;
  collabDescription?: string;     // 콜라보 설명
  goodsItems?: string;            // 굿즈 정보 [Tier 2]
  waitingHint?: string;           // 대기 안내 텍스트 [Tier 1]
  // 카테고리별 메타 (행사)
  registrationRequired?: boolean; // 사전 등록 필수 [Tier 1]
  registrationDeadline?: string;  // 등록 마감일 [Tier 1]
  targetAudience?: string;        // 참가 대상 [Tier 2]
  eventCapacity?: string;         // 정원 [Tier 2]
  derivedTags?: string[];         // AI 분석 태그 (reason label 용)
}

export const EVENT_CATEGORIES: EventCategory[] = ['전체', '축제', '공연', '행사', '전시'];

export const REGIONS: Region[] = [
  '전국',
  '서울',
  '경기',
  '부산',
  '강원',
  '충북',
  '충남',
  '전북',
  '전남',
  '경북',
  '경남',
  '제주',
  '인천',
  '대구',
  '대전',
  '광주',
  '울산',
  '세종',
  '기타',
];

export const MOCK_EVENTS: EventCardData[] = [
  {
    id: 'ev-001',
    category: '축제',
    region: '서울',
    title: '빛의 축제, 윈터 뮤지엄',
    periodText: '25.12.01 ~ 26.02.28',
    venue: '서울 강남구',
    description: '천장의 미디어 캔버스로 겨울의 빛을 만나는 전시.',
    overview: '천장의 미디어 캔버스로 겨울의 빛을 만나는 전시. 크리스마스 시즌을 맞아 특별한 빛의 향연을 선사합니다.',
    tags: ['크리스마스'],
    thumbnailUrl: 'https://static.toss.im/tds/icon/picture/default-01.png',
    detailImageUrl: 'https://static.toss.im/tds/icon/picture/default-02.png',
    detailLink: 'https://example.com/events/winter-museum',
  },
  {
    id: 'ev-002',
    category: '공연',
    region: '부산',
    title: '겨울 바다 재즈 나이트',
    periodText: '25.12.24 ~ 25.12.26',
    venue: '해운대 야외무대',
    description: '부산 해운대 야외무대에서 즐기는 라이브 재즈.',
    overview: '부산 해운대 야외무대에서 즐기는 라이브 재즈. 바다를 배경으로 펼쳐지는 특별한 공연을 만나보세요.',
    tags: ['재즈'],
    thumbnailUrl: 'https://static.toss.im/tds/icon/picture/default-03.png',
    detailImageUrl: 'https://static.toss.im/tds/icon/picture/default-04.png',
    detailLink: 'https://example.com/events/busan-jazz',
  },
  {
    id: 'ev-003',
    category: '행사',
    region: '강원',
    title: '스노우 피크 페스티벌',
    periodText: '26.01.10 ~ 26.01.20',
    venue: '강원도 평창',
    description: '강원 설원에서 캠핑 기어를 체험하고 공연도 보는 박람회.',
    overview: '강원 설원에서 캠핑 기어를 체험하고 공연도 보는 박람회. 겨울 캠핑의 매력을 느껴보세요.',
    tags: ['겨울축제'],
    thumbnailUrl: 'https://static.toss.im/tds/icon/picture/default-05.png',
    detailImageUrl: 'https://static.toss.im/tds/icon/picture/default-06.png',
    detailLink: 'https://example.com/events/snow-peak',
  },
];
