import { createRoute } from '@granite-js/react-native';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Animated,
  ScrollView,
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
} from 'react-native';
import { BottomSheet, Icon, IconButton, AnimateSkeleton, Tab } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
type Adaptive = ReturnType<typeof useAdaptive>;
import { BottomTabBar } from '../components/BottomTabBar';
import { EventCardData } from '../data/events';
import { EventImage } from '../components/EventImage';
import { API_BASE_URL } from '../config/api';
import { useLike } from '../hooks/useLike';

// ─────────────────────────────────────────────────
// API 응답 타입
// ─────────────────────────────────────────────────
interface EventsApiResponse {
  items: Array<{
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
    address?: string;
    lat?: number;
    lng?: number;
    popularityScore?: number;
    buzzScore?: number;
    isEndingSoon?: boolean;
    isFree?: boolean;
    derivedTags?: string[];
  }>;
  pageInfo: {
    page: number;
    size: number;
    totalCount: number;
  };
}

export const Route = createRoute('/explore', {
  component: ExplorePage,
});

// ─────────────────────────────────────────────────
// 퀵 필터 프리셋
// ─────────────────────────────────────────────────
const QUICK_FILTERS = [
  {
    id: 'ending_soon',
    label: '마감임박',
    preset: { sort: 'end_at', order: 'asc', filters: { is_ending_soon: true } },
  },
  {
    id: 'new',
    label: '신규',
    preset: { sort: 'created_at', order: 'desc', filters: { created_after: '7d' } },
  },
  {
    id: 'free',
    label: '무료',
    preset: { sort: 'buzz_score', order: 'desc', filters: { is_free: true } },
  },
  {
    id: 'hot',
    label: '인기',
    preset: { sort: 'buzz_score', order: 'desc', filters: { buzz_min: 30 } },
  },
] as const;

// ─────────────────────────────────────────────────
// 카테고리: 전체가 맨 앞
// ─────────────────────────────────────────────────
const CATEGORIES = [
  { id: 'all', label: '전체', value: null },
  { id: 'popup', label: '팝업', value: '팝업' },
  { id: 'exhibition', label: '전시', value: '전시' },
  { id: 'performance', label: '공연', value: '공연' },
  { id: 'festival', label: '축제', value: '축제' },
  { id: 'event', label: '행사', value: '행사' },
] as const;

// ─────────────────────────────────────────────────
// 지역 목록 (실데이터: /events/region-counts, TTL 30분)
// ─────────────────────────────────────────────────
interface RegionItem {
  value: string;
  count: number;
}

const REGION_LIST_FALLBACK: RegionItem[] = [
  { value: '서울', count: 0 },
  { value: '경기', count: 0 },
  { value: '부산', count: 0 },
  { value: '대구', count: 0 },
  { value: '인천', count: 0 },
  { value: '대전', count: 0 },
  { value: '경남', count: 0 },
  { value: '충남', count: 0 },
  { value: '경북', count: 0 },
  { value: '강원', count: 0 },
  { value: '광주', count: 0 },
  { value: '전북', count: 0 },
  { value: '울산', count: 0 },
  { value: '전남', count: 0 },
  { value: '충북', count: 0 },
  { value: '제주', count: 0 },
  { value: '세종', count: 0 },
];

const REGION_COUNTS_CACHE_TTL_MS = 30 * 60 * 1000;
let _regionCountsCache: { data: RegionItem[]; expiresAt: number } | null = null;

interface ActiveFilters {
  quickFilter: string | null;
  region: string | null;
  category: string | null;
}

