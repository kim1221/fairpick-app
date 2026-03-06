/**
 * Fairpick - 홈 화면
 * curation_themes 기반 동적 섹션 렌더링
 */

import { createRoute, ScrollViewInertialBackground } from '@granite-js/react-native';
import { useSafeAreaInsets } from '@granite-js/native/react-native-safe-area-context';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, Text, RefreshControl, Pressable } from 'react-native';
import { Icon, AnimateSkeleton } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import { BottomTabBar } from '../components/BottomTabBar';
import { EventCard } from '../components/EventCard';

import { Accuracy, getCurrentLocation, GetCurrentLocationPermissionError, InlineAd, getNetworkStatus } from '@apps-in-toss/framework';

import recommendationService from '../services/recommendationService';
import userEventService from '../services/userEventService';
import { getCurrentUserId } from '../utils/anonymousUser';
import { getAiNoticeShown, setAiNoticeShown } from '../utils/storage';
import { reverseGeocode } from '../utils/geocoding';

import type { ScoredEvent, Location } from '../types/recommendation';

export const Route = createRoute('/', {
  component: HomePage,
});

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

interface HomeSection {
  slug: string;
  title: string;
  subtitle: string | null;
  events: ScoredEvent[];
}

// ─────────────────────────────────────────────────────────────
// 스타일
// ─────────────────────────────────────────────────────────────

type Adaptive = ReturnType<typeof useAdaptive>;

const createSkeletonStyles = (a: Adaptive) => StyleSheet.create({
  largeCard: {
    marginHorizontal: 20,
    backgroundColor: a.background,
    borderRadius: 16,
    overflow: 'hidden',
  },
  largeImage: { height: 200, backgroundColor: a.grey200 },
  content: { padding: 16, gap: 8 },
  badge: { width: 48, height: 20, backgroundColor: a.grey200, borderRadius: 10 },
  titleLine1: { height: 20, backgroundColor: a.grey200, borderRadius: 4, width: '85%' },
  titleLine2: { height: 20, backgroundColor: a.grey200, borderRadius: 4, width: '60%' },
  meta: { height: 14, backgroundColor: a.grey200, borderRadius: 4, width: '40%', marginTop: 4 },
  smallCard: { width: 160, backgroundColor: a.background, borderRadius: 12, overflow: 'hidden' },
  smallImage: { height: 100, backgroundColor: a.grey200 },
  smallContent: { padding: 10, gap: 6 },
  smallBadge: { width: 36, height: 16, backgroundColor: a.grey200, borderRadius: 8 },
  smallTitle1: { height: 14, backgroundColor: a.grey200, borderRadius: 4, width: '90%' },
  smallTitle2: { height: 14, backgroundColor: a.grey200, borderRadius: 4, width: '65%' },
});

const createStyles = (a: Adaptive) => StyleSheet.create({
  aiNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: a.blue50,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  aiNoticeText: { flex: 1, fontSize: 13, color: a.blue500, fontWeight: '500' },
  aiNoticeClose: { fontSize: 14, color: a.grey500, marginLeft: 8 },
  container: { flex: 1, backgroundColor: a.grey100 },
  scrollView: { flex: 1 },
  header: {
    backgroundColor: a.background,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 28, fontWeight: '700', color: a.grey900, marginBottom: 4 },
  subtitle: { fontSize: 14, color: a.grey600, fontWeight: '500' },
  locationButton: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: a.blue50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  locationButtonContent: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationButtonText: { fontSize: 13, color: a.blue600, fontWeight: '600' },
  section: { marginTop: 24, marginBottom: 8 },
  sectionHeader: { paddingHorizontal: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: a.grey900, letterSpacing: -0.3 },
  sectionSubtitle: { fontSize: 13, fontWeight: '400', color: a.grey500, marginTop: 4 },
  horizontalList: { paddingHorizontal: 20, gap: 12 },
  emptyCard: {
    height: 300,
    backgroundColor: a.grey50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
  },
  emptyText: { fontSize: 14, color: a.grey600 },
});

// ─────────────────────────────────────────────────────────────
// 스켈레톤
// ─────────────────────────────────────────────────────────────

