import { createRoute, ScrollViewInertialBackground } from '@granite-js/react-native';
import { useDialog } from '@toss/tds-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BottomTabBar } from '../components/BottomTabBar';
import {
  CollectionOverviewSections,
  filterCollectionCards,
  getCollectionCardStatus,
  type CollectionCardFilter,
  type CollectionOverviewCard,
  type CollectionVisitRecord,
} from '../components/passport/CollectionOverviewSections';
import { SavedVisitToast, type SavedVisitToastMessage } from '../components/saved/SavedVisitToast';
import { useAuth } from '../hooks/useAuth';
import http from '../lib/http';
import {
  getDiscoveredCards,
  getPassport,
  type PassportCollectionStatus,
  type PassportDiscoveredCard,
  type PassportDiscoveredPageInfo,
  type PassportResponse,
  type PassportStamp,
} from '../services/passportService';
import userEventService from '../services/userEventService';
import { markVisited, unmarkVisited } from '../services/visitService';
import type { GetLikesResponse } from '../types/serverSync';
import { openNaverMap } from '../utils/mapLinks';
import { getLikesV2, subscribeStorageChange, toggleLike } from '../utils/storage';

export const Route = createRoute('/passport', {
  component: PassportPage,
});

const BG = '#F7F5EF';
const TEXT = '#171717';
const MUTED = '#716D66';
const RED = '#A52822';
const PAGE_SIZE = 100;
const OPENED_PREVIEW_STEP = 12;
const VISIT_PREVIEW_STEP = 6;

type CollectionSessionCache = {
  passport: PassportResponse;
  openedCards: PassportDiscoveredCard[];
  pageInfo: PassportDiscoveredPageInfo | null;
  visitStamps: PassportStamp[];
  nextStampBook: number;
  savedEventIds: string[];
  visitedEventIds: string[];
  openedPreviewLimit: number;
  visitPreviewLimit: number;
  activeFilter: CollectionCardFilter;
  fetchedAt: number;
};

const collectionSessionCache = new Map<string, CollectionSessionCache>();

function collectionCacheKey(isLoggedIn: boolean, userId?: string): string {
  return isLoggedIn && userId ? `user:${userId}` : 'guest';
}

function addId(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
  setter((previous) => {
    if (previous.has(id)) return previous;
    const next = new Set(previous);
    next.add(id);
    return next;
  });
}

function removeId(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
  setter((previous) => {
    if (!previous.has(id)) return previous;
    const next = new Set(previous);
    next.delete(id);
    return next;
  });
}

function toLastKnownStatus(status: PassportCollectionStatus | undefined): CollectionOverviewCard['lastKnownStatus'] {
  if (status === 'removed') return 'deleted';
  if (status === 'ended') return 'ended';
  return 'active';
}

function uniqueDiscoveredCards(cards: readonly PassportDiscoveredCard[]): PassportDiscoveredCard[] {
  return Array.from(new Map(cards.map((card) => [card.eventId, card])).values());
}

function mergeDiscoveredCards(
  previous: readonly PassportDiscoveredCard[],
  incoming: readonly PassportDiscoveredCard[]
): PassportDiscoveredCard[] {
  return uniqueDiscoveredCards([...previous, ...incoming]);
}

function mergeStamps(previous: readonly PassportStamp[], incoming: readonly PassportStamp[]): PassportStamp[] {
  const byKey = new Map<string, PassportStamp>();
  for (const stamp of [...previous, ...incoming]) {
    byKey.set(`${stamp.eventId}:${stamp.visitedAt}`, stamp);
  }
  return Array.from(byKey.values()).sort((a, b) => new Date(b.visitedAt).getTime() - new Date(a.visitedAt).getTime());
}

function discoveredCardMatchesFilter(
  card: PassportDiscoveredCard,
  filter: CollectionCardFilter,
  savedIds: ReadonlySet<string>,
  referenceDate: Date
): boolean {
  if (filter === 'all') return true;
  if (filter === 'saved') return savedIds.has(card.eventId);
  const status = getCollectionCardStatus(
    { endAt: card.endAt, lastKnownStatus: toLastKnownStatus(card.status) },
    referenceDate
  );
  return filter === 'active' ? status === 'active' : status !== 'active';
}

