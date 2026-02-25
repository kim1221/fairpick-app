import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ScrollView, StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, RefreshControl, Animated } from 'react-native';
import {
  getLikesV2,
  subscribeStorageChange,
  writeLikesV2,
  emitStorageChangeEvent,
  toggleLike,
} from '../../utils/storage';
import eventService from '../../services/eventService';
import { isEventEnded, isStoredItemActive, getTodayMidnight } from '../../utils/eventStatus';
import { MyPageEventCard, RenderableEventItem } from '../../components/MyPageEventCard';

export const Route = createRoute('/mypage/likes', {
  component: LikesPage,
});

function LikesPage() {
  const navigation = Route.useNavigation();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<RenderableEventItem[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [endedCount, setEndedCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [undoItem, setUndoItem] = useState<{ event: RenderableEventItem; index: number } | null>(null);
  const [hasError, setHasError] = useState(false);
  const [clearingEnded, setClearingEnded] = useState(false);
  const skipNextStorageReload = useRef(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastOpacity = useRef(new Animated.Value(0));

  const loadLikes = useCallback(async () => {
    setLoading(true);
    setHasError(false);
    try {
      const likesData = await getLikesV2();
      const totalIds = likesData.items.length;

      if (totalIds === 0) {
        setEvents([]);
        setLoading(false);
        return;
      }

      const results = await Promise.allSettled(
        likesData.items.map((item) => eventService.getEventById(item.id))
      );

      const renderableEvents: RenderableEventItem[] = [];
      const today = getTodayMidnight();

      likesData.items.forEach((item, index) => {
        const result = results[index];

        if (result.status === 'fulfilled' && result.value !== null) {
          const eventData = result.value;
          // end_at 기반 종료 판정: API 성공이어도 이미 끝난 이벤트면 'ended'
          const isEnded = isEventEnded(eventData.endAt, today);

          renderableEvents.push({
            ...eventData,
            isPlaceholder: false,
            lastKnownStatus: isEnded ? 'ended' : 'active',
          });

          // storage의 lastKnownStatus 업데이트
          item.lastKnownStatus = isEnded ? 'ended' : 'active';
        } else {
          // API 실패 → snapshot 기반 placeholder
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
          });
          item.lastKnownStatus = 'deleted';
        }
      });

      await writeLikesV2(likesData);

      setEvents(renderableEvents);
    } catch (error) {
      setHasError(true);
      if (__DEV__) console.error('[LikesPage][Load][ERROR]', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLikes();
  }, [loadLikes]);

  // likes 변경 시만 갱신 (optimistic 업데이트로 인한 재호출은 스킵)
  useEffect(() => {
    const unsubscribe = subscribeStorageChange((event) => {
      if (event.type === 'likes') {
        if (skipNextStorageReload.current) {
          skipNextStorageReload.current = false;
          return;
        }
        loadLikes();
      }
    });
    return unsubscribe;
  }, [loadLikes]);

  // events 변경 시 카운트 파생 (state updater 내 side effect 제거)
  useEffect(() => {
    const active = events.filter((e) => e.lastKnownStatus === 'active').length;
    setActiveCount(active);
    setEndedCount(events.length - active);
  }, [events]);

  // unmount 시 타이머 정리
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadLikes();
    setRefreshing(false);
  }, [loadLikes]);

  const handleBack = () => navigation.goBack();

  const handleEventPress = (event: RenderableEventItem) => {
    if (event.isPlaceholder) return; // deleted: real data 없음
    navigation.navigate('/events/:id', { id: event.id });
  };

  // 카드에서 즉시 찜 해제 (optimistic 업데이트 + Undo 토스트)
  const handleUnlike = async (eventId: string) => {
    // 1. 기존 undo 타이머 취소
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);

    // 2. updater 외부에서 제거 항목 파악 (state updater 내 side effect 방지)
    const removedIndex = events.findIndex((e) => e.id === eventId);
    const removedEvent = removedIndex >= 0 ? events[removedIndex] : null;

    setEvents((prev) => prev.filter((e) => e.id !== eventId));

    // 3. Undo 토스트 페이드인 표시 (4초 후 페이드아웃)
    if (removedEvent) {
      setUndoItem({ event: removedEvent, index: removedIndex });
      toastOpacity.current.setValue(0);
      Animated.timing(toastOpacity.current, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      undoTimerRef.current = setTimeout(() => {
        Animated.timing(toastOpacity.current, { toValue: 0, duration: 200, useNativeDriver: true }).start(
          () => setUndoItem(null)
        );
      }, 4000);
    }

    // 4. storage 이벤트로 인한 loadLikes 재호출 방지
    skipNextStorageReload.current = true;

    try {
      await toggleLike(eventId);
    } catch (error) {
      skipNextStorageReload.current = false;
      setUndoItem(null);
      loadLikes();
      if (__DEV__) console.error('[LikesPage][Unlike][ERROR]', error);
    }
  };

  // Undo: 찜 복원
  const handleUndo = async () => {
    if (!undoItem) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const { event, index } = undoItem;

    // 토스트 페이드아웃 (state 복원과 동시 진행)
    Animated.timing(toastOpacity.current, { toValue: 0, duration: 150, useNativeDriver: true }).start(
      () => setUndoItem(null)
    );

    // state 즉시 복원 (원래 위치에 삽입)
    setEvents((prev) => {
      const next = [...prev];
      next.splice(index, 0, event);
      return next;
    });

    skipNextStorageReload.current = true;

    try {
      await toggleLike(event.id, {
        title: event.title,
        venue: event.venueName || event.venue,
        imageUrl: event.thumbnailUrl,
        region: event.region as string,
        mainCategory: event.category as string,
        startAt: event.startAt,
        endAt: event.endAt,
      });
    } catch (error) {
      skipNextStorageReload.current = false;
      loadLikes();
      if (__DEV__) console.error('[LikesPage][Undo][ERROR]', error);
    }
  };

  // 종료된 이벤트만 일괄 삭제 (중복 탭 방지)
  const handleClearEnded = async () => {
    if (clearingEnded) return;
    setClearingEnded(true);
    try {
      const likesData = await getLikesV2();
      const today = getTodayMidnight();
      const activeItems = likesData.items.filter((item) => isStoredItemActive(item, today));
      await writeLikesV2({ version: 2, items: activeItems });
      emitStorageChangeEvent({
        type: 'likes',
        action: 'update',
        count: activeItems.length,
      });
    } catch (error) {
      if (__DEV__) console.error('[LikesPage][ClearEnded][ERROR]', error);
    } finally {
      setClearingEnded(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton} activeOpacity={0.7}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>찜한 목록</Text>
        <View style={styles.headerRight} />
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
            <TouchableOpacity onPress={loadLikes} style={styles.retryButton} activeOpacity={0.7}>
              <Text style={styles.retryText}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        ) : events.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>❤️</Text>
            <Text style={styles.emptyText}>아직 찜한 행사가 없어요.</Text>
            <Text style={styles.emptySubText}>마음에 드는 축제를 찜해보세요!</Text>
          </View>
        ) : (
          <>
            {/* 전부 종료된 경우 */}
            {activeCount === 0 && endedCount > 0 && (
              <View style={styles.endedNotice}>
                <View style={styles.endedNoticeContent}>
                  <Text style={styles.endedNoticeIcon}>📭</Text>
                  <View style={styles.endedNoticeTextContainer}>
                    <Text style={styles.endedNoticeText}>
                      찜한 목록 중 종료된 이벤트만 있습니다.
                    </Text>
                    <Text style={styles.endedNoticeSubText}>
                      종료된 이벤트 {endedCount}개
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.clearButton, clearingEnded && styles.clearButtonDisabled]}
                  onPress={handleClearEnded}
                  activeOpacity={0.7}
                  disabled={clearingEnded}
                >
                  <Text style={styles.clearButtonText}>{clearingEnded ? '정리 중...' : '정리하기'}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* 일부 종료된 경우 */}
            {activeCount > 0 && endedCount > 0 && (
              <View style={styles.cleanupBar}>
                <Text style={styles.cleanupText}>종료된 이벤트 {endedCount}개</Text>
                <TouchableOpacity
                  style={[styles.cleanupButton, clearingEnded && styles.cleanupButtonDisabled]}
                  onPress={handleClearEnded}
                  activeOpacity={0.7}
                  disabled={clearingEnded}
                >
                  <Text style={styles.cleanupButtonText}>정리</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.cardList}>
              {events.map((event) => (
                <MyPageEventCard
                  key={event.id}
                  event={event}
                  onPress={() => handleEventPress(event)}
                  onDelete={() => handleUnlike(event.id)}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* Undo 토스트 */}
      {undoItem && (
        <Animated.View style={[styles.undoToast, { opacity: toastOpacity.current }]}>
          <Text style={styles.undoToastText}>찜을 해제했어요</Text>
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
    width: 40,
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
  endedNotice: {
    backgroundColor: '#FFF9E6',
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FFE8A3',
  },
  endedNoticeContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  endedNoticeIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  endedNoticeTextContainer: {
    flex: 1,
  },
  endedNoticeText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#191F28',
    marginBottom: 4,
  },
  endedNoticeSubText: {
    fontSize: 13,
    color: '#6B7684',
  },
  clearButton: {
    backgroundColor: '#0064FF',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  clearButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  cleanupBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginBottom: 8,
  },
  cleanupText: {
    fontSize: 14,
    color: '#6B7684',
  },
  cleanupButton: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: '#F2F4F6',
  },
  cleanupButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0064FF',
  },
  cleanupButtonDisabled: {
    opacity: 0.5,
  },
  clearButtonDisabled: {
    opacity: 0.6,
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
