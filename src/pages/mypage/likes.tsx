import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import {
  getLikesV2,
  subscribeStorageChange,
  writeLikesV2,
  emitStorageChangeEvent,
  StoredEventItemV2,
  LikesDataV2,
} from '../../utils/storage';
import eventService from '../../services/eventService';
import { EventCardData } from '../../data/events';
import { EventImage } from '../../components/EventImage';

/**
 * 렌더용 이벤트 데이터 (정상 + placeholder 통합)
 */
interface RenderableEvent extends EventCardData {
  isPlaceholder?: boolean; // placeholder 여부
  lastKnownStatus?: 'active' | 'ended' | 'deleted';
}

export const Route = createRoute('/mypage/likes', {
    component: LikesPage,
});

/**
 * 이벤트 카드 컴포넌트 (EventImage 사용으로 카테고리별 기본 이미지 지원)
 */
function EventCard({ event, onPress }: { event: RenderableEvent; onPress: () => void }) {
    if (__DEV__) {
        console.log('[LikesPage][EventCard] Rendering card', {
            eventId: event.id,
            category: event.category,
            thumbnailUrl: event.thumbnailUrl?.substring(0, 60),
            isPlaceholder: event.isPlaceholder,
            lastKnownStatus: event.lastKnownStatus,
        });
    }

    return (
        <TouchableOpacity
            style={styles.card}
            onPress={onPress}
            activeOpacity={0.8}
        >
            {/* 썸네일 - EventImage로 카테고리별 기본 이미지 지원 */}
            <View>
                <EventImage
                    uri={event.thumbnailUrl}
                    height={160}
                    borderRadius={0}
                    resizeMode="cover"
                    category={event.category}
                    accessibilityLabel={`${event.title} 썸네일`}
                />
                {/* 종료/삭제 배지 */}
                {event.isPlaceholder && event.lastKnownStatus !== 'active' && (
                    <View style={styles.statusBadge}>
                        <Text style={styles.statusBadgeText}>
                            {event.lastKnownStatus === 'deleted' ? '종료/삭제됨' : '종료됨'}
                        </Text>
                    </View>
                )}
            </View>

            {/* 정보 */}
            <View style={styles.cardInfo}>
                <Text style={[styles.cardTitle, event.isPlaceholder && styles.placeholderText]} numberOfLines={2}>
                    {event.title}
                </Text>
                <Text style={[styles.cardMeta, event.isPlaceholder && styles.placeholderText]} numberOfLines={1}>
                    {event.venue} · {event.region}
                </Text>
                {event.periodText && (
                    <Text style={[styles.cardPeriod, event.isPlaceholder && styles.placeholderText]} numberOfLines={1}>
                        {event.periodText}
                    </Text>
                )}
            </View>
        </TouchableOpacity>
    );
}

