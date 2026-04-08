import { createRoute, ScrollViewInertialBackground } from '@granite-js/react-native';
import { useSafeAreaInsets } from '@granite-js/native/react-native-safe-area-context';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ScrollView, StyleSheet, View, Text, TouchableOpacity, RefreshControl, Animated } from 'react-native';
import { Loader, Icon } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import {
  getRecentV2,
  subscribeStorageChange,
  removeRecentItem,
  clearRecent,
  writeRecentV2,
  emitStorageChangeEvent,
} from '../../utils/storage';
import eventService from '../../services/eventService';
import { isEventEnded, getTodayMidnight } from '../../utils/eventStatus';
import { MyPageEventCard, RenderableEventItem } from '../../components/MyPageEventCard';
import { useAuth } from '../../hooks/useAuth';
import http from '../../lib/http';
import type { GetRecentResponse } from '../../types/serverSync';

export const Route = createRoute('/mypage/recent', {
  component: RecentPage,
});

type UndoInfo =
  | { kind: 'single'; event: RenderableEventItem; index: number }
  | { kind: 'all'; events: RenderableEventItem[] };

type Adaptive = ReturnType<typeof useAdaptive>;

function createStyles(a: Adaptive) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: a.grey100,
    },
    header: {
      backgroundColor: a.background,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: a.grey200,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: a.grey900,
      flex: 1,
      textAlign: 'center',
    },
    clearAllButton: {
      width: 60,
      alignItems: 'flex-end',
      paddingRight: 4,
    },
    clearAllText: {
      fontSize: 14,
      fontWeight: '500',
      color: a.grey500,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      paddingVertical: 20,
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 80,
    },
    loadingText: {
      marginTop: 16,
      fontSize: 14,
      color: a.grey500,
    },
    errorContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 80,
      paddingHorizontal: 40,
    },
    errorText: {
      fontSize: 16,
      color: a.grey600,
      textAlign: 'center',
      marginBottom: 16,
    },
    retryButton: {
      paddingVertical: 10,
      paddingHorizontal: 24,
      backgroundColor: a.blue500,
      borderRadius: 8,
    },
    retryText: {
      fontSize: 14,
      fontWeight: '600',
      color: '#FFFFFF',
    },
    emptyContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 80,
      paddingHorizontal: 40,
    },
    emptyText: {
      fontSize: 18,
      fontWeight: '600',
      color: a.grey900,
      marginBottom: 8,
      textAlign: 'center',
    },
    emptySubText: {
      fontSize: 14,
      color: a.grey500,
      textAlign: 'center',
      marginBottom: 24,
    },
    emptyCta: {
      backgroundColor: a.blue500,
      paddingVertical: 13,
      paddingHorizontal: 28,
      borderRadius: 10,
    },
    emptyCtaText: {
      fontSize: 15,
      fontWeight: '600',
      color: '#FFFFFF',
    },
    cardList: {
      paddingHorizontal: 20,
    },
    undoToast: {
      position: 'absolute',
      bottom: 24,
      left: 20,
      right: 20,
      backgroundColor: a.grey900,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 18,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 12,
      elevation: 8,
    },
    undoToastText: {
      fontSize: 14,
      color: '#FFFFFF',
      fontWeight: '500',
    },
    undoToastAction: {
      fontSize: 14,
      color: a.blue300,
      fontWeight: '700',
    },
  });
}

