import { createRoute, ScrollViewInertialBackground } from '@granite-js/react-native';
import { useSafeAreaInsets } from '@granite-js/native/react-native-safe-area-context';
import { useDialog } from '@toss/tds-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { BottomTabBar } from '../components/BottomTabBar';
import {
  PassportBookStatePage,
  PassportIndexRail,
  PassportTicketBookPage,
  type PassportBookmarkItem,
} from '../components/passport/PassportBookPages';
import {
  PassportCoverPage,
  PassportIdentityPage,
  PassportStampPage,
} from '../components/passport/PassportPages';
import { StampDetailSheet } from '../components/passport/StampDetailSheet';
import type { SavedTicketItem, SaveButtonState, VisitButtonState } from '../components/saved/SavedTicketRow';
import { SavedVisitToast, SavedVisitToastMessage } from '../components/saved/SavedVisitToast';
import { TAG_TOKENS } from '../components/culture-card/tagKit';
import type { EventCardData } from '../data/events';
import { useAuth } from '../hooks/useAuth';
import http from '../lib/http';
import eventService from '../services/eventService';
import {
  getPassport,
  type PassportDiscoveredCard,
  type PassportResponse,
  type PassportStamp,
} from '../services/passportService';
import userEventService from '../services/userEventService';
import { markVisited, unmarkVisited } from '../services/visitService';
import type { GetLikesResponse } from '../types/serverSync';
import { openNaverMap } from '../utils/mapLinks';
import {
  getLikesV2,
  subscribeStorageChange,
  toggleLike,
  type StoredEventItemV2,
} from '../utils/storage';
import {
  buildPassportBookPages,
  getActivePassportBookmark,
  getPassportSectionCopy,
  getPassportSectionIndexes,
  type PassportBookPage,
  type PassportBookmarkSection,
  type PassportContentSection,
} from './passportLogic';

export const Route = createRoute('/passport', {
  component: PassportPage,
});

const BG = TAG_TOKENS.bg;
const ON_BG = TAG_TOKENS.headText;
const ON_BG_MUTED = TAG_TOKENS.navSub;

type OrderedLike = { id: string; timestamp: string };
type EventWithWalk = EventCardData & { walkMinutes?: number | null };
type ScrollToIndexFailure = {
  index: number;
  highestMeasuredFrameIndex: number;
  averageItemLength: number;
};

function snapshotToTicketItem(item: StoredEventItemV2): SavedTicketItem {
  return {
    id: item.id,
    title: item.snapshot?.title?.trim() || '저장한 문화행사',
    venue: item.snapshot?.venue,
    region: item.snapshot?.region,
    category: item.snapshot?.mainCategory,
    subCategory: item.snapshot?.subCategory,
    startAt: item.snapshot?.startAt,
    endAt: item.snapshot?.endAt,
    lastKnownStatus: item.lastKnownStatus,
  };
}

function eventToTicketItem(event: EventWithWalk): SavedTicketItem {
  return {
    id: event.id,
    title: event.displayTitle?.trim() || event.title,
    venue: event.venue,
    region: event.region,
    category: event.mainCategory ?? event.category,
    subCategory: event.subCategory,
    startAt: event.startAt,
    endAt: event.endAt,
    walkMinutes: event.walkMinutes,
    lat: event.lat,
    lng: event.lng,
    detailLink: event.detailLink,
    lastKnownStatus: 'active',
  };
}

function discoveredToTicketItem(card: PassportDiscoveredCard): SavedTicketItem {
  return {
    id: card.eventId,
    title: card.title,
    venue: card.venue,
    region: card.region,
    category: card.category,
    startAt: card.startAt,
    endAt: card.endAt,
    lat: card.lat,
    lng: card.lng,
    lastKnownStatus: 'active',
  };
}

function createFallbackItem(id: string, snapshot?: StoredEventItemV2): SavedTicketItem {
  if (snapshot) return snapshotToTicketItem(snapshot);
  return { id, title: '저장한 문화행사', lastKnownStatus: 'active' };
}