function TodayPickSkeleton() {
  const adaptive = useAdaptive();
  const s = React.useMemo(() => createSkeletonStyles(adaptive), [adaptive]);
  return (
    <AnimateSkeleton delay={0} withGradient={false} withShimmer>
      <View style={s.largeCard}>
        <View style={s.largeImage} />
        <View style={s.content}>
          <View style={s.badge} />
          <View style={s.titleLine1} />
          <View style={s.titleLine2} />
          <View style={s.meta} />
        </View>
      </View>
    </AnimateSkeleton>
  );
}

function HorizontalSectionSkeleton() {
  const adaptive = useAdaptive();
  const s = React.useMemo(() => createSkeletonStyles(adaptive), [adaptive]);
  return (
    <AnimateSkeleton delay={0} withGradient={false} withShimmer>
      <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={s.smallCard}>
            <View style={s.smallImage} />
            <View style={s.smallContent}>
              <View style={s.smallBadge} />
              <View style={s.smallTitle1} />
              <View style={s.smallTitle2} />
            </View>
          </View>
        ))}
      </View>
    </AnimateSkeleton>
  );
}

// ─────────────────────────────────────────────────────────────
// 홈 화면
// ─────────────────────────────────────────────────────────────

function HomePage() {
  const navigation = Route.useNavigation();
  const adaptive = useAdaptive();
  const { top } = useSafeAreaInsets();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);

  // null = 로딩 중, [] = 실패/빈 상태, [...] = 로드 완료
  const [sections, setSections] = useState<HomeSection[] | null>(null);
  const [userId, setUserId] = useState('');
  const [location, setLocation] = useState<Location | undefined>(undefined);
  const [currentAddress, setCurrentAddress] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [showAiNotice, setShowAiNotice] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [feedAdRendered, setFeedAdRendered] = useState(false);

  const excludedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    initializeUser();
    checkAiNotice();
  }, []);

  const checkAiNotice = async () => {
    const shown = await getAiNoticeShown();
    if (!shown) setShowAiNotice(true);
  };

  const handleAiNoticeConfirm = async () => {
    await setAiNoticeShown();
    setShowAiNotice(false);
  };

  const initializeUser = async () => {
    try {
      const uid = await getCurrentUserId();
      setUserId(uid);

      // 위치 요청과 섹션 로드를 병렬 실행
      // - 위치 없이 즉시 섹션 표시 → 체감 속도 개선
      // - 위치 확보되면 스켈레톤 없이 조용히 갱신
      const locPromise = requestLocation();
      await loadSections(undefined, uid);

      const loc = await locPromise;
      if (loc) {
        const response = await recommendationService.getSections(loc, uid);
        if (response.success) setSections(response.sections);
      }
    } catch (error) {
      console.error('[Home] init error:', error);
      await loadSections();
    }
  };

  const requestLocation = async (): Promise<Location | undefined> => {
    try {
      const permission = await getCurrentLocation.getPermission();
      if ((permission as string) === 'denied' || (permission as string) === 'osPermissionDenied') {
        return undefined;
      }
      if (permission === 'notDetermined') {
        const result = await getCurrentLocation.openPermissionDialog();
        if (result === 'denied') return undefined;
      }
      const data = await getCurrentLocation({ accuracy: Accuracy.Balanced });
      const loc: Location = { lat: data.coords.latitude, lng: data.coords.longitude };
      setLocation(loc);
      const geo = await reverseGeocode(loc.lat, loc.lng);
      setCurrentAddress(geo.success && geo.address ? geo.address : '위치 정보');
      return loc;
    } catch (error) {
      if (!(error instanceof GetCurrentLocationPermissionError)) {
        console.error('[Home] location error:', error);
      }
      return undefined;
    }
  };

  const loadSections = async (loc?: Location, uid?: string) => {
    setSections(null);
    const networkStatus = await getNetworkStatus();
    if (networkStatus === 'OFFLINE') {
      setIsOffline(true);
      setSections([]);
      return;
    }
    setIsOffline(false);
    const response = await recommendationService.getSections(loc, uid);
    setSections(response.success ? response.sections : []);
  };

  const handleEventPress = async (eventId: string) => {
    try {
      await userEventService.logEventClick(eventId, 'home_card');
    } catch {}
    navigation.navigate('/events/:id', { id: eventId });
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      excludedIds.current.clear();
      const loc = await requestLocation();
      await loadSections(loc, userId);
    } finally {
      setRefreshing(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 섹션 렌더링 (slug에 따라 레이아웃 결정)
  // ─────────────────────────────────────────────────────────────

  const renderSection = (section: HomeSection) => {
    const { slug, title, subtitle, events } = section;

    if (events.length === 0) return null;
    if (slug === 'nearby' && !location) return null;

    // today_pick: 대형 카드 (첫 번째 이벤트)
    if (slug === 'today_pick') {
      return (
        <View key={slug} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
          </View>
          <View style={{ paddingHorizontal: 20 }}>
            <EventCard event={events[0]!} onPress={handleEventPress} variant="large" />
          </View>
        </View>
      );
    }

    // 나머지: 가로 스크롤 소형 카드
    return (
      <View key={slug} style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalList}
        >
          {events.map((event) => (
            <EventCard key={event.id} event={event} onPress={handleEventPress} variant="small" />
          ))}
        </ScrollView>
      </View>
    );
  };

  // 로딩 스켈레톤
  const renderLoading = () => (
    <>
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={{ height: 24, width: 100, backgroundColor: adaptive.grey200, borderRadius: 4 }} />
        </View>
        <TodayPickSkeleton />
      </View>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={{ height: 20, width: 120, backgroundColor: adaptive.grey200, borderRadius: 4 }} />
          </View>
          <HorizontalSectionSkeleton />
        </View>
      ))}
    </>
  );

  return (
    <View style={styles.container}>
      {showAiNotice && (
        <View style={styles.aiNoticeBanner}>
          <Text style={styles.aiNoticeText}>페어픽은 AI를 활용해요</Text>
          <Pressable onPress={handleAiNoticeConfirm} hitSlop={8}>
            <Text style={styles.aiNoticeClose}>✕</Text>
          </Pressable>
        </View>
      )}

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={handleAiNoticeConfirm}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <ScrollViewInertialBackground topColor={adaptive.background} bottomColor={adaptive.grey100} />
        {/* 헤더 */}
        <View style={[styles.header, { paddingTop: top }]}>
          <View style={styles.headerTop}>
            <View>
              <Text style={styles.title}>페어픽</Text>
              <Text style={styles.subtitle}>오늘의 재미를 찾아볼까요?</Text>
            </View>
            {location && currentAddress ? (
              <Pressable
                onPress={handleRefresh}
                style={styles.locationButton}
                android_ripple={{ color: adaptive.grey200, radius: 20 }}
              >
                <View style={styles.locationButtonContent}>
                  <Icon name="icon-pin-mono" size={14} color={adaptive.blue600} />
                  <Text style={styles.locationButtonText}>{currentAddress}</Text>
                </View>
              </Pressable>
            ) : null}
          </View>
        </View>

        {sections === null
          ? renderLoading()
          : sections.length === 0
            ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>
                  {isOffline ? '네트워크 연결을 확인해 주세요' : '추천 이벤트를 불러오지 못했어요'}
                </Text>
              </View>
            )
            : (() => {
                // 상위 섹션에서 이미 노출된 이벤트를 하위 섹션에서 제거 (중복 방지)
                const seenIds = new Set<string>();
                const rendered: React.ReactNode[] = [];
                let visibleCount = 0;
                sections.forEach((section) => {
                  const unique = section.events.filter((e) => !seenIds.has(e.id));
                  unique.forEach((e) => seenIds.add(e.id));
                  const el = renderSection({ ...section, events: unique });
                  if (el !== null) {
                    rendered.push(el);
                    visibleCount++;
                    // 2번째 섹션 이후 피드형 배너 1개 삽입
                    if (visibleCount === 2) {
                      rendered.push(
                        <View key="feed-ad" style={{ width: '100%', marginVertical: feedAdRendered ? 8 : 0 }}>
                          <InlineAd
                            adGroupId="ait-ad-test-native-image-id"
                            impressFallbackOnMount={true}
                            onAdRendered={() => setFeedAdRendered(true)}
                            onAdFailedToRender={() => setFeedAdRendered(false)}
                            onNoFill={() => setFeedAdRendered(false)}
                          />
                        </View>
                      );
                    }
                  }
                });
                return rendered;
              })()}

        <View style={{ height: 100 }} />
      </ScrollView>

      <BottomTabBar currentTab="home" />
    </View>
  );
}

export default HomePage;