function RecentPage() {
  const navigation = Route.useNavigation();
  const { isLoggedIn } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [events, setEvents] = useState<RenderableEventItem[]>([]);
  const [undoInfo, setUndoInfo] = useState<UndoInfo | null>(null);
  const [hasError, setHasError] = useState(false);

  const skipNextStorageReload = useRef(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastOpacity = useRef(new Animated.Value(0));
  const isLoggedInRef = useRef(isLoggedIn);

  // isLoggedIn이 변할 때마다 ref를 동기화 (loadRecent 의존성 제거용)
  useEffect(() => {
    isLoggedInRef.current = isLoggedIn;
  }, [isLoggedIn]);

  const adaptive = useAdaptive();
  const { top } = useSafeAreaInsets();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);

  const loadRecent = useCallback(async () => {
    setLoading(true);
    setHasError(false);
    try {
      // 로컬 데이터는 항상 로드 (snapshot 폴백용)
      const recentData = await getRecentV2();
      const localSnapshotMap = new Map(recentData.items.map((i) => [i.id, i.snapshot]));

      // 로그인 시 서버를 ID 소스로 사용, 실패 시 로컬로 폴백
      let orderedItems: Array<{ id: string; timestamp: string }>;
      if (isLoggedInRef.current) {
        try {
          const { data } = await http.get<GetRecentResponse>('/users/me/recent');
          orderedItems = data.items.map((i) => ({ id: i.eventId, timestamp: i.viewedAt }));
        } catch {
          if (__DEV__) console.warn('[RecentPage] 서버 조회 실패, 로컬로 폴백');
          orderedItems = recentData.items;
        }
      } else {
        orderedItems = recentData.items;
      }

      if (orderedItems.length === 0) {
        setEvents([]);
        setLoading(false);
        return;
      }

      const results = await Promise.allSettled(
        orderedItems.map((item) => eventService.getEventById(item.id))
      );

      const renderableEvents: RenderableEventItem[] = [];
      const today = getTodayMidnight();

      orderedItems.forEach((item, index) => {
        const result = results[index];
        if (!result) return;

        if (result.status === 'fulfilled' && result.value !== null) {
          const eventData = (result as PromiseFulfilledResult<typeof result.value>).value!;
          const isEnded = isEventEnded(eventData.endAt, today);

          renderableEvents.push({
            ...eventData,
            isPlaceholder: false,
            lastKnownStatus: isEnded ? 'ended' : 'active',
            viewedAt: item.timestamp,
          });
        } else {
          const snapshot = localSnapshotMap.get(item.id);
          renderableEvents.push({
            id: item.id,
            title: snapshot?.title || '(제목 없음)',
            venue: snapshot?.venue || '',
            region: (snapshot?.region as any) || '기타',
            category: (snapshot?.mainCategory as any) || '기타',
            thumbnailUrl: snapshot?.imageUrl ?? '',
            startAt: snapshot?.startAt || '',
            endAt: snapshot?.endAt || '',
            periodText:
              snapshot?.startAt && snapshot?.endAt
                ? `${snapshot.startAt} ~ ${snapshot.endAt}`
                : '',
            description: '',
            overview: '',
            tags: [],
            detailImageUrl: '',
            detailLink: '',
            isPlaceholder: true,
            lastKnownStatus: 'deleted',
            viewedAt: item.timestamp,
          });
        }
      });

      setEvents(renderableEvents);
    } catch (error) {
      setHasError(true);
      if (__DEV__) console.error('[RecentPage][Load][ERROR]', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  // 화면 포커스 시 재로드 (스택에서 돌아왔을 때 최신 데이터 반영)
  useEffect(() => {
    return navigation.addListener('focus', () => {
      if (!skipNextStorageReload.current) {
        loadRecent();
      }
    });
  }, [navigation, loadRecent]);

  // recent 변경 시만 갱신 (optimistic 업데이트로 인한 재호출은 스킵)
  useEffect(() => {
    const unsubscribe = subscribeStorageChange((event) => {
      if (event.type === 'recent') {
        if (skipNextStorageReload.current) {
          skipNextStorageReload.current = false;
          return;
        }
        loadRecent();
      }
    });
    return unsubscribe;
  }, [loadRecent]);

  // unmount 시 타이머 정리
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRecent();
    setRefreshing(false);
  }, [loadRecent]);

  const handleEventPress = (event: RenderableEventItem) => {
    if (event.isPlaceholder) return;
    navigation.navigate('/events/:id', { id: event.id });
  };

  // 공통: undo 토스트 표시 (이전 타이머 취소 후 새로 시작)
  const showUndoToast = (info: UndoInfo) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoInfo(info);
    toastOpacity.current.setValue(0);
    Animated.timing(toastOpacity.current, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    undoTimerRef.current = setTimeout(() => {
      Animated.timing(toastOpacity.current, { toValue: 0, duration: 200, useNativeDriver: true }).start(
        () => setUndoInfo(null)
      );
    }, 4000);
  };

  // 개별 삭제 (optimistic update + undo)
  const handleRemoveItem = async (eventId: string) => {
    const removedIndex = events.findIndex((e) => e.id === eventId);
    const removedEvent = removedIndex >= 0 ? events[removedIndex] : null;

    setEvents((prev) => prev.filter((e) => e.id !== eventId));

    if (removedEvent) {
      showUndoToast({ kind: 'single', event: removedEvent, index: removedIndex });
    }

    skipNextStorageReload.current = true;
    try {
      await removeRecentItem(eventId);
      // 로그인 시 서버에도 삭제 (fire-and-forget)
      if (isLoggedInRef.current) {
        http.delete(`/users/me/recent/${eventId}`).catch((e) => {
          if (__DEV__) console.warn('[RecentPage][Remove][Server]', e.message);
        });
      }
    } catch (error) {
      skipNextStorageReload.current = false;
      setUndoInfo(null);
      loadRecent();
      if (__DEV__) console.error('[RecentPage][Remove][ERROR]', error);
    }
  };

  // 전체 삭제 (optimistic update + undo, Alert 없음)
  const handleClearAll = async () => {
    const previousEvents = [...events];
    setEvents([]);
    showUndoToast({ kind: 'all', events: previousEvents });

    skipNextStorageReload.current = true;
    try {
      await clearRecent();
      // 로그인 시 서버에도 전체 삭제 (fire-and-forget)
      if (isLoggedInRef.current) {
        http.delete('/users/me/recent').catch((e) => {
          if (__DEV__) console.warn('[RecentPage][ClearAll][Server]', e.message);
        });
      }
    } catch (error) {
      skipNextStorageReload.current = false;
      setUndoInfo(null);
      loadRecent();
      if (__DEV__) console.error('[RecentPage][ClearAll][ERROR]', error);
    }
  };

  // Undo: 단건 또는 전체 복원
  const handleUndo = async () => {
    if (!undoInfo) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const info = undoInfo;

    // 토스트 페이드아웃 (state 복원과 동시 진행)
    Animated.timing(toastOpacity.current, { toValue: 0, duration: 150, useNativeDriver: true }).start(
      () => setUndoInfo(null)
    );

    if (info.kind === 'single') {
      const { event, index } = info;

      setEvents((prev) => {
        const next = [...prev];
        next.splice(index, 0, event);
        return next;
      });

      skipNextStorageReload.current = true;
      try {
        const recentData = await getRecentV2();
        const restoredItems = [...recentData.items];
        restoredItems.splice(Math.min(index, restoredItems.length), 0, {
          id: event.id,
          timestamp: event.viewedAt || new Date().toISOString(),
          lastKnownStatus: event.lastKnownStatus as any,
          snapshot: {
            title: event.title,
            venue: event.venue || '',
            imageUrl: event.thumbnailUrl,
            region: event.region as string,
            mainCategory: event.category as string,
            startAt: event.startAt,
            endAt: event.endAt,
          },
        });
        await writeRecentV2({ version: 2, items: restoredItems, totalCount: recentData.totalCount });
        emitStorageChangeEvent({ type: 'recent', action: 'update', count: restoredItems.length });
        // 로그인 시 서버에도 복원 (fire-and-forget)
        if (isLoggedInRef.current) {
          http.post('/users/me/recent/batch', {
            items: [{ eventId: event.id, viewedAt: event.viewedAt || new Date().toISOString() }],
          }).catch((e) => {
            if (__DEV__) console.warn('[RecentPage][Undo][Server]', e.message);
          });
        }
      } catch (error) {
        skipNextStorageReload.current = false;
        loadRecent();
        if (__DEV__) console.error('[RecentPage][Undo][ERROR]', error);
      }
    } else {
      // kind === 'all': 전체 복원
      setEvents(info.events);

      skipNextStorageReload.current = true;
      try {
        const restoredItems = info.events.map((event) => ({
          id: event.id,
          timestamp: event.viewedAt || new Date().toISOString(),
          lastKnownStatus: event.lastKnownStatus as any,
          snapshot: {
            title: event.title,
            venue: event.venue || '',
            imageUrl: event.thumbnailUrl,
            region: event.region as string,
            mainCategory: event.category as string,
            startAt: event.startAt,
            endAt: event.endAt,
          },
        }));
        await writeRecentV2({ version: 2, items: restoredItems, totalCount: restoredItems.length });
        emitStorageChangeEvent({ type: 'recent', action: 'update', count: restoredItems.length });
        // 로그인 시 서버에도 복원 (fire-and-forget)
        if (isLoggedInRef.current) {
          http.post('/users/me/recent/batch', {
            items: info.events.map((e) => ({
              eventId: e.id,
              viewedAt: e.viewedAt || new Date().toISOString(),
            })),
          }).catch((e) => {
            if (__DEV__) console.warn('[RecentPage][UndoAll][Server]', e.message);
          });
        }
      } catch (error) {
        skipNextStorageReload.current = false;
        loadRecent();
        if (__DEV__) console.error('[RecentPage][UndoAll][ERROR]', error);
      }
    }
  };

  return (
    <View style={styles.container}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: top }]}>
        <Text style={styles.headerTitle}>최근 본 이벤트</Text>
        {!loading && events.length > 0 && (
          <TouchableOpacity onPress={handleClearAll} style={styles.clearAllButton} activeOpacity={0.7}>
            <Text style={styles.clearAllText}>전체 삭제</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <ScrollViewInertialBackground topColor={adaptive.grey100} bottomColor={adaptive.grey100} />
        {loading ? (
          <View style={styles.loadingContainer}>
            <Loader size="large" type="primary" />
            <Text style={styles.loadingText}>불러오는 중...</Text>
          </View>
        ) : hasError ? (
          <View style={styles.errorContainer}>
            <Icon name="icon-warning-mono" size={48} color={adaptive.grey400} style={{ marginBottom: 16 }} />
            <Text style={styles.errorText}>불러오기에 실패했어요.</Text>
            <TouchableOpacity onPress={loadRecent} style={styles.retryButton} activeOpacity={0.7}>
              <Text style={styles.retryText}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        ) : events.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Icon name="icon-eye-mono" size={64} color={adaptive.grey300} style={{ marginBottom: 20 }} />
            <Text style={styles.emptyText}>최근 본 이벤트가 없어요.</Text>
            <Text style={styles.emptySubText}>축제를 둘러보고 기록을 남겨보세요!</Text>
            <TouchableOpacity
              style={styles.emptyCta}
              onPress={() => navigation.navigate('/explore')}
              activeOpacity={0.8}
            >
              <Text style={styles.emptyCtaText}>이벤트 둘러보기</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.cardList}>
            {events.map((event) => (
              <MyPageEventCard
                key={event.id}
                event={event}
                onPress={() => handleEventPress(event)}
                onDelete={() => handleRemoveItem(event.id)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* Undo 토스트 */}
      {undoInfo && (
        <Animated.View style={[styles.undoToast, { opacity: toastOpacity.current }]}>
          <Text style={styles.undoToastText}>
            {undoInfo.kind === 'all' ? '최근 기록을 모두 삭제했어요' : '최근 기록에서 삭제했어요'}
          </Text>
          <TouchableOpacity onPress={handleUndo} activeOpacity={0.7}>
            <Text style={styles.undoToastAction}>되돌리기</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  );
}
