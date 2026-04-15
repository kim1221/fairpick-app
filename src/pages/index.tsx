/**
 * Fairpick - 홈 화면
 * curation_themes 기반 동적 섹션 렌더링
 */

import { createRoute, ScrollViewInertialBackground } from '@granite-js/react-native';
import { useSafeAreaInsets } from '@granite-js/native/react-native-safe-area-context';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Platform, ScrollView, StyleSheet, View, Text, RefreshControl, Pressable } from 'react-native';
import { Icon, AnimateSkeleton } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import { BottomTabBar } from '../components/BottomTabBar';
import { EventCard } from '../components/EventCard';

import { Accuracy, getCurrentLocation, GetCurrentLocationPermissionError, InlineAd, getNetworkStatus } from '@apps-in-toss/framework';

import recommendationService from '../services/recommendationService';
import userEventService from '../services/userEventService';
import { getCurrentUserId } from '../utils/anonymousUser';
import { getAiNoticeShown, setAiNoticeShown, getFeedState, advanceFeedState, resetFeedState } from '../utils/storage';
import { reverseGeocode } from '../utils/geocoding';
import { LikesProvider } from '../contexts/LikesContext';
import { MagazineCard } from '../components/MagazineCard';
import { TrendCard } from '../components/TrendCard';
import { HeroCard } from '../components/HeroCard';
import { fetchFeed, feedEventToScoredEvent, type FeedCard } from '../services/feedService';
import { API_TIMEOUT } from '../config/api';

import type { ScoredEvent, Location } from '../types/recommendation';

export const Route = createRoute('/', {
  component: HomePage,
});

// sido(시도) 행정구역명 → DB region 단축명 변환
// geocoding API의 sido 필드(예: "서울특별시") → canonical_events.region(예: "서울")
function sidoToRegion(sido: string): string {
  const map: Record<string, string> = {
    '서울특별시': '서울', '경기도': '경기', '부산광역시': '부산',
    '인천광역시': '인천', '대구광역시': '대구', '광주광역시': '광주',
    '대전광역시': '대전', '울산광역시': '울산', '세종특별자치시': '세종',
    '강원도': '강원', '강원특별자치도': '강원',
    '충청북도': '충북', '충청남도': '충남',
    '전라북도': '전북', '전북특별자치도': '전북', '전라남도': '전남',
    '경상북도': '경북', '경상남도': '경남', '제주특별자치도': '제주',
  };
  return map[sido] ?? sido.replace(/(특별시|광역시|특별자치시|특별자치도|도)$/, '').trim();
}

// 모듈 레벨 캐시: 컴포넌트가 언마운트돼도 데이터 유지 (탭 전환 복귀 대응)
interface HomeCache {
  sections: HomeSection[];
  location: Location | undefined;
  userId: string;
  expiresAt: number;
}
let _homeCache: HomeCache | null = null;
const HOME_CACHE_TTL_MS = 5 * 60 * 1000; // 5분

// today_pick KST 일별 고정 캐시
// GPS 재로드 / 새로고침 시에도 오늘 이미 결정된 today_pick을 유지
interface TodayPickCache {
  section: HomeSection;
  kstDate: string; // KST 기준 YYYY-MM-DD
}
let _todayPickCache: TodayPickCache | null = null;

/** KST(UTC+9) 기준 오늘 날짜 문자열 반환 */
function getTodayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

interface HomeSection {
  slug: string;
  title: string;
  subtitle: string | null;
  events: ScoredEvent[];
}

interface ProcessedSection {
  slug: string;
  title: string;
  subtitle: string | null;
  events: Array<ScoredEvent & { signal?: { label: string; color: string } }>;
}

// FlatList 아이템 타입
type FeedItem =
  | { type: 'skeleton'; skeletonType: 'today_pick' | 'horizontal'; id: string }
  | { type: 'empty' }
  | { type: 'section'; section: ProcessedSection }
  | { type: 'ad'; id: string }
  | { type: 'magazine'; card: FeedCard }
  | { type: 'feed_loading' }
  | { type: 'feed_more_dot' }
  | { type: 'feed_end'; eventCount: number };

// ─────────────────────────────────────────────────────────────
// 섹션별 핵심 신호 계산 (컴포넌트 외부 — 재생성 없음)
// ─────────────────────────────────────────────────────────────

