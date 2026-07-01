import { createRoute, ScrollViewInertialBackground } from '@granite-js/react-native';
import { useSafeAreaInsets } from '@granite-js/native/react-native-safe-area-context';
import { Icon, Loader, useDialog } from '@toss/tds-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BottomTabBar } from '../components/BottomTabBar';
import { SavedTicketItem, SavedTicketRow, VisitButtonState } from '../components/saved/SavedTicketRow';
import { SavedVisitToast, SavedVisitToastMessage } from '../components/saved/SavedVisitToast';
import type { EventCardData } from '../data/events';
import { useAuth } from '../hooks/useAuth';
import http from '../lib/http';
import eventService from '../services/eventService';
import { markVisited } from '../services/visitService';
import type { GetLikesResponse } from '../types/serverSync';
import { getCurrentCoordsOrNull } from '../utils/currentLocation';
import { getLikesV2, subscribeStorageChange, type StoredEventItemV2 } from '../utils/storage';
import { openNaverMap } from '../utils/mapLinks';

export const Route = createRoute('/saved', {
  component: SavedPage,
});

const INK = '#16161A';
const INK_LINE = '#2C2C33';
const PAPER = '#F5F1E8';
const ON_INK = '#F2EEE5';
const ON_INK_MUTED = '#9A968E';
const BRONZE = '#B8924A';
const BLUE = '#3182F6';

type OrderedLike = {
  id: string;
  timestamp: string;
};