async function getOrderedLikes(isLoggedIn: boolean): Promise<{
  orderedLikes: OrderedLike[];
  localItems: StoredEventItemV2[];
}> {
  const localLikes = await getLikesV2();
  if (!isLoggedIn) {
    return {
      orderedLikes: localLikes.items.map((item) => ({ id: item.id, timestamp: item.timestamp })),
      localItems: localLikes.items,
    };
  }
  try {
    const { data } = await http.get<GetLikesResponse>('/users/me/likes');
    return {
      orderedLikes: data.items.map((item) => ({ id: item.eventId, timestamp: item.likedAt })),
      localItems: localLikes.items,
    };
  } catch {
    return {
      orderedLikes: localLikes.items.map((item) => ({ id: item.id, timestamp: item.timestamp })),
      localItems: localLikes.items,
    };
  }
}

function addId(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
  setter((prev) => {
    if (prev.has(id)) return prev;
    const next = new Set(prev);
    next.add(id);
    return next;
  });
}

function removeId(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
  setter((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    return next;
  });
}

function pageMonthLabel(stamps: PassportStamp[]): string {
  const first = stamps[0];
  if (!first) return '2026';
  const d = new Date(first.visitedAt);
  if (Number.isNaN(d.getTime())) return '2026';
  return `${d.getFullYear()}. ${d.getMonth() + 1}`;
}

