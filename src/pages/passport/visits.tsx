import { createRoute } from '@granite-js/react-native';
import { useSafeAreaInsets } from '@granite-js/native/react-native-safe-area-context';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import {
  CollectionArchiveSnapshotModal,
  CollectionPosterCard,
  type CollectionOverviewCard,
} from '../../components/passport/CollectionOverviewSections';
import { prefetchCollectionImageUrls } from '../../components/passport/CachedCollectionImageBackground';
import { mergeVisitStamps, uniqueDiscoveredCards } from '../../components/passport/collectionData';
import { useAuth } from '../../hooks/useAuth';
import {
  getCollectionSession,
  getCollectionSessionKey,
  setCollectionSession,
  updateCollectionSession,
  type CollectionSessionCache,
} from '../../lib/collectionSessionCache';
import {
  getPassport,
  type PassportResponse,
  type PassportStamp,
} from '../../services/passportService';
import { subscribeVisitChange } from '../../services/visitService';

export const Route = createRoute('/passport/visits', {
  component: PassportVisitsPage,
});

const BG = '#F7F5EF';
const TEXT = '#171717';
const MUTED = '#716D66';
const RED = '#A52822';
const PAPER = '#EFE9D8';
const BORDER = '#DDD4C1';

type FirstPageRequest = { key: string; id: number };
type OlderPageRequest = { key: string; book: number };

function mergeAndSortStamps(
  previous: readonly PassportStamp[],
  incoming: readonly PassportStamp[],
): PassportStamp[] {
  return mergeVisitStamps(previous, incoming);
}

function stampToOverviewCard(stamp: PassportStamp): CollectionOverviewCard {
  return {
    id: stamp.eventId,
    title: stamp.title,
    category: stamp.category,
    region: stamp.region,
    venue: stamp.venue,
    imageUrl: stamp.imageUrl,
    startAt: null,
    endAt: null,
    lastKnownStatus: stamp.status === 'removed'
      ? 'deleted'
      : stamp.status === 'ended'
        ? 'ended'
        : 'active',
    openedAt: null,
    isSaved: false,
    isVisited: true,
    visitedAt: stamp.visitedAt,
  };
}

function updateVisitCache(
  key: string,
  response: PassportResponse,
  stamps: PassportStamp[],
  nextStampBook: number,
  firstPage: boolean,
) {
  const cached = getCollectionSession(key);
  if (!cached) {
    setCollectionSession(key, {
      passport: response,
      openedCards: uniqueDiscoveredCards(response.discoveredCards),
      pageInfo: response.discoveredPageInfo ?? null,
      visitStamps: stamps,
      nextStampBook,
      savedEventIds: [],
      visitedEventIds: response.visitedEventIds.map(String),
      fetchedAt: Date.now(),
    });
    return;
  }

  updateCollectionSession(key, (current) => ({
    ...current,
    passport: firstPage
      ? {
          ...response,
          discoveredCards: current.passport.discoveredCards,
          discoveredPageInfo: current.passport.discoveredPageInfo,
        }
      : {
          ...current.passport,
          visitedCount: response.visitedCount,
          monthVisited: response.monthVisited,
          regionsVisited: response.regionsVisited,
          topRegions: response.topRegions,
          tasteCategories: response.tasteCategories,
          stampBookCount: response.stampBookCount,
          stampBookSize: response.stampBookSize,
          visitedEventIds: response.visitedEventIds,
        },
    visitStamps: stamps,
    nextStampBook,
    visitedEventIds: response.visitedEventIds.map(String),
    fetchedAt: Date.now(),
  }));
}

function hydrateFromCache(
  cache: CollectionSessionCache,
  setPassport: React.Dispatch<React.SetStateAction<PassportResponse | null>>,
  setStamps: React.Dispatch<React.SetStateAction<PassportStamp[]>>,
  setNextStampBook: React.Dispatch<React.SetStateAction<number>>,
) {
  const nextStamps = mergeAndSortStamps([], cache.visitStamps);
  setPassport(cache.passport);
  setStamps(nextStamps);
  setNextStampBook(cache.nextStampBook);
  return { stamps: nextStamps, nextStampBook: cache.nextStampBook };
}

