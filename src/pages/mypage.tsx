import { createRoute, ScrollViewInertialBackground } from '@granite-js/react-native';
import { useSafeAreaInsets } from '@granite-js/native/react-native-safe-area-context';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/core';
import { ScrollView, StyleSheet, View, Text, TouchableOpacity, RefreshControl } from 'react-native';
import { Loader, Icon, useDialog } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import { useAuth } from '../hooks/useAuth';
import { BottomTabBar } from '../components/BottomTabBar';
import {
  getLikesV2,
  getRecentV2,
  __debugStorageSmokeTest,
  subscribeStorageChange,
  StoredEventItemV2,
} from '../utils/storage';
import eventService from '../services/eventService';
import http from '../lib/http';
import { isStoredItemActive, getTodayMidnight } from '../utils/eventStatus';
import { EventCardData } from '../data/events';
import { EventImage } from '../components/EventImage';

export const Route = createRoute('/mypage', {
  component: MyPage,
});

type Adaptive = ReturnType<typeof useAdaptive>;

/**
 * 썸네일 리스트 아이템 (미리보기용 — 50×50 compact)
 */
function ThumbnailListItem({
  event,
  onPress,
  styles,
}: {
  event: EventCardData;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <TouchableOpacity style={styles.listItem} onPress={onPress} activeOpacity={0.7}>
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

// snapshot이 충분하면 EventCardData 직접 생성 → API 스킵
// MyPage 미리보기는 title·thumbnailUrl·venue·region만 사용하므로 snapshot으로 충분
function snapshotToEventCard(id: string, snap: StoredEventItemV2['snapshot']): EventCardData | null {
  if (!snap?.title || !snap?.imageUrl) return null;
  return {
    id,
    title: snap.title,
    venue: snap.venue ?? '',
    region: (snap.region as EventCardData['region']) ?? '기타',
    category: (snap.mainCategory as EventCardData['category']) ?? '행사',
    mainCategory: snap.mainCategory,
    subCategory: snap.subCategory,
    thumbnailUrl: snap.imageUrl,
    detailImageUrl: snap.imageUrl,
    startAt: snap.startAt ?? '',
    endAt: snap.endAt ?? '',
    periodText: snap.startAt && snap.endAt
      ? `${snap.startAt.slice(0, 10)} ~ ${snap.endAt.slice(0, 10)}`
      : '',
    description: snap.subCategory ?? snap.mainCategory ?? '',
    overview: '',
    tags: snap.subCategory ? [snap.subCategory] : [],
    detailLink: '',
  } as EventCardData;
}

function MyPage() {
  const navigation = Route.useNavigation();
  const { isLoggedIn, user, isLoading: authLoading, login, logout } = useAuth();
  const [loginLoading, setLoginLoading] = useState(false);

  const adaptive = useAdaptive();
  const { top } = useSafeAreaInsets();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);
  const dialog = useDialog();

  const handleLogin = async () => {
    setLoginLoading(true);
    try {
      await login();
    } catch (err) {
      // 사용자가 직접 닫기를 선택한 경우(취소)는 에러 표시 안 함
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      const isCancelled = msg.includes('cancel') || msg.includes('close') || msg.includes('dismiss');
      if (!isCancelled) {
        await dialog.openAlert({ title: '로그인 실패', description: '잠시 후 다시 시도해 주세요.' });
      }
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    const confirmed = await dialog.openConfirm({
      title: '로그아웃',
      description: '로그아웃할까요?',
      rightButton: '로그아웃',
      leftButton: '취소',
    });
    if (confirmed) logout();
  };

  // 찜/최근 각각 독립적인 카운트 + 로딩 상태
  const [likesCount, setLikesCount] = useState(0);
  const [likesActiveCount, setLikesActiveCount] = useState(0);
  const [recentCount, setRecentCount] = useState(0);
  const [likeEvents, setLikeEvents] = useState<EventCardData[]>([]);
  const [recentEvents, setRecentEvents] = useState<EventCardData[]>([]);
  const [likesLoading, setLikesLoading] = useState(true);
  const [recentLoading, setRecentLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [likesError, setLikesError] = useState(false);
  const [recentError, setRecentError] = useState(false);

  const smokeTestRanRef = useRef<boolean>(false);

  // 찜 목록 로드
  const loadLikes = useCallback(async () => {
    setLikesLoading(true);
    setLikesError(false);
    try {
      const likesData = await getLikesV2();
      const today = getTodayMidnight();

      // lastKnownStatus가 stale할 수 있으므로 snapshot.endAt으로 직접 판정
      const activeCount = likesData.items.filter((item) => isStoredItemActive(item, today)).length;

      setLikesCount(likesData.items.length);
      setLikesActiveCount(activeCount);

      if (likesData.items.length > 0) {
        const previewItems = likesData.items.slice(0, 3);
        const results = await Promise.allSettled(
          previewItems.map((item) => {
            // snapshot 충분 → API 스킵 (eventDetailCache 미스여도 네트워크 불필요)
            const fromSnapshot = snapshotToEventCard(item.id, item.snapshot);
            if (fromSnapshot) {
              if (__DEV__) console.log(`[MyPage][likes] snapshot hit (id=${item.id})`);
              return Promise.resolve(fromSnapshot);
            }
            return eventService.getEventById(item.id);
          })
        );
        const likes = previewItems
          .map((item, i) => {
            const result = results[i]!;
            if (result.status === 'fulfilled' && result.value != null) return result.value;
            // API 실패 + snapshot 없음
            return null;
          })
          .filter((e): e is EventCardData => e !== null);
        setLikeEvents(likes);
      } else {
        setLikeEvents([]);
      }
    } catch (error) {
      setLikesError(true);
      if (__DEV__) console.error('[MyPage][loadLikes][ERROR]', error);
    } finally {
      setLikesLoading(false);
    }
  }, []);

  // 최근 본 목록 로드
  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    setRecentError(false);
    try {
      const recentData = await getRecentV2();
      setRecentCount(recentData.totalCount);

      if (recentData.items.length > 0) {
        const previewItems = recentData.items.slice(0, 3);
        const results = await Promise.allSettled(
          previewItems.map((item) => {
            // snapshot 충분 → API 스킵
            const fromSnapshot = snapshotToEventCard(item.id, item.snapshot);
            if (fromSnapshot) {
              if (__DEV__) console.log(`[MyPage][recent] snapshot hit (id=${item.id})`);
              return Promise.resolve(fromSnapshot);
            }
            return eventService.getEventById(item.id);
          })
        );
        const recents = previewItems
          .map((item, i) => {
            const result = results[i]!;
            if (result.status === 'fulfilled' && result.value != null) return result.value;
            // API 실패 → snapshot 폴백 (제목·이미지 있으면 표시)
            const snap = item.snapshot;
            if (snap?.title && snap?.imageUrl) return snapshotToEventCard(item.id, snap);
            return null;
          })
          .filter((e): e is EventCardData => e !== null);
        setRecentEvents(recents);
      } else {
        setRecentEvents([]);
      }
    } catch (error) {
      setRecentError(true);
      if (__DEV__) console.error('[MyPage][loadRecent][ERROR]', error);
    } finally {
      setRecentLoading(false);
    }
  }, []);

  // 초기 로드
  useEffect(() => {
    if (!smokeTestRanRef.current) {
      smokeTestRanRef.current = true;
      if (__DEV__) {
        __debugStorageSmokeTest().catch((err) => {
          console.error('[MyPage] Smoke test exception:', err);
        });
      }
    }
    loadLikes();
    loadRecent();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 탭 포커스 시 최신 데이터 재로드 (다른 화면에서 찜/최근 변경 후 돌아왔을 때 반영)
  useFocusEffect(useCallback(() => {
    loadLikes();
    loadRecent();
  }, [loadLikes, loadRecent]));

  // Storage 변경 구독 — 타입별로 분리
  useEffect(() => {
    const unsubscribe = subscribeStorageChange((event) => {
      if (event.type === 'likes') loadLikes();
      if (event.type === 'recent') loadRecent();
    });
    return unsubscribe;
  }, [loadLikes, loadRecent]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadLikes(), loadRecent()]);
    setRefreshing(false);
  }, [loadLikes, loadRecent]);

  const isEmpty = likesCount === 0 && recentCount === 0;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <ScrollViewInertialBackground topColor={adaptive.background} bottomColor={adaptive.grey100} />
        {/* 헤더 */}
        <View style={[styles.header, { paddingTop: top }]}>
          <Text style={styles.headerTitle}>내 활동</Text>
        </View>

        {/* 프로필 섹션 */}
        <View style={styles.profileSection}>
          <View style={styles.avatarContainer}>
            <Icon name="icon-user-mono" size={40} color={adaptive.grey400} />
          </View>

          {authLoading ? (
            <Loader size="small" customStrokeColor={adaptive.grey500} style={{ marginTop: 8 }} />
          ) : isLoggedIn ? (
            <>
              <Text style={styles.welcomeText}>{user?.name ? `${user.name}님, 반가워요!` : '반가워요!'}</Text>
              <Text style={styles.infoText}>찜한 목록과 최근 본 이벤트를 확인해보세요.</Text>
              <TouchableOpacity onPress={handleLogout} style={styles.logoutButton} activeOpacity={0.7}>
                <Text style={styles.logoutButtonText}>로그아웃</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.welcomeText}>토스로 로그인하고{'\n'}활동을 저장해보세요</Text>
              <Text style={styles.infoText}>
                로그인하면 기기가 바뀌어도 찜 목록을 유지할 수 있어요.
              </Text>
              <TouchableOpacity
                style={[styles.loginButton, loginLoading && styles.loginButtonDisabled]}
                onPress={handleLogin}
                activeOpacity={0.8}
                disabled={loginLoading}
              >
                {loginLoading ? (
                  <Loader size="small" type="light" />
                ) : (
                  <Text style={styles.loginButtonText}>토스로 로그인</Text>
                )}
              </TouchableOpacity>
              <Text style={styles.loginSubText}>로그인 없이도 이 기기에서 활동이 저장돼요.</Text>
            </>
          )}
        </View>

        {/* 비로그인 안내 배너 */}
        {!isLoggedIn && !authLoading && (
          <View style={styles.loginNoticeBanner}>
            <Text style={styles.loginNoticeText}>지금은 이 기기에만 저장돼요</Text>
            <TouchableOpacity onPress={handleLogin} disabled={loginLoading} activeOpacity={0.7}>
              <Text style={styles.loginNoticeLink}>로그인하면 어디서든 확인 가능 →</Text>
            </TouchableOpacity>
          </View>
        )}

        {isEmpty && !likesLoading && !recentLoading ? (
          /* Empty State */
          <View style={styles.emptyStateContainer}>
            <Icon name="icon-bookmark-mono" size={48} color={adaptive.grey300} />
            <Text style={styles.emptyStateText}>
              아직 활동 기록이 없어요.{'\n'}이벤트를 구경해보러 갈까요?
            </Text>
            <TouchableOpacity
              style={styles.goHomeButton}
              onPress={() => navigation.navigate('/')}
              activeOpacity={0.7}
            >
              <Text style={styles.goHomeButtonText}>홈으로 가기</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* 통계 카드 */}
            {!isEmpty && (
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
            )}

            {/* 찜한 목록 미리보기 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>찜한 목록</Text>
                {likesCount > 0 && (
                  <TouchableOpacity
                    onPress={() => navigation.navigate('/mypage/likes')}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.viewAllButton}>전체보기 ›</Text>
                  </TouchableOpacity>
                )}
              </View>

              {likesLoading ? (
                <View style={styles.sectionLoading}>
                  <Loader size="small" customStrokeColor={adaptive.grey500} />
                  <Text style={styles.loadingText}>불러오는 중...</Text>
                </View>
              ) : likesError ? (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>불러오기에 실패했어요.</Text>
                  <TouchableOpacity onPress={loadLikes} activeOpacity={0.7}>
                    <Text style={styles.retryText}>다시 시도</Text>
                  </TouchableOpacity>
                </View>
              ) : likeEvents.length > 0 ? (
                <View style={styles.listContainer}>
                  {likeEvents.map((event) => (
                    <ThumbnailListItem
                      key={event.id}
                      event={event}
                      styles={styles}
                      onPress={() => navigation.navigate('/events/:id', { id: event.id })}
                    />
                  ))}
                </View>
              ) : likesCount > 0 ? (
                <View style={styles.emptyListContainer}>
                  <Icon name="icon-bookmark-mono" size={40} color={adaptive.grey300} />
                  <Text style={styles.emptyListText}>
                    찜한 목록 중 종료된 이벤트만 있어요.
                  </Text>
                  <TouchableOpacity
                    style={styles.viewAllButtonSecondary}
                    onPress={() => navigation.navigate('/mypage/likes')}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.viewAllButtonSecondaryText}>전체보기</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.emptyListContainer}>
                  <Icon name="icon-heart-mono" size={40} color={adaptive.grey300} />
                  <Text style={styles.emptyListText}>
                    찜한 이벤트가 없어요.{'\n'}마음에 드는 이벤트를 찜해보세요!
                  </Text>
                </View>
              )}
            </View>

            {/* 최근 본 이벤트 미리보기 */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>최근 본 이벤트</Text>
                {recentCount > 0 && (
                  <TouchableOpacity
                    onPress={() => navigation.navigate('/mypage/recent')}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.viewAllButton}>전체보기 ›</Text>
                  </TouchableOpacity>
                )}
              </View>

              {recentLoading ? (
                <View style={styles.sectionLoading}>
                  <Loader size="small" customStrokeColor={adaptive.grey500} />
                  <Text style={styles.loadingText}>불러오는 중...</Text>
                </View>
              ) : recentError ? (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>불러오기에 실패했어요.</Text>
                  <TouchableOpacity onPress={loadRecent} activeOpacity={0.7}>
                    <Text style={styles.retryText}>다시 시도</Text>
                  </TouchableOpacity>
                </View>
              ) : recentEvents.length > 0 ? (
                <View style={styles.listContainer}>
                  {recentEvents.map((event) => (
                    <ThumbnailListItem
                      key={event.id}
                      event={event}
                      styles={styles}
                      onPress={() => navigation.navigate('/events/:id', { id: event.id })}
                    />
                  ))}
                </View>
              ) : (
                <View style={styles.emptyListContainer}>
                  <Icon name="icon-clock-mono" size={40} color={adaptive.grey300} />
                  <Text style={styles.emptyListText}>
                    최근 본 이벤트가 없어요.{'\n'}이벤트를 둘러보고 기록을 남겨보세요!
                  </Text>
                </View>
              )}
            </View>
          </>
        )}

        {/* 알림 설정 — 미구현으로 숨김 */}

        <View style={{ height: 100 }} />
      </ScrollView>

      <BottomTabBar currentTab="mypage" />
    </View>
  );
}

