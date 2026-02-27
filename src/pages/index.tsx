/**
 * Fairpick - 추천 중심 홈 화면
 */

import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState, useRef } from 'react';
import { ScrollView, StyleSheet, View, Text, Animated, RefreshControl, Pressable } from 'react-native';
import { Icon } from '@toss/tds-react-native';
import { BottomTabBar } from '../components/BottomTabBar';
import { EventCard } from '../components/EventCard';

// Toss MiniApp - 위치 정보
import { Accuracy, getCurrentLocation, GetCurrentLocationPermissionError } from '@apps-in-toss/framework';

// API 서비스
import recommendationService from '../services/recommendationService';
import userEventService from '../services/userEventService';
import { getCurrentUserId } from '../utils/anonymousUser';
import { getAiNoticeShown, setAiNoticeShown } from '../utils/storage';
import { reverseGeocode } from '../utils/geocoding';

// 타입
import type { ScoredEvent } from '../types/recommendation';
import type { Location } from '../types/recommendation';

export const Route = createRoute('/', {
  component: HomePage,
});

// ==================== 타입 정의 ====================

interface TodayPickData {
  event: ScoredEvent | null;
  loading: boolean;
}

// ==================== 스켈레톤 컴포넌트 ====================

function useSkeletonOpacity() {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return opacity;
}

function TodayPickSkeleton() {
  const opacity = useSkeletonOpacity();
  return (
    <Animated.View style={[skeletonStyles.largeCard, { opacity }]}>
      <View style={skeletonStyles.largeImage} />
      <View style={skeletonStyles.content}>
        <View style={skeletonStyles.badge} />
        <View style={skeletonStyles.titleLine1} />
        <View style={skeletonStyles.titleLine2} />
        <View style={skeletonStyles.meta} />
      </View>
    </Animated.View>
  );
}