// ─────────────────────────────────────────────────
// 스타일 팩토리
// ─────────────────────────────────────────────────
function createStyles(a: Adaptive) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },

    // ── 고정 검색바 ──────────────────────────────────
    fixedSearchBar: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: a.grey100,
    },
    fakeSearchInput: {
      height: 48,
      backgroundColor: a.grey100,
      borderRadius: 12,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    searchPlaceholder: {
      fontSize: 15,
      color: a.grey400,
    },

    // ── 콘텐츠 영역 (FlatList + absolute 필터 헤더) ─
    contentArea: {
      flex: 1,
      overflow: 'hidden',
    },

    // ── 스크롤 반응형 필터 헤더 ──────────────────────
    filterHeader: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10,
      elevation: 3,
      borderBottomWidth: 1,
      borderBottomColor: a.grey100,
    },

    // ── 카테고리 언더라인 탭 ─────────────────────────
    categoryRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    // ── 지역 필터 pill ──────────────────────────────
    regionPill: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      marginRight: 16,
      marginLeft: 4,
      backgroundColor: a.grey100,
      borderRadius: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    regionPillText: {
      fontSize: 13,
      fontWeight: '600',
      color: a.grey700,
    },

    // ── 퀵 필터 칩 ──────────────────────────────────
    quickFiltersRow: {
      paddingVertical: 10,
    },
    quickFiltersContent: {
      paddingHorizontal: 16,
    },
    quickFilterChip: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
      marginRight: 8,
    },
    quickFilterText: {
      fontSize: 14,
      fontWeight: '600',
      color: a.grey700,
    },

    // ── 결과 카운트 ──────────────────────────────────
    countRow: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: a.grey100,
    },
    countText: {
      fontSize: 13,
      fontWeight: '500',
      color: a.grey500,
    },

    // ── FlatList ─────────────────────────────────────
    flatListContent: {
      paddingHorizontal: 10,
      paddingBottom: 100,
    },
    columnWrapper: {
      justifyContent: 'space-between',
    },

    // ── 그리드 카드 ──────────────────────────────────
    gridCard: {
      width: '48%',
      marginVertical: 6,
      backgroundColor: a.background,
      borderRadius: 12,
      overflow: 'hidden',
    },
    cardImageWrapper: {
      position: 'relative',
    },
    cardBadgeContainer: {
      position: 'absolute',
      top: 8,
      left: 8,
      flexDirection: 'row',
      gap: 4,
    },
    cardBadge: {
      backgroundColor: 'rgba(0, 0, 0, 0.60)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 10,
    },
    cardBadgeText: {
      color: a.background,
      fontSize: 11,
      fontWeight: '600',
    },
    cardInfo: {
      padding: 8,
      minHeight: 80,
    },
    reasonLabel: {
      fontSize: 11,
      color: a.blue500,
      fontWeight: '500' as const,
      marginTop: 4,
    },
    likeButton: {
      position: 'absolute',
      bottom: 8,
      right: 8,
      backgroundColor: 'rgba(255,255,255,0.92)',
      borderRadius: 16,
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: a.grey900,
      marginBottom: 4,
      lineHeight: 20,
    },
    cardMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 2,
    },
    cardMeta: {
      fontSize: 12,
      color: a.grey600,
    },

    // ── Empty State ──────────────────────────────────
    emptyState: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 80,
    },
    emptyIconWrapper: {
      marginBottom: 16,
    },
    emptyText: {
      fontSize: 16,
      fontWeight: '600',
      color: a.grey800,
      marginBottom: 8,
      textAlign: 'center',
    },
    emptyHint: {
      fontSize: 14,
      color: a.grey500,
      textAlign: 'center',
    },

    // ── 지역 BottomSheet ─────────────────────────────
    regionSheetList: {
      paddingHorizontal: 20,
      maxHeight: 460,
    },
    regionSheetItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: a.grey100,
    },
    regionSheetText: {
      fontSize: 16,
      fontWeight: '500',
      color: a.grey600,
    },
    regionSheetTextActive: {
      color: a.grey900,
      fontWeight: '700',
    },
    regionSheetRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    regionCountText: {
      fontSize: 13,
      color: a.grey500,
    },
    regionCheckmark: {
      fontSize: 16,
      color: a.blue500,
      fontWeight: '700',
    },
  });
}

function createGridSkeletonStyles(a: Adaptive) {
  return StyleSheet.create({
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      paddingHorizontal: 10,
    },
    card: {
      width: '48%',
      marginVertical: 6,
      backgroundColor: a.background,
      borderRadius: 12,
      overflow: 'hidden',
    },
    image: {
      height: 180,
      backgroundColor: a.grey200,
    },
    content: {
      padding: 8,
      gap: 6,
    },
    titleLine1: {
      height: 14,
      backgroundColor: a.grey200,
      borderRadius: 4,
      width: '90%',
    },
    titleLine2: {
      height: 14,
      backgroundColor: a.grey200,
      borderRadius: 4,
      width: '70%',
    },
    metaLine: {
      height: 11,
      backgroundColor: a.grey200,
      borderRadius: 4,
      width: '55%',
    },
  });
}