type EventWithWalk = EventCardData & {
  walkMinutes?: number | null;
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

function createFallbackItem(id: string, snapshot?: StoredEventItemV2): SavedTicketItem {
  if (snapshot) return snapshotToTicketItem(snapshot);
  return {
    id,
    title: '저장한 문화행사',
    lastKnownStatus: 'active',
  };
}

async function getOrderedLikes(isLoggedIn: boolean): Promise<{
  orderedLikes: OrderedLike[];
  localItems: StoredEventItemV2[];
  serverPath: string | null;
}> {
  const localLikes = await getLikesV2();

  if (!isLoggedIn) {
    return {
      orderedLikes: localLikes.items.map((item) => ({ id: item.id, timestamp: item.timestamp })),
      localItems: localLikes.items,
      serverPath: null,
    };
  }

  try {
    const { data } = await http.get<GetLikesResponse>('/users/me/likes');
    return {
      orderedLikes: data.items.map((item) => ({ id: item.eventId, timestamp: item.likedAt })),
      localItems: localLikes.items,
      serverPath: '/users/me/likes',
    };
  } catch {
    return {
      orderedLikes: localLikes.items.map((item) => ({ id: item.id, timestamp: item.timestamp })),
      localItems: localLikes.items,
      serverPath: null,
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

function SavedPage() {
  const { top } = useSafeAreaInsets();
  const navigation = Route.useNavigation();
  const dialog = useDialog();
  const { isLoggedIn, isLoading: authLoading } = useAuth();

  const [items, setItems] = useState<SavedTicketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [visitedIds, setVisitedIds] = useState<Set<string>>(() => new Set());
  const [markingIds, setMarkingIds] = useState<Set<string>>(() => new Set());
  const [stampSignals, setStampSignals] = useState<Record<string, number>>({});
  const [toastMessage, setToastMessage] = useState<SavedVisitToastMessage | null>(null);

  const toastOpacity = useRef(new Animated.Value(0));
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const loadSavedEvents = useCallback(async () => {
    setHasError(false);
    try {
      const { orderedLikes, localItems } = await getOrderedLikes(isLoggedIn);
      const localSnapshotMap = new Map(localItems.map((item) => [item.id, item]));
      const uniqueLikes = orderedLikes.filter((item, index, all) => (
        all.findIndex((candidate) => candidate.id === item.id) === index
      ));

      if (uniqueLikes.length === 0) {
        setItems([]);
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

      setItems(nextItems);
    } catch (error) {
      setHasError(true);
      if (__DEV__) console.error('[SavedPage][loadSavedEvents]', error);
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (authLoading) return;
    setLoading(true);
    loadSavedEvents().catch(() => {});
  }, [authLoading, loadSavedEvents]);

  useEffect(() => {
    const unsubscribe = subscribeStorageChange((event) => {
      if (event.type === 'likes') {
        loadSavedEvents().catch(() => {});
      }
    });
    return unsubscribe;
  }, [loadSavedEvents]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadSavedEvents();
    } finally {
      setRefreshing(false);
    }
  }, [loadSavedEvents]);

  const subtitle = useMemo(() => {
    if (loading) return '가보고 싶은 문화행사를 불러오고 있어요';
    if (items.length === 0) return '가보고 싶은 문화를 담아둘 수 있어요';
    return `가보고 싶은 문화 ${items.length}곳을 담아뒀어요`;
  }, [items.length, loading]);

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

  const handleVisit = useCallback(async (item: SavedTicketItem) => {
    if (visitedIds.has(item.id)) {
      showToast({
        title: '이미 도장을 찍었어요',
        description: '보너스 티켓은 행사마다 한 번만 받을 수 있어요.',
      });
      return;
    }

    if (markingIds.has(item.id)) return;

    if (!isLoggedIn) {
      await dialog.openAlert({
        title: '로그인하면 도장을 찍을 수 있어요',
        description: '다녀온 문화 기록과 티켓 보너스를 안전하게 보관해요.',
      });
      return;
    }

    addId(setMarkingIds, item.id);
    try {
      const coords = await getCurrentCoordsOrNull();
      const result = await markVisited(item.id, coords ?? undefined);

      if (result.alreadyVisited) {
        addId(setVisitedIds, item.id);
        showToast({
          title: '이미 가봤어요 도장이 있어요',
          description: '중복 보너스 없이 도장 기록만 확인했어요.',
        });
        return;
      }

      if (!result.verified) {
        if (result.reason === 'TOO_FAR') {
          showToast({
            title: '행사 근처에서 눌러야 도장을 받을 수 있어요',
            description: typeof result.distanceM === 'number'
              ? `지금은 행사장에서 약 ${Math.round(result.distanceM)}m 떨어져 있어요.`
              : '행사장 근처에서 다시 시도해 주세요.',
          });
          return;
        }

        if (result.reason === 'NO_LOCATION') {
          showToast({
            title: '위치 권한을 허용하고 다시 시도해 주세요',
            description: '현재 위치를 확인해야 도장을 받을 수 있어요.',
          });
          return;
        }

        if (result.reason === 'EVENT_NO_COORDS') {
          showToast({
            title: '행사 위치를 확인하지 못했어요',
            description: '도장을 찍을 수 있도록 위치 정보를 확인하고 있어요.',
          });
          return;
        }

        if (result.reason === 'OUT_OF_PERIOD') {
          showToast({
            title: '행사 기간에만 도장을 받을 수 있어요',
            description: '일정을 확인한 뒤 다시 시도해 주세요.',
          });
          return;
        }

        showToast({
          title: '도장을 찍지 못했어요',
          description: '잠시 후 다시 시도해 주세요.',
        });
        return;
      }

      addId(setVisitedIds, item.id);
      setStampSignals((prev) => ({ ...prev, [item.id]: (prev[item.id] ?? 0) + 1 }));
      if (result.bonusTickets > 0) {
        showToast({
          title: `+${result.bonusTickets} 티켓을 받았어요`,
          description: `문화 여권 도장 ${result.stampCount}개째예요.`,
        });
      } else {
        showToast({
          title: '도장을 찍었어요',
          description: `문화 여권 도장 ${result.stampCount}개째예요.`,
        });
      }
    } catch (error) {
      showToast({
        title: '도장을 찍지 못했어요',
        description: '잠시 후 다시 시도해 주세요.',
      });
      if (__DEV__) console.error('[SavedPage][markVisited]', error);
    } finally {
      removeId(setMarkingIds, item.id);
    }
  }, [dialog, isLoggedIn, markingIds, showToast, visitedIds]);

  const getVisitState = useCallback((id: string): VisitButtonState => {
    if (markingIds.has(id)) return 'loading';
    if (visitedIds.has(id)) return 'visited';
    return 'idle';
  }, [markingIds, visitedIds]);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={ON_INK} />}
      >
        <ScrollViewInertialBackground topColor={INK} bottomColor={INK} />
        <View style={[styles.header, { paddingTop: top + 18 }]}>
          <Text style={styles.title}>저장</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        {loading ? (
          <View style={styles.stateBox}>
            <Loader />
            <Text style={styles.stateTitle}>저장한 문화를 불러오고 있어요</Text>
          </View>
        ) : hasError && items.length === 0 ? (
          <View style={styles.stateBox}>
            <Icon name="icon-warning-mono" size={32} color={BRONZE} />
            <Text style={styles.stateTitle}>저장한 문화를 불러오지 못했어요</Text>
            <Pressable accessibilityRole="button" onPress={refresh} style={styles.retryButton}>
              <Text style={styles.retryText}>다시 불러오기</Text>
            </Pressable>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyTicket}>
            <View style={styles.emptyThumb}>
              <Icon name="icon-bookmark-mono" size={26} color={PAPER} />
            </View>
            <View style={styles.emptyContent}>
              <Text style={styles.emptyTitle}>아직 저장한 문화행사가 없어요</Text>
              <Text style={styles.emptySubtitle}>마음에 드는 카드를 저장하면 여기에 모여요.</Text>
            </View>
          </View>
        ) : (
          <View style={styles.list}>
            {items.map((item) => (
              <SavedTicketRow
                key={item.id}
                item={item}
                visitState={getVisitState(item.id)}
                stampSignal={stampSignals[item.id] ?? 0}
                onPress={handleTicketPress}
                onDirections={handleDirections}
                onVisit={handleVisit}
              />
            ))}
          </View>
        )}

        <View style={styles.footerSpace} />
      </ScrollView>

      <View pointerEvents="none" style={styles.bottomScrim} />
      <SavedVisitToast message={toastMessage} opacity={toastOpacity.current} />
      <BottomTabBar currentTab="saved" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: INK,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 4,
  },
  header: {
    paddingHorizontal: 22,
    paddingBottom: 14,
  },
  title: {
    color: ON_INK,
    fontSize: 24,
    lineHeight: 31,
    fontWeight: '800',
    fontFamily: 'Noto Serif KR',
  },
  subtitle: {
    marginTop: 4,
    color: ON_INK_MUTED,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  list: {
    paddingHorizontal: 18,
    paddingTop: 14,
    gap: 13,
  },
  stateBox: {
    marginHorizontal: 18,
    marginTop: 18,
    minHeight: 180,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: INK_LINE,
    backgroundColor: 'rgba(245,241,232,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  stateTitle: {
    marginTop: 12,
    color: ON_INK,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    minHeight: 38,
    borderRadius: 999,
    paddingHorizontal: 18,
    backgroundColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  emptyTicket: {
    marginHorizontal: 18,
    marginTop: 18,
    minHeight: 116,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: PAPER,
    borderWidth: 1,
    borderColor: '#E7E0D2',
    flexDirection: 'row',
  },
  emptyThumb: {
    width: 96,
    backgroundColor: '#332613',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContent: {
    flex: 1,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  emptyTitle: {
    color: '#1A1A1E',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    fontFamily: 'Noto Serif KR',
  },
  emptySubtitle: {
    marginTop: 6,
    color: '#6B6760',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  bottomScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 132,
    backgroundColor: 'rgba(22,22,26,0.72)',
  },
  footerSpace: {
    height: 128,
  },
});

export default SavedPage;