function HorizontalSectionSkeleton() {
  const opacity = useSkeletonOpacity();
  return (
    <Animated.View style={{ opacity, flexDirection: 'row', paddingHorizontal: 20, gap: 12 }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={skeletonStyles.smallCard}>
          <View style={skeletonStyles.smallImage} />
          <View style={skeletonStyles.smallContent}>
            <View style={skeletonStyles.smallBadge} />
            <View style={skeletonStyles.smallTitle1} />
            <View style={skeletonStyles.smallTitle2} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

const skeletonStyles = StyleSheet.create({
  // 큰 카드 (오늘의 추천)
  largeCard: {
    marginHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
  },
  largeImage: {
    height: 200,
    backgroundColor: '#E5E8EB',
  },
  content: {
    padding: 16,
    gap: 8,
  },
  badge: {
    width: 48,
    height: 20,
    backgroundColor: '#E5E8EB',
    borderRadius: 10,
  },
  titleLine1: {
    height: 20,
    backgroundColor: '#E5E8EB',
    borderRadius: 4,
    width: '85%',
  },
  titleLine2: {
    height: 20,
    backgroundColor: '#E5E8EB',
    borderRadius: 4,
    width: '60%',
  },
  meta: {
    height: 14,
    backgroundColor: '#E5E8EB',
    borderRadius: 4,
    width: '40%',
    marginTop: 4,
  },
  // 작은 카드 (가로 스크롤 섹션)
  smallCard: {
    width: 160,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
  },
  smallImage: {
    height: 100,
    backgroundColor: '#E5E8EB',
  },
  smallContent: {
    padding: 10,
    gap: 6,
  },
  smallBadge: {
    width: 36,
    height: 16,
    backgroundColor: '#E5E8EB',
    borderRadius: 8,
  },
  smallTitle1: {
    height: 14,
    backgroundColor: '#E5E8EB',
    borderRadius: 4,
    width: '90%',
  },
  smallTitle2: {
    height: 14,
    backgroundColor: '#E5E8EB',
    borderRadius: 4,
    width: '65%',
  },
});

// ==================== 홈 화면 컴포넌트 ====================

function HomePage() {
  const navigation = Route.useNavigation();
  
  // 상태 관리
  const [todayPick, setTodayPick] = useState<TodayPickData>({ event: null, loading: true });
  const [nearby, setNearby] = useState<ScoredEvent[] | null>(null); // null=로딩, []=없음
  const [trending, setTrending] = useState<ScoredEvent[] | null>(null);
  const [endingSoon, setEndingSoon] = useState<ScoredEvent[] | null>(null);
  const [exhibition, setExhibition] = useState<ScoredEvent[] | null>(null);
  const [weekend, setWeekend] = useState<ScoredEvent[] | null>(null);
  const [freeEvents, setFreeEvents] = useState<ScoredEvent[] | null>(null);
  const [latest, setLatest] = useState<ScoredEvent[] | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [location, setLocation] = useState<Location | undefined>(undefined);
  const [currentAddress, setCurrentAddress] = useState<string>(''); // 행정동 표시
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [showAiNotice, setShowAiNotice] = useState<boolean>(false);

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
      const currentUserId = await getCurrentUserId();
      setUserId(currentUserId);
      
      console.log('[Home] User initialized:', { userId: currentUserId });
      
      // 위치 정보 요청 (반환값 사용)
      const userLocation = await requestLocation();
      
      // 사용자 정보 로드 후 추천 로드 (위치 정보 전달)
      await loadRecommendations(currentUserId, userLocation);
    } catch (error) {
      console.error('[Home] Failed to initialize user:', error);
      // 에러가 발생해도 추천은 로드
      await loadRecommendations();
    }
  };

  /**
   * 위치 정보 요청
   */
  const requestLocation = async (): Promise<Location | undefined> => {
    try {
      console.log('[Home/Location] Requesting location permission...');
      
      // 1. 현재 권한 상태 확인
      const permission = await getCurrentLocation.getPermission();
      console.log('[Home/Location] Current permission:', permission);
      
      if (permission === 'denied' || permission === 'osPermissionDenied') {
        console.log('[Home/Location] Location permission denied');
        return undefined;
      }
      
      // 2. 권한이 없으면 요청
      if (permission === 'notDetermined') {
        console.log('[Home/Location] Requesting permission...');
        const dialogResult = await getCurrentLocation.openPermissionDialog();
        
        if (dialogResult === 'denied') {
          console.log('[Home/Location] User denied permission');
          return undefined;
        }
      }
      
      // 3. 위치 정보 가져오기
      console.log('[Home/Location] Getting current location...');
      const locationData = await getCurrentLocation({ 
        accuracy: Accuracy.Balanced 
      });
      
      const userLocation: Location = {
        lat: locationData.coords.latitude,
        lng: locationData.coords.longitude,
      };
      
      setLocation(userLocation);
      console.log('[Home/Location] Location acquired:', userLocation);
      
      // 역지오코딩: 좌표 → 행정동
      const geocodeResult = await reverseGeocode(userLocation.lat, userLocation.lng);
      if (geocodeResult.success && geocodeResult.address) {
        setCurrentAddress(geocodeResult.address);
        console.log('[Home/Location] Address:', geocodeResult.address);
      } else {
        setCurrentAddress('위치 정보');
        console.log('[Home/Location] Geocoding failed:', geocodeResult.error);
      }
      
      return userLocation;
      
    } catch (error) {
      if (error instanceof GetCurrentLocationPermissionError) {
        console.log('[Home/Location] Permission error:', error.message);
      } else {
        console.error('[Home/Location] Failed to get location:', error);
      }
      // 위치 정보 없이도 추천은 계속 진행
      return undefined;
    }
  };

  const loadRecommendations = async (currentUserId?: string, userLocation?: Location) => {
    try {
      const uid = currentUserId || userId;
      const loc = userLocation || location;
      
      // 1. 오늘의 추천 (위치 정보 전달)
      await loadTodayPick(uid, loc);
      
      // 2. 내 주변 이벤트 (위치 필수)
      if (loc) {
        await loadNearby(loc);
      } else {
        setNearby([]); // 위치 없음 → 스켈레톤 없이 바로 숨김
      }
      
      // 3. 지금 떠오르는 (위치 정보 전달)
      await loadTrending(loc);

      // 4. 곧 끝나요 (테마 섹션 - excludeIds 없음)
      await loadEndingSoon(loc);

      // 5. 전시 큐레이션 (테마 섹션 - excludeIds 없음)
      await loadExhibition(loc);

      // 6. 이번 주말 (위치 정보 전달)
      await loadWeekend(loc);

      // 7. 무료로 즐겨요 (테마 섹션 - excludeIds 없음)
      await loadFreeEvents(loc);

      // 8. 새로 올라왔어요 (위치 정보 전달)
      await loadLatest(loc);
      
    } catch (error) {
      console.error('[Home] Failed to load recommendations:', error);
    }
  };

  const loadTodayPick = async (currentUserId?: string, userLocation?: Location) => {
    try {
      console.log('[Home/TodayPick] Starting to load today pick...', { 
        userId: currentUserId, 
        hasLocation: !!userLocation,
        location: userLocation 
      });
      setTodayPick({ event: null, loading: true });
      
      const response = await recommendationService.getTodayPick(
        currentUserId,
        userLocation // 위치 정보 전달
      );
      
      if (response.success && response.data) {
        setTodayPick({
          event: response.data,
          loading: false,
        });
        
        // 중복 제거 리스트에 추가
        excludedIds.current.add(response.data.id);
        
        console.log('[Home/TodayPick] Loaded:', response.data.title);
      } else {
        setTodayPick({ event: null, loading: false });
        console.log('[Home/TodayPick] No recommendation available');
      }
    } catch (error) {
      console.error('[Home/TodayPick] Error:', error);
      setTodayPick({ event: null, loading: false });
    }
  };

  const loadNearby = async (userLocation: Location) => {
    try {
      const response = await recommendationService.getNearby(
        userLocation,
        {
          excludeIds: Array.from(excludedIds.current),
          limit: 10,
        }
      );

      if (response.success && response.data) {
        setNearby(response.data);
        // 이후 섹션 중복 제거를 위해 ID 등록
        response.data.forEach((e: ScoredEvent) => excludedIds.current.add(e.id));
        console.log('[Home/Nearby] Loaded:', response.data.length, 'events');
      } else {
        setNearby([]);
        console.log('[Home/Nearby] No nearby events');
      }
    } catch (error) {
      console.error('[Home/Nearby] Error:', error);
      setNearby([]);
    }
  };

  const loadTrending = async (userLocation?: Location) => {
    try {
      const response = await recommendationService.getTrending({
        excludeIds: Array.from(excludedIds.current),
        limit: 10,
        location: userLocation,
      });

      if (response.success && response.data) {
        setTrending(response.data);
        response.data.forEach((e: ScoredEvent) => excludedIds.current.add(e.id));
        console.log('[Home/Trending] Loaded:', response.data.length, 'events');
      } else {
        setTrending([]);
        console.log('[Home/Trending] No trending events');
      }
    } catch (error) {
      console.error('[Home/Trending] Error:', error);
      setTrending([]);
    }
  };

  const loadEndingSoon = async (userLocation?: Location) => {
    try {
      const response = await recommendationService.getEndingSoon({
        limit: 10,
        location: userLocation,
      });
      if (response.success && response.data) {
        setEndingSoon(response.data);
        console.log('[Home/EndingSoon] Loaded:', response.data.length, 'events');
      } else {
        setEndingSoon([]);
      }
    } catch (error) {
      console.error('[Home/EndingSoon] Error:', error);
      setEndingSoon([]);
    }
  };

  const loadExhibition = async (userLocation?: Location) => {
    try {
      const response = await recommendationService.getExhibition({
        limit: 10,
        location: userLocation,
      });
      if (response.success && response.data) {
        setExhibition(response.data);
        console.log('[Home/Exhibition] Loaded:', response.data.length, 'events');
      } else {
        setExhibition([]);
      }
    } catch (error) {
      console.error('[Home/Exhibition] Error:', error);
      setExhibition([]);
    }
  };

  const loadFreeEvents = async (userLocation?: Location) => {
    try {
      const response = await recommendationService.getFreeEvents({
        limit: 10,
        location: userLocation,
      });
      if (response.success && response.data) {
        setFreeEvents(response.data);
        console.log('[Home/Free] Loaded:', response.data.length, 'events');
      } else {
        setFreeEvents([]);
      }
    } catch (error) {
      console.error('[Home/Free] Error:', error);
      setFreeEvents([]);
    }
  };

  const loadWeekend = async (userLocation?: Location) => {
    try {
      const response = await recommendationService.getWeekend({
        limit: 10,
        location: userLocation,
      });

      if (response.success && response.data) {
        setWeekend(response.data);
        console.log('[Home/Weekend] Loaded:', response.data.length, 'events');
      } else {
        setWeekend([]);
        console.log('[Home/Weekend] No weekend events');
      }
    } catch (error) {
      console.error('[Home/Weekend] Error:', error);
      setWeekend([]);
    }
  };

  const loadLatest = async (userLocation?: Location) => {
    try {
      const response = await recommendationService.getLatest({
        excludeIds: Array.from(excludedIds.current),
        limit: 10,
        location: userLocation,
      });

      if (response.success && response.data) {
        setLatest(response.data);
        console.log('[Home/Latest] Loaded:', response.data.length, 'events');
      } else {
        setLatest([]);
        console.log('[Home/Latest] No latest events');
      }
    } catch (error) {
      console.error('[Home/Latest] Error:', error);
      setLatest([]);
    }
  };

  const handleEventPress = async (eventId: string) => {
    console.log('[Home] Event pressed:', eventId);
    
    // 사용자 행동 로그 기록 (비동기, 실패해도 진행)
    try {
      await userEventService.logEventClick(eventId, 'home_card');
    } catch (error) {
      console.error('[Home] Failed to log event click:', error);
    }

    // 이벤트 상세 페이지로 이동
    navigation.navigate('/events/:id', { id: eventId });
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      console.log('[Home] Refreshing with new location...');
      
      // 1. 위치 정보 다시 가져오기
      const newLocation = await requestLocation();
      
      // 2. 새로운 위치로 추천 다시 로드
      excludedIds.current.clear();
      setNearby(null);
      setTrending(null);
      setEndingSoon(null);
      setExhibition(null);
      setWeekend(null);
      setFreeEvents(null);
      setLatest(null);
      await loadRecommendations(userId, newLocation);
      
      console.log('[Home] Refresh completed with location:', newLocation);
    } catch (error) {
      console.error('[Home] Refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleLocationRefresh = async () => {
    console.log('[Home] Location refresh button pressed');
    await handleRefresh();
  };

  return (
    <View style={styles.container}>
      {/* 생성형 AI 사전 고지 배너 (최초 1회) */}
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
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {/* 헤더 */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View>
              <Text style={styles.title}>페어픽</Text>
              <Text style={styles.subtitle}>오늘의 재미를 찾아볼까요?</Text>
            </View>
            {location && currentAddress && (
              <Pressable 
                onPress={handleLocationRefresh}
                style={styles.locationButton}
                android_ripple={{ color: '#E5E7EB', radius: 20 }}
              >
                <View style={styles.locationButtonContent}>
                  <Icon name="icon-pin-mono" size={14} color="#0369A1" />
                  <Text style={styles.locationButtonText}>{currentAddress}</Text>
                </View>
              </Pressable>
            )}
          </View>
        </View>

        {/* 오늘의 추천 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>오늘의 추천</Text>
          </View>
          
          {todayPick.loading ? (
            <TodayPickSkeleton />
          ) : todayPick.event ? (
            <View style={{ paddingHorizontal: 20 }}>
              <EventCard 
                event={todayPick.event}
                onPress={handleEventPress}
                variant="large"
              />
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>추천할 이벤트가 없어요</Text>
            </View>
          )}
        </View>

        {/* 내 주변 이벤트 */}
        {(nearby === null || nearby.length > 0) && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>내 주변 이벤트</Text>
              <Text style={styles.sectionSubtitle}>가장 가까운 이벤트</Text>
            </View>
            {nearby === null ? (
              <HorizontalSectionSkeleton />
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
              >
                {nearby.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onPress={handleEventPress}
                    variant="small"
                  />
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* 지금 떠오르는 */}
        {(trending === null || trending.length > 0) && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>지금 떠오르는</Text>
              <Text style={styles.sectionSubtitle}>24시간 인기 급상승</Text>
            </View>
            {trending === null ? (
              <HorizontalSectionSkeleton />
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
              >
                {trending.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onPress={handleEventPress}
                    variant="small"
                  />
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* 곧 끝나요 */}
        {(endingSoon === null || endingSoon.length >= 5) && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>곧 끝나요</Text>
              <Text style={styles.sectionSubtitle}>7일 안에 마감되는 이벤트</Text>
            </View>
            {endingSoon === null ? (
              <HorizontalSectionSkeleton />
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
              >
                {endingSoon.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onPress={handleEventPress}
                    variant="small"
                  />
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* 전시 큐레이션 */}
        {(exhibition === null || exhibition.length >= 3) && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>전시 큐레이션</Text>
              <Text style={styles.sectionSubtitle}>놓치면 아쉬운 전시</Text>
            </View>
            {exhibition === null ? (
              <HorizontalSectionSkeleton />
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
              >
                {exhibition.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onPress={handleEventPress}
                    variant="small"
                  />
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* 이번 주말 */}
        {(weekend === null || weekend.length > 0) && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>이번 주말</Text>
              <Text style={styles.sectionSubtitle}>주말에 즐기기 좋은</Text>
            </View>
            {weekend === null ? (
              <HorizontalSectionSkeleton />
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
              >
                {weekend.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onPress={handleEventPress}
                    variant="small"
                  />
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* 무료로 즐겨요 */}
        {(freeEvents === null || freeEvents.length >= 5) && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>무료로 즐겨요</Text>
              <Text style={styles.sectionSubtitle}>무료 입장 이벤트 모음</Text>
            </View>
            {freeEvents === null ? (
              <HorizontalSectionSkeleton />
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
              >
                {freeEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onPress={handleEventPress}
                    variant="small"
                  />
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* 새로 올라왔어요 */}
        {(latest === null || latest.length > 0) && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>새로 올라왔어요</Text>
              <Text style={styles.sectionSubtitle}>최근 추가된 이벤트</Text>
            </View>
            {latest === null ? (
              <HorizontalSectionSkeleton />
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
              >
                {latest.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onPress={handleEventPress}
                    variant="small"
                  />
                ))}
              </ScrollView>
            )}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <BottomTabBar currentTab="home" />
    </View>
  );
}

// ==================== 스타일 ====================

const styles = StyleSheet.create({
  // AI 고지 배너
  aiNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EEF4FF',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  aiNoticeText: {
    flex: 1,
    fontSize: 13,
    color: '#3182F6',
    fontWeight: '500',
  },
  aiNoticeClose: {
    fontSize: 14,
    color: '#8B95A1',
    marginLeft: 8,
  },

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
    paddingTop: 50,
    paddingBottom: 16,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#191F28',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7684',
    fontWeight: '500',
  },
  locationButton: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: '#F0F9FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  locationButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationButtonText: {
    fontSize: 13,
    color: '#0369A1',
    fontWeight: '600',
  },
  section: {
    marginTop: 24,
    marginBottom: 8,
  },
  sectionHeader: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    letterSpacing: -0.3,
  },
  sectionSubtitle: {
    fontSize: 13,
    fontWeight: '400',
    color: '#9CA3AF',
    marginTop: 4,
  },
  horizontalList: {
    paddingHorizontal: 20,
    gap: 12,
  },
  // 빈 상태
  emptyCard: {
    height: 300,
    backgroundColor: '#F8F9FA',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
  },
  emptyText: {
    fontSize: 14,
    color: '#6B7280',
  },
});

export default HomePage;