// ─────────────────────────────────────────────────
// 스켈레톤 컴포넌트
// ─────────────────────────────────────────────────
function GridSkeletonCard() {
  const adaptive = useAdaptive();
  const gridSkeletonStyles = React.useMemo(() => createGridSkeletonStyles(adaptive), [adaptive]);

  return (
    <View style={gridSkeletonStyles.card}>
      <View style={gridSkeletonStyles.image} />
      <View style={gridSkeletonStyles.content}>
        <View style={gridSkeletonStyles.titleLine1} />
        <View style={gridSkeletonStyles.titleLine2} />
        <View style={gridSkeletonStyles.metaLine} />
        <View style={gridSkeletonStyles.metaLine} />
      </View>
    </View>
  );
}

function GridSkeleton({ filterHeight }: { filterHeight: number }) {
  const adaptive = useAdaptive();
  const gridSkeletonStyles = React.useMemo(() => createGridSkeletonStyles(adaptive), [adaptive]);

  return (
    <AnimateSkeleton delay={0} withGradient={false} withShimmer={true}>
      <View style={[gridSkeletonStyles.grid, { paddingTop: filterHeight }]}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <GridSkeletonCard key={i} />
        ))}
      </View>
    </AnimateSkeleton>
  );
}

function GridFooterSkeleton() {
  const adaptive = useAdaptive();
  const gridSkeletonStyles = React.useMemo(() => createGridSkeletonStyles(adaptive), [adaptive]);

  return (
    <AnimateSkeleton delay={0} withGradient={false} withShimmer={true}>
      <View style={gridSkeletonStyles.grid}>
        {[0, 1].map((i) => (
          <GridSkeletonCard key={i} />
        ))}
      </View>
    </AnimateSkeleton>
  );
}

// ─── Explore page 0 캐시 (탭 복귀 시 skeleton 방지) ──────────────────────
// 캐시 범위: reset=true(page 0) 요청만 / 페이지네이션(page 1+)은 캐시 안 함
// pull-to-refresh 추가 시: _exploreCache.delete(buildExploreCacheKey(filters)) 로 무효화
interface ExploreFirstPageCache {
  events: EventCardData[];
  totalCount: number;
  expiresAt: number;
}
const _exploreCache = new Map<string, ExploreFirstPageCache>();
const EXPLORE_CACHE_TTL_MS = 2 * 60 * 1000; // 2분

function buildExploreCacheKey(filters: ActiveFilters): string {
  return [
    filters.quickFilter ?? 'none',
    filters.region ?? 'none',
    filters.category ?? 'none',
  ].join('|');
}
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────
// reason label: isFree → isEndingSoon → derivedTags 순 우선순위
// ─────────────────────────────────────────────────
const TAG_LABEL_MAP: Record<string, string> = {
  '데이트':    '데이트 추천',
  '이색데이트': '데이트 추천',
  '가족':      '가족과 보기 좋아요',
  '아이와함께': '아이와 보기 좋아요',
  '혼자':      '혼자 가기 좋아요',
  '주말추천':  '주말에 딱 좋아요',
  '사진맛집':  '사진 찍기 좋아요',
  '힐링':      '힐링하기 좋아요',
};

function getReasonLabel(item: EventCardData): string | null {
  // 1순위: 무료
  if (item.isFree) return '무료 관람 가능';

  // 2순위: 마감임박 (00:00 기준 D-N)
  if (item.isEndingSoon && item.endAt) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(item.endAt);
    end.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return '오늘 종료';
    return `D-${diffDays} 마감`;
  }

  // 3순위: derivedTags 매핑 (배열 순서대로 첫 매칭)
  if (item.derivedTags) {
    for (const tag of item.derivedTags) {
      if (TAG_LABEL_MAP[tag]) return TAG_LABEL_MAP[tag];
    }
  }

  return null;
}