function getSectionSignal(slug: string, event: ScoredEvent): { label: string; color: string } | undefined {
  if (slug === 'budget_pick') {
    if ((event as any).is_free) return { label: '무료', color: '#22C55E' };
    const priceMin = (event as any).price_min as number | null;
    if (priceMin != null) {
      if (priceMin <= 10000) return { label: '1만원 이하', color: '#22C55E' };
      const manWon = Math.round(priceMin / 10000);
      return { label: `${manWon}만원대`, color: '#6B7280' };
    }
    return undefined;
  }
  if (slug === 'ending_soon') {
    if (!event.end_date) return undefined;
    const days = Math.ceil((new Date(event.end_date).getTime() - Date.now()) / 86400000);
    if (days <= 0) return { label: '오늘 마감', color: '#FF3B30' };
    if (days <= 3) return { label: `D-${days}`, color: '#FF3B30' };
    if (days <= 7) return { label: `D-${days}`, color: '#FF9500' };
    return { label: `D-${days}`, color: '#6B7280' };
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────
// 스타일
// ─────────────────────────────────────────────────────────────

type Adaptive = ReturnType<typeof useAdaptive>;

const createSkeletonStyles = (a: Adaptive) => StyleSheet.create({
  largeCard: {
    marginHorizontal: 20,
    backgroundColor: a.background,
    borderRadius: 16,
    overflow: 'hidden',
  },
  largeImage: { height: 200, backgroundColor: a.grey200 },
  content: { padding: 16, gap: 8 },
  badge: { width: 48, height: 20, backgroundColor: a.grey200, borderRadius: 10 },
  titleLine1: { height: 20, backgroundColor: a.grey200, borderRadius: 4, width: '85%' },
  titleLine2: { height: 20, backgroundColor: a.grey200, borderRadius: 4, width: '60%' },
  meta: { height: 14, backgroundColor: a.grey200, borderRadius: 4, width: '40%', marginTop: 4 },
  smallCard: { width: 160, backgroundColor: a.background, borderRadius: 12, overflow: 'hidden' },
  smallImage: { height: 100, backgroundColor: a.grey200 },
  smallContent: { padding: 10, gap: 6 },
  smallBadge: { width: 36, height: 16, backgroundColor: a.grey200, borderRadius: 8 },
  smallTitle1: { height: 14, backgroundColor: a.grey200, borderRadius: 4, width: '90%' },
  smallTitle2: { height: 14, backgroundColor: a.grey200, borderRadius: 4, width: '65%' },
});

const createStyles = (a: Adaptive) => StyleSheet.create({
  aiNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: a.blue50,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  aiNoticeText: { flex: 1, fontSize: 13, color: a.blue500, fontWeight: '500' },
  aiNoticeClose: { fontSize: 14, color: a.grey500, marginLeft: 8 },
  container: { flex: 1, backgroundColor: a.grey100 },
  scrollView: { flex: 1 },
  header: {
    backgroundColor: a.background,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 28, fontWeight: '700', color: a.grey900, marginBottom: 4 },
  subtitle: { fontSize: 14, color: a.grey600, fontWeight: '500' },
  locationButton: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: a.blue50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  locationButtonContent: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationButtonText: { fontSize: 13, color: a.blue600, fontWeight: '600' },
  section: { marginTop: 24, marginBottom: 8 },
  sectionHeader: { paddingHorizontal: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: a.grey900, letterSpacing: -0.3 },
  sectionSubtitle: { fontSize: 13, fontWeight: '400', color: a.grey500, marginTop: 4 },
  horizontalList: { paddingHorizontal: 20, gap: 12 },
  emptyCard: {
    height: 300,
    backgroundColor: a.grey50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
  },
  emptyText: { fontSize: 14, color: a.grey600 },
});

// ─────────────────────────────────────────────────────────────
// 스켈레톤
// ─────────────────────────────────────────────────────────────

function TodayPickSkeleton() {
  const adaptive = useAdaptive();
  const s = React.useMemo(() => createSkeletonStyles(adaptive), [adaptive]);
  return (
    <AnimateSkeleton delay={0} withGradient={false} withShimmer>
      <View style={s.largeCard}>
        <View style={s.largeImage} />
        <View style={s.content}>
          <View style={s.badge} />
          <View style={s.titleLine1} />
          <View style={s.titleLine2} />
          <View style={s.meta} />
        </View>
      </View>
    </AnimateSkeleton>
  );
}

function HorizontalSectionSkeleton() {
  const adaptive = useAdaptive();
  const s = React.useMemo(() => createSkeletonStyles(adaptive), [adaptive]);
  return (
    <AnimateSkeleton delay={0} withGradient={false} withShimmer>
      <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={s.smallCard}>
            <View style={s.smallImage} />
            <View style={s.smallContent}>
              <View style={s.smallBadge} />
              <View style={s.smallTitle1} />
              <View style={s.smallTitle2} />
            </View>
          </View>
        ))}
      </View>
    </AnimateSkeleton>
  );
}

// ─────────────────────────────────────────────────────────────
// AdSlot — InlineAd를 독립 컴포넌트로 분리
// feedAdRendered 상태가 HomePageInner를 리렌더하지 않도록 격리
// Android에서 부모 리렌더 시 Native Ad View가 리셋되는 문제 방지
// ─────────────────────────────────────────────────────────────
const AdSlot = React.memo(() => {
  const [status, setStatus] = useState<'loading' | 'rendered' | 'failed'>('loading');

  if (status === 'failed') return null;

  const isAndroid = Platform.OS === 'android';

  return (
    <View
      collapsable={false}
      style={{
        width: '100%',
        // Android: opacity 사용 금지 — native ad SDK 내부 SurfaceView/WebView가
        // 부모 opacity < 1 환경에서 hardware layer 합성 충돌로 렌더링 실패
        // → opacity 없이 height:96 확보, 실패 시 return null로 공간 제거
        // iOS: height:0 → undefined 전환으로 자연스럽게 처리
        height: isAndroid ? 96 : (status === 'rendered' ? undefined : 0),
        marginVertical: status === 'rendered' ? 8 : 0,
        overflow: isAndroid ? 'visible' : 'hidden',
      }}
    >
      <InlineAd
        adGroupId="ait.v2.live.b3363cb4c82643e9"
        impressFallbackOnMount={true}
        onAdRendered={() => setStatus('rendered')}
        onAdFailedToRender={() => setStatus('failed')}
        onNoFill={() => setStatus('failed')}
      />
    </View>
  );
});

