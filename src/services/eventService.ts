import http from '../lib/http';
import { EventCardData, EventCategory, Region } from '../data/events';

export interface EventService {
  getEventById(id: string): Promise<EventCardData | undefined>;
  getEventList(params: EventListParams): Promise<EventListResult>;
  getHotEvents(page?: number, size?: number): Promise<EventListResult>;
  getFreeEvents(page?: number, size?: number): Promise<EventListResult>;
  getEndingEvents(page?: number, size?: number): Promise<EventListResult>;
  getNewEvents(page?: number, size?: number): Promise<EventListResult>;
  getRecommendedEvents(page?: number, size?: number): Promise<EventListResult>;
  getNearbyEvents(params: NearbyEventsParams): Promise<NearbyEventsResult>;
}

export interface NearbyEventsParams {
  lat: number;
  lng: number;
  radius?: number; // meters, default 3000
  page?: number;
  size?: number;
  category?: EventCategory | '전체';
  region?: Region | '전국';
}

export interface NearbyEventItem extends EventCardData {
  distanceMeters: number;
  traits?: EventTraits; // GPT 프롬프트 강화용 특성
}

export interface NearbyEventsResult {
  items: NearbyEventItem[];
  totalCount: number;
}

export interface EventListResult {
  items: EventCardData[];
  totalCount: number;
}