// ─────────────────────────────────────────────────
// 그리드 카드 — useLike 훅 사용을 위해 별도 컴포넌트
// ─────────────────────────────────────────────────
function GridCard({ item, onPress }: { item: EventCardData; onPress: (id: string) => void }) {
  const { isLiked, toggle } = useLike({ eventId: item.id });
  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);

  const badges: { text: string }[] = [];
  if (item.isFree) badges.push({ text: '무료' });
  if (item.isEndingSoon) badges.push({ text: '마감임박' });
  if ((item.buzzScore ?? 0) >= 70 && badges.length === 0) badges.push({ text: '인기' });
  const visibleBadges = badges.slice(0, 2);

  const reasonLabel = getReasonLabel(item);

  return (
    <Pressable style={styles.gridCard} onPress={() => onPress(item.id)}>
      <View style={styles.cardImageWrapper}>
        <EventImage uri={item.thumbnailUrl} category={item.category} height={180} borderRadius={12} />
        {visibleBadges.length > 0 && (
          <View style={styles.cardBadgeContainer}>
            {visibleBadges.map((badge, i) => (
              <View key={i} style={styles.cardBadge}>
                <Text style={styles.cardBadgeText}>{badge.text}</Text>
              </View>
            ))}
          </View>
        )}
        {/* 찜 버튼 */}
        <IconButton
          name="icon-heart-mono"
          variant="clear"
          iconSize={15}
          color={isLiked ? adaptive.red500 : adaptive.grey400}
          style={styles.likeButton}
          onPress={toggle}
          hitSlop={8}
        />
      </View>
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
        <View style={styles.cardMetaRow}>
          <Icon name="icon-pin-mono" size={11} color={adaptive.grey500} />
          <Text style={[styles.cardMeta, { flex: 1 }]} numberOfLines={1}>{item.venue || item.region}</Text>
        </View>
        <View style={styles.cardMetaRow}>
          <Icon name="icon-calendar-check-mono" size={11} color={adaptive.grey500} />
          <Text style={[styles.cardMeta, { flex: 1 }]} numberOfLines={1}>{item.periodText}</Text>
        </View>
        {reasonLabel && (
          <Text style={styles.reasonLabel} numberOfLines={1}>{reasonLabel}</Text>
        )}
      </View>
    </Pressable>
  );
}

