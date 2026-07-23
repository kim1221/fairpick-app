import { createRoute, ScrollViewInertialBackground } from '@granite-js/react-native';
import { loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/framework';
import { Button, useDialog } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BottomTabBar } from '../components/BottomTabBar';
import { AllIssuedTag } from '../components/culture-card/AllIssuedTag';
import { CultureCardReveal, type RevealedCultureCard } from '../components/culture-card/CultureCardReveal';
import { CultureCardStack } from '../components/culture-card/CultureCardStack';
import { CultureCardStatePanel } from '../components/culture-card/CultureCardStatePanel';
import { HowItWorksSheet, markHowItWorksSeen, shouldShowHowItWorks } from '../components/culture-card/HowItWorksSheet';
import { TicketGauge } from '../components/culture-card/TicketGauge';
import {
  AD_LOAD_FAILED_COPY,
  AD_LOADING_COPY,
  AD_SHOW_REQUEST_TIMEOUT_MS,
  AD_SHOW_TERMINAL_TIMEOUT_MS,
  LOAD_FAILED_COPY,
  POOL_EMPTY_COPY,
  canDrawNextCard,
  getCapReachedView,
  getEarnFailureCopy,
  getTodayCardsAvailability,
  hasReachedDailyLimit,
  isAlreadyOpenedCardError,
  isRewardAdProgressEvent,
  isDailyLimitReachedError,
  removeLockedCardPreview,
  type HomeCopy,
} from '../components/culture-card/homeLogic';
import { TAG_TOKENS } from '../components/culture-card/tagKit';
import { LikesProvider } from '../contexts/LikesContext';
import { useAuth } from '../hooks/useAuth';
import {
  getTodayCardsV2,
  openCultureCard,
  type CardsTodayV2Response,
} from '../services/cardsService';
import {
  createRewardAdAttemptId,
  logRewardAdEvent,
  type RewardAdEventType,
} from '../services/ticketService';
import userEventService from '../services/userEventService';
import { getStartupCoords } from '../utils/currentLocation';
import { getLikesV2, toggleLike } from '../utils/storage';

export const Route = createRoute('/', {
  component: HomePage,
});

const REWARDED_AD_ID = 'ait.v2.live.b50cf7d900884c5b';
const AD_LOAD_TIMEOUT_MS = 15_000;
// draw-loop-v1: 빈티지 태그가 떠 있는 워엄 다크 캔버스.
const INK = TAG_TOKENS.bg;
const INK_BOTTOM = TAG_TOKENS.bg2;
const SURFACE = '#FFFFFF';
const LINE = '#DDD8CE';
const GOLD = '#A52822';
const TEXT = '#171717';
const MUTED = '#6F6B65';
const CREAM = '#EFE3C4';
const CANVAS_SUB = '#7A7264';
const CHIP_LINE = '#3A332A';
const CHIP_TEXT = '#B8AD98';
const CHIP_STRONG = '#E5D8BB';

type Adaptive = ReturnType<typeof useAdaptive>;
type HomeStatus =
  | 'loading'
  | 'ready'
  | 'ad_loading'
  | 'ad_failed'
  | 'earn_failed'
  | 'daily_limit'
  | 'revealed'
  | 'pool_empty'
  | 'load_failed';
type AdLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';
type AdShowWatchdogPhase = 'request' | 'terminal';

const WATCHDOG_COPY: HomeCopy = {
  title: '광고 응답이 없어요',
  description: '잠시 후 다시 시도해 주세요. 카드는 그대로예요.',
};

type HomeSessionCache = {
  cardsData: CardsTodayV2Response;
  status: HomeStatus;
  statusCopy: HomeCopy | null;
  selectedCardKey: string | null;
};

// 탭 이동으로 홈 라우트가 다시 마운트되어도 직전 화면을 즉시 보여준다.
// 계정 id와 KST 날짜를 키로 삼아 다른 계정/전날의 카드가 섞이지 않게 한다.
const homeSessionCache = new Map<string, HomeSessionCache>();

function getHomeSessionCacheKey(userId: string | null | undefined): string | null {
  if (!userId) return null;
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dayKey = [
    nowKst.getUTCFullYear(),
    String(nowKst.getUTCMonth() + 1).padStart(2, '0'),
    String(nowKst.getUTCDate()).padStart(2, '0'),
  ].join('-');
  return `user:${userId}:day:${dayKey}`;
}

function getCardKey(card: CardsTodayV2Response['lockedCards'][number]): string {
  return card.visualSeed ?? card.cardToken;
}