const eventService: EventService = {
  async getEventById(id: string) {
    const response = await http.get<EventResponse>(`/events/${id}`);
    if (__DEV__) {
      console.log('[EventService] getEventById raw response:', {
        id: response.data.id,
        mainCategory: response.data.mainCategory,
        subCategory: response.data.subCategory,
        imageUrl: response.data.imageUrl?.substring(0, 60),
      });
    }
    const mapped = mapEventResponse(response.data);
    if (__DEV__) {
      console.log('[EventService] getEventById mapped:', {
        id: mapped?.id,
        category: mapped?.category,
        thumbnailUrl: mapped?.thumbnailUrl?.substring(0, 60),
      });
    }
    return mapped;
  },
  async getEventList({ category, region, query, page = 1, size = 10 }: EventListParams) {
    // [FIX B] 파라미터 로깅 - 실제 axios 요청 전
    const params: Record<string, string | number | undefined> = {
      category: category && category !== '전체' ? category : undefined,
      region: region && region !== '전국' ? region : undefined,
      q: query && query.trim() ? query.trim() : undefined, // 검색어 (서버사이드)
      page,
      size,
    };

    console.log('[EventService][getEventList][Params]', {
      receivedCategory: category,
      receivedRegion: region,
      receivedQuery: query,
      willSendCategory: params.category,
      willSendRegion: params.region,
      willSendQuery: params.q,
      categoryIsUndefined: params.category === undefined,
      regionIsUndefined: params.region === undefined,
      queryIsUndefined: params.q === undefined,
      page: params.page,
      size: params.size,
    });

    const response = await http.get<EventListResponse>('/events', { params });

    const rawItems = response.data.items;
    const items = rawItems.map(mapEventResponse).filter((event): event is EventCardData => Boolean(event));

    const droppedCount = rawItems.length - items.length;

    if (__DEV__) {
      console.log('[EventService][Filter] getEventList - raw items:', rawItems.length, 'filtered items:', items.length, 'dropped:', droppedCount);

      if (droppedCount === 0) {
        console.log('[EventService][SUCCESS] ✅ 드롭 개수 0 달성! 모든 이벤트가 정규화되어 사용가능합니다.');
      } else {
        console.warn('[EventService][WARNING] ⚠️ 여전히', droppedCount, '개 드롭됨. 추가 디버깅 필요.');
      }

      const total = items.length;
      const other = items.filter((event) => event.region === '기타').length;
      const pct = total > 0 ? Number(((other / total) * 100).toFixed(2)) : 0;
      console.log('[EventService][RegionStats]', { total, other, pct });

      const otherRawCounts = rawItems.reduce<Record<string, number>>((acc, item) => {
        const normalized = normalizeRegion(item.region);
        if (normalized === '기타') {
          const key = item.region ?? '(null)';
          acc[key] = (acc[key] ?? 0) + 1;
        }
        return acc;
      }, {});

      const otherRawTop = Object.entries(otherRawCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([region, count]) => ({ region, count }));

      console.log('[EventService][RegionOtherTop]', otherRawTop);

      const categoryStats = rawItems.reduce<{
        total: number;
        byCategory: Record<string, number>;
        fallbackCount: number;
      }>((acc, item) => {
        const resolved = resolveCategory(item.mainCategory, item.subCategory);
        acc.total += 1;
        acc.byCategory[resolved.category] = (acc.byCategory[resolved.category] ?? 0) + 1;
        if (resolved.fallback) {
          acc.fallbackCount += 1;
        }
        return acc;
      }, { total: 0, byCategory: {}, fallbackCount: 0 });

      console.log('[EventService][CategoryStats]', categoryStats);
    }

    return {
      items,
      totalCount: response.data.pageInfo.totalCount,
    };
  },
  async getHotEvents(page = 1, size = 10) {
    const response = await http.get<EventListResponse>('/events/hot', {
      params: { page, size },
    });
    console.log('[DEBUG] /events/hot raw response:', JSON.stringify(response.data.items[0], null, 2));
    const items = response.data.items.map(mapEventResponse).filter((event): event is EventCardData => Boolean(event));
    console.log('[DEBUG] /events/hot mapped item:', JSON.stringify(items[0], null, 2));
    return {
      items,
      totalCount: response.data.pageInfo.totalCount,
    };
  },
  async getFreeEvents(page = 1, size = 10) {
    const response = await http.get<EventListResponse>('/events/free', {
      params: { page, size },
    });
    const items = response.data.items.map(mapEventResponse).filter((event): event is EventCardData => Boolean(event));
    return {
      items,
      totalCount: response.data.pageInfo.totalCount,
    };
  },
  async getEndingEvents(page = 1, size = 10) {
    const response = await http.get<EventListResponse>('/events/ending', {
      params: { page, size },
    });
    console.log('[DEBUG] /events/ending raw response:', JSON.stringify(response.data.items[0], null, 2));
    const items = response.data.items.map(mapEventResponse).filter((event): event is EventCardData => Boolean(event));
    console.log('[DEBUG] /events/ending mapped item:', JSON.stringify(items[0], null, 2));
    return {
      items,
      totalCount: response.data.pageInfo.totalCount,
    };
  },
  async getNewEvents(page = 1, size = 10) {
    const response = await http.get<EventListResponse>('/events/new', {
      params: { page, size },
    });
    const items = response.data.items.map(mapEventResponse).filter((event): event is EventCardData => Boolean(event));
    return {
      items,
      totalCount: response.data.pageInfo.totalCount,
    };
  },
  async getRecommendedEvents(page = 1, size = 10) {
    const response = await http.get<EventListResponse>('/events/recommend', {
      params: { page, size },
    });
    const items = response.data.items.map(mapEventResponse).filter((event): event is EventCardData => Boolean(event));
    return {
      items,
      totalCount: response.data.pageInfo.totalCount,
    };
  },
  async getNearbyEvents({ lat, lng, radius = 3000, page = 1, size = 10, category, region }: NearbyEventsParams) {
    console.log('🔴🔴🔴 [EventService][getNearbyEvents] FUNCTION CALLED 🔴🔴🔴');

    const params: Record<string, string | number | undefined> = {
      lat,
      lng,
      radius,
      page,
      size,
      category: category && category !== '전체' ? category : undefined,
      region: region && region !== '전국' ? region : undefined,
    };

    console.log('🔴 [EventService][getNearbyEvents] Request params:', params);
    console.log('🔴 [EventService][getNearbyEvents] About to call HTTP GET /events/nearby');

    try {
      const response = await http.get<NearbyEventsResponse>('/events/nearby', { params });

      console.log('🔴 [EventService][getNearbyEvents] HTTP response received from /events/nearby');

      if (__DEV__) {
        console.log('[EventService][getNearbyEvents][DEBUG] Raw response:', {
          status: response.status,
          hasData: !!response.data,
          dataKeys: response.data ? Object.keys(response.data) : [],
          hasItems: !!response.data?.items,
          itemsType: Array.isArray(response.data?.items) ? 'array' : typeof response.data?.items,
          itemsLength: response.data?.items?.length ?? 0,
          hasPageInfo: !!response.data?.pageInfo,
        });
      }

      // Ensure items is always an array
      const rawItems = Array.isArray(response.data?.items) ? response.data.items : [];

      if (rawItems.length === 0) {
        console.log('[EventService][getNearbyEvents][DEBUG] No items in response, returning empty result');
        return {
          items: [],
          totalCount: response.data?.pageInfo?.totalCount ?? 0,
        };
      }

      const items = rawItems.map((item) => {
        const mapped = mapEventResponse(item);
        if (!mapped) return undefined;
        
        // Traits 객체 생성 (백엔드에서 계산된 값 그대로 사용)
        const traits: EventTraits = {
          isFree: item.isFree,
          isEndingSoon: item.isEndingSoon,
          popularityScore: item.popularityScore,
          daysLeft: item.daysLeft,
          hasImage: item.hasImage, // 백엔드 계산값 사용
        };
        
        return {
          ...mapped,
          distanceMeters: item.distanceMeters,
          traits, // Traits 추가
        };
      }).filter((event): event is NearbyEventItem => Boolean(event));

      if (__DEV__) {
        console.log('[EventService][getNearbyEvents][DEBUG] Processed result:', {
          rawItemsCount: rawItems.length,
          mappedItemsCount: items.length,
          droppedCount: rawItems.length - items.length,
          totalCount: response.data.pageInfo.totalCount,
          firstThreeDistances: items.slice(0, 3).map(e => Math.round(e.distanceMeters) + 'm'),
          firstItem: items[0] ? {
            id: items[0].id,
            title: items[0].title,
            distanceMeters: items[0].distanceMeters,
            traits: items[0].traits, // Traits 확인
            thumbnailUrl: items[0].thumbnailUrl?.substring(0, 50), // 이미지 URL 확인
          } : null,
        });
      }

      return {
        items,
        totalCount: response.data.pageInfo.totalCount,
      };
    } catch (error: any) {
      console.error('[EventService][getNearbyEvents][DEBUG] Request failed:', {
        errorMessage: error?.message,
        errorCode: error?.code,
        responseStatus: error?.response?.status,
        responseData: error?.response?.data,
      });

      // Return empty result instead of throwing
      return {
        items: [],
        totalCount: 0,
      };
    }
  },
};

