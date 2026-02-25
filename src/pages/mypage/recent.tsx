import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ScrollView, StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, RefreshControl, Animated } from 'react-native';
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

export const Route = createRoute('/mypage/recent', {
  component: RecentPage,
});

type UndoInfo =
  | { kind: 'single'; event: RenderableEventItem; index: number }
  | { kind: 'all'; events: RenderableEventItem[] };

function RecentPage() {
  const navigation = Route.useNavigation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [events, setEvents] = useState<RenderableEventItem[]>([]);
  const [undoInfo, setUndoInfo] = useState<UndoInfo | null>(null);
  const [hasError, setHasError] = useState(false);

  const skipNextStorageReload = useRef(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastOpacity = useRef(new Animated.Value(0));

  const loadRecent = useCallback(async () => {
    setLoading(true);
    setHasError(false);
    try {
      const recentData = await getRecentV2();
      const totalIds = recentData.items.length;

      if (totalIds === 0) {
        setEvents([]);
        setLoading(false);
        return;
      }

      const results = await Promise.allSettled(
        recentData.items.map((item) => eventService.getEventById(item.id))
      );

      const renderableEvents: RenderableEventItem[] = [];
      const today = getTodayMidnight();

      recentData.items.forEach((item, index) => {
        const result = results[index];

        if (result.status === 'fulfilled' && result.value !== null) {
          const eventData = result.value;
          const isEnded = isEventEnded(eventData.endAt, today);

          renderableEvents.push({
            ...eventData,
            isPlaceholder: false,
            lastKnownStatus: isEnded ? 'ended' : 'active',
            viewedAt: item.timestamp,
          });
        } else {
          const snapshot = item.snapshot;
          renderableEvents.push({
            id: item.id,
            title: snapshot?.title || '(제목 없음)',
            venue: snapshot?.venue || '',
            venueName: snapshot?.venue || '',
            region: (snapshot?.region as any) || '기타',
            category: (snapshot?.mainCategory as any) || '기타',
            thumbnailUrl: snapshot?.imageUrl || undefined,
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

  const handleBack = () => navigation.goBack();

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
            venue: event.venueName || event.venue || '',
            imageUrl: event.thumbnailUrl,
            region: event.region as string,
            mainCategory: event.category as string,
            startAt: event.startAt,
            endAt: event.endAt,
          },
        });
        await writeRecentV2({ version: 2, items: restoredItems, totalCount: recentData.totalCount });
        emitStorageChangeEvent({ type: 'recent', action: 'update', count: restoredItems.length });
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
            venue: event.venueName || event.venue || '',
            imageUrl: event.thumbnailUrl,
            region: event.region as string,
            mainCategory: event.category as string,
            startAt: event.startAt,
            endAt: event.endAt,
          },
        }));
        await writeRecentV2({ version: 2, items: restoredItems, totalCount: restoredItems.length });
        emitStorageChangeEvent({ type: 'recent', action: 'update', count: restoredItems.length });
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
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton} activeOpacity={0.7}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>최근 본 이벤트</Text>
        {!loading && events.length > 0 ? (
          <TouchableOpacity onPress={handleClearAll} style={styles.clearAllButton} activeOpacity={0.7}>
            <Text style={styles.clearAllText}>전체 삭제</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerRight} />
        )}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#0064FF" />
            <Text style={styles.loadingText}>불러오는 중...</Text>
          </View>
        ) : hasError ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorText}>불러오기에 실패했어요.</Text>
            <TouchableOpacity onPress={loadRecent} style={styles.retryButton} activeOpacity={0.7}>
              <Text style={styles.retryText}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        ) : events.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>👀</Text>
            <Text style={styles.emptyText}>최근 본 이벤트가 없어요.</Text>
            <Text style={styles.emptySubText}>축제를 둘러보고 기록을 남겨보세요!</Text>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F4F6',
  },
  header: {
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    paddingTop: 50,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E8EB',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: {
    fontSize: 32,
    color: '#191F28',
    fontWeight: '300',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#191F28',
  },
  headerRight: {
    width: 60,
  },
  clearAllButton: {
    width: 60,
    alignItems: 'flex-end',
    paddingRight: 4,
  },
  clearAllText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#8B95A1',
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
    color: '#8B95A1',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: 40,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 16,
    color: '#6B7684',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    backgroundColor: '#0064FF',
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
  emptyIcon: {
    fontSize: 64,
    marginBottom: 20,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#191F28',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubText: {
    fontSize: 14,
    color: '#8B95A1',
    textAlign: 'center',
  },
  cardList: {
    paddingHorizontal: 20,
  },
  undoToast: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    backgroundColor: '#191F28',
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
    color: '#4DA3FF',
    fontWeight: '700',
  },
});
