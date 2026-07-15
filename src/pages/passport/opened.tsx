import { createRoute } from '@granite-js/react-native';
import { useSafeAreaInsets } from '@granite-js/native/react-native-safe-area-context';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  CollectionArchiveSnapshotModal,
  CollectionPosterCard,
  filterCollectionCards,
  getCollectionCardStatus,
  type CollectionCardFilter,
  type CollectionOverviewCard,
} from '../../components/passport/CollectionOverviewSections';
import { prefetchCollectionImageUrls } from '../../components/passport/CachedCollectionImageBackground';
import {
  mergeDiscoveredCards,
  mergeVisitStamps,
  toCollectionOverviewCards,
  uniqueDiscoveredCards,
} from '../../components/passport/collectionData';
import {
  getCollectionSession,
  getCollectionSessionKey,
  setCollectionSession,
  updateCollectionSession,
} from '../../lib/collectionSessionCache';
import { useAuth } from '../../hooks/useAuth';
import {
  getDiscoveredCards,
  getPassport,
  type PassportDiscoveredCard,
  type PassportDiscoveredPageInfo,
  type PassportResponse,
  type PassportStamp,
} from '../../services/passportService';
import { loadCollectionSavedEventIds } from '../../services/collectionService';

type OpenedCollectionParams = {
  filter?: CollectionCardFilter;
};

const FILTERS: ReadonlyArray<{ key: CollectionCardFilter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'active', label: '진행 중' },
  { key: 'saved', label: '저장' },
  { key: 'past', label: '지난 문화' },
];

const PAGE_SIZE = 100;
const BG = '#F7F5EF';
const TEXT = '#171717';
const MUTED = '#716D66';
const RED = '#A52822';

function isCollectionFilter(value: unknown): value is CollectionCardFilter {
  return value === 'all' || value === 'active' || value === 'saved' || value === 'past';
}

export const Route = createRoute('/passport/opened', {
  validateParams: (params: Readonly<object> | undefined): OpenedCollectionParams => {
    const filter = (params as OpenedCollectionParams | undefined)?.filter;
    return { filter: isCollectionFilter(filter) ? filter : undefined };
  },
  component: OpenedCollectionPage,
});

