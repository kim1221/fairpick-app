import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ScrollView, StyleSheet, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { BottomTabBar } from '../components/BottomTabBar';
import {
  getLikesV2,
  getRecentV2,
  __debugStorageSmokeTest,
  subscribeStorageChange,
} from '../utils/storage';
import eventService from '../services/eventService';
import { EventCardData } from '../data/events';
import { EventImage } from '../components/EventImage';

export const Route = createRoute('/mypage', {
    component: MyPage,
});

/**
 * 썸네일이 포함된 리스트 아이템 컴포넌트
 * - EventImage 사용으로 카테고리별 기본 이미지 지원
 */
function ThumbnailListItem({
    event,
    onPress
}: {
    event: EventCardData;
    onPress: () => void;
}) {
    if (__DEV__) {
        console.log('[ThumbnailListItem] Rendering item', {
            eventId: event.id,
            category: event.category,
            thumbnailUrl: event.thumbnailUrl?.substring(0, 60),
        });
    }

    return (
        <TouchableOpacity
            style={styles.listItem}
            onPress={onPress}
            activeOpacity={0.7}
        >
            {/* 썸네일 - EventImage로 카테고리별 기본 이미지 지원 */}
            <View style={styles.thumbnail}>
                <EventImage
                    uri={event.thumbnailUrl}
                    height={50}
                    borderRadius={8}
                    resizeMode="cover"
                    category={event.category}
                    accessibilityLabel={`${event.title} 썸네일`}
                />
            </View>

            {/* 정보 */}
            <View style={styles.listInfo}>
                <Text style={styles.listTitle} numberOfLines={2}>
                    {event.title}
                </Text>
                <Text style={styles.listMeta} numberOfLines={1}>
                    {event.venue} · {event.region}
                </Text>
            </View>

            <Text style={styles.listChevron}>›</Text>
        </TouchableOpacity>
    );
}