export default eventService;

export interface EventListParams {
  category?: EventCategory | '전체';
  region?: Region | '전국';
  query?: string; // 검색어
  page?: number;
  size?: number;
}

interface EventListResponse {
  items: EventResponse[];
  pageInfo: {
    page: number;
    size: number;
    totalCount: number;
  };
}

interface NearbyEventsResponse {
  items: NearbyEventResponse[];
  pageInfo: {
    page: number;
    size: number;
    totalCount: number;
  };
}

interface NearbyEventResponse extends EventResponse {
  distanceMeters: number;
}

// EventTraits: 이벤트 고유 특성 (GPT 프롬프트 강화용)
export interface EventTraits {
  isFree?: boolean;          // 무료 이벤트 여부
  isEndingSoon?: boolean;    // 곧 종료 (3일 이내)
  popularityScore?: number;  // 인기도 점수 (0-1000)
  daysLeft?: number | null;  // 남은 일수 (null = 날짜 없음)
  hasImage?: boolean;        // 이미지 있음
}

// 새로운 canonical_events API 응답 형식
interface EventResponse {
  id: string;
  title: string;
  displayTitle?: string;
  contentKey?: string;
  venue: string;
  startAt: string;
  endAt: string;
  region: string;
  mainCategory: string;
  subCategory: string;
  imageUrl: string;
  sourcePriorityWinner: string;
  sources?: Record<string, unknown>;
  popularityScore?: number;
  isEndingSoon?: boolean;
  isFree?: boolean;
  address?: string;
  lat?: number;
  lng?: number;
  // Traits 필드 (백엔드에서 계산된 값)
  daysLeft?: number | null;
  hasImage?: boolean;
}

function formatPeriodText(startAt: string, endAt: string): string {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
  };
  return `${formatDate(startAt)} ~ ${formatDate(endAt)}`;
}

type CategoryResolution = {
  category: Exclude<EventCategory, '전체'>;
  fallback: boolean;
};

function resolveCategory(rawMainCategory: string | null | undefined, rawSubCategory: string | null | undefined): CategoryResolution {
  const main = rawMainCategory?.trim() || '';
  const sub = rawSubCategory?.trim() || '';

  if (main && isCategory(main)) {
    return {
      category: main as Exclude<EventCategory, '전체'>,
      fallback: false,
    };
  }

  if (sub) {
    const lower = sub.toLowerCase();
    if (lower.includes('공연') || lower.includes('콘서트') || lower.includes('연극') || lower.includes('뮤지컬')) {
      return { category: '공연', fallback: false };
    }
    if (lower.includes('전시') || lower.includes('미술')) {
      return { category: '전시', fallback: false };
    }
    if (lower.includes('축제')) {
      return { category: '축제', fallback: false };
    }
    return { category: '행사', fallback: true };
  }

  return { category: '행사', fallback: true };
}

