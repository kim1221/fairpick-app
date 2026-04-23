/**
 * Fairpick - 홈 화면
 * 섹션 + 피드를 단일 FeedCard 스트림으로 통합
 * /api/home/sections → TODAY_PICK / SECTION 카드
 * /api/home/feed     → HERO / BUNDLE / RANKING / TREND 카드
 * 모두 feedCards[] 하나로 관리 → 로딩 상태 단순화
 */

import { createRoute, ScrollViewInertialBackground } from '@granite-js/react-native';
import { useSafeAreaInsets } from '@granite-js/native/react-native-safe-area-context';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, Image, ScrollView, StyleSheet, View, Text, RefreshControl, Pressable } from 'react-native';
import { Icon, AnimateSkeleton, BottomSheet, Button, useDialog } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import { BottomTabBar } from '../components/BottomTabBar';
import { EventCard } from '../components/EventCard';

import { Accuracy, getCurrentLocation, GetCurrentLocationPermissionError, InlineAd, getNetworkStatus, Storage } from '@apps-in-toss/framework';

import recommendationService from '../services/recommendationService';
import userEventService from '../services/userEventService';
import { getCurrentUserId } from '../utils/anonymousUser';
import { getAiNoticeShown, setAiNoticeShown, getFeedState, advanceFeedState, resetFeedState } from '../utils/storage';
import { reverseGeocode } from '../utils/geocoding';
import { LikesProvider } from '../contexts/LikesContext';
import { MagazineCard } from '../components/MagazineCard';
import { TrendCard } from '../components/TrendCard';
import { HeroCard } from '../components/HeroCard';
import { fetchFeed, feedEventToScoredEvent, sectionToFeedCards, type FeedCard } from '../services/feedService';
import { API_TIMEOUT } from '../config/api';
import { getTickets, exchangeTickets, subscribeTicketCount, TICKETS_PER_EXCHANGE, type TicketInfo } from '../services/ticketService';
import { checkin, getAttendanceStatus, getKstToday, type AttendanceStatus } from '../services/attendanceService';
import { AttendanceWidget } from '../components/AttendanceWidget';
import { AttendanceBottomSheet } from '../components/AttendanceBottomSheet';
import { getToken } from '../utils/authStorage';
import { useAuth } from '../hooks/useAuth';

import type { ScoredEvent, Location } from '../types/recommendation';

export const Route = createRoute('/', {
  component: HomePage,
});

// sido(시도) 행정구역명 → DB region 단축명 변환
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

/** KST(UTC+9) 기준 오늘 날짜 문자열 반환 */
function getTodayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────
// 모듈 레벨 캐시
// ─────────────────────────────────────────────────────────────

// 통합 피드 캐시: 섹션 카드 + 피드 page 0 합본
interface HomeCache {
  feedCards: FeedCard[];
  location: Location | undefined;
  userId: string;
  nextFeedPage: number; // 다음에 불러올 feed 페이지 번호
  expiresAt: number;
}
let _homeCache: HomeCache | null = null;
const HOME_CACHE_TTL_MS = 5 * 60 * 1000; // 5분

// today_pick KST 일별 고정 캐시
interface TodayPickCache {
  card: FeedCard;
  kstDate: string;
}
let _todayPickCache: TodayPickCache | null = null;

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

// FlatList 아이템 타입
type FeedItem =
  | { type: 'skeleton'; skeletonType: 'today_pick' | 'horizontal'; id: string }
  | { type: 'magazine'; card: FeedCard }
  | { type: 'ad'; id: string; adType: 'section' }
  | { type: 'feed_loading'; loadingIdx: number }
  | { type: 'feed_more_dot' }
  | { type: 'feed_error' }
  | { type: 'feed_end'; eventCount: number };

