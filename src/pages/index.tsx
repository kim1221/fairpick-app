import { createRoute, ScrollViewInertialBackground } from '@granite-js/react-native';
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
import { TasteCompass } from '../components/culture-card/TasteCompass';
import { WeeklyDiscoveryCollection } from '../components/culture-card/WeeklyDiscoveryCollection';
import {
  AD_LOAD_FAILED_COPY,
  AD_LOADING_COPY,
  AD_SHOW_REQUEST_TIMEOUT_MS,
  AD_SHOW_TERMINAL_TIMEOUT_MS,
  getEarnFailureCopy,
  hasReachedDailyLimit,
  isRewardAdProgressEvent,
  isDailyLimitReachedError,
  type HomeCopy,
} from '../components/culture-card/homeLogic';
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
import { getCurrentCoordsOrNull } from '../utils/currentLocation';
import { getLikesV2, toggleLike } from '../utils/storage';

export const Route = createRoute('/', {
  component: HomePage,
});

const REWARDED_AD_ID = 'ait.v2.live.b50cf7d900884c5b';
const AD_LOAD_TIMEOUT_MS = 15_000;
// 카드뉴스의 색이 살아나도록 따뜻한 밝은 캔버스를 사용한다.
const INK = '#F7F5EF';
const INK_BOTTOM = '#EFECE4';
const SURFACE = '#FFFFFF';
const LINE = '#DDD8CE';
const GOLD = '#A52822';
const TEXT = '#171717';
const MUTED = '#6F6B65';
const MUTED_2 = '#817C74';

type Adaptive = ReturnType<typeof useAdaptive>;
type HomeStatus = 'loading' | 'ready' | 'ad_loading' | 'ad_failed' | 'earn_failed' | 'daily_limit' | 'revealed' | 'empty';
type AdLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';
type AdShowWatchdogPhase = 'request' | 'terminal';

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
      paddingBottom: 10,
    },
    nav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: 9,
      borderBottomWidth: 2,
      borderBottomColor: '#171717',
    },
    brand: {
      flex: 1,
    },
    mark: {
      display: 'none',
    },
    markText: {
      color: '#FFFFFF',
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '900',
    },
    name: {
      color: TEXT,
      fontSize: 18,
      lineHeight: 22,
      fontWeight: '900',
      letterSpacing: 0.2,
    },
    issue: {
      marginTop: 7,
      color: TEXT,
      fontSize: 9.5,
      lineHeight: 13,
      fontWeight: '800',
      letterSpacing: 1.2,
    },
    ticketChip: {
      height: 39,
      borderRadius: 2,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor: '#171717',
      backgroundColor: '#F7F5EF',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
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
    ticketChipDivider: {
      width: 1,
      height: 13,
      backgroundColor: '#D8D2C7',
      marginHorizontal: 2,
    },
    ticketChipCta: {
      color: GOLD,
      fontSize: 12.5,
      lineHeight: 16,
      fontWeight: '800',
    },
    ticketChipChevron: {
      color: GOLD,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '800',
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
  const { isLoggedIn, isLoading: authLoading, login } = useAuth();

  const [status, setStatus] = useState<HomeStatus>('loading');
  const [cardsData, setCardsData] = useState<CardsTodayV2Response | null>(null);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
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
  const lastShowEventTypeRef = useRef<RewardAdEventType | null>(null);
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
    const data = await getTodayCardsV2(coords ?? undefined);
    if (!mountedRef.current) return;
    setCardsData(data);
    setSelectedToken((current) => (
      data.lockedCards.some((card) => card.cardToken === current)
        ? current
        : (data.lockedCards[0]?.cardToken ?? null)
    ));
    if (hasReachedDailyLimit(data)) {
      setStatusCopy(getEarnFailureCopy({ response: { status: 429, data: { error: 'DAILY_OPEN_LIMIT_REACHED' } } }));
      setStatus('daily_limit');
      return;
    }
    setStatusCopy(null);
    setStatus(data.lockedCards.length === 0 ? 'empty' : nextStatus);
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

  const activeCard = useMemo(() => {
    const lockedCards = cardsData?.lockedCards ?? [];
    return lockedCards.find((card) => card.cardToken === selectedToken) ?? lockedCards[0] ?? null;
  }, [cardsData?.lockedCards, selectedToken]);
  const dailyLimitReached = hasReachedDailyLimit(cardsData);
  const ticketCount = cardsData?.ticketCount ?? 0;
  const dailyOpenCount = cardsData?.dailyOpenCount ?? 0;
  const dailyOpenLimit = cardsData?.dailyOpenLimit ?? 50;

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
      const copy = getEarnFailureCopy({ response: { status: 429, data: { error: 'DAILY_OPEN_LIMIT_REACHED' } } });
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
            setCardsData((prev) => prev ? {
              ...prev,
              lockedCards: prev.lockedCards.filter((item) => item.cardToken !== card.cardToken),
              ticketCount: result.ticketCount,
              dailyEarned: result.dailyEarned,
              dailyLimit: result.dailyLimit,
              dailyOpenCount: result.dailyOpenCount,
              dailyOpenLimit: result.dailyOpenLimit,
            } : prev);
            setOpenedCard({
              card: result.card,
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
    ? '로그인하고 공개하기'
    : dailyLimitReached
      ? '오늘 50장 공개 완료'
      : '광고 보고 공개하기';
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
        <View style={[styles.header, { paddingTop: 14 }]}>
          <View style={styles.nav}>
            <View style={styles.brand}>
              <Text style={styles.name}>CULTURE CARD</Text>
              <Text style={styles.issue}>SEOUL · DAILY EDITION · 07.11.2026</Text>
            </View>
            <Pressable style={styles.ticketChip} onPress={() => navigation.navigate('/points' as never)}>
              <Icon name="icon-ticket-mono" size={15} color={GOLD} />
              <Text style={styles.ticketChipNumber}>{ticketCount}</Text>
              <Text style={styles.ticketChipLabel}>티켓</Text>
              <View style={styles.ticketChipDivider} />
              <Text style={styles.ticketChipCta}>교환</Text>
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
              cards={cardsData?.lockedCards ?? []}
              selectedToken={activeCard?.cardToken ?? null}
              dailyOpenCount={dailyOpenCount}
              dailyOpenLimit={dailyOpenLimit}
              loading={status === 'ad_loading' || adLoadStatus === 'loading'}
              disabled={stackDisabled}
              actionLabel={actionLabel}
              onOpen={handleOpenCard}
              userRegion={cardsData?.userRegion ?? null}
            />

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
                title={statusCopy?.title ?? '오늘 컬처카드 50장을 모두 열었어요'}
                description={statusCopy?.description ?? '공개한 카드는 컬렉션에서 다시 볼 수 있어요.'}
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

        {cardsData?.weeklyDiscovery ? (
          <WeeklyDiscoveryCollection
            discovery={cardsData.weeklyDiscovery}
            onPressCard={(eventId) => navigation.navigate('/events/:id', { id: eventId })}
            onOpenCollection={() => navigation.navigate('/passport')}
          />
        ) : null}

        {cardsData?.personalization && cardsData.personalization.signalCount > 0 ? (
          <TasteCompass profile={cardsData.personalization} />
        ) : null}

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