function MyPage() {
    const navigation = Route.useNavigation();
    const [likesCount, setLikesCount] = useState(0);
    const [likesActiveCount, setLikesActiveCount] = useState(0); // 활성 이벤트 수
    const [recentCount, setRecentCount] = useState(0); // totalCount (누적)
    const [likeEvents, setLikeEvents] = useState<EventCardData[]>([]);
    const [recentEvents, setRecentEvents] = useState<EventCardData[]>([]);
    const [loading, setLoading] = useState(true);
    const lastLoadTimeRef = useRef<number>(0);
    const smokeTestRanRef = useRef<boolean>(false);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            console.log('[MyPage][Load][START] Fetching storage data...', {
                timestamp: new Date().toISOString()
            });

            const likesData = await getLikesV2();
            const recentData = await getRecentV2();

            // 찜한 목록 중 활성 이벤트 수 계산
            const activeCount = likesData.items.filter(
                (item) => item.lastKnownStatus === 'active'
            ).length;

            console.log('[MyPage][Load][AFTER_STORAGE]', {
                likesCount: likesData.items.length,
                likesActiveCount: activeCount,
                likesEndedCount: likesData.items.length - activeCount,
                recentCount: recentData.totalCount, // V2: totalCount 사용
                recentItemsCount: recentData.items.length,
                timestamp: new Date().toISOString()
            });

            setLikesCount(likesData.items.length);
            setLikesActiveCount(activeCount);
            setRecentCount(recentData.totalCount); // V2: totalCount로 표시

            // 찜한 이벤트 데이터 조회 (미리보기: 최대 3개)
            if (likesData.items.length > 0) {
                console.log(`[MyPage][Likes][API_START] Fetching ${Math.min(likesData.items.length, 3)} like events...`);

                const likeResults = await Promise.allSettled(
                    likesData.items.slice(0, 3).map(item => eventService.getEventById(item.id))
                );

                const likes = likeResults
                    .filter((result): result is PromiseFulfilledResult<EventCardData> =>
                        result.status === 'fulfilled' && result.value !== null
                    )
                    .map(result => result.value);

                console.log(`[MyPage][Likes][API_COMPLETE] Loaded ${likes.length} like events`);
                setLikeEvents(likes);
            } else {
                setLikeEvents([]);
            }

            // 최근 본 이벤트 데이터 조회 (미리보기: 최대 3개)
            if (recentData.items.length > 0) {
                console.log(`[MyPage][Recent][API_START] Fetching ${Math.min(recentData.items.length, 3)} recent events...`);

                const recentResults = await Promise.allSettled(
                    recentData.items.slice(0, 3).map(item => eventService.getEventById(item.id))
                );

                const recents = recentResults
                    .filter((result): result is PromiseFulfilledResult<EventCardData> =>
                        result.status === 'fulfilled' && result.value !== null
                    )
                    .map(result => result.value);

                console.log(`[MyPage][Recent][API_COMPLETE] Loaded ${recents.length} recent events`);
                setRecentEvents(recents);
            } else {
                console.log('[MyPage][Recent][EMPTY] No recent events to load', {
                    recentItemsLength: recentData.items.length,
                    timestamp: new Date().toISOString()
                });
                setRecentEvents([]);
            }

            lastLoadTimeRef.current = Date.now();
        } catch (error) {
            console.error('[MyPage][Load][EXCEPTION] Failed to load data', {
                error,
                errorMessage: error instanceof Error ? error.message : String(error),
                errorStack: error instanceof Error ? error.stack : undefined
            });
        } finally {
            setLoading(false);
            console.log('[MyPage][Load][END] Loading complete', {
                likesCount,
                recentCount,
                timestamp: new Date().toISOString()
            });
        }
    }, []);

    // 초기 로드 + Storage 스모크 테스트 (1회만)
    useEffect(() => {
        console.log('[MyPage][InitialLoad] First mount, loading data...');

        // [STEP 3] Storage 스모크 테스트 (1회만 실행)
        if (!smokeTestRanRef.current) {
            smokeTestRanRef.current = true;
            __debugStorageSmokeTest().catch(err => {
                console.error('[MyPage] Smoke test exception:', err);
            });
        }

        loadData();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Storage 변경 이벤트 구독 (찜/최근본 변경 시 즉시 갱신)
    useEffect(() => {
        console.log('[MyPage][StorageSubscribe] Subscribing to storage change events...');

        const unsubscribe = subscribeStorageChange((event) => {
            console.log('[MyPage][StorageEvent] Storage changed, reloading...', {
                eventType: event.type,
                eventAction: event.action,
                eventId: event.id,
                eventCount: event.count,
                timestamp: new Date().toISOString()
            });

            // Storage 변경 시 즉시 데이터 다시 로드
            loadData();
        });

        // 컴포넌트 언마운트 시 구독 해제
        return () => {
            console.log('[MyPage][StorageUnsubscribe] Unsubscribing from storage events...');
            unsubscribe();
        };
    }, [loadData]);

    const handleGoHome = () => {
        navigation.navigate('/');
    };

    const handleViewAllLikes = () => {
        navigation.navigate('/mypage/likes' as any);
    };

    const handleViewAllRecent = () => {
        navigation.navigate('/mypage/recent' as any);
    };

    const isEmpty = likesCount === 0 && recentCount === 0;

    return (
        <View style={styles.container}>
            <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
                {/* 헤더 */}
                <View style={styles.header}>
                    <Text style={styles.headerTitle}>내 활동</Text>
                </View>

                {/* 프로필 섹션 */}
                <View style={styles.profileSection}>
                    <View style={styles.avatarContainer}>
                        <Text style={styles.avatarIcon}>👤</Text>
                    </View>
                    <Text style={styles.welcomeText}>반가워요! 내 활동 기록을 확인해보세요.</Text>
                    <Text style={styles.infoText}>
                        내가 찜한 목록과 최근 본 이벤트는 이 기기에 자동으로 저장됩니다.
                    </Text>
                </View>

                {isEmpty ? (
                    /* Empty State */
                    <View style={styles.emptyStateContainer}>
                        <Text style={styles.emptyStateIcon}>📭</Text>
                        <Text style={styles.emptyStateText}>
                            아직 활동 기록이 없어요.{'\n'}축제를 구경해보러 갈까요?
                        </Text>
                        <TouchableOpacity
                            style={styles.goHomeButton}
                            onPress={handleGoHome}
                            activeOpacity={0.7}
                        >
                            <Text style={styles.goHomeButtonText}>홈으로 가기</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <>
                        {/* 통계 섹션 - Toss Blue 고도화 */}
                        <View style={styles.statsSection}>
                            <View style={styles.statItem}>
                                <Text style={styles.statNumber}>{likesCount}</Text>
                                <Text style={styles.statLabel}>찜한 수</Text>
                                {likesCount > 0 && (
                                    <Text style={styles.statDetail}>
                                        활성 {likesActiveCount}개 · 종료 {likesCount - likesActiveCount}개
                                    </Text>
                                )}
                            </View>
                            <View style={styles.statDivider} />
                            <View style={styles.statItem}>
                                <Text style={styles.statNumber}>{recentCount}</Text>
                                <Text style={styles.statLabel}>최근 본 수</Text>
                            </View>
                        </View>

                        {/* 찜한 목록 섹션 - 항상 노출 */}
                        <View style={styles.section}>
                            <View style={styles.sectionHeader}>
                                <Text style={styles.sectionTitle}>❤️ 찜한 목록</Text>
                                {likesCount > 0 && (
                                    <TouchableOpacity onPress={handleViewAllLikes} activeOpacity={0.7}>
                                        <Text style={styles.viewAllButton}>전체보기 ›</Text>
                                    </TouchableOpacity>
                                )}
                            </View>

                            {likeEvents.length > 0 ? (
                                <View style={styles.listContainer}>
                                    {likeEvents.map((event) => (
                                        <ThumbnailListItem
                                            key={event.id}
                                            event={event}
                                            onPress={() => navigation.navigate('/events/:id', { id: event.id })}
                                        />
                                    ))}
                                </View>
                            ) : likesCount > 0 && likesActiveCount === 0 ? (
                                // Case: 찜은 있지만 모두 종료됨
                                <View style={styles.emptyListContainer}>
                                    <Text style={styles.emptyListIcon}>📭</Text>
                                    <Text style={styles.emptyListText}>찜한 목록 중 종료된 이벤트만 있습니다.</Text>
                                    <TouchableOpacity
                                        style={styles.viewAllButtonSecondary}
                                        onPress={handleViewAllLikes}
                                        activeOpacity={0.7}
                                    >
                                        <Text style={styles.viewAllButtonSecondaryText}>전체보기</Text>
                                    </TouchableOpacity>
                                </View>
                            ) : (
                                // Case: 찜이 하나도 없음
                                <View style={styles.emptyListContainer}>
                                    <Text style={styles.emptyListIcon}>💝</Text>
                                    <Text style={styles.emptyListText}>찜한 행사가 없어요.{'\n'}마음에 드는 축제를 찜해보세요!</Text>
                                </View>
                            )}
                        </View>

                        {/* 최근 본 이벤트 섹션 */}
                        {recentCount > 0 && (
                            <View style={styles.section}>
                                <View style={styles.sectionHeader}>
                                    <Text style={styles.sectionTitle}>🕒 최근 본 이벤트</Text>
                                    {recentCount > 3 && (
                                        <TouchableOpacity onPress={handleViewAllRecent} activeOpacity={0.7}>
                                            <Text style={styles.viewAllButton}>전체보기 ›</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>

                                {loading ? (
                                    <View style={styles.loadingContainer}>
                                        <ActivityIndicator size="small" color="#8B95A1" />
                                        <Text style={styles.loadingText}>불러오는 중...</Text>
                                    </View>
                                ) : recentEvents.length > 0 ? (
                                    <View style={styles.listContainer}>
                                        {recentEvents.map((event) => (
                                            <ThumbnailListItem
                                                key={event.id}
                                                event={event}
                                                onPress={() => navigation.navigate('/events/:id', { id: event.id })}
                                            />
                                        ))}
                                    </View>
                                ) : null}
                            </View>
                        )}
                    </>
                )}

                {/* 하단 여백 (탭 바 공간 확보) */}
                <View style={{ height: 100 }} />
            </ScrollView>

            {/* 하단 탭 바 */}
            <BottomTabBar currentTab="mypage" />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F2F4F6',
    },
    scrollView: {
        flex: 1,
    },
    header: {
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 20,
        paddingVertical: 16,
        paddingTop: 50, // iOS safe area
        borderBottomWidth: 1,
        borderBottomColor: '#E5E8EB',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: '700',
        color: '#191F28',
    },
    profileSection: {
        backgroundColor: '#FFFFFF',
        paddingVertical: 32,
        paddingHorizontal: 20,
        alignItems: 'center',
    },
    avatarContainer: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#F2F4F6',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
    },
    avatarIcon: {
        fontSize: 40,
    },
    welcomeText: {
        fontSize: 18,
        fontWeight: '600',
        color: '#191F28',
        marginBottom: 8,
        textAlign: 'center',
    },
    infoText: {
        fontSize: 13,
        color: '#8B95A1',
        textAlign: 'center',
        lineHeight: 18,
    },
    emptyStateContainer: {
        backgroundColor: '#FFFFFF',
        marginTop: 24,
        marginHorizontal: 20,
        borderRadius: 12,
        paddingVertical: 60,
        paddingHorizontal: 20,
        alignItems: 'center',
        // Toss 감성: 그림자
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    emptyStateIcon: {
        fontSize: 48,
        marginBottom: 16,
    },
    emptyStateText: {
        fontSize: 16,
        color: '#6B7684',
        textAlign: 'center',
        lineHeight: 24,
        marginBottom: 24,
    },
    goHomeButton: {
        backgroundColor: '#0064FF', // Toss Blue
        paddingVertical: 14,
        paddingHorizontal: 32,
        borderRadius: 8,
    },
    goHomeButtonText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#FFFFFF',
    },
    // 통계 섹션 - Toss Blue 고도화
    statsSection: {
        backgroundColor: '#FFFFFF',
        marginTop: 24,
        marginHorizontal: 20,
        borderRadius: 12,
        flexDirection: 'row',
        paddingVertical: 28,
        // Toss 감성: 그림자
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 12,
        elevation: 3,
    },
    statItem: {
        flex: 1,
        alignItems: 'center',
    },
    statNumber: {
        fontSize: 32,
        fontWeight: '700',
        color: '#0064FF', // Toss Blue
        marginBottom: 6,
    },
    statLabel: {
        fontSize: 14,
        color: '#6B7684',
        fontWeight: '500',
    },
    statDetail: {
        fontSize: 12,
        color: '#8B95A1',
        marginTop: 4,
    },
    statDivider: {
        width: 1,
        backgroundColor: '#E5E8EB',
        opacity: 0.5, // 얇고 연하게
    },
    // 섹션
    section: {
        marginTop: 24,
        marginHorizontal: 20,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#191F28',
    },
    viewAllButton: {
        fontSize: 14,
        fontWeight: '600',
        color: '#0064FF',
    },
    // 리스트
    listContainer: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        overflow: 'hidden',
        // Toss 감성: 그림자
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 8,
        elevation: 2,
    },
    listItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 16,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F2F4F6',
    },
    thumbnail: {
        width: 50,
        height: 50,
        borderRadius: 8,
        marginRight: 12,
        overflow: 'hidden',
    },
    thumbnailImage: {
        width: '100%',
        height: '100%',
    },
    thumbnailPlaceholder: {
        width: '100%',
        height: '100%',
        backgroundColor: '#E5E8EB',
        alignItems: 'center',
        justifyContent: 'center',
    },
    placeholderIcon: {
        fontSize: 20,
    },
    listInfo: {
        flex: 1,
        marginRight: 12,
    },
    listTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: '#191F28',
        marginBottom: 4,
        lineHeight: 20,
    },
    listMeta: {
        fontSize: 13,
        color: '#6B7684',
    },
    listChevron: {
        fontSize: 24,
        color: '#B0B8C1',
    },
    loadingContainer: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        paddingVertical: 40,
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 12,
        fontSize: 14,
        color: '#8B95A1',
    },
    emptyListContainer: {
        backgroundColor: '#F8F9FA',
        borderRadius: 12,
        paddingVertical: 32,
        paddingHorizontal: 20,
        alignItems: 'center',
    },
    emptyListIcon: {
        fontSize: 36,
        marginBottom: 12,
    },
    emptyListText: {
        fontSize: 14,
        color: '#8B95A1',
        textAlign: 'center',
        lineHeight: 20,
    },
    viewAllButtonSecondary: {
        marginTop: 12,
        paddingVertical: 8,
        paddingHorizontal: 16,
        backgroundColor: '#F2F4F6',
        borderRadius: 6,
    },
    viewAllButtonSecondaryText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#0064FF',
    },
});