// ─────────────────────────────────────────────────────────────
// 섹션별 핵심 신호 계산
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
  ticketStickyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: a.background,
    borderBottomWidth: 1,
    borderBottomColor: a.grey200,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
  },
  ticketStickyCount: {
    fontSize: 13,
    fontWeight: '700',
    color: a.grey900,
    minWidth: 52,
  },
  ticketStickyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ticketStickySub: {
    fontSize: 11,
    color: a.grey500,
    marginTop: 3,
  },
  ticketStickyTrack: {
    flex: 1,
    height: 4,
    backgroundColor: a.grey200,
    borderRadius: 2,
    overflow: 'hidden',
  },
  ticketStickyFill: {
    height: 4,
    backgroundColor: a.blue500,
    borderRadius: 2,
  },
  ticketStickyBtn: {
    backgroundColor: a.blue500,
    borderRadius: 7,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  ticketStickyBtnDisabled: {
    backgroundColor: a.grey300,
  },
  ticketStickyBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  ticketStickyLoginTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: a.grey900,
  },
  ticketStickyLoginSub: {
    fontSize: 11,
    color: a.grey500,
    marginTop: 1,
  },
  onboardingSheet: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 20,
  },
  onboardingStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  onboardingEmoji: {
    fontSize: 28,
    lineHeight: 36,
  },
  onboardingStepText: {
    flex: 1,
    gap: 2,
  },
  onboardingStepTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: a.grey900,
  },
  onboardingStepDesc: {
    fontSize: 13,
    color: a.grey500,
    lineHeight: 18,
  },
  onboardingBtn: {
    marginTop: 8,
  },
  bonusPopup: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 16,
  },
  bonusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bonusLabel: {
    fontSize: 14,
    color: a.grey700,
  },
  bonusValue: {
    fontSize: 15,
    fontWeight: '700',
    color: a.grey900,
  },
  bonusHighlight: {
    color: a.blue500,
  },
  bonusCappedNote: {
    fontSize: 12,
    color: a.grey500,
    textAlign: 'center',
  },
  section: { marginTop: 24, marginBottom: 8 },
  sectionHeader: { paddingHorizontal: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: a.grey900, letterSpacing: -0.3 },
  sectionSubtitle: { fontSize: 13, fontWeight: '400', color: a.grey500, marginTop: 4 },
  horizontalList: { paddingHorizontal: 20, gap: 12 },
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
// AdSlot — InlineAd 독립 래퍼
//
// list 광고 클리핑 분석 결과:
//   - 상위 컨테이너(section/scrollView/container)에는 overflow/clip 없음
//   - ticketStickyBar/aiNoticeBanner는 FlatList 위에 별도 배치, 겹침 없음
//   - 클리핑 경계는 이 컴포넌트의 overflow:'hidden' + height:96 으로 확인
//
// [L-1] list 포맷: overflow:'visible'로 전환
//   목적: height:96은 유지하되 overflow를 열어 InlineAd 콘텐츠 클립 해소
//   toss-docs 공식은 overflow:'hidden'이나, 실제 렌더가 잘리고 있어 실험
//   → 잘림 해소되면 overflow가 원인 확정
//   → 여전히 잘리면 height:96 자체가 문제이거나 광고 그룹 포맷 불일치 검토
//
// feed 광고: [F-0] 임시 비활성 (feedItems useMemo에서 삽입 중단)
// ─────────────────────────────────────────────────────────────
const AdSlot = React.memo(({ adGroupId, adFormat }: { adGroupId: string; adFormat: 'list' | 'feed' }) => {
  const [status, setStatus] = useState<'loading' | 'rendered' | 'failed'>('loading');

  if (status === 'failed') return null;

  const isList = adFormat === 'list';

  return (
    <View
      collapsable={false}
      style={isList ? {
        width: '100%',
        // [L-2] height 고정 해제 → InlineAd 실제 크기대로 렌더되는지 확인
        // 기존 height:96이 클리핑 원인으로 유력 판단 (overflow:visible로도 여전히 잘림)
        minHeight: 96,
        overflow: 'visible',
        marginVertical: 8,
      } : {
        width: '100%',
        marginVertical: status === 'rendered' ? 8 : 0,
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

const AD_GROUP_SECTION = 'ait.v2.live.b3363cb4c82643e9';
// AD_GROUP_FEED: feed 광고 별도 기술 과제로 분리, 현재 릴리즈 비활성
// const AD_GROUP_FEED = 'ait.v2.live.7e6f43f894204302';

// ─────────────────────────────────────────────────────────────
// SectionCard / TodayPickCard — 메모이제이션된 카드 래퍼
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

  // ── 캐시 히트 판별 ──────────────────────────────────────────
  const now = Date.now();
  const validCache = _homeCache && now < _homeCache.expiresAt ? _homeCache : null;

  // ── 상태 ────────────────────────────────────────────────────
  const [userId, setUserId] = useState(validCache?.userId ?? '');
  const [location, setLocation] = useState<Location | undefined>(validCache?.location);
  const [currentAddress, setCurrentAddress] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [showAiNotice, setShowAiNotice] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [ticketInfo, setTicketInfo] = useState<TicketInfo | null>(null);
  const [ticketFetching, setTicketFetching] = useState(false);
  const [ticketExchangeLoading, setTicketExchangeLoading] = useState(false);
  const [showTicketOnboarding, setShowTicketOnboarding] = useState(false);
  const dialog = useDialog();
  const { isLoggedIn, isLoading: authLoading, login } = useAuth();

  // ── 출석체크 상태 ──────────────────────────────────────────────
  const [attendanceStatus, setAttendanceStatus] = useState<AttendanceStatus | null>(null);
  const [showAttendanceSheet, setShowAttendanceSheet] = useState(false);
  const [weeklyBonusPopup, setWeeklyBonusPopup] = useState<{
    bonusTickets: number;
    adTickets: number;
    capped: boolean;
  } | null>(null);
  // 오늘 KST 날짜 추적 (날짜 변경 감지용)
  const lastCheckinDateRef = useRef<string | null>(null);

  // 통합 피드 상태 (섹션 카드 + 매거진 카드 한 배열)
  const [feedCards, setFeedCards] = useState<FeedCard[]>(validCache?.feedCards ?? []);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState(false);

  // ── Ref ─────────────────────────────────────────────────────
  const ticketInfoRef = useRef(ticketInfo);
  useEffect(() => { ticketInfoRef.current = ticketInfo; }, [ticketInfo]);

  const flatListRef = useRef<FlatList>(null);
  const feedLoadingRef = useRef(false);
  const feedSeenEventIds = useRef<Set<string>>(new Set());
  const feedResetAttemptedRef = useRef(false);
  const feedCardsLoadedRef = useRef(validCache !== null); // 캐시 히트면 이미 로드된 것으로
  const feedHasMoreRef = useRef(false);
  const feedPageRef = useRef(validCache?.nextFeedPage ?? 0);
  const feedRegionStageRef = useRef<'exact' | 'metro' | 'all'>('exact');
  const feedPendingLoadRef = useRef(false);
  const userRegionRef = useRef('');
  const userIdRef = useRef(validCache?.userId ?? '');
  const locationRef = useRef<Location | undefined>(validCache?.location);
  const feedRetryCountRef = useRef(0);
  const feedRecoveryCountRef = useRef(0);

  const FEED_MAX_RETRIES = 3;
  const FEED_MAX_RECOVERY = 3;
  // 첫 로드 타임아웃: Railway 콜드 스타트(15~30초) 커버
  const COLD_START_TIMEOUT = 30000;

  // ── 티켓 조회 + 온보딩 (앱 최초 마운트) ──────────────────────
  useEffect(() => {
    getToken().then(async (token) => {
      if (!token) return;
      setTicketFetching(true);
      getTickets().then(setTicketInfo).catch(() => {}).finally(() => setTicketFetching(false));
      const seen = await Storage.getItem('ticket_onboarding_seen');
      if (!seen) {
        setShowTicketOnboarding(true);
        await Storage.setItem('ticket_onboarding_seen', '1');
      }
    });
  }, []);

  // ── 로그인 직후 즉시 티켓 조회 ──────────────────────────────
  // isLoggedIn false→true 전환 시 ticketInfo가 없으면 바로 fetch
  const prevIsLoggedInRef = useRef(isLoggedIn);
  useEffect(() => {
    const prev = prevIsLoggedInRef.current;
    prevIsLoggedInRef.current = isLoggedIn;
    if (!prev && isLoggedIn) {
      setTicketFetching(true);
      getTickets().then(setTicketInfo).catch(() => {}).finally(() => setTicketFetching(false));
    }
    if (prev && !isLoggedIn) {
      // 로그아웃 시 티켓 상태 초기화
      setTicketInfo(null);
    }
  }, [isLoggedIn]);

  // 다른 화면(상세페이지)에서 적립 성공 시 즉시 카운터 갱신
  useEffect(() => {
    return subscribeTicketCount((ticketCount) => {
      if (ticketInfoRef.current) {
        setTicketInfo((prev) => prev ? { ...prev, ticketCount } : null);
      } else {
        // ticketInfo가 아직 없으면 전체 조회로 채움 (updater 바깥에서 호출)
        getTickets().then(setTicketInfo).catch(() => {});
      }
    });
  }, []);

  const handleTicketExchange = async () => {
    if (!ticketInfo || ticketInfo.ticketCount < TICKETS_PER_EXCHANGE) return;
    try {
      setTicketExchangeLoading(true);
      const result = await exchangeTickets();
      setTicketInfo((prev) => prev ? { ...prev, ticketCount: result.ticketCount } : null);
      dialog.openAlert({ title: '교환 완료!', description: '1포인트가 지급됐어요 🎉' });
    } catch (err: any) {
      const errCode = err?.response?.data?.error ?? err?.message;
      let description = '교환 중 오류가 발생했어요.';
      if (errCode === 'NOT_ENOUGH_TICKETS') description = '티켓이 부족해요.';
      else if (errCode === 'EXCHANGE_EXPIRED') description = '교환 요청이 만료됐어요. 다시 시도해 주세요.';
      else if (errCode === 'UNSUPPORTED_VERSION') description = '토스 앱을 최신 버전으로 업데이트해 주세요.';
      dialog.openAlert({ title: '오류', description });
    } finally {
      setTicketExchangeLoading(false);
    }
  };

  // ── 출석 체크인 ──────────────────────────────────────────────
  // 호출 조건: 로그인 상태 + 오늘 KST 날짜로 아직 처리 안 됨
  const maybeCheckin = useCallback(async () => {
    if (!isLoggedIn) return;
    const today = getKstToday();
    if (lastCheckinDateRef.current === today) return; // 오늘 이미 처리
    lastCheckinDateRef.current = today; // 낙관적 선점 (중복 호출 방지)
    try {
      const res = await checkin();
      // 티켓 잔액 동기화
      if (!res.alreadyCheckedIn) {
        setTicketInfo((prev) => prev ? { ...prev, ticketCount: res.ticketCount } : null);
      }
      // 출석 현황 갱신
      const status = await getAttendanceStatus();
      setAttendanceStatus(status);
      // 주간 완주 보너스 팝업
      if (res.weeklyBonus) {
        setWeeklyBonusPopup(res.weeklyBonus);
      }
    } catch {
      lastCheckinDateRef.current = null; // 실패 시 재시도 허용
    }
  }, [isLoggedIn]);

  // 로그인 상태 변화 시 체크인
  useEffect(() => {
    maybeCheckin();
  }, [maybeCheckin]);

  // 앱 포어그라운드 복귀 시 체크인 (날짜 변경 대응)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') maybeCheckin();
    });
    return () => sub.remove();
  }, [maybeCheckin]);

  // ── 초기화 ───────────────────────────────────────────────────

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
    // 피드 상태 복원 (excludeIds, nextPage)
    const feedState = await getFeedState();
    if (!feedState.wasReset && feedState.excludeIds.length > 0) {
      feedSeenEventIds.current = new Set(feedState.excludeIds);
      // 캐시가 없을 때만 feedPageRef를 복원 (캐시 히트 시 nextFeedPage를 이미 세팅)
      if (!validCache) feedPageRef.current = feedState.nextPage;
    }

    const triggerFeedLoad = () => {
      feedHasMoreRef.current = true;
      setFeedHasMore(true);
      setFeedError(false);
      feedRecoveryCountRef.current = 0;
      feedRetryCountRef.current = 0;
      void loadMoreFeedRef.current();
    };

    if (validCache) {
      // 캐시 히트: 섹션+피드 page0 데이터가 이미 state 초기값으로 표시됨
      // 위치 갱신 + 다음 피드 페이지 계속 로드
      void requestLocation();
      triggerFeedLoad();
      return;
    }

    // 스테일 섹션 즉시 표시 (SWR: 네트워크 응답 전 이전 세션 데이터 선표시)
    try {
      const stale = await recommendationService.getStaleHomeSections();
      if (stale && stale.length > 0) {
        const staleCards = sectionToFeedCards(stale);
        setFeedCards(staleCards);
        feedCardsLoadedRef.current = false; // 스테일이므로 실제 로드 필요
      }
    } catch (_) {}

    try {
      // 첫 방문: 권한 다이얼로그 먼저 처리
      try {
        const perm = await getCurrentLocation.getPermission();
        if ((perm as string) === 'notDetermined') {
          await getCurrentLocation.openPermissionDialog();
        }
      } catch (_) {}

      const [uid, loc] = await Promise.all([
        getCurrentUserId(),
        Promise.race([
          requestLocation(),
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 500)),
        ]),
      ]);
      setUserId(uid);
      userIdRef.current = uid;

      triggerFeedLoad();

      // 500ms 내에 GPS가 안 왔으면 이후 완료 시 재로드
      if (!loc) {
        requestLocation().then((resolvedLoc) => {
          if (resolvedLoc) {
            // 위치 업데이트 후 섹션만 갱신 (피드는 계속 이어서 로드)
            recommendationService.getSections(resolvedLoc, uid)
              .then(res => {
                if (res.success && res.sections.length > 0) {
                  const sectionCards = applyTodayPickCache(sectionToFeedCards(res.sections));
                  // 기존 feedCards에서 섹션 카드를 교체하고 매거진 카드는 유지
                  setFeedCards(prev => {
                    const magazineCards = prev.filter(c => c.content_type !== 'TODAY_PICK' && c.content_type !== 'SECTION');
                    return [...sectionCards, ...magazineCards];
                  });
                }
              })
              .catch(() => {});
          }
        }).catch(() => {});
      }
    } catch (error) {
      console.error('[Home] init error:', error);
      triggerFeedLoad();
    }
  };

  // today_pick 일별 고정 적용
  function applyTodayPickCache(cards: FeedCard[]): FeedCard[] {
    const todayPickCard = cards.find(c => c.content_type === 'TODAY_PICK');
    if (!todayPickCard) return cards;
    const today = getTodayKst();
    if (!_todayPickCache || _todayPickCache.kstDate !== today) {
      _todayPickCache = { card: todayPickCard, kstDate: today };
    }
    return cards.map(c => c.content_type === 'TODAY_PICK' ? _todayPickCache!.card : c);
  }

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
      locationRef.current = loc;
      reverseGeocode(loc.lat, loc.lng).then((geo) => {
        setCurrentAddress(geo.success && geo.address ? geo.address : '위치 정보');
        if (geo.success && geo.sido) {
          userRegionRef.current = sidoToRegion(geo.sido);
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

  const handleEventPress = useCallback((eventId: string, sectionSlug?: string, rankPosition?: number) => {
    navigation.navigate('/events/:id', { id: eventId });
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
      await requestLocation();
      void loadMoreFeedRef.current();
    } finally {
      setRefreshing(false);
    }
  }, []);

  // ── 통합 피드 로드 ────────────────────────────────────────────
  // page 0: /api/home/sections + /api/home/feed 병렬 → 섹션 카드 + 매거진 카드
  // page 1+: /api/home/feed 만
  const loadMoreFeed = useCallback(async () => {
    if (feedLoadingRef.current || !feedHasMoreRef.current) return;
    feedLoadingRef.current = true;
    setFeedLoading(true);

    const currentPage = feedPageRef.current;
    const isPageZero = currentPage === 0;
    const isFirstLoad = !feedCardsLoadedRef.current;
    const fetchTimeout = isFirstLoad ? COLD_START_TIMEOUT : API_TIMEOUT;
    const currentRegion = userRegionRef.current;
    const currentUserId = userIdRef.current;
    const currentLocation = locationRef.current;

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
      let networkStatus = 'ONLINE';
      try { networkStatus = await getNetworkStatus(); } catch (_) {}
      if (networkStatus === 'OFFLINE') {
        setIsOffline(true);
        return;
      }
      setIsOffline(false);

      if (isPageZero) {
        // ── page 0: 섹션 + 피드 병렬 로드 ──────────────────────
        const [sectionsResult, feedResult] = await Promise.all([
          recommendationService.getSections(currentLocation, currentUserId)
            .catch(() => ({ success: false as const, sections: [] })),
          fetchFeed({
            page: 0,
            excludeIds: Array.from(feedSeenEventIds.current),
            userId: currentUserId,
            region: currentRegion || undefined,
            regionStage: currentRegion ? feedRegionStageRef.current : 'all',
            timeout: fetchTimeout,
          }),
        ]);

        // 섹션 → FeedCard 변환 + today_pick 일별 고정
        const rawSectionCards = sectionsResult.success
          ? sectionToFeedCards(sectionsResult.sections)
          : [];
        const sectionCards = applyTodayPickCache(rawSectionCards);

        const allCards = [...sectionCards, ...feedResult.cards];
        feedCardsLoadedRef.current = true;
        setFeedCards(allCards);

        // 이미지 프리페치
        requestAnimationFrame(() => {
          allCards.forEach(card => {
            card.events.slice(0, 6).forEach(e => {
              if (e.image_url) Image.prefetch(e.image_url).catch(() => {});
            });
          });
        });

        // 피드 이벤트 ID 기록
        feedResult.cards.forEach(card =>
          card.events.forEach(e => feedSeenEventIds.current.add(e.id)),
        );
        const nextPage = parseInt(feedResult.next_cursor ?? '1');
        feedPageRef.current = nextPage;
        advanceFeedState(
          feedResult.cards.flatMap(c => c.events.map(e => e.id)),
          nextPage,
        ).catch(() => {});

        setFeedHasMore(feedResult.has_more);
        feedHasMoreRef.current = feedResult.has_more;
        feedRetryCountRef.current = 0;

        // 캐시 저장
        _homeCache = {
          feedCards: allCards,
          location: currentLocation,
          userId: currentUserId,
          nextFeedPage: nextPage,
          expiresAt: Date.now() + HOME_CACHE_TTL_MS,
        };
      } else {
        // ── page 1+: 피드만 ──────────────────────────────────────
        const res = await fetchFeed({
          page: currentPage,
          excludeIds: Array.from(feedSeenEventIds.current),
          userId: currentUserId,
          region: currentRegion || undefined,
          regionStage: currentRegion ? feedRegionStageRef.current : 'all',
          timeout: fetchTimeout,
        });

        if (res.cards.length === 0) {
          // excludeIds 소진 → 1회 리셋
          if (feedSeenEventIds.current.size > 0 && !feedResetAttemptedRef.current) {
            feedResetAttemptedRef.current = true;
            feedSeenEventIds.current.clear();
            feedPageRef.current = 1; // 0은 섹션 포함이므로 1부터 재시도
            setFeedHasMore(true);
            feedHasMoreRef.current = true;
            resetFeedState().catch(() => {});
            setTimeout(() => { void loadMoreFeedRef.current(); }, 100);
            return;
          }
          // 지역 단계 확장
          if (currentRegion && feedRegionStageRef.current !== 'all') {
            feedRegionStageRef.current = feedRegionStageRef.current === 'exact' ? 'metro' : 'all';
            feedPageRef.current = 1;
            setFeedHasMore(true);
            feedHasMoreRef.current = true;
            setTimeout(() => { void loadMoreFeedRef.current(); }, 100);
            return;
          }
          setFeedHasMore(false);
          feedHasMoreRef.current = false;
          return;
        }

        feedCardsLoadedRef.current = true;
        setFeedCards(prev => [...prev, ...res.cards]);

        const newIds: string[] = [];
        res.cards.forEach(card => card.events.forEach(e => {
          feedSeenEventIds.current.add(e.id);
          newIds.push(e.id);
        }));
        const nextPage = parseInt(res.next_cursor ?? String(currentPage + 1));
        feedPageRef.current = nextPage;
        advanceFeedState(newIds, nextPage).catch(() => {});

        requestAnimationFrame(() => {
          res.cards.forEach(card => {
            card.events.forEach(e => {
              if (e.image_url) Image.prefetch(e.image_url).catch(() => {});
            });
          });
        });

        setFeedHasMore(res.has_more);
        feedHasMoreRef.current = res.has_more;
        feedRetryCountRef.current = 0;
      }
    } catch (err) {
      console.warn('[Feed] error:', err instanceof Error ? err.message : String(err));
      if (feedRetryCountRef.current < FEED_MAX_RETRIES) {
        feedRetryCountRef.current++;
        const delay = 1000 * feedRetryCountRef.current;
        setTimeout(() => { void loadMoreFeedRef.current(); }, delay);
      }
    } finally {
      clearTimeout(safetyTimeoutId);
      feedLoadingRef.current = false;
      setFeedLoading(false);
      if (feedPendingLoadRef.current) {
        feedPendingLoadRef.current = false;
        setTimeout(() => { void loadMoreFeedRef.current(); }, 150);
      }
    }
  }, [userId]);

  const loadMoreFeedRef = useRef(loadMoreFeed);
  useEffect(() => { loadMoreFeedRef.current = loadMoreFeed; }, [loadMoreFeed]);

  // 피드 고착 자동 복구
  useEffect(() => {
    if (feedCards.length === 0 && !feedLoading && feedHasMore && !feedError) {
      if (feedRecoveryCountRef.current >= FEED_MAX_RECOVERY) {
        setFeedError(true);
        return undefined;
      }
      const id = setTimeout(() => {
        feedRecoveryCountRef.current++;
        feedRetryCountRef.current = 0;
        void loadMoreFeedRef.current();
      }, 3000);
      return () => clearTimeout(id);
    }
    if (feedCards.length > 0 && feedError) {
      setFeedError(false);
      feedRecoveryCountRef.current = 0;
    }
    return undefined;
  }, [feedCards.length, feedLoading, feedHasMore, feedError]);

  const scrollToTop = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  const handleMomentumScrollEnd = useCallback((e: { nativeEvent: { contentSize: { height: number }; layoutMeasurement: { height: number }; contentOffset: { y: number } } }) => {
    const { contentSize, layoutMeasurement, contentOffset } = e.nativeEvent;
    const distanceFromEnd = contentSize.height - layoutMeasurement.height - contentOffset.y;
    if (distanceFromEnd < layoutMeasurement.height * 2) {
      void loadMoreFeedRef.current();
    }
  }, []);

  // ── FlatList 데이터 구성 ─────────────────────────────────────
  const feedItems = useMemo((): FeedItem[] => {
    const items: FeedItem[] = [];

    if (feedCards.length === 0) {
      // 초기 로딩 중: 스켈레톤 표시
      if (feedLoading || (feedHasMore && !feedError)) {
        items.push({ type: 'skeleton', skeletonType: 'today_pick', id: 'sk-today' });
        items.push({ type: 'skeleton', skeletonType: 'horizontal', id: 'sk-h1' });
        items.push({ type: 'skeleton', skeletonType: 'horizontal', id: 'sk-h2' });
        items.push({ type: 'skeleton', skeletonType: 'horizontal', id: 'sk-h3' });
      } else if (feedError) {
        items.push({ type: 'feed_error' });
      }
      return items;
    }

    // 섹션 카드 / 매거진 카드 순회하며 광고 삽입
    let sectionCardCount = 0;
    let magazineCardCount = 0;

    for (let i = 0; i < feedCards.length; i++) {
      const card = feedCards[i]!;
      const isSection = card.content_type === 'TODAY_PICK' || card.content_type === 'SECTION';

      items.push({ type: 'magazine', card });

      if (isSection) {
        sectionCardCount++;
        // 두 번째 섹션 카드 뒤에 리스트형 광고 삽입
        if (sectionCardCount === 2) {
          items.push({ type: 'ad', id: 'section-1', adType: 'section' });
        }
      } else {
        magazineCardCount++;
        // feed 광고 비활성 (현재 릴리즈 범위 제외)
        // 원인: FlatList 재마운트 시 InlineAd noFill + 스크롤 버벅임 반복 확인
        // 위치/빈도 조정으로는 해결 불가 → 별도 기술 과제로 분리
        // 운영 광고: 추천탭 list 광고 + 이벤트 상세 광고
      }
    }

    // 로딩 / 에러 / 완료 표시
    const showFeedLoading = feedLoading || (feedHasMore && !feedError && magazineCardCount === 0);
    if (showFeedLoading) {
      items.push({ type: 'feed_loading', loadingIdx: 0 });
      items.push({ type: 'feed_loading', loadingIdx: 1 });
      items.push({ type: 'feed_loading', loadingIdx: 2 });
    } else if (feedError) {
      items.push({ type: 'feed_error' });
    } else if (!feedHasMore) {
      const eventCount = feedCards.reduce((sum, card) => sum + card.events.length, 0);
      items.push({ type: 'feed_end', eventCount });
    } else if (magazineCardCount > 0) {
      items.push({ type: 'feed_more_dot' });
    }

    return items;
  }, [feedCards, feedLoading, feedHasMore, feedError]);

  // ── 렌더러 ────────────────────────────────────────────────────
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

    if (item.type === 'ad') {
      // 현재 운영: section(list) 광고만
      return <AdSlot adGroupId={AD_GROUP_SECTION} adFormat="list" />;
    }

    if (item.type === 'magazine') {
      const { card } = item;

      // ── 섹션형 카드 ─────────────────────────────────────────
      if (card.content_type === 'TODAY_PICK') {
        if (!card.events[0]) return null;
        return (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{card.framing_label ?? '오늘의 픽'}</Text>
              {card.title ? <Text style={styles.sectionSubtitle}>{card.title}</Text> : null}
            </View>
            <View style={{ paddingHorizontal: 20 }}>
              <TodayPickCard
                event={feedEventToScoredEvent(card.events[0])}
                onPress={handleEventPress}
              />
            </View>
          </View>
        );
      }

      if (card.content_type === 'SECTION') {
        const events = card.events.map(e => {
          const scored = feedEventToScoredEvent(e);
          return { ...scored, signal: getSectionSignal(card.framing_type, scored) };
        });
        return (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{card.framing_label ?? ''}</Text>
              {card.title ? <Text style={styles.sectionSubtitle}>{card.title}</Text> : null}
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
                  slug={card.framing_type}
                  rank={idx + 1}
                  onPress={handleEventPress}
                />
              ))}
            </ScrollView>
          </View>
        );
      }

      // ── 매거진형 카드 ────────────────────────────────────────
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
          <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 20 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: adaptive.grey200 }} />
            <Text style={{ marginHorizontal: 12, color: adaptive.grey600, fontSize: 13, fontWeight: '600' }}>
              오늘 이벤트는 다 봤어요
            </Text>
            <View style={{ flex: 1, height: 1, backgroundColor: adaptive.grey200 }} />
          </View>
          <Text style={{ fontSize: 15, fontWeight: '700', color: adaptive.grey900, marginBottom: 6 }}>
            {item.eventCount > 0
              ? `${item.eventCount.toLocaleString()}개의 이벤트를 둘러봤어요`
              : '새로운 피드를 준비 중이에요'}
          </Text>
          <Text style={{ fontSize: 13, color: adaptive.grey500, marginBottom: 24 }}>
            매일 새 이벤트가 업데이트돼요
          </Text>
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

    return null;
  }, [styles, adaptive, isOffline, handleEventPress, scrollToTop, handleRefresh]);

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

      {/* 티켓 sticky 바 */}
      {!authLoading && (
        isLoggedIn && ticketInfo !== null ? (
          // ① 로그인 + 데이터 있음: 현황 + 교환하기
          <View style={styles.ticketStickyBar}>
            <View style={{ flex: 1 }}>
              <View style={styles.ticketStickyRow}>
                <Text style={styles.ticketStickyCount}>
                  🎟 {ticketInfo.ticketCount}/{TICKETS_PER_EXCHANGE}
                </Text>
                <View style={styles.ticketStickyTrack}>
                  <View
                    style={[
                      styles.ticketStickyFill,
                      { width: `${Math.min(ticketInfo.ticketCount / TICKETS_PER_EXCHANGE, 1) * 100}%` },
                    ]}
                  />
                </View>
              </View>
              <Text style={styles.ticketStickySub}>티켓을 포인트로 바꾸기</Text>
            </View>
            <Pressable
              style={[
                styles.ticketStickyBtn,
                (ticketInfo.ticketCount < TICKETS_PER_EXCHANGE || ticketExchangeLoading) && styles.ticketStickyBtnDisabled,
              ]}
              onPress={handleTicketExchange}
              disabled={ticketInfo.ticketCount < TICKETS_PER_EXCHANGE || ticketExchangeLoading}
            >
              <Text style={styles.ticketStickyBtnText}>
                {ticketExchangeLoading ? '...' : '교환하기'}
              </Text>
            </Pressable>
          </View>
        ) : isLoggedIn && ticketFetching ? (
          // ② 로그인 + 로딩 중: 플레이스홀더
          <View style={styles.ticketStickyBar}>
            <View style={[styles.ticketStickyTrack, { flex: 1, height: 8, borderRadius: 4, backgroundColor: adaptive.grey200 }]} />
          </View>
        ) : !isLoggedIn ? (
          // ③ 비로그인: 로그인 유도
          <View style={styles.ticketStickyBar}>
            <View style={{ flex: 1 }}>
              <Text style={styles.ticketStickyLoginTitle}>로그인하고 티켓 모으기</Text>
              <Text style={styles.ticketStickyLoginSub}>티켓으로 토스 포인트를 교환할 수 있어요</Text>
            </View>
            <Pressable style={styles.ticketStickyBtn} onPress={login}>
              <Text style={styles.ticketStickyBtnText}>로그인하기</Text>
            </Pressable>
          </View>
        ) : null
      )}

      {/* 출석 위젯 (로그인 상태에서만) */}
      {isLoggedIn && (
        <AttendanceWidget
          status={attendanceStatus}
          onPress={() => setShowAttendanceSheet(true)}
        />
      )}

      <FlatList
        ref={flatListRef}
        style={styles.scrollView}
        data={feedItems}
        renderItem={renderFeedItem}
        keyExtractor={(item, _index) => {
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

      {/* 티켓 온보딩 (첫 로그인 시 1회) */}
      <BottomSheet.Root
        open={showTicketOnboarding}
        onClose={() => setShowTicketOnboarding(false)}
        onDimmerClick={() => setShowTicketOnboarding(false)}
      >
        <BottomSheet.Header>티켓 조각 모으기</BottomSheet.Header>
        <View style={styles.onboardingSheet}>
          <View style={styles.onboardingStep}>
            <Text style={styles.onboardingEmoji}>🔍</Text>
            <View style={styles.onboardingStepText}>
              <Text style={styles.onboardingStepTitle}>이벤트 카드를 탭해요</Text>
              <Text style={styles.onboardingStepDesc}>관심 있는 이벤트를 골라 상세 정보를 확인하세요</Text>
            </View>
          </View>
          <View style={styles.onboardingStep}>
            <Text style={styles.onboardingEmoji}>📺</Text>
            <View style={styles.onboardingStepText}>
              <Text style={styles.onboardingStepTitle}>광고를 보면 티켓 조각을 받아요</Text>
              <Text style={styles.onboardingStepDesc}>어떤 이벤트든 OK! 볼 때마다 1~3조각을 드려요</Text>
            </View>
          </View>
          <View style={styles.onboardingStep}>
            <Text style={styles.onboardingEmoji}>🎁</Text>
            <View style={styles.onboardingStepText}>
              <Text style={styles.onboardingStepTitle}>10조각 모으면 1 토스 포인트</Text>
              <Text style={styles.onboardingStepDesc}>모은 조각을 토스 포인트로 바꿀 수 있어요</Text>
            </View>
          </View>
          <View style={styles.onboardingBtn}>
            <Button
              type="primary"
              size="big"
              viewStyle={{ width: '100%' }}
              onPress={() => setShowTicketOnboarding(false)}
            >
              시작하기
            </Button>
          </View>
        </View>
      </BottomSheet.Root>

      {/* 출석 상세 바텀시트 */}
      <AttendanceBottomSheet
        open={showAttendanceSheet}
        onClose={() => setShowAttendanceSheet(false)}
        status={attendanceStatus}
      />

      {/* 주간 완주 보너스 팝업 */}
      <BottomSheet.Root
        open={weeklyBonusPopup !== null}
        onClose={() => setWeeklyBonusPopup(null)}
        onDimmerClick={() => setWeeklyBonusPopup(null)}
      >
        <BottomSheet.Header>이번 주 완주! 🎉</BottomSheet.Header>
        <View style={styles.bonusPopup}>
          <View style={styles.bonusRow}>
            <Text style={styles.bonusLabel}>이번 주 모은 티켓</Text>
            <Text style={styles.bonusValue}>{weeklyBonusPopup?.adTickets ?? 0}장</Text>
          </View>
          <View style={styles.bonusRow}>
            <Text style={styles.bonusLabel}>출석 완주 보너스</Text>
            <Text style={[styles.bonusValue, styles.bonusHighlight]}>
              {weeklyBonusPopup?.bonusTickets ?? 0}장 지급
            </Text>
          </View>
          {weeklyBonusPopup?.capped && (
            <Text style={styles.bonusCappedNote}>주간 보너스 최대치가 반영되었어요</Text>
          )}
          <Button
            type="primary"
            size="big"
            viewStyle={{ width: '100%' }}
            onPress={() => setWeeklyBonusPopup(null)}
          >
            확인
          </Button>
        </View>
      </BottomSheet.Root>

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