function getStableCachedState(data: CardsTodayV2Response): Pick<HomeSessionCache, 'status' | 'statusCopy'> {
  const availability = getTodayCardsAvailability(data);
  if (availability === 'daily_limit') {
    return {
      status: 'daily_limit',
      statusCopy: getEarnFailureCopy({
        response: { status: 429, data: { error: 'DAILY_OPEN_LIMIT_REACHED' } },
      }),
    };
  }

  return {
    status: availability === 'pool_empty' ? 'pool_empty' : 'ready',
    statusCopy: availability === 'pool_empty' ? POOL_EMPTY_COPY : null,
  };
}

function formatIssueLine(): string {
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const year = nowKst.getUTCFullYear();
  const month = String(nowKst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(nowKst.getUTCDate()).padStart(2, '0');
  return `DAILY EDITION · ${month}.${day}.${year}`;
}

function createStyles(a: Adaptive) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: INK,
    },
    scroll: {
      flex: 1,
    },
    header: {
      paddingHorizontal: 22,
      paddingBottom: 10,
    },
    nav: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 10,
    },
    brand: {
      flex: 1,
    },
    name: {
      color: CREAM,
      fontSize: 19,
      lineHeight: 24,
      fontWeight: '900',
      letterSpacing: 1.6,
      transform: [{ scaleX: 0.94 }],
      alignSelf: 'flex-start',
    },
    issue: {
      marginTop: 3,
      color: CANVAS_SUB,
      fontSize: 9.5,
      lineHeight: 13,
      fontWeight: '700',
      letterSpacing: 1.2,
    },
    navSide: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    locChip: {
      marginTop: 2,
      borderWidth: 1,
      borderColor: CHIP_LINE,
      borderRadius: 20,
      paddingHorizontal: 10,
      paddingVertical: 5,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    helpChip: {
      marginTop: 2,
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: CHIP_LINE,
      alignItems: 'center',
      justifyContent: 'center',
    },
    helpChipText: {
      color: CHIP_STRONG,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '800',
    },
    locChipMark: {
      color: CHIP_TEXT,
      fontSize: 10,
      lineHeight: 14,
    },
    locChipText: {
      color: CHIP_STRONG,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: '600',
    },
    loadingBox: {
      marginHorizontal: 22,
      marginTop: 18,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: LINE,
      backgroundColor: SURFACE,
      padding: 22,
      alignItems: 'center',
      gap: 12,
    },
    loadingTitle: {
      color: TEXT,
      fontSize: 18,
      lineHeight: 24,
      fontWeight: '800',
      textAlign: 'center',
    },
    loadingDesc: {
      color: MUTED,
      fontSize: 14,
      lineHeight: 21,
      fontWeight: '600',
      textAlign: 'center',
    },
    loginBox: {
      marginHorizontal: 22,
      marginTop: 16,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: LINE,
      backgroundColor: SURFACE,
      padding: 16,
      gap: 12,
    },
    loginTitle: {
      color: TEXT,
      fontSize: 16,
      lineHeight: 23,
      fontWeight: '800',
    },
    loginDesc: {
      color: MUTED,
      fontSize: 13,
      lineHeight: 20,
      fontWeight: '600',
    },
    footerSpace: {
      height: 122,
    },
    mutedText: {
      color: a.grey500,
    },
  });
}

