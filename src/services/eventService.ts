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
  async getEventList({ category, region, query, page = 1, size = 10, sortBy, order, isFree, isEndingSoon }: EventListParams) {
    // [FIX B] 파라미터 로깅 - 실제 axios 요청 전
    const params: Record<string, string | number | boolean | undefined> = {
      category: category && category !== '전체' ? category : undefined,
      region: region && region !== '전국' ? region : undefined,
      q: query && query.trim() ? query.trim() : undefined, // 검색어 (서버사이드)
      page,
      size,
      sortBy: sortBy ?? undefined,
      order: order ?? undefined,
      is_free: isFree ? true : undefined,
      is_ending_soon: isEndingSoon ? true : undefined,
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
        } as NearbyEventItem;
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
  sortBy?: string;       // 정렬 기준 (created_at, end_at, buzz_score 등)
  order?: 'asc' | 'desc';
  isFree?: boolean;      // 무료 필터
  isEndingSoon?: boolean; // 마감임박 필터
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
  // 상세 정보 필드
  overview?: string;
  priceInfo?: string;
  priceMin?: number;
  priceMax?: number;
  openingHours?: any; // JSON 또는 문자열
  // Phase 1 추가 필드
  buzzScore?: number;
  externalLinks?: {
    ticket?: string;
    official?: string;
    reservation?: string;
    instagram?: string;
    [key: string]: string | undefined;
  };
  derivedTags?: string[];
  metadata?: {
    display?: {
      performance?: {
        cast?: string;
        genre?: string;
        duration_minutes?: number | string;
        last_admission?: string;
        crew?: { director?: string; writer?: string; composer?: string; [key: string]: any };
        [key: string]: any;
      };
      exhibition?: {
        artists?: string;
        genre?: string;
        duration_minutes?: number | string;
        last_admission?: string;
        photography_allowed?: boolean;
        facilities?: { photo_zone?: boolean; [key: string]: any };
        [key: string]: any;
      };
      popup?: {
        type?: string;
        brands?: string | string[];
        is_fnb?: boolean;
        collab_description?: string;
        fnb_items?: { signature_menu?: string[]; best_items?: string | string[]; [key: string]: any };
        photo_zone?: boolean;
        photo_zone_desc?: string;
        goods_items?: string | string[];
        waiting_hint?: { level?: string; text?: string; [key: string]: any };
        [key: string]: any;
      };
      festival?: { organizer?: string; program_highlights?: string; [key: string]: any };
      event?: {
        target_audience?: string;
        capacity?: string | number;
        registration?: { required?: boolean; url?: string; deadline?: string; [key: string]: any };
        [key: string]: any;
      };
      [key: string]: any;
    };
    [key: string]: any;
  };
  parkingAvailable?: boolean;
  parkingInfo?: string;
  publicTransportInfo?: string;
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

/** JSONB metadata 값을 string | undefined 로 안전하게 변환 */
function safeMetaStr(val: unknown): string | undefined {
  if (val == null) return undefined;
  if (typeof val === 'string') return val.trim() || undefined;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return undefined; // object/array는 무시
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

  // isFree 보정: DB is_free=false인데 price_info가 무료임을 나타내는 경우 방어
  // - "무료" 포함 여부: partial match (백엔드 deriveIsFree와 동일 기준)
  // - "0원": 앞뒤 숫자 lookaround로 "10,000원" 오판 방지 (\b는 한글 경계 미지원)
  // - 단, 다른 금액(숫자+원)이 함께 있으면 유료 우선 (혼합 가격)
  const priceInfoLower = event.priceInfo?.trim().toLowerCase() ?? '';
  const isZeroWon = /(?<!\d)0원(?!\d)/.test(priceInfoLower);
  const hasOtherPrice = /\d{1,}[,\d]*원/.test(priceInfoLower) && !isZeroWon;
  const effectiveIsFree = event.isFree ||
    (!hasOtherPrice && priceInfoLower.includes('무료')) ||
    (!hasOtherPrice && isZeroWon) ||
    (event.priceMin === 0 && event.priceMax === 0 && !event.priceInfo);

  // priceText 생성
  let priceText = '';
  if (effectiveIsFree) {
    priceText = '무료';
  } else if (event.priceInfo) {
    priceText = event.priceInfo;
  } else if (event.priceMin != null && event.priceMax != null && event.priceMin > 0) {
    if (event.priceMin === event.priceMax) {
      priceText = `${event.priceMin.toLocaleString()}원`;
    } else {
      priceText = `${event.priceMin.toLocaleString()}원 ~ ${event.priceMax.toLocaleString()}원`;
    }
  }

  // openingHours 정규화 - object로 유지 (UI에서 포맷팅)
  let openingHoursData: any = undefined;
  if (event.openingHours) {
    if (typeof event.openingHours === 'string') {
      // 문자열이면 JSON 파싱 시도
      try {
        openingHoursData = JSON.parse(event.openingHours);
      } catch {
        // 파싱 실패하면 notes로 간주
        openingHoursData = { notes: event.openingHours };
      }
    } else if (typeof event.openingHours === 'object') {
      // 이미 object면 그대로 사용
      openingHoursData = event.openingHours;
    }
  }

  // detailLink: externalLinks에서 우선순위별 추출
  const externalLinks = event.externalLinks ?? {};
  const detailLink =
    externalLinks.ticket ||
    externalLinks.reservation ||
    externalLinks.official ||
    externalLinks.instagram ||
    '';

  // tags: derived_tags 우선, 없으면 subCategory 폴백
  // 배열 방어: ["", " "] 같은 빈 문자열 포함 배열을 유효하지 않음으로 처리
  const validDerivedTags = Array.isArray(event.derivedTags)
    ? event.derivedTags.filter((t: string) => t?.trim().length > 0)
    : [];
  const tags: string[] =
    validDerivedTags.length > 0
      ? validDerivedTags
      : ([event.subCategory].filter(Boolean) as string[]);

  // 카테고리별 메타데이터 추출 (metadata.display.*)
  const display = event.metadata?.display ?? {};
  const perfMeta = display.performance ?? {};
  const exhMeta = display.exhibition ?? {};
  const popupMeta = display.popup ?? {};
  const festMeta = display.festival ?? {};
  const eventMeta = display.event ?? {};
  const eventReg = (eventMeta.registration as any) ?? {};

  return {
    id: event.id,
    title: effectiveTitle,
    displayTitle: displayTitle || event.title,
    contentKey: event.contentKey,
    description: event.subCategory || category,
    overview: event.overview || '',
    mainCategory: event.mainCategory,
    subCategory: event.subCategory,
    venue: event.venue ?? '',
    periodText: formatPeriodText(event.startAt, event.endAt),
    startAt: event.startAt,
    endAt: event.endAt,
    tags,
    thumbnailUrl: event.imageUrl,
    detailImageUrl: event.imageUrl,
    detailLink,
    region,
    category,
    buzzScore: event.buzzScore,
    popularityScore: event.popularityScore,
    isEndingSoon: event.isEndingSoon,
    isFree: effectiveIsFree,
    priceText,
    priceInfo: event.priceInfo,
    priceMin: event.priceMin,
    priceMax: event.priceMax,
    openingHours: openingHoursData,
    address: event.address,
    lat: event.lat,
    lng: event.lng,
    externalLinks: Object.keys(externalLinks).length > 0 ? externalLinks : undefined,
    parkingAvailable: event.parkingAvailable,
    parkingInfo: event.parkingInfo,
    publicTransportInfo: event.publicTransportInfo,
    // ── 공연/전시 공용 ──────────────────────────────────────────
    durationMinutes: (() => {
      const raw = perfMeta.duration_minutes ?? exhMeta.duration_minutes;
      if (raw == null) return undefined;
      const n = typeof raw === 'number' ? raw : parseInt(String(raw));
      return isNaN(n) ? undefined : n;
    })(),
    lastAdmission: safeMetaStr(perfMeta.last_admission) || safeMetaStr(exhMeta.last_admission) || undefined,
    // ── 공연 ────────────────────────────────────────────────────
    cast: safeMetaStr(perfMeta.cast),
    genre: safeMetaStr(perfMeta.genre) || safeMetaStr(exhMeta.genre),
    crewDirector: safeMetaStr(perfMeta.crew?.director),
    crewWriter: safeMetaStr(perfMeta.crew?.writer),
    crewComposer: safeMetaStr(perfMeta.crew?.composer),
    // ── 전시 ────────────────────────────────────────────────────
    artists: safeMetaStr(exhMeta.artists),
    photographyAllowed: exhMeta.photography_allowed != null ? exhMeta.photography_allowed === true : undefined,
    photoZone: (popupMeta.photo_zone === true || exhMeta.facilities?.photo_zone === true) || undefined,
    photoZoneDesc: safeMetaStr(popupMeta.photo_zone_desc),
    // ── 축제 ────────────────────────────────────────────────────
    organizer: safeMetaStr(festMeta.organizer),
    programHighlights: safeMetaStr(festMeta.program_highlights),
    // ── 팝업 ────────────────────────────────────────────────────
    popupType: safeMetaStr(popupMeta.type),
    brands: Array.isArray(popupMeta.brands)
      ? popupMeta.brands.filter((b: unknown) => typeof b === 'string' && b.trim()).join(', ') || undefined
      : safeMetaStr(popupMeta.brands),
    bestItems: (() => {
      const fnbItems = popupMeta.fnb_items ?? {};
      const menu = Array.isArray(fnbItems.signature_menu)
        ? fnbItems.signature_menu.filter((s: unknown) => typeof s === 'string' && (s as string).trim()).join(', ')
        : safeMetaStr(fnbItems.signature_menu);
      return menu || undefined;
    })(),
    collabDescription: safeMetaStr(popupMeta.collab_description),
    waitingHint: safeMetaStr(popupMeta.waiting_hint?.text),
    goodsItems: Array.isArray(popupMeta.goods_items)
      ? (popupMeta.goods_items as string[]).filter((s) => typeof s === 'string' && s.trim()).join(', ') || undefined
      : safeMetaStr(popupMeta.goods_items),
    // ── 행사 ────────────────────────────────────────────────────
    registrationRequired: eventReg.required === true ? true : undefined,
    registrationDeadline: safeMetaStr(eventReg.deadline),
    targetAudience: safeMetaStr(eventMeta.target_audience),
    eventCapacity: safeMetaStr(eventMeta.capacity),
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