function mapEventResponse(event: EventResponse | undefined): EventCardData | undefined {
  if (!event) {
    return undefined;
  }

  // region 정규화 (절대 드롭하지 않음)
  const region = normalizeRegion(event.region);

  // DEV: 정규화 로그
  if (__DEV__ && event.region !== region) {
    console.log('[EventService][RegionNormalized]', {
      original: event.region,
      normalized: region,
    });
  }

  // category 생성 (절대 undefined 금지)
  const rawMainCategory = event.mainCategory?.trim() || '';
  const rawSubCategory = event.subCategory?.trim() || '';
  const categoryResolution = resolveCategory(rawMainCategory, rawSubCategory);
  const category = categoryResolution.category;

  // DEV 로그 (1회만 샘플)
  if (__DEV__ && Math.random() < 0.05) {
    console.log('[EventService] category mapping sample:', {
      rawMain: rawMainCategory || '(empty)',
      rawSub: rawSubCategory || '(empty)',
      finalCategory: category,
      allKeys: Object.keys(event),
    });
  }

  const displayTitle = event.displayTitle?.trim() || '';
  const effectiveTitle = displayTitle || event.title;

  return {
    id: event.id,
    title: effectiveTitle,
    displayTitle: displayTitle || event.title,
    contentKey: event.contentKey,
    description: event.subCategory || category,
    overview: '',
    mainCategory: event.mainCategory,
    subCategory: event.subCategory,
    venue: event.venue ?? '',
    periodText: formatPeriodText(event.startAt, event.endAt),
    startAt: event.startAt,
    endAt: event.endAt,
    tags: [event.subCategory].filter(Boolean),
    thumbnailUrl: event.imageUrl,
    detailImageUrl: event.imageUrl,
    detailLink: '',
    region,
    category,
    popularityScore: event.popularityScore,
    isEndingSoon: event.isEndingSoon,
    isFree: event.isFree,
    address: event.address,
    lat: event.lat,
    lng: event.lng,
  };
}

const REGION_VALUES: Array<Exclude<Region, '전국'>> = [
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

const CATEGORY_VALUES: Array<Exclude<EventCategory, '전체'>> = ['축제', '공연', '행사', '전시'];

// Region 정규화 함수 (드롭 방지)
function normalizeRegion(rawRegion: string | null | undefined): Exclude<Region, '전국'> {
  if (!rawRegion) {
    return '기타' as Exclude<Region, '전국'>;
  }

  const region = rawRegion.trim();

  // 정확히 일치하는 경우
  if (REGION_VALUES.includes(region as Exclude<Region, '전국'>)) {
    return region as Exclude<Region, '전국'>;
  }

  // 정규화 매핑
  const regionLower = region.toLowerCase();

  // 서울
  if (regionLower.includes('서울')) {
    return '서울';
  }
  // 경기
  if (regionLower.includes('경기')) {
    return '경기';
  }
  // 인천
  if (regionLower.includes('인천')) {
    return '인천';
  }
  // 부산
  if (regionLower.includes('부산')) {
    return '부산';
  }
  // 대구
  if (regionLower.includes('대구')) {
    return '대구';
  }
  // 대전
  if (regionLower.includes('대전')) {
    return '대전';
  }
  // 광주
  if (regionLower.includes('광주')) {
    return '광주';
  }
  // 울산
  if (regionLower.includes('울산')) {
    return '울산';
  }
  // 세종
  if (regionLower.includes('세종')) {
    return '세종';
  }
  // 강원
  if (regionLower.includes('강원')) {
    return '강원';
  }
  // 충북
  if (regionLower.includes('충북') || regionLower.includes('충청북')) {
    return '충북';
  }
  // 충남
  if (regionLower.includes('충남') || regionLower.includes('충청남')) {
    return '충남';
  }
  // 전북
  if (regionLower.includes('전북') || regionLower.includes('전라북')) {
    return '전북';
  }
  // 전남
  if (regionLower.includes('전남') || regionLower.includes('전라남')) {
    return '전남';
  }
  // 경북
  if (regionLower.includes('경북') || regionLower.includes('경상북')) {
    return '경북';
  }
  // 경남
  if (regionLower.includes('경남') || regionLower.includes('경상남')) {
    return '경남';
  }
  // 제주
  if (regionLower.includes('제주')) {
    return '제주';
  }

  // 기본값: 기타
  return '기타' as Exclude<Region, '전국'>;
}

function isRegion(value: string): value is Exclude<Region, '전국'> {
  return REGION_VALUES.includes(value as Exclude<Region, '전국'>);
}

function isCategory(value: string): value is Exclude<EventCategory, '전체'> {
  return CATEGORY_VALUES.includes(value as Exclude<EventCategory, '전체'>);
}
