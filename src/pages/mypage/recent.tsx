import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import {
  getRecentV2,
  subscribeStorageChange,
  writeRecentV2,
  StoredEventItemV2,
  RecentDataV2,
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

export const Route = createRoute('/mypage/recent', {
    component: RecentPage,
});

/**
 * 이벤트 카드 컴포넌트 (EventImage 사용으로 카테고리별 기본 이미지 지원)
 */
function EventCard({ event, onPress }: { event: RenderableEvent; onPress: () => void }) {
    if (__DEV__) {
        console.log('[RecentPage][EventCard] Rendering card', {
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

function RecentPage() {
    const navigation = Route.useNavigation();
    const [loading, setLoading] = useState(true);
    const [events, setEvents] = useState<RenderableEvent[]>([]);

    const loadRecent = useCallback(async () => {
        setLoading(true);
        try {
            console.log('[RecentPage][Load][START] Fetching all recent events...');

            const recentData = await getRecentV2();
            const totalIds = recentData.items.length;

            console.log('[RecentPage][Load] V2 data:', {
                totalItems: totalIds,
                totalCount: recentData.totalCount,
                items: recentData.items.slice(0, 5).map(item => ({ id: item.id, status: item.lastKnownStatus })),
            });

            if (totalIds === 0) {
                setEvents([]);
                setLoading(false);
                return;
            }

            // 모든 최근 본 이벤트 가져오기 (병렬)
            const results = await Promise.allSettled(
                recentData.items.map((item) => eventService.getEventById(item.id))
            );

            const renderableEvents: RenderableEvent[] = [];
            let fetchedSuccessCount = 0;
            let placeholderCount = 0;

            // 결과 처리: 성공 + 실패(placeholder)
            recentData.items.forEach((item, index) => {
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

                    console.log('[RecentPage][Load][Placeholder]', {
                        id: item.id,
                        reason: result.status === 'rejected' ? result.reason : 'no data',
                    });
                }
            });

            // Storage 업데이트 (lastKnownStatus 반영)
            await writeRecentV2(recentData);

            console.log('[RecentPage][Load][COMPLETE]', {
                totalIds,
                fetchedSuccessCount,
                placeholderCount,
                finalRenderCount: renderableEvents.length,
            });

            setEvents(renderableEvents);
        } catch (error) {
            console.error('[RecentPage][Load][ERROR]', error);
        } finally {
            setLoading(false);
        }
    }, []);

    // 초기 로드
    useEffect(() => {
        loadRecent();
    }, [loadRecent]);

    // Storage 변경 이벤트 구독 (최근본/찜 변경 시 즉시 갱신)
    useEffect(() => {
        console.log('[RecentPage][StorageSubscribe] Subscribing to storage changes...');

        const unsubscribe = subscribeStorageChange((event) => {
            // 최근본이 추가되거나 찜이 변경되면 다시 로드 (찜 상태도 표시될 수 있음)
            console.log('[RecentPage][StorageEvent] Storage changed, reloading...', {
                type: event.type,
                action: event.action,
                id: event.id,
                count: event.count
            });
            loadRecent();
        });

        return () => {
            console.log('[RecentPage][StorageUnsubscribe] Unsubscribing from storage events...');
            unsubscribe();
        };
    }, [loadRecent]);

    const handleBack = () => {
        navigation.goBack();
    };

    const handleEventPress = (eventId: string) => {
        navigation.navigate('/events/:id', { id: eventId });
    };

    return (
        <View style={styles.container}>
            {/* 헤더 */}
            <View style={styles.header}>
                <TouchableOpacity onPress={handleBack} style={styles.backButton} activeOpacity={0.7}>
                    <Text style={styles.backIcon}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>최근 본 이벤트</Text>
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
                        <Text style={styles.emptyIcon}>👀</Text>
                        <Text style={styles.emptyText}>최근 본 이벤트가 없어요.</Text>
                        <Text style={styles.emptySubText}>축제를 둘러보고 기록을 남겨보세요!</Text>
                    </View>
                ) : (
                    <View style={styles.cardList}>
                        {events.map((event) => (
                            <EventCard
                                key={event.id}
                                event={event}
                                onPress={() => handleEventPress(event.id)}
                            />
                        ))}
                    </View>
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
});