// SectionCard — 메모이제이션된 카드 래퍼
// onPress를 안정된 참조로 유지해 EventCard 리렌더 방지
// ─────────────────────────────────────────────────────────────

interface SectionCardProps {
  event: ScoredEvent & { signal?: { label: string; color: string } };
  slug: string;
  rank: number;
  onPress: (id: string, slug: string, rank: number) => void;
}

const SectionCard = React.memo(({ event, slug, rank, onPress }: SectionCardProps) => {
  const handlePress = useCallback(
    (id: string) => onPress(id, slug, rank),
    [onPress, slug, rank],
  );
  return (
    <EventCard
      event={event}
      onPress={handlePress}
      variant="small"
      contextLabel={event.signal?.label}
      contextLabelColor={event.signal?.color}
    />
  );
});

interface TodayPickCardProps {
  event: ScoredEvent;
  onPress: (id: string, slug: string, rank: number) => void;
}

const TodayPickCard = React.memo(({ event, onPress }: TodayPickCardProps) => {
  const handlePress = useCallback(
    (id: string) => onPress(id, 'today_pick', 1),
    [onPress],
  );
  return <EventCard event={event} onPress={handlePress} variant="large" />;
});

// ─────────────────────────────────────────────────────────────
// 홈 화면
// ─────────────────────────────────────────────────────────────