function ExplorePage() {
  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);
  const navigation = Route.useNavigation();

  const [activeFilters, setActiveFilters] = useState<ActiveFilters>({
    quickFilter: null,
    region: null,
    category: null,
  });

  const [events, setEvents] = useState<EventCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [showRegionSheet, setShowRegionSheet] = useState(false);
  const [regionList, setRegionList] = useState<RegionItem[]>(
    _regionCountsCache && Date.now() < _regionCountsCache.expiresAt
      ? _regionCountsCache.data
      : REGION_LIST_FALLBACK
  );

  // ── 스크롤 반응형 헤더 (translateY + useNativeDriver) ──────────────
  const filterTranslateY = useRef(new Animated.Value(0)).current;
  const filterHeightRef = useRef(108); // onLayout으로 실제 값 갱신
  const isFetchingRef = useRef(false); // 중복 fetch 방지 (동기 락)
  const [filterHeight, setFilterHeight] = useState(108);
  const lastScrollY = useRef(0);
  const filterVisible = useRef(true);

  const handleFilterLayout = useCallback((e: any) => {
    const h = e.nativeEvent.layout.height;
    filterHeightRef.current = h;
    setFilterHeight(h);
  }, []);

  const showFilterHeader = useCallback(() => {
    if (filterVisible.current) return;
    filterVisible.current = true;
    Animated.timing(filterTranslateY, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [filterTranslateY]);

  const hideFilterHeader = useCallback(() => {
    if (!filterVisible.current) return;
    filterVisible.current = false;
    Animated.timing(filterTranslateY, {
      toValue: -filterHeightRef.current,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [filterTranslateY]);

  const handleScroll = useCallback((event: any) => {
    const currentY = event.nativeEvent.contentOffset.y;
    const diff = currentY - lastScrollY.current;
    lastScrollY.current = currentY;

    if (currentY <= 10) {
      showFilterHeader();
    } else if (diff > 5 && currentY > 30) {
      hideFilterHeader();
    } else if (diff < -3) {
      showFilterHeader();
    }
  }, [showFilterHeader, hideFilterHeader]);

  // ─── API URL 빌더 ───────────────────────────────
  const buildApiUrl = () => {
    const endpoint = '/events';
    const params = new URLSearchParams();
    let sortBy = 'created_at';
    let order = 'desc';

    if (activeFilters.quickFilter) {
      const preset = QUICK_FILTERS.find(f => f.id === activeFilters.quickFilter);
      if (preset) {
        sortBy = preset.preset.sort;
        order = preset.preset.order;
        Object.entries(preset.preset.filters).forEach(([key, value]) => {
          if (value !== undefined && value !== null) params.append(key, String(value));
        });
      }
    }

    if (activeFilters.region) params.append('region', activeFilters.region);
    if (activeFilters.category) params.append('category', activeFilters.category);
    params.append('sortBy', sortBy);
    params.append('order', order);
    params.append('page', String(page + 1));
    params.append('size', '20');

    return `${API_BASE_URL}${endpoint}?${params}`;
  };

  // ─── 백엔드 응답 → EventCardData ────────────────
  const mapApiResponseToEventCard = (item: EventsApiResponse['items'][0]): EventCardData => {
    const formatDate = (dateStr: string) => {
      const date = new Date(dateStr);
      const y = date.getFullYear().toString().slice(2);
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}.${m}.${d}`;
    };

    const category = (['축제', '공연', '행사', '전시'].includes(item.mainCategory)
      ? item.mainCategory
      : '행사') as EventCardData['category'];

    return {
      id: item.id,
      title: item.displayTitle || item.title,
      displayTitle: item.displayTitle,
      contentKey: item.contentKey,
      category,
      region: item.region as EventCardData['region'],
      periodText: `${formatDate(item.startAt)} ~ ${formatDate(item.endAt)}`,
      startAt: item.startAt,
      endAt: item.endAt,
      mainCategory: item.mainCategory,
      subCategory: item.subCategory,
      venue: item.venue || '',
      description: item.subCategory || category,
      overview: '',
      tags: item.subCategory ? [item.subCategory] : [],
      thumbnailUrl: item.imageUrl,
      detailImageUrl: item.imageUrl,
      detailLink: '',
      address: item.address,
      lat: item.lat,
      lng: item.lng,
      popularityScore: item.popularityScore,
      buzzScore: item.buzzScore,
      isEndingSoon: item.isEndingSoon,
      isFree: item.isFree,
      derivedTags: item.derivedTags,
    };
  };

  // ─── 데이터 로딩 ────────────────────────────────
  const loadEvents = async (_targetPage: number, reset = false) => {
    if (!reset && isFetchingRef.current) return;
    isFetchingRef.current = true;

    // ── page 0 캐시 확인 (탭 복귀 시 skeleton 방지) ──
    if (reset) {
      const cacheKey = buildExploreCacheKey(activeFilters);
      const cached = _exploreCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        if (__DEV__) console.log(`[Explore] cache HIT (key=${cacheKey})`);
        setEvents(cached.events);
        setTotalCount(cached.totalCount);
        setLoading(false);
        isFetchingRef.current = false;
        return;
      }
      if (__DEV__) console.log(`[Explore] cache MISS (key=${cacheKey})`);
    }

    setLoading(true);
    try {
      const url = buildApiUrl();
      if (__DEV__) console.log('[Explore] Fetching:', url);

      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data: EventsApiResponse = await response.json() as any;
      const newEvents = data.items.map(mapApiResponseToEventCard);

      if (reset) {
        setEvents(newEvents);
        setTotalCount(data.pageInfo.totalCount);
        // ── page 0 캐시 저장 ──
        const cacheKey = buildExploreCacheKey(activeFilters);
        _exploreCache.set(cacheKey, {
          events: newEvents,
          totalCount: data.pageInfo.totalCount,
          expiresAt: Date.now() + EXPLORE_CACHE_TTL_MS,
        });
      } else {
        setEvents(prev => {
          const existingIds = new Set(prev.map(item => item.id));
          const deduped = newEvents.filter(item => !existingIds.has(item.id));
          return [...prev, ...deduped];
        });
      }
      setHasMore(newEvents.length >= 20);
    } catch (error) {
      console.error('[Explore] Load error:', error);
      if (reset) { setEvents([]); setHasMore(false); }
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  };

  // ─── 필터 핸들러 ────────────────────────────────
  const handleQuickFilterPress = (filterId: string) => {
    setActiveFilters(prev => ({
      ...prev,
      quickFilter: prev.quickFilter === filterId ? null : filterId,
    }));
    setPage(0);
  };

  const handleCategoryPress = (categoryValue: string | null) => {
    setActiveFilters(prev => ({ ...prev, category: categoryValue }));
    setPage(0);
  };

  const handleRegionSelect = (region: string | null) => {
    setActiveFilters(prev => ({ ...prev, region }));
    setPage(0);
    setShowRegionSheet(false);
  };

  // ─── 사이드 이펙트 ──────────────────────────────
  useEffect(() => {
    // 필터 변경 시 헤더 상태 초기화
    filterVisible.current = true;
    filterTranslateY.setValue(0);
    lastScrollY.current = 0;
    setPage(0);
    loadEvents(0, true);
  }, [activeFilters]);

  useEffect(() => {
    if (page > 0) loadEvents(page, false);
  }, [page]);

  // ─── 지역 이벤트 수 실데이터 fetch (30분 TTL) ──
  useEffect(() => {
    if (_regionCountsCache && Date.now() < _regionCountsCache.expiresAt) return;
    fetch(`${API_BASE_URL}/events/region-counts`)
      .then(r => r.json())
      .then((res: { regions: RegionItem[] }) => {
        _regionCountsCache = { data: res.regions, expiresAt: Date.now() + REGION_COUNTS_CACHE_TTL_MS };
        setRegionList(res.regions);
      })
      .catch(() => {
        // 실패 시 fallback(count: 0) 유지
      });
  }, []);

  const handleLoadMore = () => {
    if (!loading && hasMore) setPage(prev => prev + 1);
  };

  // ─── 카드 렌더링 ────────────────────────────────
  const renderCard = ({ item }: { item: EventCardData }) => (
    <GridCard
      item={item}
      onPress={(id) => navigation.navigate('/events/:id', { id })}
    />
  );

  // ─── FlatList 헤더: 결과 카운트만 ───────────────
  const renderCountRow = () => (
    <View style={styles.countRow}>
      <Text style={styles.countText}>총 {totalCount.toLocaleString()}개</Text>
    </View>
  );

  // ─── Empty State ────────────────────────────────
  const renderEmpty = () => {
    if (loading) return null;
    const hasFilter = activeFilters.quickFilter || activeFilters.region || activeFilters.category;
    return (
      <View style={styles.emptyState}>
        <View style={styles.emptyIconWrapper}>
          <Icon name="icon-search-bold-mono" size={36} color={adaptive.grey400} />
        </View>
        <Text style={styles.emptyText}>
          {activeFilters.region ? `${activeFilters.region}에 ` : ''}
          {activeFilters.category ? `${activeFilters.category} ` : ''}
          이벤트가 없어요
        </Text>
        <Text style={styles.emptyHint}>
          {hasFilter ? '필터를 변경해보세요' : '잠시 후 다시 확인해주세요'}
        </Text>
      </View>
    );
  };

  // ─── 렌더링 ─────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: adaptive.background }]}>
      {/* 고정 검색바 */}
      <View style={[styles.fixedSearchBar, { backgroundColor: adaptive.background }]}>
        <Pressable
          style={styles.fakeSearchInput}
          onPress={() => navigation.push('/search', {
            category: activeFilters.category,
            region: activeFilters.region,
            quickFilter: activeFilters.quickFilter,
          })}
        >
          <Icon name="icon-search-bold-mono" size={16} color={adaptive.grey400} />
          <Text style={styles.searchPlaceholder}>이벤트, 장소, 키워드 검색</Text>
        </Pressable>
      </View>

      {/* 콘텐츠 영역 (FlatList + absolute 필터 헤더) */}
      <View style={styles.contentArea}>
        {/* 스크롤 반응형 필터 헤더 — position: absolute + translateY */}
        <Animated.View
          style={[
            styles.filterHeader,
            {
              backgroundColor: adaptive.background,
              transform: [{ translateY: filterTranslateY }],
            },
          ]}
          onLayout={handleFilterLayout}
        >
          {/* 카테고리 언더라인 탭 + 지역 버튼 */}
          <View style={styles.categoryRow}>
            <Tab
              fluid
              value={activeFilters.category ?? 'all'}
              onChange={(val) => handleCategoryPress(val === 'all' ? null : val as string)}
              style={{ flex: 1 }}
            >
              {CATEGORIES.map((cat) => (
                <Tab.Item key={cat.id} value={cat.value ?? 'all'}>
                  {cat.label}
                </Tab.Item>
              ))}
            </Tab>

            <Pressable style={styles.regionPill} onPress={() => setShowRegionSheet(true)}>
              <Icon name="icon-pin-mono" size={12} color={adaptive.grey700} />
              <Text style={styles.regionPillText}>
                {activeFilters.region ?? '전국'} ▾
              </Text>
            </Pressable>
          </View>

          {/* 퀵 필터 칩 */}
          <View style={styles.quickFiltersRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickFiltersContent}
            >
              {QUICK_FILTERS.map((filter) => {
                const isActive = activeFilters.quickFilter === filter.id;
                return (
                  <Pressable
                    key={filter.id}
                    style={[
                      styles.quickFilterChip,
                      { borderColor: adaptive.grey300 },
                      isActive && { backgroundColor: adaptive.grey900, borderColor: adaptive.grey900 },
                    ]}
                    onPress={() => handleQuickFilterPress(filter.id)}
                  >
                    <Text style={[styles.quickFilterText, isActive && { color: adaptive.background }]}>
                      {filter.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Animated.View>

        {/* 이벤트 목록 — paddingTop으로 필터 헤더 아래부터 시작 */}
        {loading && page === 0 ? (
          <GridSkeleton filterHeight={filterHeight} />
        ) : (
          <FlatList
            data={events}
            numColumns={2}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={renderCountRow}
            ListEmptyComponent={renderEmpty}
            renderItem={renderCard}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.5}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            ListFooterComponent={
              loading && page > 0
                ? <GridFooterSkeleton />
                : null
            }
            contentContainerStyle={[styles.flatListContent, { paddingTop: filterHeight }]}
            columnWrapperStyle={styles.columnWrapper}
            removeClippedSubviews
            windowSize={10}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            updateCellsBatchingPeriod={50}
          />
        )}
      </View>

      <BottomTabBar currentTab="explore" />

      {/* 지역 선택 BottomSheet */}
      <BottomSheet.Root
        open={showRegionSheet}
        onClose={() => setShowRegionSheet(false)}
        onDimmerClick={() => setShowRegionSheet(false)}
      >
        <BottomSheet.Header>지역 선택</BottomSheet.Header>
        <ScrollView
          style={styles.regionSheetList}
          contentContainerStyle={{ paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            style={styles.regionSheetItem}
            onPress={() => handleRegionSelect(null)}
          >
            <Text style={[styles.regionSheetText, !activeFilters.region && styles.regionSheetTextActive]}>
              전국 전체
            </Text>
            {!activeFilters.region && <Icon name="icon-check-mono" size={16} color={adaptive.blue500} />}
          </Pressable>

          {regionList.map(({ value, count }) => (
            <Pressable
              key={value}
              style={styles.regionSheetItem}
              onPress={() => handleRegionSelect(value)}
            >
              <Text style={[styles.regionSheetText, activeFilters.region === value && styles.regionSheetTextActive]}>
                {value}
              </Text>
              <View style={styles.regionSheetRight}>
                {count > 0 && (
                  <Text style={styles.regionCountText}>{count.toLocaleString()}개</Text>
                )}
                {activeFilters.region === value && (
                  <Icon name="icon-check-mono" size={16} color={adaptive.blue500} />
                )}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet.Root>
    </View>
  );
}