const createStyles = (a: Adaptive) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: a.grey100,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    backgroundColor: a.background,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: a.grey200,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: a.grey900,
  },
  profileSection: {
    backgroundColor: a.background,
    paddingVertical: 32,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  avatarContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: a.grey100,
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
    color: a.grey900,
    marginBottom: 8,
    textAlign: 'center',
  },
  infoText: {
    fontSize: 13,
    color: a.grey500,
    textAlign: 'center',
    lineHeight: 18,
  },
  loginButton: {
    marginTop: 20,
    backgroundColor: a.blue500,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 10,
    minWidth: 180,
    alignItems: 'center',
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  loginButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  loginSubText: {
    marginTop: 12,
    fontSize: 12,
    color: a.grey400,
    textAlign: 'center',
  },
  logoutButton: {
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: a.grey200,
  },
  logoutButtonText: {
    fontSize: 13,
    color: a.grey500,
    fontWeight: '500',
  },
  emptyStateContainer: {
    backgroundColor: a.background,
    marginTop: 24,
    marginHorizontal: 20,
    borderRadius: 12,
    paddingVertical: 60,
    paddingHorizontal: 20,
    alignItems: 'center',
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
    color: a.grey600,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },
  goHomeButton: {
    backgroundColor: a.blue500,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  goHomeButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  statsSection: {
    backgroundColor: a.background,
    marginTop: 24,
    marginHorizontal: 20,
    borderRadius: 12,
    flexDirection: 'row',
    paddingVertical: 28,
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
    color: a.blue500,
    marginBottom: 6,
  },
  statLabel: {
    fontSize: 14,
    color: a.grey600,
    fontWeight: '500',
  },
  statDetail: {
    fontSize: 12,
    color: a.grey500,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: a.grey200,
    opacity: 0.5,
  },
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
    color: a.grey900,
  },
  viewAllButton: {
    fontSize: 14,
    fontWeight: '600',
    color: a.blue500,
  },
  listContainer: {
    backgroundColor: a.background,
    borderRadius: 12,
    overflow: 'hidden',
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
    borderBottomColor: a.grey100,
  },
  thumbnail: {
    width: 50,
    height: 50,
    borderRadius: 8,
    marginRight: 12,
    overflow: 'hidden',
  },
  listInfo: {
    flex: 1,
    marginRight: 12,
  },
  listTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: a.grey900,
    marginBottom: 4,
    lineHeight: 20,
  },
  listMeta: {
    fontSize: 13,
    color: a.grey600,
  },
  listChevron: {
    fontSize: 24,
    color: a.grey400,
  },
  sectionLoading: {
    backgroundColor: a.background,
    borderRadius: 12,
    paddingVertical: 32,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 14,
    color: a.grey500,
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
    color: a.grey500,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorContainer: {
    backgroundColor: '#FFF5F5',
    borderRadius: 12,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  errorText: {
    fontSize: 14,
    color: a.grey600,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
    color: a.blue500,
  },
  viewAllButtonSecondary: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: a.grey100,
    borderRadius: 6,
  },
  viewAllButtonSecondaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: a.blue500,
  },
  settingsCard: {
    backgroundColor: a.background,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  settingsRowInfo: {
    flex: 1,
    marginRight: 12,
  },
  settingsRowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: a.grey900,
    marginBottom: 4,
  },
  settingsRowDesc: {
    fontSize: 13,
    color: a.grey500,
    lineHeight: 18,
  },
  loginNoticeBanner: {
    marginTop: 12,
    marginHorizontal: 20,
    backgroundColor: a.blue50,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  loginNoticeText: {
    fontSize: 13,
    color: a.grey700,
    fontWeight: '500',
  },
  loginNoticeLink: {
    fontSize: 13,
    color: a.blue500,
    fontWeight: '600',
  },
});