async function loadSavedEventIds(isLoggedIn: boolean): Promise<Set<string>> {
  const local = await getLikesV2();
  if (!isLoggedIn) return new Set(local.items.map((item) => item.id));
  try {
    const { data } = await http.get<GetLikesResponse>('/users/me/likes');
    return new Set(data.items.map((item) => item.eventId));
  } catch {
    return new Set(local.items.map((item) => item.id));
  }
}

function PassportPage() {
  const navigation = Route.useNavigation();
  const dialog = useDialog();
  const { isLoggedIn, user, isLoading: authLoading } = useAuth();
  const initialCacheKey = collectionCacheKey(isLoggedIn, user?.id);
  const initialCacheRef = useRef<CollectionSessionCache | null>(
    authLoading ? null : collectionSessionCache.get(initialCacheKey) ?? null
  );
  const initialCache = initialCacheRef.current;
  const activeCacheKeyRef = useRef(initialCacheKey);
  const lastFetchedAtRef = useRef(initialCache?.fetchedAt ?? 0);
  const savingIdsRef = useRef(new Set<string>());
  const markingIdsRef = useRef(new Set<string>());
  const toastOpacity = useRef(new Animated.Value(0));
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [passport, setPassport] = useState<PassportResponse | null>(initialCache?.passport ?? null);
  const [openedCards, setOpenedCards] = useState<PassportDiscoveredCard[]>(() => initialCache?.openedCards ?? []);
  const [pageInfo, setPageInfo] = useState<PassportDiscoveredPageInfo | null>(initialCache?.pageInfo ?? null);
  const [visitStamps, setVisitStamps] = useState<PassportStamp[]>(() => initialCache?.visitStamps ?? []);
  const [nextStampBook, setNextStampBook] = useState(initialCache?.nextStampBook ?? 2);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set(initialCache?.savedEventIds ?? []));
  const [visitedIds, setVisitedIds] = useState<Set<string>>(() => new Set(initialCache?.visitedEventIds ?? []));
  const [loading, setLoading] = useState(!initialCache);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMoreOpened, setLoadingMoreOpened] = useState(false);
  const [loadingMoreVisits, setLoadingMoreVisits] = useState(false);
  const [openedPreviewLimit, setOpenedPreviewLimit] = useState(
    initialCache?.openedPreviewLimit ?? OPENED_PREVIEW_STEP
  );
  const [visitPreviewLimit, setVisitPreviewLimit] = useState(initialCache?.visitPreviewLimit ?? VISIT_PREVIEW_STEP);
  const [activeFilter, setActiveFilter] = useState<CollectionCardFilter>(initialCache?.activeFilter ?? 'all');
  const [referenceDate, setReferenceDate] = useState(() => new Date());
  const [toastMessage, setToastMessage] = useState<SavedVisitToastMessage | null>(null);
  const [dataOwnerKey, setDataOwnerKey] = useState<string | null>(initialCache ? initialCacheKey : null);
  const openedCardsRef = useRef(openedCards);
  const pageInfoRef = useRef(pageInfo);
  openedCardsRef.current = openedCards;
  pageInfoRef.current = pageInfo;

  const showToast = useCallback((message: SavedVisitToastMessage) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    toastOpacity.current.stopAnimation();
    toastOpacity.current.setValue(0);
    Animated.timing(toastOpacity.current, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
    toastTimerRef.current = setTimeout(() => {
      Animated.timing(toastOpacity.current, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start(() => setToastMessage(null));
    }, 2600);
  }, []);

  const hydrateCollectionCache = useCallback((key: string, cache: CollectionSessionCache) => {
    activeCacheKeyRef.current = key;
    lastFetchedAtRef.current = cache.fetchedAt;
    openedCardsRef.current = cache.openedCards;
    pageInfoRef.current = cache.pageInfo;
    setPassport(cache.passport);
    setOpenedCards(cache.openedCards);
    setPageInfo(cache.pageInfo);
    setVisitStamps(cache.visitStamps);
    setNextStampBook(cache.nextStampBook);
    setSavedIds(new Set(cache.savedEventIds));
    setVisitedIds(new Set(cache.visitedEventIds));
    setOpenedPreviewLimit(cache.openedPreviewLimit);
    setVisitPreviewLimit(cache.visitPreviewLimit);
    setActiveFilter(cache.activeFilter);
    setDataOwnerKey(key);
    setLoadingMoreOpened(false);
    setLoadingMoreVisits(false);
    setError(false);
    setLoading(false);
  }, []);

  const loadCollection = useCallback(
    async ({ preservePages = false }: { preservePages?: boolean } = {}) => {
      const requestKey = collectionCacheKey(isLoggedIn, user?.id);
      setError(false);
      try {
        const [nextPassport, nextSavedIds] = await Promise.all([
          getPassport({ stampBook: 1, discoveredLimit: PAGE_SIZE }),
          loadSavedEventIds(isLoggedIn),
        ]);
        if (activeCacheKeyRef.current !== requestKey) return;

        const nextVisitedIds = new Set(nextPassport.visitedEventIds.map(String));
        const nextRootPageInfo = nextPassport.discoveredPageInfo ?? {
          limit: PAGE_SIZE,
          // 구버전 서버는 cursor를 발급하지 않으므로 눌러도 동작하지 않는
          // "더 보기"를 노출하지 않는다. 백엔드와 함께 배포되면 pageInfo가 온다.
          hasMore: false,
          nextCursor: null,
        };
        const hasPreservedPages = preservePages
          && openedCardsRef.current.length > nextPassport.discoveredCards.length;

        setPassport(nextPassport);
        setSavedIds(nextSavedIds);
        setVisitedIds(nextVisitedIds);
        setVisitStamps((previous) =>
          preservePages
            ? mergeStamps(
                previous.filter((stamp) => nextVisitedIds.has(stamp.eventId)),
                nextPassport.stamps
              )
            : nextPassport.stamps
        );
        if (!preservePages) setNextStampBook(2);
        if (preservePages) {
          setOpenedCards((previous) => mergeDiscoveredCards(previous, nextPassport.discoveredCards));
        } else {
          setOpenedCards(uniqueDiscoveredCards(nextPassport.discoveredCards));
          setOpenedPreviewLimit(OPENED_PREVIEW_STEP);
          setVisitPreviewLimit(VISIT_PREVIEW_STEP);
        }
        setPageInfo(hasPreservedPages ? pageInfoRef.current ?? nextRootPageInfo : nextRootPageInfo);
        lastFetchedAtRef.current = Date.now();
        setDataOwnerKey(requestKey);
      } catch (loadError) {
        if (activeCacheKeyRef.current === requestKey) setError(true);
        if (__DEV__) console.error('[PassportPage][loadCollection]', loadError);
      } finally {
        if (activeCacheKeyRef.current === requestKey) setLoading(false);
      }
    },
    [isLoggedIn, user?.id]
  );

  useEffect(() => {
    if (authLoading) return;
    const nextKey = collectionCacheKey(isLoggedIn, user?.id);
    const cached = collectionSessionCache.get(nextKey);
    activeCacheKeyRef.current = nextKey;

    if (cached) {
      hydrateCollectionCache(nextKey, cached);
      // 화면은 캐시로 즉시 그리고, 새 공개/저장/방문 상태는 뒤에서 맞춘다.
      loadCollection({ preservePages: true }).catch(() => {});
      return;
    }

    openedCardsRef.current = [];
    pageInfoRef.current = null;
    setPassport(null);
    setOpenedCards([]);
    setPageInfo(null);
    setVisitStamps([]);
    setNextStampBook(2);
    setSavedIds(new Set());
    setVisitedIds(new Set());
    setOpenedPreviewLimit(OPENED_PREVIEW_STEP);
    setVisitPreviewLimit(VISIT_PREVIEW_STEP);
    setActiveFilter('all');
    setLoadingMoreOpened(false);
    setLoadingMoreVisits(false);
    setDataOwnerKey(null);
    setError(false);
    setLoading(true);
    loadCollection().catch(() => {});
  }, [authLoading, hydrateCollectionCache, isLoggedIn, loadCollection, user?.id]);

  useEffect(() => {
    if (authLoading || !passport) return;
    const currentKey = collectionCacheKey(isLoggedIn, user?.id);
    if (dataOwnerKey !== currentKey || activeCacheKeyRef.current !== currentKey) return;
    collectionSessionCache.set(currentKey, {
      passport,
      openedCards: [...openedCards],
      pageInfo,
      visitStamps: [...visitStamps],
      nextStampBook,
      savedEventIds: [...savedIds],
      visitedEventIds: [...visitedIds],
      openedPreviewLimit,
      visitPreviewLimit,
      activeFilter,
      fetchedAt: lastFetchedAtRef.current || Date.now(),
    });
  }, [
    activeFilter,
    authLoading,
    dataOwnerKey,
    isLoggedIn,
    nextStampBook,
    openedCards,
    openedPreviewLimit,
    pageInfo,
    passport,
    savedIds,
    user?.id,
    visitPreviewLimit,
    visitStamps,
    visitedIds,
  ]);

  useEffect(() => {
    const unsubscribe = subscribeStorageChange((event) => {
      if (event.type !== 'likes') return;
      const requestKey = collectionCacheKey(isLoggedIn, user?.id);
      loadSavedEventIds(isLoggedIn)
        .then((next) => {
          if (activeCacheKeyRef.current === requestKey) setSavedIds(next);
        })
        .catch(() => {});
    });
    return unsubscribe;
  }, [isLoggedIn, user?.id]);

  useEffect(() => {
    let midnightTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleMidnightRefresh = () => {
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      midnightTimer = setTimeout(() => {
        setReferenceDate(new Date());
        scheduleMidnightRefresh();
      }, Math.max(1_000, nextMidnight.getTime() - now.getTime() + 250));
    };
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setReferenceDate(new Date());
    });
    scheduleMidnightRefresh();
    return () => {
      if (midnightTimer) clearTimeout(midnightTimer);
      appStateSubscription.remove();
    };
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    []
  );

  const visitDateById = useMemo(
    () => new Map(visitStamps.map((stamp) => [stamp.eventId, stamp.visitedAt])),
    [visitStamps]
  );

  const overviewCards = useMemo<CollectionOverviewCard[]>(
    () =>
      openedCards.map((card) => ({
        id: card.eventId,
        title: card.title,
        category: card.category,
        region: card.region,
        venue: card.venue,
        imageUrl: card.imageUrl,
        startAt: card.startAt,
        endAt: card.endAt,
        lat: card.lat,
        lng: card.lng,
        lastKnownStatus: toLastKnownStatus(card.status),
        openedAt: card.discoveredAt,
        isSaved: savedIds.has(card.eventId),
        isVisited: visitedIds.has(card.eventId),
        visitedAt: visitDateById.get(card.eventId) ?? null,
      })),
    [openedCards, savedIds, visitDateById, visitedIds]
  );

  const visitRecords = useMemo<CollectionVisitRecord[]>(
    () =>
      visitStamps.map((stamp) => ({
        eventId: stamp.eventId,
        title: stamp.title,
        category: stamp.category,
        region: stamp.region,
        venue: stamp.venue,
        imageUrl: stamp.imageUrl,
        visitedAt: stamp.visitedAt,
        status: stamp.status,
      })),
    [visitStamps]
  );
  const savedOpenedCount = useMemo(() => overviewCards.filter((card) => card.isSaved).length, [overviewCards]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadCollection();
    } finally {
      setRefreshing(false);
    }
  }, [loadCollection]);

  const syncLocalLikeState = useCallback(async (card: CollectionOverviewCard, shouldSave: boolean) => {
    const likes = await getLikesV2();
    const exists = likes.items.some((item) => item.id === card.id);
    if (exists === shouldSave) return;
    await toggleLike(card.id, {
      title: card.title,
      startAt: card.startAt ?? undefined,
      endAt: card.endAt ?? undefined,
      venue: card.venue ?? undefined,
      region: card.region ?? undefined,
      imageUrl: card.imageUrl ?? undefined,
      mainCategory: card.category ?? undefined,
      subCategory: card.subCategory ?? undefined,
    });
  }, []);

  const handleToggleSave = useCallback(
    async (card: CollectionOverviewCard) => {
      if (savingIdsRef.current.has(card.id)) return;
      savingIdsRef.current.add(card.id);
      const shouldSave = !savedIds.has(card.id);
      if (shouldSave) addId(setSavedIds, card.id);
      else removeId(setSavedIds, card.id);
      try {
        if (isLoggedIn) {
          if (shouldSave) await http.post(`/users/me/likes/${card.id}`);
          else await http.delete(`/users/me/likes/${card.id}`);
        }
        await syncLocalLikeState(card, shouldSave);
        if (shouldSave) userEventService.logEventSave(card.id).catch(() => {});
        else userEventService.logEventUnsave(card.id).catch(() => {});
        showToast({ title: shouldSave ? '가고 싶어요에 저장했어요' : '저장을 취소했어요' });
      } catch (saveError) {
        if (shouldSave) removeId(setSavedIds, card.id);
        else addId(setSavedIds, card.id);
        showToast({ title: '저장 상태를 바꾸지 못했어요', description: '잠시 후 다시 시도해 주세요.' });
        if (__DEV__) console.error('[PassportPage][toggleSave]', saveError);
      } finally {
        savingIdsRef.current.delete(card.id);
      }
    },
    [isLoggedIn, savedIds, showToast, syncLocalLikeState]
  );

  const handleToggleVisit = useCallback(
    async (card: CollectionOverviewCard) => {
      if (markingIdsRef.current.has(card.id)) return;
      if (!isLoggedIn) {
        await dialog.openAlert({
          title: '로그인하면 방문 기록을 남길 수 있어요',
          description: '다녀온 문화는 계정의 컬렉션에 안전하게 보관돼요.',
        });
        return;
      }

      markingIdsRef.current.add(card.id);
      const wasVisited = visitedIds.has(card.id);
      if (wasVisited) removeId(setVisitedIds, card.id);
      else addId(setVisitedIds, card.id);
      try {
        if (wasVisited) await unmarkVisited(card.id);
        else await markVisited(card.id);
        await loadCollection({ preservePages: true });
        showToast({
          title: wasVisited ? '방문 기록을 취소했어요' : '컬렉션에 방문 기록을 남겼어요',
          description: wasVisited ? undefined : '위치 인증 없이 추억으로 남겨요.',
        });
      } catch (visitError) {
        if (wasVisited) addId(setVisitedIds, card.id);
        else removeId(setVisitedIds, card.id);
        showToast({ title: '방문 기록을 바꾸지 못했어요', description: '잠시 후 다시 시도해 주세요.' });
        if (__DEV__) console.error('[PassportPage][toggleVisit]', visitError);
      } finally {
        markingIdsRef.current.delete(card.id);
      }
    },
    [dialog, isLoggedIn, loadCollection, showToast, visitedIds]
  );

  const handleDirections = useCallback(
    async (card: CollectionOverviewCard) => {
      const placeName = [card.venue, card.region].filter(Boolean).join(' ');
      if (!placeName) {
        showToast({ title: '장소 정보가 아직 없어요' });
        return;
      }
      try {
        if (typeof card.lat === 'number' && typeof card.lng === 'number') {
          await openNaverMap(card.lat, card.lng, placeName);
        } else {
          await Linking.openURL(`https://map.naver.com/v5/search/${encodeURIComponent(placeName)}`);
        }
      } catch {
        showToast({ title: '길찾기를 열지 못했어요', description: '잠시 후 다시 시도해 주세요.' });
      }
    },
    [showToast]
  );

  const handleViewMoreOpened = useCallback(
    async (filter: CollectionCardFilter) => {
      if (loadingMoreOpened) return;
      const filteredCount = filterCollectionCards(overviewCards, filter, referenceDate).length;
      if (openedPreviewLimit < filteredCount) {
        setOpenedPreviewLimit((previous) => previous + OPENED_PREVIEW_STEP);
        return;
      }
      if (!pageInfo?.hasMore || !pageInfo.nextCursor) return;

      const requestKey = activeCacheKeyRef.current;
      setLoadingMoreOpened(true);
      try {
        let mergedCards = openedCardsRef.current;
        let nextPageInfo = pageInfo;
        let nextCursor: string | null = pageInfo.nextCursor;
        const visibleBefore = mergedCards.filter((card) => (
          discoveredCardMatchesFilter(card, filter, savedIds, referenceDate)
        )).length;

        // 저장/지난 문화처럼 희소한 필터는 다음 한 묶음에 결과가 없을 수 있다.
        // 한 번의 탭에서 최대 세 묶음까지 찾아 체감상 무반응인 경로를 줄인다.
        for (let attempt = 0; attempt < 3 && nextCursor; attempt += 1) {
          const requestedCursor: string = nextCursor;
          const next = await getDiscoveredCards({ limit: PAGE_SIZE, cursor: requestedCursor });
          if (activeCacheKeyRef.current !== requestKey) return;
          mergedCards = mergeDiscoveredCards(mergedCards, next.items);
          nextPageInfo = next.pageInfo;
          nextCursor = next.pageInfo.hasMore ? next.pageInfo.nextCursor : null;

          const visibleAfter = mergedCards.filter((card) => (
            discoveredCardMatchesFilter(card, filter, savedIds, referenceDate)
          )).length;
          if (visibleAfter > visibleBefore || !nextPageInfo.hasMore) break;
          if (!nextCursor || nextCursor === requestedCursor) break;
        }

        const visibleAfter = mergedCards.filter((card) => (
          discoveredCardMatchesFilter(card, filter, savedIds, referenceDate)
        )).length;
        openedCardsRef.current = mergedCards;
        pageInfoRef.current = nextPageInfo;
        setOpenedCards(mergedCards);
        setPageInfo(nextPageInfo);
        if (visibleAfter > visibleBefore) {
          setOpenedPreviewLimit((previous) => previous + OPENED_PREVIEW_STEP);
        } else {
          showToast({
            title: nextPageInfo.hasMore ? '이 조건의 카드를 더 찾고 있어요' : '이 조건의 카드는 여기까지예요',
            description: nextPageInfo.hasMore ? '버튼을 한 번 더 누르면 더 지난 기록을 찾아봐요.' : undefined,
          });
        }
      } catch (paginationError) {
        showToast({ title: '지난 카드를 더 불러오지 못했어요' });
        if (__DEV__) console.error('[PassportPage][loadMoreOpened]', paginationError);
      } finally {
        setLoadingMoreOpened(false);
      }
    },
    [
      loadingMoreOpened,
      openedPreviewLimit,
      overviewCards,
      pageInfo,
      referenceDate,
      savedIds,
      showToast,
    ]
  );

  const handleViewMoreVisits = useCallback(async () => {
    if (loadingMoreVisits) return;
    if (visitPreviewLimit < visitStamps.length) {
      setVisitPreviewLimit((previous) => previous + VISIT_PREVIEW_STEP);
      return;
    }
    if (!passport || nextStampBook > passport.stampBookCount) return;

    const requestKey = activeCacheKeyRef.current;
    setLoadingMoreVisits(true);
    try {
      const next = await getPassport({ stampBook: nextStampBook, discoveredLimit: 1 });
      if (activeCacheKeyRef.current !== requestKey) return;
      const merged = mergeStamps(visitStamps, next.stamps);
      setVisitStamps(merged);
      setPassport((previous) => previous ? {
        ...previous,
        visitedCount: next.visitedCount,
        stampBookCount: next.stampBookCount,
      } : next);
      setNextStampBook((previous) => previous + 1);
      if (merged.length > visitStamps.length) {
        setVisitPreviewLimit((previous) => previous + VISIT_PREVIEW_STEP);
      } else {
        showToast({ title: '방문 기록은 여기까지예요' });
      }
    } catch (paginationError) {
      showToast({ title: '지난 방문 기록을 더 불러오지 못했어요' });
      if (__DEV__) console.error('[PassportPage][loadMoreVisits]', paginationError);
    } finally {
      setLoadingMoreVisits(false);
    }
  }, [loadingMoreVisits, nextStampBook, passport, showToast, visitPreviewLimit, visitStamps]);

  const hasMoreVisits = Boolean(
    visitPreviewLimit < visitStamps.length || (passport && nextStampBook <= passport.stampBookCount)
  );

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={MUTED} />}
      >
        <ScrollViewInertialBackground topColor={BG} bottomColor={BG} />

        <Text style={styles.navEyebrow}>THE CULTURE ARCHIVE</Text>
        <Text style={styles.navTitle}>나의 컬렉션</Text>
        <Text style={styles.navDescription}>내가 연 카드에서 다음 문화를 고르고, 다녀온 기억까지 남겨요.</Text>

        <View style={styles.summaryCard}>
          <View style={styles.summaryMain}>
            <Text style={styles.summaryValue}>{passport?.discoveredCount ?? openedCards.length}</Text>
            <Text style={styles.summaryLabel}>장의 문화 카드</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryMetric}>
            <Text style={styles.summaryMetricValue}>{passport?.visitedCount ?? visitedIds.size}</Text>
            <Text style={styles.summaryMetricLabel}>방문</Text>
          </View>
          <View style={styles.summaryMetric}>
            <Text style={styles.summaryMetricValue}>{savedOpenedCount}</Text>
            <Text style={styles.summaryMetricLabel}>저장</Text>
          </View>
        </View>

        {loading && openedCards.length === 0 ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={RED} />
            <Text style={styles.stateTitle}>컬렉션을 불러오고 있어요</Text>
          </View>
        ) : error && openedCards.length === 0 ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>컬렉션을 불러오지 못했어요</Text>
            <Text style={styles.stateDescription}>잠시 후 다시 확인해 주세요.</Text>
            <Pressable accessibilityRole="button" onPress={() => loadCollection()} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>다시 불러오기</Text>
            </Pressable>
          </View>
        ) : (
          <CollectionOverviewSections
            openedCards={overviewCards}
            visitRecords={visitRecords}
            filter={activeFilter}
            onFilterChange={(next) => {
              setActiveFilter(next);
              setOpenedPreviewLimit(OPENED_PREVIEW_STEP);
            }}
            openedPreviewLimit={openedPreviewLimit}
            visitPreviewLimit={visitPreviewLimit}
            referenceDate={referenceDate}
            hasMoreOpened={Boolean(pageInfo?.hasMore && pageInfo.nextCursor)}
            isLoadingMoreOpened={loadingMoreOpened}
            hasMoreVisits={hasMoreVisits}
            isLoadingMoreVisits={loadingMoreVisits}
            onPressActiveCard={(card) => navigation.navigate('/events/:id', { id: card.id })}
            onToggleSave={handleToggleSave}
            onToggleVisit={handleToggleVisit}
            onDirections={handleDirections}
            onViewAllOpened={handleViewMoreOpened}
            onViewAllVisits={hasMoreVisits ? handleViewMoreVisits : undefined}
            onOpenNewCard={() => (navigation.replace as (route: string) => void)('/')}
          />
        )}
      </ScrollView>

      <SavedVisitToast message={toastMessage} opacity={toastOpacity.current} />
      <BottomTabBar currentTab="passport" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 124 },
  navEyebrow: { color: RED, fontSize: 10.5, lineHeight: 14, fontWeight: '900', letterSpacing: 1.6 },
  navTitle: {
    marginTop: 5,
    color: TEXT,
    fontSize: 34,
    lineHeight: 41,
    fontWeight: '900',
    letterSpacing: -1,
    fontFamily: 'Noto Serif KR',
  },
  navDescription: { marginTop: 4, color: MUTED, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  summaryCard: {
    marginTop: 20,
    marginBottom: 32,
    minHeight: 92,
    borderRadius: 22,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFE9D8',
    borderWidth: 1,
    borderColor: '#E0D6BE',
  },
  summaryMain: { flex: 1, minWidth: 0 },
  summaryValue: { color: TEXT, fontSize: 28, lineHeight: 34, fontWeight: '900', fontFamily: 'Noto Serif KR' },
  summaryLabel: { marginTop: 1, color: MUTED, fontSize: 10.5, fontWeight: '800' },
  summaryDivider: { width: 1, height: 42, marginHorizontal: 14, backgroundColor: '#D4C9AF' },
  summaryMetric: { width: 48, alignItems: 'center' },
  summaryMetricValue: { color: RED, fontSize: 18, lineHeight: 24, fontWeight: '900' },
  summaryMetricLabel: { marginTop: 2, color: MUTED, fontSize: 9.5, fontWeight: '800' },
  stateCard: {
    minHeight: 240,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
    backgroundColor: '#EFE9D8',
  },
  stateTitle: { marginTop: 12, color: TEXT, fontSize: 16, lineHeight: 22, fontWeight: '900', textAlign: 'center' },
  stateDescription: {
    marginTop: 5,
    color: MUTED,
    fontSize: 11.5,
    lineHeight: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    minHeight: 44,
    borderRadius: 999,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: RED,
  },
  retryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
});

export default PassportPage;
