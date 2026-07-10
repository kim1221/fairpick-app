import { createRoute, ScrollViewInertialBackground } from '@granite-js/react-native';
import { useDialog } from '@toss/tds-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
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
import { PassportDiscoverySummary } from '../components/passport/PassportDiscoverySummary';
import type { SavedTicketItem, SaveButtonState, VisitButtonState } from '../components/saved/SavedTicketRow';
import { SavedVisitToast, SavedVisitToastMessage } from '../components/saved/SavedVisitToast';
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
  getStampBookMeta,
  STAMPS_PER_PASSPORT_BOOK,
  type PassportBookPage,
  type PassportBookmarkSection,
  type PassportContentSection,
} from './passportLogic';

export const Route = createRoute('/passport', {
  component: PassportPage,
});

const BG = '#F7F5EF';
const ON_BG = '#171717';
const ON_BG_MUTED = '#716D66';
const GOLD = '#CBA15E';

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
  const { width: screenWidth } = useWindowDimensions();
  const navigation = Route.useNavigation();
  const dialog = useDialog();
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const bookListRef = useRef<FlatList<PassportBookPage<SavedTicketItem, PassportStamp>>>(null);
  const savingIdsRef = useRef<Set<string>>(new Set());
  const markingIdsRef = useRef<Set<string>>(new Set());
  const desiredBookSectionRef = useRef<PassportBookmarkSection>('discovered');
  const stampBookRef = useRef(1);
  const lastAlignedBookPageRef = useRef<string | null>(null);
  const [currentBookPage, setCurrentBookPage] = useState(0);
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());

  const [passport, setPassport] = useState<PassportResponse | null>(null);
  const [passportLoading, setPassportLoading] = useState(true);
  const [passportError, setPassportError] = useState(false);
  const [stampBook, setStampBook] = useState(1);
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

  const pageWidth = Math.max(screenWidth, 0);

  const setCurrentStampBook = useCallback((nextBook: number) => {
    stampBookRef.current = nextBook;
    setStampBook(nextBook);
  }, []);

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

  const loadPassport = useCallback(async (nextStampBook?: number) => {
    const requestedStampBook = nextStampBook ?? stampBookRef.current;
    setPassportError(false);
    try {
      let next = await getPassport({ stampBook: requestedStampBook });
      let normalizedStampBook = getStampBookMeta(
        next.visitedCount,
        next.stampBook ?? requestedStampBook,
        next.stampBookSize ?? STAMPS_PER_PASSPORT_BOOK,
      ).bookIndex;
      if (normalizedStampBook !== requestedStampBook) {
        next = await getPassport({ stampBook: normalizedStampBook });
        normalizedStampBook = getStampBookMeta(
          next.visitedCount,
          next.stampBook ?? normalizedStampBook,
          next.stampBookSize ?? STAMPS_PER_PASSPORT_BOOK,
        ).bookIndex;
      }
      setPassport(next);
      setCurrentStampBook(normalizedStampBook);
      setVisitedIds(new Set((next.visitedEventIds ?? next.stamps.map((stamp) => stamp.eventId)).map(String)));
    } catch {
      setPassportError(true);
    } finally {
      setPassportLoading(false);
    }
  }, [setCurrentStampBook]);

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
      await loadPassport(1).catch(() => {});
    } catch (error) {
      await loadPassport(1).catch(() => {});
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
        description: '다녀온 문화 기록을 컬렉션에 안전하게 보관해요.',
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
        await loadPassport(1).catch(() => {});
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
      await loadPassport(1).catch(() => {});
      if (!firstStampNoticeShownRef.current) {
        firstStampNoticeShownRef.current = true;
        showToast({
          title: '컬렉션에 방문 기록을 남겼어요',
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
  const stampBookMeta = useMemo(
    () => getStampBookMeta(
      visitedCount,
      stampBook,
      passport?.stampBookSize ?? STAMPS_PER_PASSPORT_BOOK,
    ),
    [passport?.stampBookSize, stampBook, visitedCount],
  );
  const stampOrdinal = useMemo(() => {
    if (!activeStamp) return null;
    const idx = stamps.findIndex(
      (stamp) => stamp.eventId === activeStamp.eventId && stamp.visitedAt === activeStamp.visitedAt,
    );
    if (idx < 0 || stampBookMeta.endOrdinal <= 0) return null;
    return Math.max(stampBookMeta.startOrdinal, stampBookMeta.endOrdinal - idx);
  }, [activeStamp, stampBookMeta.endOrdinal, stampBookMeta.startOrdinal, stamps]);
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
    }).filter((page) => page.section !== 'cover'),
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
    { section: 'discovered', label: `공개 ${discoveredCount}` },
    { section: 'wishlist', label: `저장 ${pendingSavedCount}` },
    { section: 'stamps', label: `방문 ${visitedCount}` },
  ], [discoveredCount, pendingSavedCount, visitedCount]);

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

    const alignmentKey = `${pageWidth}:${targetIndex}`;

    if (targetIndex !== currentBookPage) {
      setCurrentBookPage(targetIndex);
      if (pageWidth > 0) {
        requestAnimationFrame(() => {
          bookListRef.current?.scrollToIndex({ index: targetIndex, animated: false });
        });
        lastAlignedBookPageRef.current = alignmentKey;
      }
      return;
    }

    if (pageWidth > 0 && lastAlignedBookPageRef.current !== alignmentKey) {
      requestAnimationFrame(() => {
        bookListRef.current?.scrollToIndex({ index: targetIndex, animated: false });
      });
      lastAlignedBookPageRef.current = alignmentKey;
    }
  }, [bookPages, currentBookPage, pageWidth]);

  useEffect(() => {
    desiredBookSectionRef.current = activeBookmark;
  }, [activeBookmark]);

  const handleBookMomentumEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (bookPages.length === 0) return;
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / Math.max(pageWidth, 1));
    const validIndex = Math.max(0, Math.min(nextIndex, bookPages.length - 1));
    desiredBookSectionRef.current = bookPages[validIndex]?.section ?? 'discovered';
    setCurrentBookPage(validIndex);
  }, [bookPages, pageWidth]);

  const handlePressBookmark = useCallback((section: PassportBookmarkSection) => {
    desiredBookSectionRef.current = section;
    const index = bookmarkIndexes[section];
    setCurrentBookPage(index);
    if (pageWidth <= 0) return;
    bookListRef.current?.scrollToIndex({ index, animated: true });
    lastAlignedBookPageRef.current = `${pageWidth}:${index}`;
  }, [bookmarkIndexes, pageWidth]);

  const handleSelectStampBook = useCallback((nextBook: number) => {
    const nextMeta = getStampBookMeta(
      visitedCount,
      nextBook,
      passport?.stampBookSize ?? STAMPS_PER_PASSPORT_BOOK,
    );
    if (nextMeta.bookIndex === stampBook && !passportError) return;

    setActiveStamp(null);
    setCurrentStampBook(nextMeta.bookIndex);
    setPassport((prev) => prev ? { ...prev, stamps: [] } : prev);
    setPassportLoading(true);
    desiredBookSectionRef.current = 'stamps';
    const index = bookmarkIndexes.stamps;
    setCurrentBookPage(index);
    if (pageWidth > 0) {
      bookListRef.current?.scrollToIndex({ index, animated: true });
      lastAlignedBookPageRef.current = `${pageWidth}:${index}`;
    }
    loadPassport(nextMeta.bookIndex).catch(() => {});
  }, [
    bookmarkIndexes.stamps,
    loadPassport,
    pageWidth,
    passport?.stampBookSize,
    passportError,
    setCurrentStampBook,
    stampBook,
    visitedCount,
  ]);

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
      return (
        <PassportCoverPage
          width={pageWidth}
          passportNo={passportNo}
          discoveredCount={discoveredCount}
          wishlistCount={pendingSavedCount}
          visitedCount={visitedCount}
        />
      );
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
          bookLabel={stampBookMeta.label}
          rangeLabel={stampBookMeta.rangeLabel}
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
    stampBookMeta.label,
    stampBookMeta.rangeLabel,
    tasteCategories,
    visitedCount,
    wishlistBookPageCount,
  ]);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={ON_BG_MUTED} />
        }
      >
        <ScrollViewInertialBackground topColor={BG} bottomColor={BG} />

        <Text style={styles.navEyebrow}>THE CULTURE ARCHIVE</Text>
        <Text style={styles.navTitle}>나의 컬렉션</Text>
        <Text style={styles.navDescription}>광고로 공개하고, 저장하고, 직접 다녀온 문화를 한곳에 모았어요.</Text>

        <PassportDiscoverySummary passport={passport} />
        <PassportIndexRail
          items={bookmarkItems}
          activeSection={activeBookmark}
          onPress={handlePressBookmark}
        />
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
        </View>
        <Text style={styles.bookHint}>탭을 누르거나 옆으로 넘겨 컬렉션을 살펴보세요</Text>
        {activeBookmark === 'stamps' && stampBookMeta.totalBooks > 1 ? (
          <View style={styles.stampBookPager}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="새 도장권 보기"
              disabled={!stampBookMeta.hasNewerBook || passportLoading}
              onPress={() => handleSelectStampBook(stampBook - 1)}
              style={[
                styles.stampBookButton,
                !stampBookMeta.hasNewerBook || passportLoading ? styles.stampBookButtonDisabled : null,
              ]}
            >
              <Text
                style={[
                  styles.stampBookButtonText,
                  !stampBookMeta.hasNewerBook || passportLoading ? styles.stampBookButtonTextDisabled : null,
                ]}
              >
                새 권
              </Text>
            </Pressable>
            <View style={styles.stampBookStatus}>
              <Text style={styles.stampBookTitle} numberOfLines={1}>{stampBookMeta.label}</Text>
              <Text style={styles.stampBookRange} numberOfLines={1}>{stampBookMeta.rangeLabel}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="지난 도장권 보기"
              disabled={!stampBookMeta.hasOlderBook || passportLoading}
              onPress={() => handleSelectStampBook(stampBook + 1)}
              style={[
                styles.stampBookButton,
                !stampBookMeta.hasOlderBook || passportLoading ? styles.stampBookButtonDisabled : null,
              ]}
            >
              <Text
                style={[
                  styles.stampBookButtonText,
                  !stampBookMeta.hasOlderBook || passportLoading ? styles.stampBookButtonTextDisabled : null,
                ]}
              >
                지난 권
              </Text>
            </Pressable>
          </View>
        ) : null}
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
    paddingTop: 18,
    paddingBottom: 124,
  },
  navTitle: {
    color: ON_BG,
    fontSize: 34,
    lineHeight: 41,
    fontWeight: '900',
    letterSpacing: -1,
    marginTop: 5,
    fontFamily: 'Noto Serif KR',
    marginBottom: 4,
  },
  navEyebrow: {
    color: '#A52822',
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 1.6,
  },
  navDescription: {
    color: ON_BG_MUTED,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    marginBottom: 2,
  },
  bookStage: {
    height: 400,
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
  stampBookPager: {
    marginTop: 14,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stampBookButton: {
    minWidth: 74,
    minHeight: 42,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(203,161,94,0.54)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: 'rgba(203,161,94,0.16)',
  },
  stampBookButtonDisabled: {
    borderColor: 'rgba(176,164,142,0.2)',
    backgroundColor: 'rgba(176,164,142,0.08)',
  },
  stampBookButtonText: {
    color: GOLD,
    fontSize: 13,
    fontWeight: '900',
  },
  stampBookButtonTextDisabled: {
    color: 'rgba(176,164,142,0.38)',
  },
  stampBookStatus: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stampBookTitle: {
    color: ON_BG,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
    fontFamily: 'Noto Serif KR',
  },
  stampBookRange: {
    marginTop: 2,
    color: ON_BG_MUTED,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
});

export default PassportPage;
