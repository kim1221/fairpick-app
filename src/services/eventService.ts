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
}

export interface EventListResult {
  items: EventCardData[];
  totalCount: number;
}

const eventService: EventService = {
  async getEventById(id: string) {
    const response = await http.get<EventResponse>(`/events/${id}`);
    return mapEventResponse(response.data);
  },
  async getEventList({ category, region, page = 1, size = 10 }: EventListParams) {
    const response = await http.get<EventListResponse>('/events', {
      params: {
        category: category && category !== '전체' ? category : undefined,
        region: region && region !== '전국' ? region : undefined,
        page,
        size,
      },
    });
    const items = response.data.items.map(mapEventResponse).filter((event): event is EventCardData => Boolean(event));
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
};

export default eventService;

export interface EventListParams {
  category?: EventCategory | '전체';
  region?: Region | '전국';
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

// 새로운 canonical_events API 응답 형식
interface EventResponse {
  id: string;
  title: string;
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

function mapEventResponse(event: EventResponse | undefined): EventCardData | undefined {
  if (!event) {
    return undefined;
  }

  const region = event.region as Exclude<Region, '전국'>;
  const category = event.mainCategory as Exclude<EventCategory, '전체'>;

  if (!isRegion(region) || !isCategory(category)) {
    return undefined;
  }

  return {
    id: event.id,
    title: event.title,
    description: event.subCategory || category,
    overview: '',
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
];

const CATEGORY_VALUES: Array<Exclude<EventCategory, '전체'>> = ['축제', '공연', '행사', '전시'];

function isRegion(value: string): value is Exclude<Region, '전국'> {
  return REGION_VALUES.includes(value as Exclude<Region, '전국'>);
}

function isCategory(value: string): value is Exclude<EventCategory, '전체'> {
  return CATEGORY_VALUES.includes(value as Exclude<EventCategory, '전체'>);
}