function HomePageInner() {
  const navigation = Route.useNavigation();
  const adaptive = useAdaptive();
  const { top } = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(adaptive), [adaptive]);

  const now = Date.now();
  const validCache = _homeCache && now < _homeCache.expiresAt ? _homeCache : null;
  const [sections, setSections] = useState<HomeSection[] | null>(validCache?.sections ?? null);
  const [userId, setUserId] = useState(validCache?.userId ?? '');
  const [location, setLocation] = useState<Location | undefined>(validCache?.location);
  const [currentAddress, setCurrentAddress] = useState('');
  // userRegion은 ref로만 관리 (렌더링에 직접 사용되지 않음)
  const [refreshing, setRefreshing] = useState(false);
  const [showAiNotice, setShowAiNotice] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const excludedIds = useRef<Set<string>>(new Set());
  const flatListRef = useRef<FlatList>(null);

  // 매거진 피드 상태
  const [feedCards, setFeedCards] = useState<FeedCard[]>([]);
  // feedPage/userRegion은 렌더링에 직접 사용되지 않으므로 ref만 관리 (setState 불필요)
  const [feedHasMore, setFeedHasMore] = useState(true);
  const [feedLoading, setFeedLoading] = useState(false);
  // ref: setState는 비동기 배치라 연속 onEndReached 호출 시 guard가 뚫릴 수 있음
  // ref는 동기적으로 체크되므로 동시 실행 방지에 사용
  const feedLoadingRef = useRef(false);
  const feedSeenEventIds = useRef<Set<string>>(new Set());
  // exclude 소진 자동 리셋은 세션당 1회만 (무한 루프 방지)
  const feedResetAttemptedRef = useRef(false);
  // 이번 세션에서 카드를 한 번이라도 로드했는지 (자연스러운 피드 끝 vs. 초기 로드 실패 구분용)
  const feedCardsLoadedRef = useRef(false);
  // feedHasMore 클로저 stale 문제 방지용 ref: loadMoreFeed guard는 이 ref로 동기 체크
  // (onEndReached 조기 발동으로 feedHasMore=false가 세팅돼도 initializeUser 호출을 막지 않음)
  const feedHasMoreRef = useRef(true);
  // feedPage 클로저 stale 방지용 ref: setFeedPage(0) 후 타임아웃 재시도 시 비동기 리렌더 완료 전에
  // 이전 page 값을 읽는 문제를 방지 (ref는 동기 업데이트)
  const feedPageRef = useRef(0);
  // 지역 하드 필터 단계: exact(서울) → metro(수도권) → all(전국) 순서로 자동 확장
  const feedRegionStageRef = useRef<'exact' | 'metro' | 'all'>('exact');
  // initializeUser가 호출한 loadMoreFeed가 fetch 중이라 drop됐을 때 재시도 예약 플래그
  const feedPendingLoadRef = useRef(false);
  // userRegion ref: loadMoreFeed 클로저 stale 방지 (reverseGeocode가 비동기로 세팅됨)
  const userRegionRef = useRef('');

  useEffect(() => {
    initializeUser();
    checkAiNotice();
  }, []);

  const checkAiNotice = async () => {
    const shown = await getAiNoticeShown();
    if (!shown) setShowAiNotice(true);
  };

  const handleAiNoticeConfirm = useCallback(async () => {
    await setAiNoticeShown();
    setShowAiNotice(false);
  }, []);

  const initializeUser = async () => {
    // 피드 상태 복원 (캐시 히트 여부와 관계없이 항상 수행)
    const feedState = await getFeedState();
    if (!feedState.wasReset && feedState.excludeIds.length > 0) {
      feedSeenEventIds.current = new Set(feedState.excludeIds);
      feedPageRef.current = feedState.nextPage;
    }

    if (_homeCache && Date.now() < _homeCache.expiresAt) {
      if (!feedCardsLoadedRef.current) feedHasMoreRef.current = true;
      // fetch 중이면 pending 마킹 → finally에서 자동 재시도
      if (feedLoadingRef.current) { feedPendingLoadRef.current = true; }
      else { void loadMoreFeedRef.current(); } // 캐시 히트해도 첫 피드 배치 로드
      return;
    }

    try {
      // userId 조회 + GPS 대기 병렬 실행
      const [uid, loc] = await Promise.all([
        getCurrentUserId(),
        Promise.race([
          requestLocation(),
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 500)),
        ]),
      ]);
      setUserId(uid);

      await loadSections(loc, uid);
      if (!feedCardsLoadedRef.current) feedHasMoreRef.current = true;
      // fetch 중이면 pending 마킹 → finally에서 자동 재시도
      if (feedLoadingRef.current) { feedPendingLoadRef.current = true; }
      else { void loadMoreFeedRef.current(); } // 섹션 로드 완료 후 최신 loadMoreFeed로 피드 로드

      // GPS가 2초 내에 못 왔지만 이후 완료된 경우 전체 섹션 재로드
      if (!loc) {
        requestLocation().then((resolvedLoc) => {
          if (resolvedLoc) {
            void loadSections(resolvedLoc, uid);
          }
        }).catch(() => {});
      }
    } catch (error) {
      console.error('[Home] init error:', error);
      await loadSections();
      if (!feedCardsLoadedRef.current) feedHasMoreRef.current = true;
      // fetch 중이면 pending 마킹 → finally에서 자동 재시도
      if (feedLoadingRef.current) { feedPendingLoadRef.current = true; }
      else { void loadMoreFeedRef.current(); } // 오류 복구 후에도 피드 로드 시도
    }
  };

  const requestLocation = async (): Promise<Location | undefined> => {
    try {
      const permission = await getCurrentLocation.getPermission();
      if ((permission as string) === 'denied' || (permission as string) === 'osPermissionDenied') {
        return undefined;
      }
      if (permission === 'notDetermined') {
        const result = await getCurrentLocation.openPermissionDialog();
        if (result === 'denied') return undefined;
      }
      const data = await getCurrentLocation({ accuracy: Accuracy.Balanced });
      const loc: Location = { lat: data.coords.latitude, lng: data.coords.longitude };
      setLocation(loc);
      reverseGeocode(loc.lat, loc.lng).then((geo) => {
        setCurrentAddress(geo.success && geo.address ? geo.address : '위치 정보');
        if (geo.success && geo.sido) {
          const region = sidoToRegion(geo.sido);
          // ref만 업데이트: 다음 loadMoreFeed 호출 시 자동으로 반영됨
          // 강제 재로드 금지 — feedSeenEventIds가 채워진 상태에서 page=0+exact로 재시도하면
          // 이미 본 이벤트가 exclude되어 빈 결과 → 단계 순환 루프 발생
          userRegionRef.current = region;
        }
      }).catch(() => {});
      return loc;
    } catch (error) {
      if (!(error instanceof GetCurrentLocationPermissionError)) {
        console.error('[Home] location error:', error);
      }
      return undefined;
    }
  };

  const loadSections = async (loc?: Location, uid?: string) => {
    const currentUid = uid ?? userId;

    // SWR Step 1: 이전 세션 stale 캐시 즉시 렌더링 (skeleton 없이 바로 데이터 표시)
    // 이미 sections가 있으면 stale로 덮어씌우지 않음 (GPS 재호출 시 플래시 방지)
    const stale = await recommendationService.getStaleHomeSections();
    setSections((prev) => prev !== null ? prev : (stale ?? null));

    const networkStatus = await getNetworkStatus();
    if (networkStatus === 'OFFLINE') {
      setIsOffline(true);
      if (stale === null) setSections([]); // 캐시도 없고 오프라인 → 에러 표시
      return;
    }
    setIsOffline(false);

    // SWR Step 2: 신선한 데이터를 백그라운드에서 fetch → 완료 시 UI 갱신
    const response = await recommendationService.getSections(loc, currentUid);
    if (response.success) {
      // today_pick 하루 고정: GPS 재로드·새로고침 시에도 오늘 이미 선택된 이벤트 유지
      // (GPS 유무에 따라 backend 후보 풀이 달라져 변경될 수 있으므로 프론트에서 잠금)
      const today = getTodayKst();
      const freshTodayPick = response.sections.find(s => s.slug === 'today_pick');
      let finalSections = response.sections;
      if (freshTodayPick) {
        if (!_todayPickCache || _todayPickCache.kstDate !== today) {
          // 오늘 첫 선택 → 캐시에 저장
          _todayPickCache = { section: freshTodayPick, kstDate: today };
        }
        // 이미 오늘 today_pick이 결정됐으면 기존 것 유지
        finalSections = response.sections.map(s =>
          s.slug === 'today_pick' ? _todayPickCache!.section : s
        );
      }
      setSections(finalSections);
      _homeCache = {
        sections: finalSections,
        location: loc,
        userId: currentUid,
        expiresAt: Date.now() + HOME_CACHE_TTL_MS,
      };
      // 첫 화면에 보이는 이미지 프리페치 — 사용자가 보기 전에 미리 캐시
      // 각 섹션 앞 6개만 프리페치 (오버헤드 최소화)
      requestAnimationFrame(() => {
        finalSections.forEach((section) => {
          section.events.slice(0, 6).forEach((event) => {
            if (event.thumbnail_url) {
              Image.prefetch(event.thumbnail_url).catch(() => {});
            }
          });
        });
      });
    } else if (stale === null) {
      // 캐시도 없고 API도 실패한 경우에만 에러 표시
      setSections([]);
    }
    // API 실패 + stale 있음 → stale 유지 (에러 화면 없음)
  };

  const handleEventPress = useCallback((eventId: string, sectionSlug?: string, rankPosition?: number) => {
    navigation.navigate('/events/:id', { id: eventId });
    // navigate 이후 로깅: 네비게이션 애니메이션이 먼저 시작되도록 지연
    requestAnimationFrame(() => {
      userEventService.logEventClick(eventId, {
        sectionSlug,
        rankPosition,
        metadata: {
          click_source: 'home_card',
          ...(sectionSlug === 'today_pick' && { algorithm_version: 'v2' }),
        },
      }).catch(() => {});
    });
  }, [navigation]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    _homeCache = null;
    try {
      excludedIds.current.clear();
      // 피드 초기화 + 스토리지 리셋
      await resetFeedState();
      setFeedCards([]);
      feedPageRef.current = 0;
      setFeedHasMore(true);
      feedHasMoreRef.current = true;
      feedSeenEventIds.current.clear();
      feedResetAttemptedRef.current = false;
      feedCardsLoadedRef.current = false;
      feedRegionStageRef.current = 'exact';
      feedPendingLoadRef.current = false;
      userRegionRef.current = '';
      const loc = await requestLocation();
      await loadSections(loc, userId);
      void loadMoreFeedRef.current(); // 새로고침 후 피드도 재로드
    } finally {
      setRefreshing(false);
    }
  }, [userId]);

  const loadMoreFeed = useCallback(async () => {
    // ref로 동기 체크 — setState 배치로 인한 동시 실행 방지
    // feedHasMoreRef: 클로저 stale 문제 없는 동기 ref 사용
    if (feedLoadingRef.current || !feedHasMoreRef.current) return;
    feedLoadingRef.current = true;
    setFeedLoading(true);
    // feedPage/userRegion은 ref로 읽어 stale 클로저 문제 방지
    // (setFeedPage(0) 후 타임아웃 재시도 시 비동기 리렌더 완료 전에 이전 값을 읽는 문제 방지)
    const currentPage = feedPageRef.current;
    const currentRegion = userRegionRef.current;
    // Android safety timeout: OkHttp가 AbortController abort를 무시하면 fetchFeed가 hang함
    // → JS 레벨에서 (API_TIMEOUT + 3s) 후 강제로 loading 해제해 UI가 멈추지 않도록 보장
    const safetyTimeoutId = setTimeout(() => {
      if (feedLoadingRef.current) {
        console.warn('[Feed] safety timeout triggered — clearing stuck loading state');
        feedLoadingRef.current = false;
        setFeedLoading(false);
      }
    }, API_TIMEOUT + 3000);
    try {
      const res = await fetchFeed({
        page: currentPage,
        excludeIds: Array.from(feedSeenEventIds.current),
        userId,
        region: currentRegion || undefined,
        // 위치 정보 있으면 현재 단계의 하드 필터 적용, 없으면 전국 표시
        regionStage: currentRegion ? feedRegionStageRef.current : 'all',
      });

      if (res.cards.length === 0) {
        // Priority 1: excludeIds 풀 소진 시 → 초기화 후 1회만 재시도
        // stale pendingRetry가 feedPage=0으로 잘못 호출돼 false exhaustion이 생기는 경우도 포함
        // feedResetAttemptedRef로 무한 루프 방지 (세션당 1회)
        if (
          feedSeenEventIds.current.size > 0 &&
          !feedResetAttemptedRef.current
        ) {
          feedResetAttemptedRef.current = true;
          feedSeenEventIds.current.clear();
          feedPageRef.current = 0;
          setFeedHasMore(true);
          feedHasMoreRef.current = true;
          feedPendingLoadRef.current = false; // setTimeout이 처리하므로 별도 pending 불필요
          resetFeedState().catch(() => {});
          setTimeout(() => { void loadMoreFeedRef.current(); }, 100);
          return;
        }

        // Priority 2: 지역 단계 확장 (서울 exact → 수도권 metro → 전국 all)
        // 위치 정보가 있고 아직 all 단계가 아닐 때만 확장
        if (currentRegion && feedRegionStageRef.current !== 'all') {
          if (feedRegionStageRef.current === 'exact') {
            feedRegionStageRef.current = 'metro';
          } else {
            feedRegionStageRef.current = 'all';
          }
          feedPageRef.current = 0;
          setFeedHasMore(true);
          feedHasMoreRef.current = true;
          feedPendingLoadRef.current = false; // setTimeout이 처리하므로 별도 pending 불필요
          setTimeout(() => { void loadMoreFeedRef.current(); }, 100);
          return;
        }

        // Priority 3: 모든 단계 소진 → 피드 끝 카드 표시
        setFeedHasMore(false);
        feedHasMoreRef.current = false;
        return;
      }
      if (res.cards.length > 0) {
        feedCardsLoadedRef.current = true; // 이번 세션에서 카드 로드 성공
        setFeedCards((prev) => [...prev, ...res.cards]);
        const newIds: string[] = [];
        res.cards.forEach((card) =>
          card.events.forEach((e) => {
            feedSeenEventIds.current.add(e.id);
            newIds.push(e.id);
          }),
        );
        const nextPage = parseInt(res.next_cursor ?? String(currentPage + 1));
        feedPageRef.current = nextPage;
        advanceFeedState(newIds, nextPage).catch(() => {}); // fire-and-forget
        // 다음 스크롤 전에 이미지 미리 캐시 — 스크롤 시 즉시 표시
        requestAnimationFrame(() => {
          res.cards.forEach((card) => {
            card.events.forEach((e) => {
              if (e.image_url) Image.prefetch(e.image_url).catch(() => {});
            });
          });
        });
      }
      setFeedHasMore(res.has_more);
      feedHasMoreRef.current = res.has_more;
    } catch (err) {
      // 피드 로딩 실패는 무시 (기존 섹션에 영향 없음)
      // 에러 로그: Android abort 미지원 / 네트워크 에러 등 원인 파악용
      console.warn('[Feed] loadMoreFeed error:', err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(safetyTimeoutId); // safety timeout이 이미 발동됐으면 no-op
      feedLoadingRef.current = false;
      setFeedLoading(false);
      // initializeUser의 call이 drop됐으면 지금 재시도
      // 150ms: React가 setFeedPage 등으로 re-render + loadMoreFeedRef 갱신을 완료할 여유
      if (feedPendingLoadRef.current) {
        feedPendingLoadRef.current = false;
        setTimeout(() => { void loadMoreFeedRef.current(); }, 150);
      }
    }
  }, [userId]); // feedPage/userRegion은 ref로 읽으므로 deps 제거 (stale 클로저 방지)

  // loadMoreFeed는 deps 변경 시마다 새 참조 생성 (useCallback).
  // initializeUser/handleRefresh는 first-render closure를 캡처하므로
  // 항상 최신 버전을 호출하도록 ref에 동기화.
  const loadMoreFeedRef = useRef(loadMoreFeed);
  useEffect(() => { loadMoreFeedRef.current = loadMoreFeed; }, [loadMoreFeed]);

  const scrollToTop = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  // onEndReached가 새 카드 추가 후 자동으로 재평가되지 않는 React Native FlatList 이슈 보완
  // 스크롤 모멘텀 종료 시점에 추가로 체크하여 누락된 로드 트리거 보정
  const handleMomentumScrollEnd = useCallback((e: { nativeEvent: { contentSize: { height: number }; layoutMeasurement: { height: number }; contentOffset: { y: number } } }) => {
    const { contentSize, layoutMeasurement, contentOffset } = e.nativeEvent;
    const distanceFromEnd = contentSize.height - layoutMeasurement.height - contentOffset.y;
    if (distanceFromEnd < layoutMeasurement.height * 2) {
      void loadMoreFeedRef.current();
    }
  }, []);

  // ─────────────────────────────────────────────────────────────
  // 중복 제거 + 신호 계산을 useMemo로 처리 — 렌더 중 연산 제거
  // ─────────────────────────────────────────────────────────────

  const processedSections = useMemo((): ProcessedSection[] => {
    if (!sections) return [];
    const seenIds = new Set<string>();
    const result: ProcessedSection[] = [];

    for (const section of sections) {
      if (section.slug === 'nearby' && !location) continue;

      const unique = section.events.filter((e) => !seenIds.has(e.id));
      unique.forEach((e) => seenIds.add(e.id));

      if (unique.length === 0) continue;

      result.push({
        ...section,
        events: unique.map((event) => ({
          ...event,
          signal: getSectionSignal(section.slug, event),
        })),
      });
    }

    return result;
  }, [sections, location]);

  // ─────────────────────────────────────────────────────────────
  // 섹션 렌더링
  // ─────────────────────────────────────────────────────────────

  const renderSection = useCallback((section: ProcessedSection) => {
    const { slug, title, subtitle, events } = section;

    if (slug === 'today_pick') {
      return (
        <View key={slug} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
          </View>
          <View style={{ paddingHorizontal: 20 }}>
            <TodayPickCard event={events[0]!} onPress={handleEventPress} />
          </View>
        </View>
      );
    }

    return (
      <View key={slug} style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalList}
          removeClippedSubviews={true}
          nestedScrollEnabled={true}
        >
          {events.map((event, idx) => (
            <SectionCard
              key={event.id}
              event={event}
              slug={slug}
              rank={idx + 1}
              onPress={handleEventPress}
            />
          ))}
        </ScrollView>
      </View>
    );
  }, [styles, handleEventPress]);

  // ─────────────────────────────────────────────────────────────
  // FlatList 데이터 + 렌더러
  // ─────────────────────────────────────────────────────────────

  const feedItems = useMemo((): FeedItem[] => {
    if (sections === null) {
      return [
        { type: 'skeleton', skeletonType: 'today_pick', id: 'sk-today' },
        { type: 'skeleton', skeletonType: 'horizontal', id: 'sk-h1' },
        { type: 'skeleton', skeletonType: 'horizontal', id: 'sk-h2' },
        { type: 'skeleton', skeletonType: 'horizontal', id: 'sk-h3' },
      ];
    }
    if (processedSections.length === 0) {
      return [{ type: 'empty' }];
    }

    const items: FeedItem[] = [];

    // 섹션 고정 배치
    // 섹션 사이에 피드 카드를 끼워넣으면 피드 로딩 시 기존 아이템 인덱스가 밀려
    // FlatList가 스크롤 위치를 잃는 점프 현상이 발생함 → 섹션 뒤에 순서대로 붙임
    for (let i = 0; i < processedSections.length; i++) {
      items.push({ type: 'section', section: processedSections[i]! });
      if (i === 1) items.push({ type: 'ad', id: 'section-1' });
    }

    // 피드 카드는 섹션 전체 이후에 추가 (스크롤 점프 없음)
    // 3개 컴포넌트마다 광고 1개 삽입
    for (let i = 0; i < feedCards.length; i++) {
      items.push({ type: 'magazine', card: feedCards[i]! });
      if ((i + 1) % 3 === 0) items.push({ type: 'ad', id: `feed-${i}` });
    }

    if (feedLoading) {
      // 스켈레톤 3개: 인스타/핀터레스트처럼 여러 개가 오고 있다는 느낌 제공
      items.push({ type: 'feed_loading' });
      items.push({ type: 'feed_loading' });
      items.push({ type: 'feed_loading' });
    } else if (!feedHasMore) {
      const eventCount = feedCards.reduce((sum, card) => sum + card.events.length, 0);
      items.push({ type: 'feed_end', eventCount });
    } else if (feedCards.length > 0) {
      // feedHasMore=true && !feedLoading: 더 로드 가능한 상태임을 하단 도트로 표시
      // 사용자가 더 스크롤할 의지를 갖도록 유도 (핀터레스트 방식)
      items.push({ type: 'feed_more_dot' });
    }

    return items;
  }, [sections, processedSections, feedCards, feedLoading, feedHasMore]);

  const renderFeedItem = useCallback(({ item }: { item: FeedItem }) => {
    if (item.type === 'skeleton') {
      if (item.skeletonType === 'today_pick') {
        return (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ height: 24, width: 100, backgroundColor: adaptive.grey200, borderRadius: 4 }} />
            </View>
            <TodayPickSkeleton />
          </View>
        );
      }
      return (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={{ height: 20, width: 120, backgroundColor: adaptive.grey200, borderRadius: 4 }} />
          </View>
          <HorizontalSectionSkeleton />
        </View>
      );
    }
    if (item.type === 'empty') {
      return (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            {isOffline ? '네트워크 연결을 확인해 주세요' : '추천 이벤트를 불러오지 못했어요'}
          </Text>
        </View>
      );
    }
    if (item.type === 'ad') {
      return <AdSlot />;
    }
    if (item.type === 'magazine') {
      const { card } = item;

      if (card.content_type === 'HERO') {
        if (!card.events[0]) return null;
        return (
          <HeroCard
            framingLabel={card.framing_label ?? ''}
            event={card.events[0]}
            onPress={(id) => handleEventPress(id, card.framing_type)}
          />
        );
      }

      if (card.content_type === 'TREND' || card.content_type === 'RANKING') {
        return (
          <TrendCard
            title={card.framing_label ?? card.title ?? ''}
            events={card.events}
            onPress={(id) => handleEventPress(id, card.framing_type)}
          />
        );
      }

      if (card.content_type === 'BUNDLE') {
        // 기존 섹션과 동일한 EventCard small + 가로 스크롤 — 시각적 일관성
        const adaptedEvents = card.events.map(feedEventToScoredEvent);
        return (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{card.framing_label ?? card.title ?? ''}</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              removeClippedSubviews
              nestedScrollEnabled={true}
            >
              {adaptedEvents.map((event, idx) => (
                <SectionCard
                  key={event.id}
                  event={event}
                  slug={card.framing_type}
                  rank={idx + 1}
                  onPress={handleEventPress}
                />
              ))}
            </ScrollView>
          </View>
        );
      }

      // SPOTLIGHT 등 fallback
      return (
        <MagazineCard
          contentType="BUNDLE"
          title={card.framing_label ?? card.title ?? ''}
          body={card.body}
          events={card.events}
          onPress={(id) => handleEventPress(id, card.framing_type)}
        />
      );
    }
    if (item.type === 'feed_loading') {
      return (
        <View style={{ paddingVertical: 12, paddingHorizontal: 20 }}>
          <AnimateSkeleton delay={0} withGradient={false} withShimmer>
            <View style={{ height: 100, borderRadius: 16, backgroundColor: adaptive.grey200 }} />
          </AnimateSkeleton>
        </View>
      );
    }
    if (item.type === 'feed_more_dot') {
      // 더 로드 가능한 상태임을 알리는 점 세 개 — 핀터레스트 방식
      return (
        <View style={{ paddingVertical: 20, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: adaptive.grey300 }} />
          ))}
        </View>
      );
    }
    if (item.type === 'feed_end') {
      return (
        <View style={{ paddingHorizontal: 20, paddingVertical: 32, alignItems: 'center' }}>
          {/* 구분선 + 타이틀 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 20 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: adaptive.grey200 }} />
            <Text style={{ marginHorizontal: 12, color: adaptive.grey600, fontSize: 13, fontWeight: '600' }}>
              오늘 이벤트는 다 봤어요
            </Text>
            <View style={{ flex: 1, height: 1, backgroundColor: adaptive.grey200 }} />
          </View>
          {/* 이벤트 수 */}
          <Text style={{ fontSize: 15, fontWeight: '700', color: adaptive.grey900, marginBottom: 6 }}>
            {item.eventCount > 0
              ? `${item.eventCount.toLocaleString()}개의 이벤트를 둘러봤어요`
              : '새로운 피드를 준비 중이에요'}
          </Text>
          {/* 업데이트 안내 */}
          <Text style={{ fontSize: 13, color: adaptive.grey500, marginBottom: 24 }}>
            매일 새 이벤트가 업데이트돼요
          </Text>
          {/* 버튼 2개 */}
          <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
            <Pressable
              onPress={scrollToTop}
              style={{ flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: adaptive.grey300, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: adaptive.grey700 }}>↑ 맨 위로</Text>
            </Pressable>
            <Pressable
              onPress={handleRefresh}
              style={{ flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: adaptive.grey300, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: adaptive.grey700 }}>새로 고침</Text>
            </Pressable>
          </View>
        </View>
      );
    }
    return renderSection(item.section);
  }, [styles, adaptive, isOffline, renderSection, handleEventPress, scrollToTop, handleRefresh]);

  const listHeader = useMemo(() => (
    <>
      <ScrollViewInertialBackground topColor={adaptive.background} bottomColor={adaptive.grey100} />
      <View style={[styles.header, { paddingTop: top }]}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.title}>페어픽</Text>
            <Text style={styles.subtitle}>오늘의 재미를 찾아볼까요?</Text>
          </View>
          {location && currentAddress ? (
            <Pressable
              onPress={handleRefresh}
              style={styles.locationButton}
              android_ripple={{ color: adaptive.grey200, radius: 20 }}
            >
              <View style={styles.locationButtonContent}>
                <Icon name="icon-pin-mono" size={14} color={adaptive.blue600} />
                <Text style={styles.locationButtonText}>{currentAddress}</Text>
              </View>
            </Pressable>
          ) : null}
        </View>
      </View>
    </>
  ), [adaptive, styles, top, location, currentAddress, handleRefresh]);

  return (
    <View style={styles.container}>
      {showAiNotice && (
        <View style={styles.aiNoticeBanner}>
          <Text style={styles.aiNoticeText}>페어픽은 AI를 활용해요</Text>
          <Pressable onPress={handleAiNoticeConfirm} hitSlop={8}>
            <Text style={styles.aiNoticeClose}>✕</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        ref={flatListRef}
        style={styles.scrollView}
        data={feedItems}
        renderItem={renderFeedItem}
        keyExtractor={(item, index) => {
          if (item.type === 'section') return item.section.slug;
          if (item.type === 'skeleton') return item.id;
          if (item.type === 'magazine') return `magazine-${item.card.id}`;
          // feed_loading은 3개가 동시에 렌더링될 수 있으므로 index로 구분
          if (item.type === 'feed_loading') return `feed_loading_${index}`;
          if (item.type === 'feed_more_dot') return 'feed_more_dot';
          if (item.type === 'feed_end') return 'feed_end';
          if (item.type === 'ad') return `ad-${item.id}`;
          return item.type;
        }}
        ListHeaderComponent={listHeader}
        ListFooterComponent={<View style={{ height: 100 }} />}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={Platform.OS !== 'android'}
        // Android 성능 최적화: 기본 windowSize=21(화면 20개 분량)이 너무 커서
        // 스크롤 누적 시 JS 스레드 과부하 → 5로 줄여 메모리/렌더 부담 감소
        windowSize={5}
        maxToRenderPerBatch={3}
        initialNumToRender={6}
        onScrollBeginDrag={handleAiNoticeConfirm}
        onEndReached={loadMoreFeed}
        onEndReachedThreshold={2}
        // React Native FlatList는 새 아이템 추가 후 onEndReached를 자동 재평가하지 않음
        // → 모멘텀 스크롤 종료 시 추가 체크하여 누락된 로드 트리거 보정
        onMomentumScrollEnd={handleMomentumScrollEnd}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      />

      <BottomTabBar currentTab="home" onHomeTabPress={scrollToTop} />
    </View>
  );
}

function HomePage() {
  return (
    <LikesProvider>
      <HomePageInner />
    </LikesProvider>
  );
}

export default HomePage;