export function OpenedCollectionPage() {
  const navigation = Route.useNavigation();
  const params = Route.useParams();
  const { top, bottom } = useSafeAreaInsets();
  const { isLoggedIn, user, isLoading: authLoading } = useAuth();
  const initialKey = authLoading ? null : getCollectionSessionKey(isLoggedIn, user?.id);
  const initialCacheRef = useRef(initialKey ? getCollectionSession(initialKey) : null);
  const initialCache = initialCacheRef.current;
  const [filter, setFilter] = useState<CollectionCardFilter>(params.filter ?? 'all');
  const [passport, setPassport] = useState<PassportResponse | null>(initialCache?.passport ?? null);
  const [openedCards, setOpenedCards] = useState<PassportDiscoveredCard[]>(initialCache?.openedCards ?? []);
  const [pageInfo, setPageInfo] = useState<PassportDiscoveredPageInfo | null>(initialCache?.pageInfo ?? null);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set(initialCache?.savedEventIds ?? []));
  const [visitedIds, setVisitedIds] = useState<Set<string>>(() => new Set(initialCache?.visitedEventIds ?? []));
  const [stamps, setStamps] = useState<PassportStamp[]>(initialCache?.visitStamps ?? []);
  const [loading, setLoading] = useState(!initialCache);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [archiveCard, setArchiveCard] = useState<CollectionOverviewCard | null>(null);
  const [dataOwnerKey, setDataOwnerKey] = useState<string | null>(initialCache ? initialKey : null);
  const [referenceDate] = useState(() => new Date());
  const activeKeyRef = useRef<string | null>(initialKey);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    setFilter(params.filter ?? 'all');
  }, [params.filter]);

  const hydrateCache = useCallback((key: string) => {
    const cached = getCollectionSession(key);
    if (!cached) return false;
    setPassport(cached.passport);
    setOpenedCards(cached.openedCards);
    setPageInfo(cached.pageInfo);
    setSavedIds(new Set(cached.savedEventIds));
    setVisitedIds(new Set(cached.visitedEventIds));
    setStamps(cached.visitStamps);
    setDataOwnerKey(key);
    setLoading(false);
    setError(false);
    return true;
  }, []);

  const loadFirstPage = useCallback(
    async (key: string, mode: 'initial' | 'refresh') => {
      if (mode === 'initial') setLoading(true);
      setError(false);
      try {
        const [nextPassport, nextSavedIds] = await Promise.all([
          getPassport({ stampBook: 1, discoveredLimit: PAGE_SIZE }),
          loadCollectionSavedEventIds(isLoggedIn),
        ]);
        if (activeKeyRef.current !== key) return;

        const nextOpened = uniqueDiscoveredCards(nextPassport.discoveredCards);
        const nextPageInfo = nextPassport.discoveredPageInfo ?? {
          limit: PAGE_SIZE,
          hasMore: false,
          nextCursor: null,
        };
        const nextVisitedIds = new Set(nextPassport.visitedEventIds.map(String));
        const currentCache = getCollectionSession(key);
        const nextVisitStamps = currentCache
          ? mergeVisitStamps(
              currentCache.visitStamps.filter((stamp) => nextVisitedIds.has(stamp.eventId)),
              nextPassport.stamps
            )
          : nextPassport.stamps;

        setPassport(nextPassport);
        setOpenedCards(nextOpened);
        setPageInfo(nextPageInfo);
        setSavedIds(nextSavedIds);
        setVisitedIds(nextVisitedIds);
        setStamps(nextVisitStamps);
        setDataOwnerKey(key);
        setCollectionSession(key, {
          passport: nextPassport,
          openedCards: nextOpened,
          pageInfo: nextPageInfo,
          visitStamps: nextVisitStamps,
          nextStampBook: currentCache?.nextStampBook ?? 2,
          savedEventIds: [...nextSavedIds],
          visitedEventIds: [...nextVisitedIds],
          fetchedAt: Date.now(),
        });
      } catch (loadError) {
        if (activeKeyRef.current === key) setError(true);
        if (__DEV__) console.error('[OpenedCollectionPage][loadFirstPage]', loadError);
      } finally {
        if (activeKeyRef.current === key) {
          setLoading(false);
          if (mode === 'refresh') setRefreshing(false);
        }
      }
    },
    [isLoggedIn]
  );

  useEffect(() => {
    if (authLoading) return;
    const key = getCollectionSessionKey(isLoggedIn, user?.id);
    activeKeyRef.current = key;
    loadingMoreRef.current = false;
    setRefreshing(false);
    setLoadingMore(false);
    setLoadMoreError(false);
    if (!hydrateCache(key)) {
      setPassport(null);
      setOpenedCards([]);
      setPageInfo(null);
      setSavedIds(new Set());
      setVisitedIds(new Set());
      setStamps([]);
      setDataOwnerKey(key);
      loadFirstPage(key, 'initial').catch(() => {});
    }
  }, [authLoading, hydrateCache, isLoggedIn, loadFirstPage, user?.id]);

  useEffect(() => {
    return navigation.addListener('focus', () => {
      if (authLoading) return;
      const key = getCollectionSessionKey(isLoggedIn, user?.id);
      if (activeKeyRef.current !== key) return;
      // 포커스 복귀에서는 네트워크 요청을 시작하지 않는다. 상세 화면 아래에
      // 살아 있던 컬렉션 화면이 갱신한 동일 사용자 캐시만 즉시 반영한다.
      hydrateCache(key);
    });
  }, [authLoading, hydrateCache, isLoggedIn, navigation, user?.id]);

  const overviewCards = useMemo(
    () => toCollectionOverviewCards(openedCards, savedIds, visitedIds, stamps),
    [openedCards, savedIds, stamps, visitedIds]
  );
  const filteredCards = useMemo(
    () => filterCollectionCards(overviewCards, filter, referenceDate),
    [filter, overviewCards, referenceDate]
  );
  const counts = useMemo(
    () => ({
      all: overviewCards.length,
      active: filterCollectionCards(overviewCards, 'active', referenceDate).length,
      saved: filterCollectionCards(overviewCards, 'saved', referenceDate).length,
      past: filterCollectionCards(overviewCards, 'past', referenceDate).length,
    }),
    [overviewCards, referenceDate]
  );

  useEffect(() => {
    prefetchCollectionImageUrls(filteredCards.slice(0, 24).map((card) => card.imageUrl)).catch(() => {});
  }, [filteredCards]);

  const refresh = useCallback(() => {
    const key = activeKeyRef.current;
    if (!key || refreshing || loadingMoreRef.current) return;
    setRefreshing(true);
    setLoadMoreError(false);
    loadFirstPage(key, 'refresh').catch(() => {});
  }, [loadFirstPage, refreshing]);

  const loadMore = useCallback(async () => {
    const key = activeKeyRef.current;
    const cursor = pageInfo?.nextCursor;
    if (!key || refreshing || loadingMoreRef.current || !pageInfo?.hasMore || !cursor) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const nextPage = await getDiscoveredCards({ limit: PAGE_SIZE, cursor });
      if (activeKeyRef.current !== key) return;
      const merged = mergeDiscoveredCards(openedCards, nextPage.items);
      setOpenedCards(merged);
      setPageInfo(nextPage.pageInfo);
      updateCollectionSession(key, (current) => ({
        ...current,
        openedCards: merged,
        pageInfo: nextPage.pageInfo,
        fetchedAt: Date.now(),
      }));
    } catch (nextPageError) {
      if (activeKeyRef.current === key) setLoadMoreError(true);
      if (__DEV__) console.error('[OpenedCollectionPage][loadMore]', nextPageError);
    } finally {
      if (activeKeyRef.current === key) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [openedCards, pageInfo, refreshing]);

  const pressCard = useCallback(
    (card: CollectionOverviewCard) => {
      if (getCollectionCardStatus(card, referenceDate) === 'active') {
        navigation.navigate('/events/:id', { id: card.id });
      } else {
        setArchiveCard(card);
      }
    },
    [navigation, referenceDate]
  );

  const knownTotal = Math.max(passport?.discoveredCount ?? 0, openedCards.length);
  const ownsCurrentData = !authLoading
    && dataOwnerKey === getCollectionSessionKey(isLoggedIn, user?.id);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: top + 8 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="컬렉션으로 돌아가기"
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={styles.backButton}
        >
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>내가 연 카드</Text>
        <View style={styles.headerSpacer} />
      </View>

      {!ownsCurrentData || loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={RED} />
          <Text style={styles.stateDescription}>공개한 카드를 불러오고 있어요.</Text>
        </View>
      ) : error && openedCards.length === 0 ? (
        <View style={styles.centerState}>
          <Text style={styles.stateTitle}>카드를 불러오지 못했어요</Text>
          <Text style={styles.stateDescription}>잠시 후 다시 시도해 주세요.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              const key = activeKeyRef.current;
              if (key) loadFirstPage(key, 'initial').catch(() => {});
            }}
            style={styles.retryButton}
          >
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filteredCards}
          keyExtractor={(card) => card.id}
          numColumns={2}
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(bottom, 24) + 24 }]}
          columnWrapperStyle={styles.gridRow}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={RED} />}
          showsVerticalScrollIndicator={false}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          renderItem={({ item: card }) => (
            <View style={styles.gridCell}>
              <CollectionPosterCard
                card={card}
                status={getCollectionCardStatus(card, referenceDate)}
                compact
                visitDate={card.isVisited ? card.visitedAt : null}
                onPress={() => pressCard(card)}
              />
            </View>
          )}
          ListHeaderComponent={(
            <>
              <Text style={styles.eyebrow}>OPENED COLLECTION</Text>
              <Text style={styles.title}>공개한 문화의 기록</Text>
              <Text style={styles.description}>
                {knownTotal === openedCards.length
                  ? `${knownTotal}장의 카드를 모았어요.`
                  : `전체 ${knownTotal}장 중 ${openedCards.length}장을 불러왔어요.`}
              </Text>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filters}
              >
                {FILTERS.map((item) => {
                  const selected = item.key === filter;
                  return (
                    <Pressable
                      key={item.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setFilter(item.key)}
                      style={[styles.filter, selected ? styles.filterSelected : null]}
                    >
                      <Text style={[styles.filterText, selected ? styles.filterTextSelected : null]}>
                        {item.label} {counts[item.key]}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}
          ListEmptyComponent={(
            <View style={styles.emptyBox}>
              <Text style={styles.stateTitle}>이 조건에 맞는 카드가 없어요</Text>
              <Text style={styles.stateDescription}>다른 필터를 선택해 컬렉션을 살펴보세요.</Text>
            </View>
          )}
          ListFooterComponent={(
            <View>
              {pageInfo?.hasMore && pageInfo.nextCursor ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="공개한 카드 더 불러오기"
                  disabled={loadingMore || refreshing}
                  onPress={() => loadMore().catch(() => {})}
                  style={({ pressed }) => [
                    styles.loadMoreButton,
                    pressed ? styles.pressed : null,
                    loadingMore || refreshing ? styles.loadMoreDisabled : null,
                  ]}
                >
                  {loadingMore ? (
                    <ActivityIndicator color={TEXT} />
                  ) : (
                    <Text style={styles.loadMoreText}>카드 더 불러오기</Text>
                  )}
                </Pressable>
              ) : openedCards.length > 0 ? (
                <Text style={styles.endText}>공개한 카드를 모두 불러왔어요.</Text>
              ) : null}
              {loadMoreError ? (
                <Text style={styles.loadMoreError}>불러오지 못했어요. 다시 눌러 주세요.</Text>
              ) : null}
            </View>
          )}
        />
      )}

      <CollectionArchiveSnapshotModal
        card={archiveCard}
        referenceDate={referenceDate}
        onClose={() => setArchiveCard(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: {
    minHeight: 64,
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D9D3C7',
    backgroundColor: BG,
  },
  backButton: { width: 44, height: 44, justifyContent: 'center' },
  backIcon: { color: TEXT, fontSize: 42, fontWeight: '300', lineHeight: 44 },
  headerTitle: { flex: 1, color: TEXT, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  headerSpacer: { width: 44 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 24, paddingTop: 28 },
  eyebrow: { color: RED, fontSize: 13, fontWeight: '900', letterSpacing: 1.7 },
  title: { color: TEXT, fontSize: 30, lineHeight: 38, fontWeight: '900', marginTop: 9 },
  description: { color: MUTED, fontSize: 15, lineHeight: 22, marginTop: 8 },
  filters: { gap: 8, paddingVertical: 24, paddingRight: 24 },
  filter: {
    borderWidth: 1,
    borderColor: '#D8D0C1',
    borderRadius: 999,
    paddingHorizontal: 15,
    paddingVertical: 10,
    backgroundColor: '#FBF9F3',
  },
  filterSelected: { borderColor: RED, backgroundColor: '#F6E9E5' },
  filterText: { color: MUTED, fontSize: 13, fontWeight: '700' },
  filterTextSelected: { color: RED },
  gridRow: { justifyContent: 'space-between', marginBottom: 14 },
  gridCell: { width: '48.5%' },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  stateTitle: { color: TEXT, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  stateDescription: { color: MUTED, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 10 },
  retryButton: { backgroundColor: RED, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 20 },
  retryText: { color: '#FFFFFF', fontWeight: '800' },
  emptyBox: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#DED7C9',
    borderRadius: 18,
    backgroundColor: '#FBF9F3',
    paddingHorizontal: 24,
    paddingVertical: 42,
  },
  loadMoreButton: {
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#CEC5B5',
    backgroundColor: '#FBF9F3',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  loadMoreDisabled: { opacity: 0.6 },
  loadMoreText: { color: TEXT, fontSize: 15, fontWeight: '800' },
  loadMoreError: { color: RED, fontSize: 13, textAlign: 'center', marginTop: 10 },
  endText: { color: MUTED, fontSize: 13, textAlign: 'center', marginTop: 26 },
});