function LikesPage() {
    const navigation = Route.useNavigation();
    const [loading, setLoading] = useState(true);
    const [events, setEvents] = useState<RenderableEvent[]>([]);
    const [activeCount, setActiveCount] = useState(0);
    const [endedCount, setEndedCount] = useState(0);

    const loadLikes = useCallback(async () => {
        setLoading(true);
        try {
            console.log('[LikesPage][Load][START] Fetching all liked events...');

            const likesData = await getLikesV2();
            const totalIds = likesData.items.length;

            console.log('[LikesPage][Load] V2 data:', {
                totalItems: totalIds,
                items: likesData.items.slice(0, 5).map(item => ({ id: item.id, status: item.lastKnownStatus })),
            });

            if (totalIds === 0) {
                setEvents([]);
                setLoading(false);
                return;
            }

            // 모든 찜한 이벤트 가져오기 (병렬)
            const results = await Promise.allSettled(
                likesData.items.map((item) => eventService.getEventById(item.id))
            );

            const renderableEvents: RenderableEvent[] = [];
            let fetchedSuccessCount = 0;
            let placeholderCount = 0;

            // 결과 처리: 성공 + 실패(placeholder)
            likesData.items.forEach((item, index) => {
                const result = results[index];

                if (result.status === 'fulfilled' && result.value !== null) {
                    // API 성공 → 최신 데이터로 렌더
                    renderableEvents.push({
                        ...result.value,
                        isPlaceholder: false,
                        lastKnownStatus: 'active',
                    });
                    fetchedSuccessCount++;
                } else {
                    // API 실패 → snapshot 기반 placeholder로 렌더
                    const snapshot = item.snapshot;
                    const placeholderEvent: RenderableEvent = {
                        id: item.id,
                        title: snapshot?.title || '(제목 없음)',
                        venue: snapshot?.venue || '',
                        venueName: snapshot?.venue || '',
                        region: snapshot?.region || '기타',
                        category: (snapshot?.mainCategory as any) || '기타',
                        thumbnailUrl: snapshot?.imageUrl || undefined,
                        startAt: snapshot?.startAt || '',
                        endAt: snapshot?.endAt || '',
                        periodText: snapshot?.startAt && snapshot?.endAt
                            ? `${snapshot.startAt} ~ ${snapshot.endAt}`
                            : '',
                        isPlaceholder: true,
                        lastKnownStatus: 'deleted', // 404/500 → deleted로 간주
                    };
                    renderableEvents.push(placeholderEvent);
                    placeholderCount++;

                    // lastKnownStatus 업데이트 (storage에 기록)
                    item.lastKnownStatus = 'deleted';

                    console.log('[LikesPage][Load][Placeholder]', {
                        id: item.id,
                        reason: result.status === 'rejected' ? result.reason : 'no data',
                    });
                }
            });

            // Storage 업데이트 (lastKnownStatus 반영)
            await writeLikesV2(likesData);

            // 활성/종료 카운트 계산
            const active = renderableEvents.filter((e) => !e.isPlaceholder || e.lastKnownStatus === 'active').length;
            const ended = renderableEvents.length - active;

            console.log('[LikesPage][Load][COMPLETE]', {
                totalIds,
                fetchedSuccessCount,
                placeholderCount,
                finalRenderCount: renderableEvents.length,
                activeCount: active,
                endedCount: ended,
            });

            setEvents(renderableEvents);
            setActiveCount(active);
            setEndedCount(ended);
        } catch (error) {
            console.error('[LikesPage][Load][ERROR]', error);
        } finally {
            setLoading(false);
        }
    }, []);

    // 초기 로드
    useEffect(() => {
        loadLikes();
    }, [loadLikes]);

    // Storage 변경 이벤트 구독 (찜 변경 시 즉시 갱신)
    useEffect(() => {
        console.log('[LikesPage][StorageSubscribe] Subscribing to likes changes...');

        const unsubscribe = subscribeStorageChange((event) => {
            if (event.type === 'likes') {
                console.log('[LikesPage][StorageEvent] Likes changed, reloading...', {
                    action: event.action,
                    id: event.id,
                    count: event.count
                });
                loadLikes();
            }
        });

        return () => {
            console.log('[LikesPage][StorageUnsubscribe] Unsubscribing from storage events...');
            unsubscribe();
        };
    }, [loadLikes]);

    const handleBack = () => {
        navigation.goBack();
    };

    const handleEventPress = (eventId: string) => {
        navigation.navigate('/events/:id', { id: eventId });
    };

    const handleClearEnded = async () => {
        try {
            console.log('[LikesPage][ClearEnded][START]');
            
            const likesData = await getLikesV2();
            
            // 활성 이벤트만 남기기
            const activeItems = likesData.items.filter(
                (item) => item.lastKnownStatus === 'active'
            );
            
            await writeLikesV2({
                version: 2,
                items: activeItems,
            });
            
            console.log('[LikesPage][ClearEnded][COMPLETE]', {
                before: likesData.items.length,
                after: activeItems.length,
                removed: likesData.items.length - activeItems.length,
            });
            
            // Storage 변경 이벤트 수동 발행 (MyPage 업데이트용)
            emitStorageChangeEvent({
                type: 'likes',
                action: 'update',
                count: activeItems.length,
            });
            
            // 다시 로드
            loadLikes();
        } catch (error) {
            console.error('[LikesPage][ClearEnded][ERROR]', error);
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

            <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
                {loading ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color="#0064FF" />
                        <Text style={styles.loadingText}>불러오는 중...</Text>
                    </View>
                ) : events.length === 0 ? (
                    <View style={styles.emptyContainer}>
                        <Text style={styles.emptyIcon}>❤️</Text>
                        <Text style={styles.emptyText}>아직 찜한 행사가 없어요.</Text>
                        <Text style={styles.emptySubText}>마음에 드는 축제를 찜해보세요!</Text>
                    </View>
                ) : (
                    <>
                        {/* 종료된 이벤트만 있는 경우 안내 + 정리 버튼 */}
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
                                    style={styles.clearButton}
                                    onPress={handleClearEnded}
                                    activeOpacity={0.7}
                                >
                                    <Text style={styles.clearButtonText}>정리하기</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* 종료된 이벤트 정리 버튼 (일부만 종료된 경우) */}
                        {activeCount > 0 && endedCount > 0 && (
                            <View style={styles.cleanupBar}>
                                <Text style={styles.cleanupText}>
                                    종료된 이벤트 {endedCount}개
                                </Text>
                                <TouchableOpacity
                                    style={styles.cleanupButton}
                                    onPress={handleClearEnded}
                                    activeOpacity={0.7}
                                >
                                    <Text style={styles.cleanupButtonText}>정리</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        <View style={styles.cardList}>
                            {events.map((event) => (
                                <EventCard
                                    key={event.id}
                                    event={event}
                                    onPress={() => handleEventPress(event.id)}
                                />
                            ))}
                        </View>
                    </>
                )}
            </ScrollView>
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
        paddingTop: 50, // iOS safe area
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
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        marginBottom: 16,
        overflow: 'hidden',
        // Toss 감성: 그림자
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 12,
        elevation: 3,
    },
    cardThumbnail: {
        width: '100%',
        height: 160,
    },
    cardImage: {
        width: '100%',
        height: '100%',
    },
    cardPlaceholder: {
        width: '100%',
        height: '100%',
        backgroundColor: '#E5E8EB',
        alignItems: 'center',
        justifyContent: 'center',
    },
    placeholderIcon: {
        fontSize: 48,
    },
    cardInfo: {
        padding: 16,
    },
    cardTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: '#191F28',
        marginBottom: 8,
        lineHeight: 24,
    },
    cardMeta: {
        fontSize: 14,
        color: '#6B7684',
        marginBottom: 4,
    },
    cardPeriod: {
        fontSize: 13,
        color: '#8B95A1',
    },
    statusBadge: {
        position: 'absolute',
        top: 8,
        right: 8,
        backgroundColor: 'rgba(25, 31, 40, 0.85)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 6,
    },
    statusBadgeText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#FFFFFF',
    },
    placeholderText: {
        color: '#8B95A1',
    },
    endedNotice: {
        backgroundColor: '#FFF9E6',
        marginHorizontal: 20,
        marginTop: 20,
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
});