function HomePageInner() {
  const navigation = Route.useNavigation();
  const adaptive = useAdaptive();
  const styles = useMemo(() => createStyles(adaptive), [adaptive]);
  const dialog = useDialog();
  const { isLoggedIn, user, isLoading: authLoading, login } = useAuth();

  const renderCacheKey = isLoggedIn ? getHomeSessionCacheKey(user?.id) : null;
  const initialCacheRef = useRef<HomeSessionCache | null>(
    renderCacheKey ? (homeSessionCache.get(renderCacheKey) ?? null) : null,
  );
  const initialCache = initialCacheRef.current;

  const [status, setStatus] = useState<HomeStatus>(initialCache?.status ?? 'loading');
  const [cardsData, setCardsData] = useState<CardsTodayV2Response | null>(initialCache?.cardsData ?? null);
  const [selectedCardKey, setSelectedCardKey] = useState<string | null>(initialCache?.selectedCardKey ?? null);
  const [openedCard, setOpenedCard] = useState<RevealedCultureCard | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [adLoadStatus, setAdLoadStatus] = useState<AdLoadStatus>('idle');
  const [statusCopy, setStatusCopy] = useState<HomeCopy | null>(initialCache?.statusCopy ?? null);
  const [loginPending, setLoginPending] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  const loadUnregisterRef = useRef<(() => void) | null>(null);
  const showUnregisterRef = useRef<(() => void) | null>(null);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showSettledRef = useRef(false);
  const lastShowEventTypeRef = useRef<RewardAdEventType | null>(null);
  const mountedRef = useRef(true);
  const activeCacheKeyRef = useRef<string | null>(renderCacheKey);
  const selectedCardKeyRef = useRef<string | null>(initialCache?.selectedCardKey ?? null);
  const refreshRequestVersionRef = useRef(0);
  const statusRef = useRef<HomeStatus>(initialCache?.status ?? 'loading');

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const clearLoadTimeout = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  }, []);

  const clearShowWatchdog = useCallback(() => {
    if (showWatchdogRef.current) {
      clearTimeout(showWatchdogRef.current);
      showWatchdogRef.current = null;
    }
  }, []);

  const startRewardedAdLoad = useCallback(() => {
    clearLoadTimeout();
    loadUnregisterRef.current?.();
    loadUnregisterRef.current = null;

    if (!loadFullScreenAd.isSupported()) {
      setAdLoadStatus('failed');
      return;
    }

    setAdLoadStatus('loading');
    loadUnregisterRef.current = loadFullScreenAd({
      options: { adGroupId: REWARDED_AD_ID },
      onEvent: (event) => {
        if (!mountedRef.current) return;
        if (event.type === 'loaded') {
          clearLoadTimeout();
          setAdLoadStatus('loaded');
        }
      },
      onError: () => {
        if (!mountedRef.current) return;
        clearLoadTimeout();
        setAdLoadStatus('failed');
      },
    });

    loadTimeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      loadUnregisterRef.current?.();
      loadUnregisterRef.current = null;
      setAdLoadStatus((current) => current === 'loaded' ? current : 'failed');
    }, AD_LOAD_TIMEOUT_MS);
  }, [clearLoadTimeout]);

  const resetAdAfterAttempt = useCallback(() => {
    setAdLoadStatus('idle');
    startRewardedAdLoad();
  }, [startRewardedAdLoad]);

  const refreshCards = useCallback(async (nextStatus: HomeStatus = 'ready') => {
    const requestCacheKey = activeCacheKeyRef.current;
    if (!requestCacheKey) return;
    const requestVersion = ++refreshRequestVersionRef.current;

    // 캐시 좌표로 즉시 요청해 첫 페인트를 GPS에 묶지 않는다. 크게 이동했으면 뒤에서 조용히 재검증.
    const coords = await getStartupCoords(() => {
      const current = statusRef.current;
      // 광고·공개 흐름 중에는 상태를 건드리지 않는다(ad-freeze 방지).
      if (current === 'ready' || current === 'loading' || current === 'load_failed') {
        refreshCards().catch(() => {});
      }
    });
    const data = await getTodayCardsV2(coords ?? undefined);
    if (
      !mountedRef.current
      || activeCacheKeyRef.current !== requestCacheKey
      || refreshRequestVersionRef.current !== requestVersion
    ) return;

    const nextSelectedCardKey = data.lockedCards.some((card) => getCardKey(card) === selectedCardKeyRef.current)
      ? selectedCardKeyRef.current
      : (data.lockedCards[0] ? getCardKey(data.lockedCards[0]) : null);
    selectedCardKeyRef.current = nextSelectedCardKey;
    setCardsData(data);
    setSelectedCardKey(nextSelectedCardKey);

    const availability = getTodayCardsAvailability(data);
    if (availability === 'daily_limit') {
      const dailyLimitCopy = getEarnFailureCopy({
        response: { status: 429, data: { error: 'DAILY_OPEN_LIMIT_REACHED' } },
      });
      setStatusCopy(dailyLimitCopy);
      setStatus('daily_limit');
      homeSessionCache.set(requestCacheKey, {
        cardsData: data,
        selectedCardKey: nextSelectedCardKey,
        status: 'daily_limit',
        statusCopy: dailyLimitCopy,
      });
      return data;
    }

    const resolvedStatus = availability === 'pool_empty' ? 'pool_empty' : nextStatus;
    const resolvedCopy = availability === 'pool_empty' ? POOL_EMPTY_COPY : null;
    setStatusCopy(resolvedCopy);
    setStatus(resolvedStatus);
    homeSessionCache.set(requestCacheKey, {
      cardsData: data,
      selectedCardKey: nextSelectedCardKey,
      // 공개 결과 화면은 openedCard가 필요하므로 재진입 캐시에서는 카드 목록으로 복귀한다.
      status: resolvedStatus === 'revealed' ? 'ready' : resolvedStatus,
      statusCopy: resolvedCopy,
    });
    return data;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearLoadTimeout();
      clearShowWatchdog();
      loadUnregisterRef.current?.();
      showUnregisterRef.current?.();
    };
  }, [clearLoadTimeout, clearShowWatchdog]);

  // 첫 진입 1회 이용 방법 안내(이후엔 헤더 "?" 칩으로만). 광고/공개 흐름과 무관한 표시 전용.
  useEffect(() => {
    let cancelled = false;
    shouldShowHowItWorks().then((show) => {
      if (!cancelled && show) setShowHowItWorks(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authLoading) return;

    const nextCacheKey = isLoggedIn ? getHomeSessionCacheKey(user?.id) : null;
    if (!isLoggedIn || !nextCacheKey) {
      refreshRequestVersionRef.current += 1;
      activeCacheKeyRef.current = null;
      selectedCardKeyRef.current = null;
      setCardsData(null);
      setSelectedCardKey(null);
      setOpenedCard(null);
      setStatusCopy(null);
      setStatus('ready');
      return;
    }

    const cached = homeSessionCache.get(nextCacheKey) ?? null;
    if (activeCacheKeyRef.current !== nextCacheKey) {
      refreshRequestVersionRef.current += 1;
      activeCacheKeyRef.current = nextCacheKey;
      selectedCardKeyRef.current = cached?.selectedCardKey ?? null;
      setCardsData(cached?.cardsData ?? null);
      setSelectedCardKey(cached?.selectedCardKey ?? null);
      setOpenedCard(null);
      setStatusCopy(cached?.statusCopy ?? null);
      setStatus(cached?.status ?? 'loading');
    }

    // 캐시가 있으면 화면은 그대로 보여 주고, 최신 카드는 뒤에서 재검증한다.
    refreshCards().catch(() => {
      if (!mountedRef.current || activeCacheKeyRef.current !== nextCacheKey || cached) return;
      setStatus('load_failed');
      setStatusCopy(LOAD_FAILED_COPY);
    });
    startRewardedAdLoad();
  }, [authLoading, isLoggedIn, refreshCards, startRewardedAdLoad, user?.id]);

  const handleSelectCard = useCallback((cardKey: string) => {
    selectedCardKeyRef.current = cardKey;
    setSelectedCardKey(cardKey);

    const cacheKey = activeCacheKeyRef.current;
    const cached = cacheKey ? homeSessionCache.get(cacheKey) : null;
    if (cacheKey && cached) {
      homeSessionCache.set(cacheKey, { ...cached, selectedCardKey: cardKey });
    }
  }, []);

  const activeCard = useMemo(() => {
    const lockedCards = cardsData?.lockedCards ?? [];
    return lockedCards.find((card) => (
      (card.visualSeed ?? card.cardToken) === selectedCardKey
    )) ?? lockedCards[0] ?? null;
  }, [cardsData?.lockedCards, selectedCardKey]);
  const dailyLimitReached = hasReachedDailyLimit(cardsData);
  const ticketCount = cardsData?.ticketCount ?? 0;
  const issueLine = formatIssueLine();
  const regionLabel = cardsData?.userRegion?.trim() || '내 주변';
  const capView = cardsData ? getCapReachedView(cardsData) : null;
  const canDrawNext = cardsData
    ? canDrawNextCard(cardsData.dailyOpenCount, cardsData)
    : false;

  const handleRefresh = useCallback(async () => {
    if (!isLoggedIn) return;
    setRefreshing(true);
    try {
      await refreshCards(status === 'revealed' ? 'revealed' : 'ready');
    } catch {
      setStatusCopy(LOAD_FAILED_COPY);
      setStatus('load_failed');
    } finally {
      setRefreshing(false);
    }
  }, [isLoggedIn, refreshCards, status]);

  const openAlert = useCallback((copy: HomeCopy) => {
    dialog.openAlert({
      title: copy.title,
      description: copy.description,
    }).catch(() => {});
  }, [dialog]);

  const handleLogin = useCallback(async () => {
    if (loginPending) return;
    setLoginPending(true);
    try {
      await login();
    } catch {
      // 로그인 취소는 별도 오류로 다루지 않아요.
    } finally {
      if (mountedRef.current) setLoginPending(false);
    }
  }, [login, loginPending]);

  const handleOpenCard = useCallback(async () => {
    if (authLoading || status === 'ad_loading') return;
    if (!isLoggedIn) {
      await handleLogin();
      return;
    }
    if (!cardsData) {
      setStatus('loading');
      await refreshCards().catch(() => {
        setStatusCopy(LOAD_FAILED_COPY);
        setStatus('load_failed');
      });
      return;
    }
    if (dailyLimitReached) {
      const copy = getEarnFailureCopy({ response: { status: 429, data: { error: 'DAILY_OPEN_LIMIT_REACHED' } } });
      setStatusCopy(copy);
      setStatus('daily_limit');
      openAlert(copy);
      return;
    }
    if (!activeCard) {
      setStatusCopy(POOL_EMPTY_COPY);
      setStatus('pool_empty');
      return;
    }
    if (!showFullScreenAd.isSupported()) {
      setStatusCopy(AD_LOAD_FAILED_COPY);
      setStatus('ad_failed');
      openAlert(AD_LOAD_FAILED_COPY);
      return;
    }
    if (adLoadStatus !== 'loaded') {
      if (adLoadStatus !== 'loading') startRewardedAdLoad();
      const copy = adLoadStatus === 'failed' ? AD_LOAD_FAILED_COPY : AD_LOADING_COPY;
      setStatusCopy(copy);
      if (adLoadStatus === 'failed') setStatus('ad_failed');
      openAlert(copy);
      return;
    }

    const attemptId = createRewardAdAttemptId();
    const card = activeCard;
    const logAdEvent = (eventType: RewardAdEventType, eventData?: Record<string, unknown>) => (
      logRewardAdEvent({
        attemptId,
        eventType,
        adGroupId: REWARDED_AD_ID,
        placement: 'culturecard_home_open',
        eventData,
        metadata: {
          cardToken: card.cardToken,
          route: '/',
          platform: Platform.OS,
        },
      })
    );
    const settleTimedOutAd = (phase: AdShowWatchdogPhase) => {
      if (!mountedRef.current || showSettledRef.current) return;
      showSettledRef.current = true;
      logAdEvent('error', {
        reason: 'watchdog_timeout',
        phase,
        lastEventType: lastShowEventTypeRef.current,
      }).catch(() => {});
      showUnregisterRef.current?.();
      showUnregisterRef.current = null;
      setStatus('ready');
      setStatusCopy(WATCHDOG_COPY);
      resetAdAfterAttempt();
      openAlert(WATCHDOG_COPY);
    };
    const scheduleShowWatchdog = (phase: AdShowWatchdogPhase) => {
      clearShowWatchdog();
      const timeoutMs = phase === 'request'
        ? AD_SHOW_REQUEST_TIMEOUT_MS
        : AD_SHOW_TERMINAL_TIMEOUT_MS;
      showWatchdogRef.current = setTimeout(() => settleTimedOutAd(phase), timeoutMs);
    };

    // 캐시 재검증 요청이 뒤늦게 끝나 광고 진행 상태를 덮지 않게 한다.
    refreshRequestVersionRef.current += 1;
    setStatus('ad_loading');
    setStatusCopy(null);
    setOpenedCard(null);
    showSettledRef.current = false;
    lastShowEventTypeRef.current = null;
    showUnregisterRef.current?.();
    showUnregisterRef.current = null;
    scheduleShowWatchdog('request');

    showUnregisterRef.current = showFullScreenAd({
      options: { adGroupId: REWARDED_AD_ID },
      onEvent: async (event) => {
        const eventType = event.type as RewardAdEventType;
        lastShowEventTypeRef.current = eventType;
        const eventLog = logAdEvent(eventType, 'data' in event ? event.data : undefined);

        if (isRewardAdProgressEvent(eventType)) {
          eventLog.catch(() => {});
          scheduleShowWatchdog('terminal');
          return;
        }

        if (event.type === 'userEarnedReward') {
          if (showSettledRef.current) return;
          showSettledRef.current = true;
          clearShowWatchdog();
          showUnregisterRef.current?.();
          showUnregisterRef.current = null;

          try {
            // 공개 API는 reward 이벤트가 서버에 기록된 뒤에만 성공한다.
            await eventLog;
            const result = await openCultureCard(card.cardToken, attemptId);
            if (!mountedRef.current) return;
            const nextCardsData: CardsTodayV2Response = {
              ...cardsData,
              lockedCards: cardsData.lockedCards.filter((item) => item.cardToken !== card.cardToken),
              ticketCount: result.ticketCount,
              dailyEarned: result.dailyEarned,
              dailyLimit: result.dailyLimit,
              dailyOpenCount: result.dailyOpenCount,
              dailyOpenLimit: result.dailyOpenLimit,
            };
            const nextSelectedCardKey = nextCardsData.lockedCards.some((item) => (
              getCardKey(item) === selectedCardKeyRef.current
            ))
              ? selectedCardKeyRef.current
              : (nextCardsData.lockedCards[0] ? getCardKey(nextCardsData.lockedCards[0]) : null);
            selectedCardKeyRef.current = nextSelectedCardKey;
            setCardsData(nextCardsData);
            setSelectedCardKey(nextSelectedCardKey);

            const cacheKey = activeCacheKeyRef.current;
            if (cacheKey) {
              const cachedState = getStableCachedState(nextCardsData);
              homeSessionCache.set(cacheKey, {
                cardsData: nextCardsData,
                selectedCardKey: nextSelectedCardKey,
                ...cachedState,
              });
            }
            setOpenedCard({
              card: result.card,
              earned: result.earned,
              ticketCount: result.ticketCount,
              dailyEarned: result.dailyEarned,
              dailyLimit: result.dailyLimit,
              reveal: result.reveal,
              collectionProgress: result.collectionProgress,
            });
            setStatus('revealed');
            resetAdAfterAttempt();
          } catch (error) {
            if (!mountedRef.current) return;
            if (isAlreadyOpenedCardError(error)) {
              const nextCardsData = removeLockedCardPreview(cardsData, card.cardToken);
              const nextSelectedCardKey = nextCardsData.lockedCards.some((item) => (
                getCardKey(item) === selectedCardKeyRef.current
              ))
                ? selectedCardKeyRef.current
                : (nextCardsData.lockedCards[0] ? getCardKey(nextCardsData.lockedCards[0]) : null);
              const stableState = getStableCachedState(nextCardsData);

              selectedCardKeyRef.current = nextSelectedCardKey;
              setCardsData(nextCardsData);
              setSelectedCardKey(nextSelectedCardKey);
              setOpenedCard(null);
              setStatusCopy(stableState.statusCopy);
              setStatus(stableState.status);

              const cacheKey = activeCacheKeyRef.current;
              if (cacheKey) {
                homeSessionCache.set(cacheKey, {
                  cardsData: nextCardsData,
                  selectedCardKey: nextSelectedCardKey,
                  ...stableState,
                });
              }

              resetAdAfterAttempt();
              // 다른 기기나 이전 세션에서 이미 공개된 stale 토큰은 조용히 버리고
              // 서버 권위의 최신 미공개 목록으로 즉시 다시 맞춘다.
              await refreshCards().catch(() => {
                // 로컬과 세션 캐시에서는 이미 stale 카드를 제거했으므로,
                // 재검증 실패 시에도 그 카드를 다시 노출하지 않는다.
              });
              return;
            }
            const copy = getEarnFailureCopy(error);
            setStatusCopy(copy);
            setStatus(isDailyLimitReachedError(error) ? 'daily_limit' : 'earn_failed');
            resetAdAfterAttempt();
            openAlert(copy);
          }
          return;
        }

        if (event.type === 'dismissed') {
          eventLog.catch(() => {});
          if (showSettledRef.current) return;
          showSettledRef.current = true;
          clearShowWatchdog();
          showUnregisterRef.current?.();
          showUnregisterRef.current = null;
          setStatus('ready');
          setStatusCopy({
            title: '카드가 열리지 않았어요',
            description: '광고를 끝까지 보면 카드가 열리고 티켓이 쌓여요.',
          });
          resetAdAfterAttempt();
        }

        if (event.type === 'failedToShow') {
          eventLog.catch(() => {});
          if (showSettledRef.current) return;
          showSettledRef.current = true;
          clearShowWatchdog();
          showUnregisterRef.current?.();
          showUnregisterRef.current = null;
          setStatusCopy(AD_LOAD_FAILED_COPY);
          setStatus('ad_failed');
          resetAdAfterAttempt();
          openAlert(AD_LOAD_FAILED_COPY);
        }
      },
      onError: (error) => {
        logAdEvent('error', {
          message: error instanceof Error ? error.message : String(error),
        }).catch(() => {});
        if (showSettledRef.current) return;
        showSettledRef.current = true;
        clearShowWatchdog();
        showUnregisterRef.current?.();
        showUnregisterRef.current = null;
        setStatusCopy(AD_LOAD_FAILED_COPY);
        setStatus('ad_failed');
        resetAdAfterAttempt();
        openAlert(AD_LOAD_FAILED_COPY);
      },
    });
  }, [
    activeCard,
    adLoadStatus,
    authLoading,
    cardsData,
    clearShowWatchdog,
    dailyLimitReached,
    handleLogin,
    isLoggedIn,
    openAlert,
    refreshCards,
    resetAdAfterAttempt,
    startRewardedAdLoad,
    status,
  ]);

  const handleNextCard = useCallback(async () => {
    setOpenedCard(null);
    setStatus('loading');
    try {
      const nextData = await refreshCards();
      if (hasReachedDailyLimit(nextData ?? null)) {
        // regional_pool 캡은 전용 ALL ISSUED 화면이 설명하므로 알럿은 daily_max에서만 띄운다.
        const reached = nextData ? getCapReachedView(nextData) : null;
        if (reached?.variant !== 'regional_pool') {
          openAlert(getEarnFailureCopy({
            response: { status: 429, data: { error: 'DAILY_OPEN_LIMIT_REACHED' } },
          }));
        }
      }
    } catch {
      setStatusCopy(LOAD_FAILED_COPY);
      setStatus('load_failed');
    }
  }, [openAlert, refreshCards]);

  const handleDetail = useCallback(() => {
    if (!openedCard) return;
    navigation.navigate('/events/:id', { id: openedCard.card.eventId });
  }, [navigation, openedCard]);

  const handleSave = useCallback(async () => {
    const card = openedCard?.card;
    if (!card) return;
    const likes = await getLikesV2().catch(() => null);
    if (likes?.items.some((item) => item.id === card.eventId)) {
      await dialog.openAlert({
        title: '이미 저장돼 있어요',
        description: '컬렉션의 ‘저장’에서 다시 볼 수 있어요.',
      });
      return;
    }

    await toggleLike(card.eventId, {
      title: card.title,
      startAt: card.startAt ?? undefined,
      endAt: card.endAt ?? undefined,
      venue: card.venue ?? undefined,
      region: card.region ?? undefined,
      imageUrl: card.imageUrl ?? undefined,
      mainCategory: card.category ?? undefined,
    }).catch(() => null);
    userEventService.logEventSave(card.eventId).catch(() => {});
    await dialog.openAlert({
      title: '저장했어요',
      description: '컬렉션의 ‘저장’에서 다시 볼 수 있어요.',
    });
  }, [dialog, openedCard]);

  const actionLabel = !isLoggedIn && !authLoading
    ? '로그인하고 컬처카드 열기'
    : dailyLimitReached
      ? '오늘 공개 완료'
      : '광고 보고 카드 열기';
  const stackDisabled = (
    authLoading
    || loginPending
    || status === 'loading'
    || status === 'ad_loading'
    || (isLoggedIn && (!activeCard || status === 'pool_empty' || status === 'load_failed'))
  );

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={GOLD} />}
      >
        <ScrollViewInertialBackground topColor={INK} bottomColor={INK_BOTTOM} />
        <View style={[styles.header, { paddingTop: 14 }]}>
          <View style={styles.nav}>
            <View style={styles.brand}>
              <Text style={styles.name}>CULTURE CARD</Text>
              <Text style={styles.issue}>{issueLine}</Text>
            </View>
            <View style={styles.navSide}>
              <View style={styles.locChip} accessibilityLabel={`현재 지역 ${regionLabel}`}>
                <Text style={styles.locChipMark}>◉</Text>
                <Text style={styles.locChipText}>{regionLabel}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="이용 방법 보기"
                style={styles.helpChip}
                onPress={() => setShowHowItWorks(true)}
              >
                <Text style={styles.helpChipText}>?</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {isLoggedIn && cardsData ? (
          <TicketGauge
            ticketCount={ticketCount}
            dailyOpenCount={cardsData.dailyOpenCount}
            onPress={() => (navigation.replace as (route: string) => void)('/points')}
          />
        ) : null}

        {status === 'revealed' && openedCard ? (
          <CultureCardReveal
            openedCard={openedCard}
            canDrawNext={canDrawNext}
            onDetail={handleDetail}
            onNext={handleNextCard}
            onSave={handleSave}
          />
        ) : (
          <>
            {status !== 'daily_limit' && status !== 'pool_empty' && status !== 'load_failed' ? (
              <CultureCardStack
                cards={cardsData?.lockedCards ?? []}
                selectedCardKey={activeCard ? (activeCard.visualSeed ?? activeCard.cardToken) : null}
                loading={status === 'ad_loading' || adLoadStatus === 'loading'}
                disabled={stackDisabled}
                actionLabel={actionLabel}
                onSelectCard={handleSelectCard}
                onOpen={handleOpenCard}
                userRegion={cardsData?.userRegion ?? null}
                nextCardNumber={isLoggedIn && cardsData ? cardsData.dailyOpenCount + 1 : null}
              />
            ) : null}

            {status === 'ad_loading' ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={GOLD} />
                <Text style={styles.loadingTitle}>광고 확인 중</Text>
                <Text style={styles.loadingDesc}>광고가 끝나면 서버에서 티켓을 적립해요.</Text>
              </View>
            ) : null}

            {status === 'ad_failed' ? (
              <CultureCardStatePanel
                label="광고 없음"
                title={statusCopy?.title ?? AD_LOAD_FAILED_COPY.title}
                description={statusCopy?.description ?? AD_LOAD_FAILED_COPY.description}
                actionLabel="다시 불러오기"
                tone="danger"
                onAction={() => {
                  setStatus('ready');
                  setStatusCopy(null);
                  startRewardedAdLoad();
                }}
              />
            ) : null}

            {status === 'earn_failed' ? (
              <CultureCardStatePanel
                label="적립 실패"
                title={statusCopy?.title ?? '티켓 적립에 실패했어요'}
                description={statusCopy?.description ?? '잠시 후 다시 시도해 주세요.'}
                actionLabel="다시 시도"
                tone="danger"
                onAction={() => {
                  setStatus('ready');
                  setStatusCopy(null);
                }}
              />
            ) : null}

            {status === 'daily_limit' ? (
              capView?.variant === 'regional_pool' ? (
                <AllIssuedTag
                  title={capView.title}
                  description={capView.description}
                  meterLabel={capView.meterLabel}
                  ctaLabel={capView.ctaLabel}
                  footnote={capView.footnote}
                  onAction={() => (navigation.replace as (route: string) => void)('/passport')}
                />
              ) : (
                <CultureCardStatePanel
                  label="오늘 완료"
                  title={statusCopy?.title ?? '오늘 준비한 컬처카드는 여기까지예요'}
                  description={statusCopy?.description ?? '내일 새로운 카드가 도착해요. 공개한 카드는 컬렉션에서 다시 볼 수 있어요.'}
                  actionLabel="컬렉션 보기"
                  tone="success"
                  onAction={() => (navigation.replace as (route: string) => void)('/passport')}
                />
              )
            ) : null}

            {status === 'pool_empty' ? (
              <CultureCardStatePanel
                label="새로운 카드 완료"
                title={statusCopy?.title ?? POOL_EMPTY_COPY.title}
                description={statusCopy?.description ?? POOL_EMPTY_COPY.description}
                actionLabel="컬렉션 보기"
                tone="success"
                onAction={() => (navigation.replace as (route: string) => void)('/passport')}
              />
            ) : null}

            {status === 'load_failed' ? (
              <CultureCardStatePanel
                label="불러오기 실패"
                title={statusCopy?.title ?? LOAD_FAILED_COPY.title}
                description={statusCopy?.description ?? LOAD_FAILED_COPY.description}
                actionLabel="다시 시도"
                tone="neutral"
                onAction={handleRefresh}
              />
            ) : null}
          </>
        )}

        {!isLoggedIn && !authLoading ? (
          <View style={styles.loginBox}>
            <View>
              <Text style={styles.loginTitle}>로그인이 필요해요</Text>
              <Text style={styles.loginDesc}>오늘의 문화카드와 티켓 잔액을 서버에서 불러올게요.</Text>
            </View>
            <Button type="primary" size="medium" disabled={loginPending} onPress={handleLogin}>
              토스로 로그인
            </Button>
          </View>
        ) : null}

        <View style={styles.footerSpace} />
      </ScrollView>

      <BottomTabBar currentTab="home" />
      {showHowItWorks ? (
        <HowItWorksSheet
          onClose={() => {
            setShowHowItWorks(false);
            markHowItWorksSeen().catch(() => {});
          }}
        />
      ) : null}
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
