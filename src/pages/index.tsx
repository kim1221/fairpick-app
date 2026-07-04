import { createRoute, ScrollViewInertialBackground } from '@granite-js/react-native';
import { useSafeAreaInsets } from '@granite-js/native/react-native-safe-area-context';
import { loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/framework';
import { Button, Icon, useDialog } from '@toss/tds-react-native';
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
import { CultureCardReveal, type RevealedCultureCard } from '../components/culture-card/CultureCardReveal';
import { CultureCardStack } from '../components/culture-card/CultureCardStack';
import { CultureCardStatePanel } from '../components/culture-card/CultureCardStatePanel';
import {
  AD_LOAD_FAILED_COPY,
  AD_LOADING_COPY,
  getEarnFailureCopy,
  getNextOpenableCard,
  getTodayCardProgress,
  getTodayCards as getThreeTodayCards,
  hasReachedDailyLimit,
  isDailyLimitReachedError,
  markCardOpened,
  type HomeCopy,
} from '../components/culture-card/homeLogic';
import { LikesProvider } from '../contexts/LikesContext';
import { useAuth } from '../hooks/useAuth';
import { getTodayCards, type CardsTodayResponse } from '../services/cardsService';
import {
  createRewardAdAttemptId,
  earnTickets,
  logRewardAdEvent,
  type RewardAdEventType,
} from '../services/ticketService';
import userEventService from '../services/userEventService';
import { getCurrentCoordsOrNull } from '../utils/currentLocation';
import { getLikesV2, toggleLike } from '../utils/storage';

export const Route = createRoute('/', {
  component: HomePage,
});

const REWARDED_AD_ID = 'ait.v2.live.b50cf7d900884c5b';
const AD_LOAD_TIMEOUT_MS = 15_000;
const AD_SHOW_WATCHDOG_MS = 60_000;
// 워엄 다크 배경 + 마닐라 워엄톤 크롬 (컬처카드 태그 방향)
const INK = '#100D09';
const INK_BOTTOM = '#0A0805';
const SURFACE = '#1A140D';
const LINE = '#4A3F2C';
const GOLD = '#D9C7A0';
const TEXT = '#EDE6D6';
const MUTED = '#9A8F77';
const MUTED_2 = '#7A6E58';

type Adaptive = ReturnType<typeof useAdaptive>;
type HomeStatus = 'loading' | 'ready' | 'ad_loading' | 'ad_failed' | 'earn_failed' | 'daily_limit' | 'revealed' | 'empty';
type AdLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';

const WATCHDOG_COPY: HomeCopy = {
  title: '광고 응답이 없어요',
  description: '잠시 후 다시 시도해 주세요. 카드는 그대로예요.',
};

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
      paddingBottom: 8,
    },
    nav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    brand: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    mark: {
      width: 25,
      height: 25,
      borderRadius: 6,
      backgroundColor: GOLD,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markText: {
      color: '#2C2A22',
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '900',
    },
    name: {
      color: TEXT,
      fontSize: 17,
      lineHeight: 23,
      fontWeight: '800',
    },
    ticketChip: {
      minWidth: 62,
      height: 36,
      borderRadius: 999,
      paddingHorizontal: 13,
      borderWidth: 1,
      borderColor: LINE,
      backgroundColor: 'transparent',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    ticketChipNumber: {
      color: TEXT,
      fontSize: 14,
      lineHeight: 19,
      fontWeight: '800',
    },
    ticketChipLabel: {
      color: MUTED_2,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: '700',
    },
    ticketChipChevron: {
      color: MUTED_2,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
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
  const { top } = useSafeAreaInsets();
  const dialog = useDialog();
  const { isLoggedIn, isLoading: authLoading, login } = useAuth();

  const [status, setStatus] = useState<HomeStatus>('loading');
  const [cardsData, setCardsData] = useState<CardsTodayResponse | null>(null);
  const [openedCard, setOpenedCard] = useState<RevealedCultureCard | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [adLoadStatus, setAdLoadStatus] = useState<AdLoadStatus>('idle');
  const [statusCopy, setStatusCopy] = useState<HomeCopy | null>(null);
  const [loginPending, setLoginPending] = useState(false);

  const loadUnregisterRef = useRef<(() => void) | null>(null);
  const showUnregisterRef = useRef<(() => void) | null>(null);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showSettledRef = useRef(false);
  const mountedRef = useRef(true);

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
    const coords = await getCurrentCoordsOrNull();
    const data = await getTodayCards(coords ?? undefined);
    if (!mountedRef.current) return;
    setCardsData(data);
    if (hasReachedDailyLimit(data)) {
      setStatusCopy(getEarnFailureCopy({ response: { status: 429, data: { error: 'DAILY_LIMIT_REACHED' } } }));
      setStatus('daily_limit');
      return;
    }
    setStatusCopy(null);
    setStatus(data.today.length === 0 ? 'empty' : nextStatus);
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

  useEffect(() => {
    if (authLoading) return;
    if (!isLoggedIn) {
      setStatus('ready');
      return;
    }
    setStatus('loading');
    refreshCards().catch(() => {
      if (!mountedRef.current) return;
      setStatus('empty');
      setStatusCopy({
        title: '새로운 문화카드를 찾고 있어요',
        description: '이벤트 정보를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.',
      });
    });
    startRewardedAdLoad();
  }, [authLoading, isLoggedIn, refreshCards, startRewardedAdLoad]);

  const todayCards = useMemo(() => getThreeTodayCards(cardsData?.today ?? []), [cardsData?.today]);
  const progress = useMemo(() => getTodayCardProgress(cardsData), [cardsData]);
  const activeCard = useMemo(() => getNextOpenableCard(cardsData), [cardsData]);
  const dailyLimitReached = hasReachedDailyLimit(cardsData);
  const ticketCount = cardsData?.ticketCount ?? 0;
  const dailyEarned = cardsData?.dailyEarned ?? 0;
  const dailyLimit = cardsData?.dailyLimit ?? 30;
  const bonusMode = progress.opened >= 3 && !dailyLimitReached && !!activeCard;
  const openedTodayCards = useMemo(() => todayCards.filter((card) => card.opened), [todayCards]);

  const handleRefresh = useCallback(async () => {
    if (!isLoggedIn) return;
    setRefreshing(true);
    try {
      await refreshCards(status === 'revealed' ? 'revealed' : 'ready');
    } catch {
      setStatus('empty');
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
      await refreshCards().catch(() => setStatus('empty'));
      return;
    }
    if (dailyLimitReached) {
      const copy = getEarnFailureCopy({ response: { status: 429, data: { error: 'DAILY_LIMIT_REACHED' } } });
      setStatusCopy(copy);
      setStatus('daily_limit');
      openAlert(copy);
      return;
    }
    if (!activeCard) {
      setStatus('empty');
      setStatusCopy({
        title: '새로운 문화카드를 찾고 있어요',
        description: '오늘 열 수 있는 카드를 준비하지 못했어요. 잠시 후 다시 확인해 주세요.',
      });
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
    const logAdEvent = (eventType: RewardAdEventType, eventData?: Record<string, unknown>) => {
      logRewardAdEvent({
        attemptId,
        eventType,
        eventId: card.eventId,
        adGroupId: REWARDED_AD_ID,
        placement: 'culturecard_home_open',
        eventData,
        metadata: {
          eventTitle: card.title,
          route: '/',
          platform: Platform.OS,
        },
      }).catch(() => {});
    };

    setStatus('ad_loading');
    setStatusCopy(null);
    setOpenedCard(null);
    showSettledRef.current = false;
    showUnregisterRef.current?.();
    showUnregisterRef.current = null;

    showWatchdogRef.current = setTimeout(() => {
      if (!mountedRef.current || showSettledRef.current) return;
      showSettledRef.current = true;
      showUnregisterRef.current?.();
      showUnregisterRef.current = null;
      setStatus('ready');
      setStatusCopy(WATCHDOG_COPY);
      resetAdAfterAttempt();
      openAlert(WATCHDOG_COPY);
    }, AD_SHOW_WATCHDOG_MS);

    showUnregisterRef.current = showFullScreenAd({
      options: { adGroupId: REWARDED_AD_ID },
      onEvent: async (event) => {
        logAdEvent(event.type as RewardAdEventType, 'data' in event ? event.data : undefined);

        if (event.type === 'userEarnedReward') {
          if (showSettledRef.current) return;
          showSettledRef.current = true;
          clearShowWatchdog();
          showUnregisterRef.current?.();
          showUnregisterRef.current = null;

          try {
            const result = await earnTickets(card.eventId, attemptId);
            if (!mountedRef.current) return;
            setCardsData((prev) => prev ? markCardOpened(prev, card.eventId, result) : prev);
            setOpenedCard({
              card: { ...card, opened: true },
              earned: result.earned,
              ticketCount: result.ticketCount,
              dailyEarned: result.dailyEarned,
              dailyLimit: result.dailyLimit,
            });
            setStatus('revealed');
            resetAdAfterAttempt();
          } catch (error) {
            if (!mountedRef.current) return;
            const copy = getEarnFailureCopy(error);
            setStatusCopy(copy);
            setStatus(isDailyLimitReachedError(error) ? 'daily_limit' : 'earn_failed');
            resetAdAfterAttempt();
            openAlert(copy);
          }
          return;
        }

        if (event.type === 'dismissed') {
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
        });
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
    await refreshCards().catch(() => setStatus('empty'));
  }, [refreshCards]);

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
        description: '저장 탭에서 다시 볼 수 있어요.',
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
      description: '저장 탭에서 다시 볼 수 있어요.',
    });
  }, [dialog, openedCard]);

  const actionLabel = !isLoggedIn && !authLoading
    ? '로그인하고 열기'
    : dailyLimitReached
      ? '오늘 티켓 완료'
      : bonusMode
        ? '광고 보고 보너스 열기'
        : '광고 보고 열기';
  const stackDisabled = (
    authLoading
    || loginPending
    || status === 'loading'
    || status === 'ad_loading'
    || (isLoggedIn && (!activeCard || status === 'empty'))
  );

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={GOLD} />}
      >
        <ScrollViewInertialBackground topColor={INK} bottomColor={INK_BOTTOM} />
        <View style={[styles.header, { paddingTop: top + 14 }]}>
          <View style={styles.nav}>
            <View style={styles.brand}>
              <View style={styles.mark}>
                <Text style={styles.markText}>C</Text>
              </View>
              <Text style={styles.name}>컬처카드</Text>
            </View>
            <Pressable style={styles.ticketChip} onPress={() => navigation.navigate('/points' as never)}>
              <Icon name="icon-ticket-mono" size={15} color={GOLD} />
              <Text style={styles.ticketChipNumber}>{ticketCount}</Text>
              <Text style={styles.ticketChipLabel}>티켓</Text>
              <Text style={styles.ticketChipChevron}>›</Text>
            </Pressable>
          </View>
        </View>

        {status === 'revealed' && openedCard ? (
          <CultureCardReveal
            openedCard={openedCard}
            onDetail={handleDetail}
            onNext={handleNextCard}
            onSave={handleSave}
          />
        ) : (
          <>
            <CultureCardStack
              cards={todayCards}
              activeCard={activeCard}
              progress={progress}
              dailyEarned={dailyEarned}
              dailyLimit={dailyLimit}
              loading={status === 'ad_loading' || adLoadStatus === 'loading'}
              disabled={stackDisabled}
              actionLabel={actionLabel}
              onOpen={handleOpenCard}
              bonusMode={bonusMode}
              openedCards={openedTodayCards}
              userRegion={cardsData?.userRegion ?? null}
            />

            {status === 'loading' ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={GOLD} />
                <Text style={styles.loadingTitle}>카드를 준비하고 있어요</Text>
                <Text style={styles.loadingDesc}>오늘 열어볼 문화 이벤트를 고르는 중이에요.</Text>
              </View>
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
              <CultureCardStatePanel
                label="오늘 완료"
                title={statusCopy?.title ?? '오늘 티켓을 다 모았어요'}
                description={statusCopy?.description ?? '내일 다시 새로운 문화카드를 열 수 있어요.'}
                tone="success"
              />
            ) : null}

            {status === 'empty' ? (
              <CultureCardStatePanel
                label="카드 준비 중"
                title={statusCopy?.title ?? '새로운 문화카드를 찾고 있어요'}
                description={statusCopy?.description ?? '이벤트 정보를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.'}
                actionLabel="새로 고침"
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