function deriveIssueMonth(stamps: PassportStamp[]): string | null {
  const oldest = stamps[stamps.length - 1];
  if (!oldest) return null;
  const d = new Date(oldest.visitedAt);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}. ${d.getMonth() + 1}`;
}

function PassportPage() {
  const { top } = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const navigation = Route.useNavigation();
  const dialog = useDialog();
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const bookListRef = useRef<FlatList<PassportBookPage<SavedTicketItem, PassportStamp>>>(null);
  const savingIdsRef = useRef<Set<string>>(new Set());
  const markingIdsRef = useRef<Set<string>>(new Set());
  const desiredBookSectionRef = useRef<PassportBookmarkSection>('cover');
  const [currentBookPage, setCurrentBookPage] = useState(0);
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());

  const [passport, setPassport] = useState<PassportResponse | null>(null);
  const [passportLoading, setPassportLoading] = useState(true);
  const [passportError, setPassportError] = useState(false);
  const [activeStamp, setActiveStamp] = useState<PassportStamp | null>(null);
  const [cancelingStamp, setCancelingStamp] = useState(false);

  const [savedItems, setSavedItems] = useState<SavedTicketItem[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState(false);
  const [visitedIds, setVisitedIds] = useState<Set<string>>(() => new Set());
  const [markingIds, setMarkingIds] = useState<Set<string>>(() => new Set());
  const [stampSignals, setStampSignals] = useState<Record<string, number>>({});

  const [refreshing, setRefreshing] = useState(false);
  const [toastMessage, setToastMessage] = useState<SavedVisitToastMessage | null>(null);

  const toastOpacity = useRef(new Animated.Value(0));
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstStampNoticeShownRef = useRef(false);

  const pageWidth = Math.max(screenWidth - 40, 0);

  const showToast = useCallback((message: SavedVisitToastMessage) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
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

  const loadPassport = useCallback(async () => {
    setPassportError(false);
    try {
      const next = await getPassport();
      setPassport(next);
      setVisitedIds(new Set(next.stamps.map((stamp) => stamp.eventId)));
    } catch {
      setPassportError(true);
    } finally {
      setPassportLoading(false);
    }
  }, []);

  const loadSaved = useCallback(async () => {
    setSavedError(false);
    try {
      const { orderedLikes, localItems } = await getOrderedLikes(isLoggedIn);
      const localSnapshotMap = new Map(localItems.map((item) => [item.id, item]));
      const uniqueLikes = orderedLikes.filter((item, index, all) =>
        all.findIndex((candidate) => candidate.id === item.id) === index
      );
      if (uniqueLikes.length === 0) {
        setSavedItems([]);
        return;
      }
      const results = await Promise.allSettled(
        uniqueLikes.slice(0, 50).map((item) => eventService.getEventById(item.id))
      );
      const nextItems = uniqueLikes.slice(0, 50).map((like, index) => {
        const result = results[index];
        if (result?.status === 'fulfilled' && result.value) {
          return eventToTicketItem(result.value as EventWithWalk);
        }
        return createFallbackItem(like.id, localSnapshotMap.get(like.id));
      });
      setSavedItems(nextItems);
    } catch (error) {
      setSavedError(true);
      if (__DEV__) console.error('[PassportPage][loadSaved]', error);
    } finally {
      setSavedLoading(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (authLoading) return;
    setPassportLoading(true);
    setSavedLoading(true);
    loadPassport().catch(() => {});
    loadSaved().catch(() => {});
  }, [authLoading, loadPassport, loadSaved]);

  useEffect(() => {
    const unsubscribe = subscribeStorageChange((event) => {
      if (event.type === 'likes') loadSaved().catch(() => {});
    });
    return unsubscribe;
  }, [loadSaved]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadPassport(), loadSaved()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadPassport, loadSaved]);

  const handlePressStamp = useCallback((stamp: PassportStamp) => {
    setActiveStamp(stamp);
  }, []);

  const stamps = passport?.stamps ?? [];

  const stampOrdinal = useMemo(() => {
    if (!activeStamp) return null;
    const idx = stamps.findIndex(
      (stamp) => stamp.eventId === activeStamp.eventId && stamp.visitedAt === activeStamp.visitedAt,
    );
    if (idx < 0) return null;
    return stamps.length - idx;
  }, [activeStamp, stamps]);

  const handleCancelStamp = useCallback(async (stamp: PassportStamp) => {
    if (cancelingStamp) return;
    if (!isLoggedIn) {
      await dialog.openAlert({
        title: '로그인이 필요해요',
        description: '도장은 로그인한 계정에 보관돼요.',
      });
      return;
    }
    setCancelingStamp(true);
    setPassport((prev) => prev
      ? {
          ...prev,
          stamps: prev.stamps.filter(
            (candidate) => !(candidate.eventId === stamp.eventId && candidate.visitedAt === stamp.visitedAt),
          ),
          visitedCount: Math.max(prev.visitedCount - 1, 0),
        }
      : prev);
    setActiveStamp(null);
    try {
      await unmarkVisited(stamp.eventId);
      removeId(setVisitedIds, stamp.eventId);
    } catch (error) {
      await loadPassport().catch(() => {});
      showToast({ title: '도장을 취소하지 못했어요', description: '잠시 후 다시 시도해 주세요.' });
      if (__DEV__) console.error('[PassportPage][cancelStamp]', error);
    } finally {
      setCancelingStamp(false);
    }
  }, [cancelingStamp, dialog, isLoggedIn, loadPassport, showToast]);

  const handleOpenEvent = useCallback((eventId: string) => {
    setActiveStamp(null);
    navigation.navigate('/events/:id', { id: eventId });
  }, [navigation]);

  const handleTicketPress = useCallback((item: SavedTicketItem) => {
    navigation.navigate('/events/:id', { id: item.id });
  }, [navigation]);

  const handleDirections = useCallback(async (item: SavedTicketItem) => {
    const placeName = [item.venue, item.region].filter(Boolean).join(' ');
    if (!placeName) {
      showToast({ title: '장소 정보가 아직 없어요' });
      return;
    }
    try {
      if (typeof item.lat === 'number' && typeof item.lng === 'number') {
        await openNaverMap(item.lat, item.lng, placeName);
        return;
      }
      await Linking.openURL(`https://map.naver.com/v5/search/${encodeURIComponent(placeName)}`);
    } catch {
      showToast({ title: '길찾기를 열지 못했어요', description: '잠시 후 다시 시도해 주세요.' });
    }
  }, [showToast]);

  const savedIds = useMemo(() => new Set(savedItems.map((item) => item.id)), [savedItems]);

  const syncLocalLikeState = useCallback(async (item: SavedTicketItem, shouldSave: boolean) => {
    const likes = await getLikesV2();
    const exists = likes.items.some((like) => like.id === item.id);
    if (exists === shouldSave) return;
    await toggleLike(item.id, {
      title: item.title,
      startAt: item.startAt ?? undefined,
      endAt: item.endAt ?? undefined,
      venue: item.venue ?? undefined,
      region: item.region ?? undefined,
      mainCategory: item.category ?? undefined,
      subCategory: item.subCategory ?? undefined,
    });
  }, []);

  const handleToggleSave = useCallback(async (item: SavedTicketItem) => {
    if (savingIdsRef.current.has(item.id)) return;
    if (savingIds.has(item.id)) return;
    savingIdsRef.current.add(item.id);
    addId(setSavingIds, item.id);
    const shouldSave = !savedIds.has(item.id);
    try {
      if (isLoggedIn) {
        if (shouldSave) await http.post(`/users/me/likes/${item.id}`);
        else await http.delete(`/users/me/likes/${item.id}`);
      }
      await syncLocalLikeState(item, shouldSave);
      if (shouldSave) {
        userEventService.logEventSave(item.id).catch(() => {});
        setSavedItems((prev) => (
          prev.some((saved) => saved.id === item.id) ? prev : [item, ...prev]
        ));
        showToast({ title: '가고 싶어요에 저장했어요' });
      } else {
        userEventService.logEventUnsave(item.id).catch(() => {});
        setSavedItems((prev) => prev.filter((saved) => saved.id !== item.id));
        showToast({ title: '저장을 취소했어요' });
      }
    } catch (error) {
      showToast({ title: '저장 상태를 바꾸지 못했어요', description: '잠시 후 다시 시도해 주세요.' });
      loadSaved().catch(() => {});
      if (__DEV__) console.error('[PassportPage][toggleSave]', error);
    } finally {
      savingIdsRef.current.delete(item.id);
      removeId(setSavingIds, item.id);
    }
  }, [isLoggedIn, loadSaved, savedIds, savingIds, showToast, syncLocalLikeState]);

  const handleVisit = useCallback(async (item: SavedTicketItem) => {
    if (markingIdsRef.current.has(item.id)) return;
    if (!isLoggedIn) {
      await dialog.openAlert({
        title: '로그인하면 도장을 남길 수 있어요',
        description: '다녀온 문화 기록을 문화 여권에 안전하게 보관해요.',
      });
      return;
    }
    markingIdsRef.current.add(item.id);
    const wasVisited = visitedIds.has(item.id);
    addId(setMarkingIds, item.id);
    if (wasVisited) {
      removeId(setVisitedIds, item.id);
      try {
        await unmarkVisited(item.id);
        await loadPassport().catch(() => {});
      } catch (error) {
        addId(setVisitedIds, item.id);
        showToast({ title: '도장을 취소하지 못했어요', description: '잠시 후 다시 시도해 주세요.' });
        if (__DEV__) console.error('[PassportPage][unmarkVisited]', error);
      } finally {
        markingIdsRef.current.delete(item.id);
        removeId(setMarkingIds, item.id);
      }
      return;
    }
    addId(setVisitedIds, item.id);
    setStampSignals((prev) => ({ ...prev, [item.id]: (prev[item.id] ?? 0) + 1 }));
    try {
      await markVisited(item.id);
      await loadPassport().catch(() => {});
      if (!firstStampNoticeShownRef.current) {
        firstStampNoticeShownRef.current = true;
        showToast({
          title: '문화 여권에 도장을 남겼어요',
          description: '위치 인증 없이 추억으로 남겨요 (보상 아님)',
        });
      }
    } catch (error) {
      removeId(setVisitedIds, item.id);
      showToast({ title: '도장을 남기지 못했어요', description: '잠시 후 다시 시도해 주세요.' });
      if (__DEV__) console.error('[PassportPage][markVisited]', error);
    } finally {
      markingIdsRef.current.delete(item.id);
      removeId(setMarkingIds, item.id);
    }
  }, [dialog, isLoggedIn, loadPassport, showToast, visitedIds]);

  const getVisitState = useCallback((id: string): VisitButtonState => {
    if (visitedIds.has(id)) return 'visited';
    if (markingIds.has(id)) return 'loading';
    return 'idle';
  }, [markingIds, visitedIds]);

  const getSaveState = useCallback((id: string): SaveButtonState => {
    if (savingIds.has(id)) return 'loading';
    if (savedIds.has(id)) return 'saved';
    return 'idle';
  }, [savedIds, savingIds]);

  const getStampSignal = useCallback((id: string) => stampSignals[id] ?? 0, [stampSignals]);

  const visitedCount = passport?.visitedCount ?? stamps.length;
  const discoveredItems = useMemo(
    () => (passport?.discoveredCards ?? []).map(discoveredToTicketItem),
    [passport?.discoveredCards],
  );
  const discoveredCount = passport?.discoveredCount ?? discoveredItems.length;
  const passportNo = passport?.passportNo ?? '----';
  const issueMonth = useMemo(() => deriveIssueMonth(stamps), [stamps]);
  const tasteCategories = passport?.tasteCategories ?? [];
  const pendingSavedCount = useMemo(
    () => savedItems.filter((item) => !visitedIds.has(item.id)).length,
    [savedItems, visitedIds],
  );

  const bookPages = useMemo(
    () => buildPassportBookPages<SavedTicketItem, PassportStamp>({
      discoveredItems,
      wishlistItems: savedItems,
      stamps,
      visitedIds,
      passportLoading,
      passportError,
      savedLoading,
      savedError,
    }),
    [
      discoveredItems,
      passportError,
      passportLoading,
      savedError,
      savedItems,
      savedLoading,
      stamps,
      visitedIds,
    ],
  );

  const bookmarkIndexes = useMemo(() => getPassportSectionIndexes(bookPages), [bookPages]);
  const activeBookmark = getActivePassportBookmark(bookPages, currentBookPage);
  const bookmarkItems: PassportBookmarkItem[] = useMemo(() => [
    { section: 'cover', label: '표지' },
    { section: 'discovered', label: '발견' },
    { section: 'wishlist', label: '예정' },
    { section: 'stamps', label: '도장' },
  ], []);

  useEffect(() => {
    if (bookPages.length === 0) return;
    const maxIndex = bookPages.length - 1;
    const clampedIndex = Math.min(currentBookPage, maxIndex);
    const desiredSection = desiredBookSectionRef.current;
    const clampedPage = bookPages[clampedIndex];
    const desiredIndex = bookPages.findIndex((page) => page.section === desiredSection);
    const targetIndex = clampedPage?.section === desiredSection
      ? clampedIndex
      : desiredIndex >= 0
        ? desiredIndex
        : clampedIndex;

    if (targetIndex !== currentBookPage) {
      setCurrentBookPage(targetIndex);
      if (pageWidth > 0) {
        requestAnimationFrame(() => {
          bookListRef.current?.scrollToIndex({ index: targetIndex, animated: false });
        });
      }
    }
  }, [bookPages, currentBookPage, pageWidth]);

  useEffect(() => {
    desiredBookSectionRef.current = activeBookmark;
  }, [activeBookmark]);

  const handleBookMomentumEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (bookPages.length === 0) return;
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / Math.max(pageWidth, 1));
    const validIndex = Math.max(0, Math.min(nextIndex, bookPages.length - 1));
    desiredBookSectionRef.current = bookPages[validIndex]?.section ?? 'cover';
    setCurrentBookPage(validIndex);
  }, [bookPages, pageWidth]);

  const handlePressBookmark = useCallback((section: PassportBookmarkSection) => {
    desiredBookSectionRef.current = section;
    const index = bookmarkIndexes[section];
    setCurrentBookPage(index);
    if (pageWidth <= 0) return;
    bookListRef.current?.scrollToIndex({ index, animated: true });
  }, [bookmarkIndexes, pageWidth]);

  const handleScrollToIndexFailed = useCallback((info: ScrollToIndexFailure) => {
    const offset = Math.max(info.averageItemLength, pageWidth, 1) * info.index;
    requestAnimationFrame(() => {
      bookListRef.current?.scrollToOffset({ offset, animated: false });
    });
  }, [pageWidth]);

  const renderStateCopy = useCallback((section: PassportContentSection) => {
    if (section === 'wishlist') return getPassportSectionCopy('wishlist');
    if (section === 'stamps') return getPassportSectionCopy('visited');
    return getPassportSectionCopy('discovered');
  }, []);

  const discoveredBookPageCount = useMemo(
    () => bookPages.filter((candidate) => candidate.type === 'discovered').length,
    [bookPages],
  );
  const wishlistBookPageCount = useMemo(
    () => bookPages.filter((candidate) => candidate.type === 'wishlist').length,
    [bookPages],
  );

  const renderBookPage = useCallback(({ item }: { item: PassportBookPage<SavedTicketItem, PassportStamp> }) => {
    if (item.type === 'cover') {
      return <PassportCoverPage width={pageWidth} passportNo={passportNo} />;
    }
    if (item.type === 'identity') {
      return (
        <PassportIdentityPage
          width={pageWidth}
          passportNo={passportNo}
          discoveredCount={discoveredCount}
          wishlistCount={pendingSavedCount}
          visitedCount={visitedCount}
          monthLabel={issueMonth}
          tasteCategories={tasteCategories}
        />
      );
    }
    if (item.type === 'discovered') {
      return (
        <PassportTicketBookPage
          width={pageWidth}
          copy={getPassportSectionCopy('discovered')}
          mode="discovered"
          pageIndex={item.pageIndex}
          totalPages={discoveredBookPageCount}
          items={item.items}
          getVisitState={getVisitState}
          getSaveState={getSaveState}
          getStampSignal={getStampSignal}
          onPressTicket={handleTicketPress}
          onDirections={handleDirections}
          onVisit={handleVisit}
          onToggleSave={handleToggleSave}
        />
      );
    }
    if (item.type === 'wishlist') {
      return (
        <PassportTicketBookPage
          width={pageWidth}
          copy={getPassportSectionCopy('wishlist')}
          mode="wishlist"
          pageIndex={item.pageIndex}
          totalPages={wishlistBookPageCount}
          items={item.items}
          getVisitState={getVisitState}
          getSaveState={getSaveState}
          getStampSignal={getStampSignal}
          onPressTicket={handleTicketPress}
          onDirections={handleDirections}
          onVisit={handleVisit}
          onToggleSave={handleToggleSave}
        />
      );
    }
    if (item.type === 'stamps') {
      return (
        <PassportStampPage
          width={pageWidth}
          stamps={item.stamps}
          pageIndex={item.pageIndex}
          pageMonthLabel={pageMonthLabel(item.stamps)}
          onPressStamp={handlePressStamp}
        />
      );
    }
    return (
      <PassportBookStatePage
        width={pageWidth}
        section={item.section}
        copy={renderStateCopy(item.section)}
        state={item.type}
        onRetry={refresh}
      />
    );
  }, [
    discoveredBookPageCount,
    discoveredCount,
    getSaveState,
    getStampSignal,
    getVisitState,
    handleDirections,
    handlePressStamp,
    handleTicketPress,
    handleToggleSave,
    handleVisit,
    issueMonth,
    pageWidth,
    passportNo,
    pendingSavedCount,
    refresh,
    renderStateCopy,
    tasteCategories,
    visitedCount,
    wishlistBookPageCount,
  ]);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: top + 18 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={ON_BG_MUTED} />
        }
      >
        <ScrollViewInertialBackground topColor={BG} bottomColor={BG} />

        <Text style={styles.navTitle}>문화 여권</Text>

        <View style={styles.bookStage}>
          <FlatList
            ref={bookListRef}
            horizontal
            pagingEnabled
            data={bookPages}
            keyExtractor={(item) => item.key}
            renderItem={renderBookPage}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleBookMomentumEnd}
            onScrollToIndexFailed={handleScrollToIndexFailed}
            getItemLayout={(_, index) => ({
              length: pageWidth,
              offset: pageWidth * index,
              index,
            })}
          />
          <PassportIndexRail
            items={bookmarkItems}
            activeSection={activeBookmark}
            onPress={handlePressBookmark}
          />
        </View>
        <Text style={styles.bookHint}>책갈피를 누르거나 옆으로 넘겨요</Text>
      </ScrollView>

      <SavedVisitToast message={toastMessage} opacity={toastOpacity.current} />
      <StampDetailSheet
        stamp={activeStamp}
        ordinal={stampOrdinal}
        canceling={cancelingStamp}
        onClose={() => setActiveStamp(null)}
        onCancelStamp={handleCancelStamp}
        onOpenEvent={handleOpenEvent}
      />
      <BottomTabBar currentTab="passport" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 132,
  },
  navTitle: {
    color: ON_BG,
    fontSize: 24,
    lineHeight: 31,
    fontWeight: '800',
    fontFamily: 'Noto Serif KR',
    marginBottom: 14,
  },
  bookStage: {
    height: 520,
    marginHorizontal: -20,
    position: 'relative',
  },
  bookHint: {
    marginTop: 12,
    textAlign: 'center',
    color: ON_BG_MUTED,
    fontSize: 12.5,
    fontWeight: '700',
  },
});

export default PassportPage;
