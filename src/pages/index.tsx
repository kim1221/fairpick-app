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
  | { type: 'ad'; id: string; adType: 'section' | 'feed' }
  | { type: 'magazine'; card: FeedCard }
  | { type: 'feed_loading'; loadingIdx: number }
  | { type: 'feed_more_dot' }
  | { type: 'feed_error' }
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
const AdSlot = React.memo(({ adGroupId }: { adGroupId: string }) => {
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
        adGroupId={adGroupId}
        impressFallbackOnMount={true}
        onAdRendered={() => setStatus('rendered')}
        onAdFailedToRender={() => setStatus('failed')}
        onNoFill={() => setStatus('failed')}
      />
    </View>
  );
});

// 섹션 사이 광고 ID (추천 섹션용)
const AD_GROUP_SECTION = 'ait.v2.live.b3363cb4c82643e9';
// 피드 카드 사이 광고 ID (피드 전용 — 섹션과 동일 ID 사용 시 fill 충돌 발생)
const AD_GROUP_FEED = 'ait.v2.live.7e6f43f894204302';

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
  // feedHasMore=false로 시작: initializeUser 완료 전에 onEndReached가
  // 조기 발동해서 레이스 컨디션을 일으키는 것을 방지
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);
  // feedError: 카드 0개인 상태에서 모든 복구 시도 실패 시 표시 (hasMore=false 대신 사용)
  const [feedError, setFeedError] = useState(false);
  const feedLoadingRef = useRef(false);
  const feedSeenEventIds = useRef<Set<string>>(new Set());
  const feedResetAttemptedRef = useRef(false);
  const feedCardsLoadedRef = useRef(false);
  const feedHasMoreRef = useRef(false);
  const feedPageRef = useRef(0);
  const feedRegionStageRef = useRef<'exact' | 'metro' | 'all'>('exact');
  const feedPendingLoadRef = useRef(false);
  const userRegionRef = useRef('');
  // userId ref: loadMoreFeed가 loadSections 완료 전에 호출될 때 stale 클로저 방지
  const userIdRef = useRef(validCache?.userId ?? '');
  const feedRetryCountRef = useRef(0);
  // recovery effect 재시도 횟수: 무한 루프 방지
  const feedRecoveryCountRef = useRef(0);
  const FEED_MAX_RETRIES = 3;
  const FEED_MAX_RECOVERY = 3;
  // 첫 피드 요청 타임아웃: 8초로 짧게 유지해 빠른 재시도로 서버 웨이크업을 노림
  // Railway 콜드 스타트(15~30초)는 재시도가 catch해줌 — 1번 요청이 30초 기다리는 것보다 빠름
  const COLD_START_TIMEOUT = 8000;

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

    const triggerFeedLoad = () => {
      feedHasMoreRef.current = true;
      setFeedHasMore(true);
      setFeedError(false);
      feedRecoveryCountRef.current = 0;
      feedRetryCountRef.current = 0;
      void loadMoreFeedRef.current();
    };

    if (_homeCache && Date.now() < _homeCache.expiresAt) {
      // 캐시 히트: 섹션은 이미 useState 초기값으로 표시됨
      // Railway 콜드 스타트 대비: loadSections를 fire-and-forget으로 호출해 서버를 미리 깨움
      // (응답 결과는 무시하지 않고 섹션 갱신에 활용)
      loadSections(_homeCache.location, _homeCache.userId).catch(() => {});
      triggerFeedLoad();
      return;
    }

    try {
      // 첫 방문 유저: 권한 다이얼로그를 500ms Race 밖에서 먼저 처리
      // Race 안에서 openPermissionDialog를 호출하면 500ms 타임아웃이 먼저 resolve되고
      // 이후 if(!loc) 재호출과 openPermissionDialog가 동시에 실행돼 다이얼로그가 안 뜨는 버그
      try {
        const perm = await getCurrentLocation.getPermission();
        if ((perm as string) === 'notDetermined') {
          await getCurrentLocation.openPermissionDialog();
        }
      } catch (_) {}

      const [uid, loc] = await Promise.all([
        getCurrentUserId(),
        // 권한은 위에서 이미 처리됨 → 여기서는 좌표만 가져오면 되므로 500ms Race 유효
        Promise.race([
          requestLocation(),
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 500)),
        ]),
      ]);
      setUserId(uid);
      userIdRef.current = uid;

      // 섹션·피드 병렬 로드: 섹션 완료를 기다리지 않고 피드 즉시 시작
      // Railway 콜드 스타트 시 섹션 로드가 10~30초 걸려 피드가 늦게 뜨는 문제 해결
      loadSections(loc, uid).catch((err) => {
        console.warn('[Home] loadSections failed, setting empty sections:', err);
        setSections((prev) => prev ?? []);
      });
      triggerFeedLoad();

      // GPS가 500ms 내에 못 왔지만 이후 완료된 경우 전체 섹션 재로드
      if (!loc) {
        requestLocation().then((resolvedLoc) => {
          if (resolvedLoc) {
            void loadSections(resolvedLoc, uid);
          }
        }).catch(() => {});
      }
    } catch (error) {
      console.error('[Home] init error:', error);
      setSections((prev) => prev ?? []);
      triggerFeedLoad();
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
    let stale: Awaited<ReturnType<typeof recommendationService.getStaleHomeSections>> = null;
    try {
      stale = await recommendationService.getStaleHomeSections();
    } catch (e) {
      console.warn('[Home] getStaleHomeSections failed:', e);
    }
    setSections((prev) => prev !== null ? prev : (stale ?? null));

    let networkStatus: string = 'ONLINE';
    try {
      networkStatus = await getNetworkStatus();
    } catch (e) {
      console.warn('[Home] getNetworkStatus failed, assuming online:', e);
    }
    if (networkStatus === 'OFFLINE') {
      setIsOffline(true);
      if (stale === null) setSections([]);
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
      feedRetryCountRef.current = 0;
      feedRecoveryCountRef.current = 0;
      setFeedError(false);
      userRegionRef.current = '';
      const loc = await requestLocation();
      loadSections(loc, userId).catch((err) => {
        console.warn('[Home] refresh loadSections failed:', err);
        setSections((prev) => prev ?? []);
      });
      void loadMoreFeedRef.current();
    } finally {
      setRefreshing(false);
    }
  }, [userId]);

  const loadMoreFeed = useCallback(async () => {
    if (feedLoadingRef.current || !feedHasMoreRef.current) return;
    feedLoadingRef.current = true;
    setFeedLoading(true);
    const currentPage = feedPageRef.current;
    const currentRegion = userRegionRef.current;
    // userId: ref로 읽어 stale 클로저 방지 (loadSections 완료 전에 호출될 수 있음)
    const currentUserId = userIdRef.current;
    // 첫 피드 요청(카드 0개)이면 Railway 콜드 스타트에 대비해 30초 타임아웃
    const isFirstLoad = !feedCardsLoadedRef.current;
    const fetchTimeout = isFirstLoad ? COLD_START_TIMEOUT : API_TIMEOUT;
    const safetyTimeoutId = setTimeout(() => {
      if (feedLoadingRef.current) {
        feedLoadingRef.current = false;
        setFeedLoading(false);
        if (feedRetryCountRef.current < FEED_MAX_RETRIES) {
          feedRetryCountRef.current++;
          setTimeout(() => { void loadMoreFeedRef.current(); }, 1000);
        }
      }
    }, fetchTimeout + 3000);
    try {
      const res = await fetchFeed({
        page: currentPage,
        excludeIds: Array.from(feedSeenEventIds.current),
        userId: currentUserId,
        region: currentRegion || undefined,
        regionStage: currentRegion ? feedRegionStageRef.current : 'all',
        timeout: fetchTimeout,
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
      // 성공 시 재시도 카운터 리셋
      feedRetryCountRef.current = 0;
    } catch (err) {
      console.warn('[Feed] error:', err instanceof Error ? err.message : String(err));
      if (feedRetryCountRef.current < FEED_MAX_RETRIES) {
        feedRetryCountRef.current++;
        const delay = 1000 * feedRetryCountRef.current;
        setTimeout(() => { void loadMoreFeedRef.current(); }, delay);
      }
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

  // 피드 고착 상태 자동 복구: feedCards=0, loading=false, hasMore=true이면
  // 섹션은 로드됐는데 피드가 빠진 상태 → 3초 후 자동 재트리거
  // FEED_MAX_RECOVERY 초과 시 feedError=true로 에러 카드 표시 (hasMore는 건드리지 않음)
  // 이유: hasMore=false는 "콘텐츠가 없음"을 의미하지만 실제로는 서버 응답 실패이므로 구분
  useEffect(() => {
    if (sections !== null && feedCards.length === 0 && !feedLoading && feedHasMore && !feedError) {
      if (feedRecoveryCountRef.current >= FEED_MAX_RECOVERY) {
        // 복구 시도 초과 → 에러 카드 표시 (다시 시도 버튼 포함)
        setFeedError(true);
        return undefined;
      }
      const id = setTimeout(() => {
        feedRecoveryCountRef.current++;
        void loadMoreFeedRef.current();
      }, 3000);
      return () => clearTimeout(id);
    }
    // 카드가 생겼으면 복구 카운터·에러 리셋
    if (feedCards.length > 0 && feedError) {
      setFeedError(false);
      feedRecoveryCountRef.current = 0;
    }
    return undefined;
  }, [sections, feedCards.length, feedLoading, feedHasMore, feedError]);

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
    const items: FeedItem[] = [];

    if (sections === null) {
      // 섹션 로딩 중: 스켈레톤 표시
      items.push({ type: 'skeleton', skeletonType: 'today_pick', id: 'sk-today' });
      items.push({ type: 'skeleton', skeletonType: 'horizontal', id: 'sk-h1' });
      items.push({ type: 'skeleton', skeletonType: 'horizontal', id: 'sk-h2' });
      items.push({ type: 'skeleton', skeletonType: 'horizontal', id: 'sk-h3' });
    } else if (processedSections.length === 0) {
      items.push({ type: 'empty' });
    } else {
      for (let i = 0; i < processedSections.length; i++) {
        items.push({ type: 'section', section: processedSections[i]! });
        if (i === 1) items.push({ type: 'ad', id: 'section-1', adType: 'section' });
      }
    }

    // 피드 카드는 섹션 상태와 무관하게 항상 표시
    // (sections 로딩/실패로 피드가 영원히 숨겨지는 버그 방지)
    for (let i = 0; i < feedCards.length; i++) {
      items.push({ type: 'magazine', card: feedCards[i]! });
      if ((i + 1) % 3 === 0) items.push({ type: 'ad', id: `feed-${i}`, adType: 'feed' });
    }

    // 로딩 중이거나 재시도 대기 중(카드 없음+hasMore+에러 없음)일 때 스켈레톤 표시
    // 재시도 사이 1~3초 갭에도 스켈레톤을 유지해 깜박임 방지
    const showFeedLoading = feedLoading || (feedCards.length === 0 && feedHasMore && !feedError);
    if (showFeedLoading) {
      items.push({ type: 'feed_loading', loadingIdx: 0 });
      items.push({ type: 'feed_loading', loadingIdx: 1 });
      items.push({ type: 'feed_loading', loadingIdx: 2 });
    } else if (feedError) {
      // 카드 0개 + 모든 재시도 실패: 에러 카드 (hasMore는 여전히 true — 콘텐츠는 존재함)
      items.push({ type: 'feed_error' });
    } else if (!feedHasMore) {
      const eventCount = feedCards.reduce((sum, card) => sum + card.events.length, 0);
      items.push({ type: 'feed_end', eventCount });
    } else if (feedCards.length > 0) {
      items.push({ type: 'feed_more_dot' });
    }

    return items;
  }, [sections, processedSections, feedCards, feedLoading, feedHasMore, feedError]);

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
      return <AdSlot adGroupId={item.adType === 'feed' ? AD_GROUP_FEED : AD_GROUP_SECTION} />;
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
    if (item.type === 'feed_error') {
      // 카드 0개 상태에서 서버 응답 실패 — 다시 시도 버튼 제공
      return (
        <View style={{ paddingHorizontal: 20, paddingVertical: 32, alignItems: 'center' }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: adaptive.grey700, marginBottom: 8 }}>
            피드를 불러오지 못했어요
          </Text>
          <Text style={{ fontSize: 13, color: adaptive.grey500, marginBottom: 20 }}>
            잠시 후 다시 시도해 주세요
          </Text>
          <Pressable
            onPress={() => {
              setFeedError(false);
              feedRecoveryCountRef.current = 0;
              feedRetryCountRef.current = 0;
              void loadMoreFeedRef.current();
            }}
            style={{ paddingVertical: 11, paddingHorizontal: 24, borderRadius: 10, borderWidth: 1, borderColor: adaptive.grey300 }}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: adaptive.grey700 }}>다시 시도</Text>
          </Pressable>
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
        keyExtractor={(item, _index) => {
          if (item.type === 'section') return item.section.slug;
          if (item.type === 'skeleton') return item.id;
          if (item.type === 'magazine') return `magazine-${item.card.id}`;
          if (item.type === 'feed_loading') return `feed_loading_${item.loadingIdx}`;
          if (item.type === 'feed_more_dot') return 'feed_more_dot';
          if (item.type === 'feed_end') return 'feed_end';
          if (item.type === 'ad') return `ad-${item.id}`;
          return item.type;
        }}
        ListHeaderComponent={listHeader}
        ListFooterComponent={<View style={{ height: 100 }} />}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        windowSize={5}
        maxToRenderPerBatch={3}
        initialNumToRender={8}
        onScrollBeginDrag={handleAiNoticeConfirm}
        onEndReached={loadMoreFeed}
        onEndReachedThreshold={2}
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