export function PassportVisitsPage() {
  const navigation = Route.useNavigation();
  const { top, bottom } = useSafeAreaInsets();
  const { isLoggedIn, user, isLoading: authLoading } = useAuth();
  const initialKey = authLoading ? null : getCollectionSessionKey(isLoggedIn, user?.id);
  const initialCacheRef = useRef<CollectionSessionCache | null>(
    initialKey ? getCollectionSession(initialKey) : null,
  );
  const initialCache = initialCacheRef.current;

  const [passport, setPassport] = useState<PassportResponse | null>(initialCache?.passport ?? null);
  const [stamps, setStamps] = useState<PassportStamp[]>(() =>
    mergeAndSortStamps([], initialCache?.visitStamps ?? []),
  );
  const [nextStampBook, setNextStampBook] = useState(initialCache?.nextStampBook ?? 2);
  const [loading, setLoading] = useState(!initialCache);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveCard, setArchiveCard] = useState<CollectionOverviewCard | null>(null);
  const [dataOwnerKey, setDataOwnerKey] = useState<string | null>(initialCache ? initialKey : null);
  const [referenceDate] = useState(() => new Date());

  const ownerKeyRef = useRef<string | null>(initialKey);
  const stampsRef = useRef(stamps);
  const nextStampBookRef = useRef(nextStampBook);
  const requestSequenceRef = useRef(0);
  const firstPageRequestRef = useRef<FirstPageRequest | null>(null);
  const olderPageRequestRef = useRef<OlderPageRequest | null>(null);

  stampsRef.current = stamps;
  nextStampBookRef.current = nextStampBook;

  const loadFirstPage = useCallback(
    async (key: string, preserveLoadedBooks: boolean, showInitialLoader: boolean) => {
      if (firstPageRequestRef.current?.key === key) return;
      if (olderPageRequestRef.current?.key === key) return;

      const request = { key, id: ++requestSequenceRef.current };
      firstPageRequestRef.current = request;
      if (showInitialLoader) setLoading(true);
      setError(null);

      try {
        const response = await getPassport({ stampBook: 1, discoveredLimit: 1 });
        if (ownerKeyRef.current !== key || firstPageRequestRef.current?.id !== request.id) return;

        const validVisitedIds = new Set(response.visitedEventIds.map(String));
        const retained = preserveLoadedBooks
          ? stampsRef.current.filter((stamp) => validVisitedIds.has(stamp.eventId))
          : [];
        const nextStamps = mergeAndSortStamps(retained, response.stamps);
        const nextBook = preserveLoadedBooks ? nextStampBookRef.current : 2;

        stampsRef.current = nextStamps;
        nextStampBookRef.current = nextBook;
        setPassport(response);
        setStamps(nextStamps);
        setNextStampBook(nextBook);
        updateVisitCache(key, response, nextStamps, nextBook, true);
      } catch (loadError) {
        if (ownerKeyRef.current !== key) return;
        setError(stampsRef.current.length > 0
          ? '최신 방문 기록을 확인하지 못했어요.'
          : '방문 기록을 불러오지 못했어요.');
        if (__DEV__) console.error('[PassportVisitsPage][loadFirstPage]', loadError);
      } finally {
        if (firstPageRequestRef.current?.id === request.id) firstPageRequestRef.current = null;
        if (ownerKeyRef.current === key) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (authLoading) return;

    const key = getCollectionSessionKey(isLoggedIn, user?.id);
    const cache = getCollectionSession(key);
    ownerKeyRef.current = key;
    setDataOwnerKey(cache ? key : null);
    setError(null);
    setArchiveCard(null);

    if (cache) {
      const hydrated = hydrateFromCache(cache, setPassport, setStamps, setNextStampBook);
      stampsRef.current = hydrated.stamps;
      nextStampBookRef.current = hydrated.nextStampBook;
      setLoading(false);
      setDataOwnerKey(key);
      loadFirstPage(key, true, false).catch(() => {});
      return;
    }

    stampsRef.current = [];
    nextStampBookRef.current = 2;
    setPassport(null);
    setStamps([]);
    setNextStampBook(2);
    setDataOwnerKey(key);
    setLoading(true);
    loadFirstPage(key, false, true).catch(() => {});
  }, [authLoading, isLoggedIn, loadFirstPage, user?.id]);

  useEffect(() => {
    return subscribeVisitChange((event) => {
      const key = ownerKeyRef.current;
      if (!key) return;
      if (!event.visited) {
        const nextStamps = stampsRef.current.filter((stamp) => stamp.eventId !== event.eventId);
        stampsRef.current = nextStamps;
        setStamps(nextStamps);
        updateCollectionSession(key, (current) => ({
          ...current,
          visitStamps: nextStamps,
          visitedEventIds: current.visitedEventIds.filter((id) => id !== event.eventId),
          fetchedAt: Date.now(),
        }));
      }
      loadFirstPage(key, true, false).catch(() => {});
    });
  }, [loadFirstPage]);

  useEffect(() => {
    return navigation.addListener('focus', () => {
      if (authLoading) return;
      const key = getCollectionSessionKey(isLoggedIn, user?.id);
      const cache = getCollectionSession(key);
      if (cache) {
        const hydrated = hydrateFromCache(cache, setPassport, setStamps, setNextStampBook);
        stampsRef.current = hydrated.stamps;
        nextStampBookRef.current = hydrated.nextStampBook;
        ownerKeyRef.current = key;
        setDataOwnerKey(key);
      }
      loadFirstPage(key, true, false).catch(() => {});
    });
  }, [authLoading, isLoggedIn, loadFirstPage, navigation, user?.id]);

  useEffect(() => {
    prefetchCollectionImageUrls(stamps.slice(0, 40).map((stamp) => stamp.imageUrl)).catch(() => {});
  }, [stamps]);

  const refresh = useCallback(async () => {
    const key = ownerKeyRef.current;
    if (!key || firstPageRequestRef.current?.key === key || olderPageRequestRef.current?.key === key) return;
    setRefreshing(true);
    try {
      // 새 방문/취소로 페이지 경계가 이동할 수 있으므로 새로고침은 1권부터 다시 시작한다.
      await loadFirstPage(key, false, false);
    } finally {
      if (ownerKeyRef.current === key) setRefreshing(false);
    }
  }, [loadFirstPage]);

  const loadOlder = useCallback(async () => {
    const key = ownerKeyRef.current;
    const nextBook = nextStampBookRef.current;
    if (!key || !passport || nextBook > passport.stampBookCount) return;
    if (olderPageRequestRef.current || firstPageRequestRef.current?.key === key) return;

    olderPageRequestRef.current = { key, book: nextBook };
    setLoadingMore(true);
    setError(null);
    try {
      const response = await getPassport({ stampBook: nextBook, discoveredLimit: 1 });
      const activeRequest = olderPageRequestRef.current;
      if (ownerKeyRef.current !== key || activeRequest?.key !== key || activeRequest.book !== nextBook) return;

      const nextStamps = mergeAndSortStamps(stampsRef.current, response.stamps);
      const followingBook = nextBook + 1;
      stampsRef.current = nextStamps;
      nextStampBookRef.current = followingBook;
      setStamps(nextStamps);
      setNextStampBook(followingBook);
      setPassport((previous) => previous
        ? {
            ...previous,
            visitedCount: response.visitedCount,
            stampBookCount: response.stampBookCount,
            stampBookSize: response.stampBookSize,
            visitedEventIds: response.visitedEventIds,
          }
        : response);
      updateVisitCache(key, response, nextStamps, followingBook, false);
    } catch (loadError) {
      if (ownerKeyRef.current === key) setError('이전 방문 기록을 불러오지 못했어요.');
      if (__DEV__) console.error('[PassportVisitsPage][loadOlder]', loadError);
    } finally {
      const activeRequest = olderPageRequestRef.current;
      if (activeRequest?.key === key && activeRequest.book === nextBook) olderPageRequestRef.current = null;
      if (ownerKeyRef.current === key) setLoadingMore(false);
    }
  }, [passport]);

  const hasMore = Boolean(passport && nextStampBook <= passport.stampBookCount);
  const countDescription = useMemo(() => {
    const total = passport?.visitedCount ?? stamps.length;
    if (total === stamps.length) return `${total}개의 방문 기록을 모두 모았어요.`;
    return `${total}개의 방문 중 최근 ${stamps.length}개를 보고 있어요.`;
  }, [passport?.visitedCount, stamps.length]);

  const pressStamp = useCallback((stamp: PassportStamp) => {
    if (!stamp.status || stamp.status === 'active') {
      navigation.navigate('/events/:id', { id: stamp.eventId });
      return;
    }
    setArchiveCard(stampToOverviewCard(stamp));
  }, [navigation]);

  const renderStamp = useCallback(({ item }: ListRenderItemInfo<PassportStamp>) => {
    const card = stampToOverviewCard(item);
    return (
      <View style={styles.gridCell}>
        <CollectionPosterCard
          card={card}
          status={item.status ?? 'active'}
          compact
          visitDate={item.visitedAt}
          onPress={() => pressStamp(item)}
        />
      </View>
    );
  }, [pressStamp]);

  const listHeader = (
    <View style={[styles.header, { paddingTop: top + 14 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="컬렉션으로 돌아가기"
        hitSlop={12}
        onPress={() => navigation.goBack()}
        style={({ pressed }) => [styles.backButton, pressed ? styles.pressed : null]}
      >
        <Text style={styles.backArrow}>←</Text>
        <Text style={styles.backText}>컬렉션</Text>
      </Pressable>
      <Text style={styles.eyebrow}>VISIT ARCHIVE</Text>
      <Text style={styles.title}>방문 기록</Text>
      <Text style={styles.description}>다녀온 문화를 날짜순으로 한곳에 모았어요.</Text>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryValue}>{passport?.visitedCount ?? stamps.length}</Text>
        <View style={styles.summaryCopy}>
          <Text style={styles.summaryTitle}>번의 문화 방문</Text>
          <Text style={styles.summaryDescription}>{countDescription}</Text>
        </View>
      </View>
      {error && stamps.length > 0 ? (
        <View style={styles.inlineError}>
          <Text style={styles.inlineErrorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );

  const ownsCurrentData = !authLoading
    && dataOwnerKey === getCollectionSessionKey(isLoggedIn, user?.id);

  if (!ownsCurrentData || ((authLoading || loading) && stamps.length === 0)) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator color={RED} />
        <Text style={styles.stateTitle}>방문 기록을 불러오고 있어요</Text>
      </View>
    );
  }

  if (error && stamps.length === 0) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.stateTitle}>방문 기록을 불러오지 못했어요</Text>
        <Text style={styles.stateDescription}>잠시 후 다시 확인해 주세요.</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            const key = ownerKeyRef.current;
            if (key) loadFirstPage(key, false, true).catch(() => {});
          }}
          style={styles.retryButton}
        >
          <Text style={styles.retryText}>다시 불러오기</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={stamps}
        renderItem={renderStamp}
        keyExtractor={(item) => item.eventId}
        numColumns={2}
        columnWrapperStyle={stamps.length > 0 ? styles.row : undefined}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={(
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>아직 방문 기록이 없어요</Text>
            <Text style={styles.emptyDescription}>공개한 카드에서 다녀온 문화를 기록해 보세요.</Text>
          </View>
        )}
        ListFooterComponent={hasMore ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="이전 방문 기록 더 불러오기"
            disabled={loadingMore || refreshing}
            onPress={loadOlder}
            style={({ pressed }) => [
              styles.moreButton,
              pressed ? styles.pressed : null,
              loadingMore || refreshing ? styles.disabled : null,
            ]}
          >
            {loadingMore ? <ActivityIndicator color={RED} size="small" /> : null}
            <Text style={styles.moreButtonText}>{loadingMore ? '불러오는 중' : '이전 방문 더 불러오기'}</Text>
            {!loadingMore ? <Text style={styles.moreArrow}>→</Text> : null}
          </Pressable>
        ) : stamps.length > 0 ? (
          <Text style={styles.endCopy}>모든 방문 기록을 불러왔어요.</Text>
        ) : null}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={MUTED} />}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(bottom, 24) + 24 }]}
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
      />

      <CollectionArchiveSnapshotModal
        card={archiveCard}
        referenceDate={referenceDate}
        onClose={() => setArchiveCard(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  header: { paddingTop: 14, paddingBottom: 22 },
  backButton: {
    minHeight: 42,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 18,
  },
  backArrow: { color: TEXT, fontSize: 25, lineHeight: 29, fontWeight: '500' },
  backText: { color: TEXT, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  eyebrow: { color: RED, fontSize: 10.5, lineHeight: 14, fontWeight: '900', letterSpacing: 1.6 },
  title: {
    marginTop: 5,
    color: TEXT,
    fontSize: 34,
    lineHeight: 41,
    fontWeight: '900',
    letterSpacing: -1,
    fontFamily: 'Noto Serif KR',
  },
  description: { marginTop: 5, color: MUTED, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  summaryCard: {
    minHeight: 86,
    marginTop: 20,
    paddingHorizontal: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: PAPER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  summaryValue: { color: RED, fontSize: 30, lineHeight: 36, fontWeight: '900', fontFamily: 'Noto Serif KR' },
  summaryCopy: { flex: 1, minWidth: 0 },
  summaryTitle: { color: TEXT, fontSize: 13, lineHeight: 18, fontWeight: '900' },
  summaryDescription: { marginTop: 3, color: MUTED, fontSize: 10.5, lineHeight: 15, fontWeight: '600' },
  row: { justifyContent: 'space-between', gap: 12 },
  gridCell: { width: '48%', marginBottom: 12 },
  inlineError: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#F3E4E0',
  },
  inlineErrorText: { color: RED, fontSize: 10.5, lineHeight: 15, fontWeight: '700' },
  emptyCard: {
    minHeight: 240,
    borderRadius: 22,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PAPER,
    borderWidth: 1,
    borderColor: BORDER,
  },
  emptyTitle: { color: TEXT, fontSize: 17, lineHeight: 23, fontWeight: '900', textAlign: 'center' },
  emptyDescription: { marginTop: 6, color: MUTED, fontSize: 11.5, lineHeight: 17, fontWeight: '600', textAlign: 'center' },
  moreButton: {
    minHeight: 60,
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 18,
    backgroundColor: '#FBF9F4',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  moreButtonText: { color: TEXT, fontSize: 12, lineHeight: 17, fontWeight: '900' },
  moreArrow: { position: 'absolute', right: 18, color: RED, fontSize: 18, lineHeight: 22, fontWeight: '800' },
  endCopy: { marginTop: 20, color: MUTED, fontSize: 10.5, lineHeight: 15, fontWeight: '600', textAlign: 'center' },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.72 },
  centerState: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', padding: 32 },
  stateTitle: { marginTop: 12, color: TEXT, fontSize: 16, lineHeight: 22, fontWeight: '900', textAlign: 'center' },
  stateDescription: { marginTop: 6, color: MUTED, fontSize: 11.5, lineHeight: 17, fontWeight: '600', textAlign: 'center' },
  retryButton: {
    minHeight: 44,
    marginTop: 18,
    borderRadius: 999,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: RED,
  },
  retryText: { color: '#FFFFFF', fontSize: 12, lineHeight: 17, fontWeight: '900' },
});

export default PassportVisitsPage;
