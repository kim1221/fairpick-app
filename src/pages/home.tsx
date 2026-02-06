/**
 * Fairpick 2.0 - 추천 중심 홈 화면
 * 
 * "이벤트를 찾는 게 아니라, 나에게 맞는 이벤트가 찾아오는 경험"
 */

import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState, useRef } from 'react';
import { ScrollView, StyleSheet, View, Text, Pressable, Dimensions, ActivityIndicator, RefreshControl } from 'react-native';
import { BottomTabBar } from '../components/BottomTabBar';
import { EventCard } from '../components/EventCard';

// API 서비스
import recommendationService from '../services/recommendationService';
import userEventService from '../services/userEventService';
import { getCurrentUserId, isLoggedIn } from '../utils/anonymousUser';

// 타입
import type { ScoredEvent } from '../types/recommendation';

// TDS 컴포넌트
// import { Badge, Card, Chip, Divider, Button } from '@toss/tds-react-native';

export const Route = createRoute('/', {
  component: HomePage,
});

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ==================== 타입 정의 ====================

interface TodayPickData {
  event: ScoredEvent | null;
  loading: boolean;
}

// ==================== 홈 화면 컴포넌트 ====================

function HomePage() {
  const navigation = Route.useNavigation();
  
  // 상태 관리
  const [todayPick, setTodayPick] = useState<TodayPickData>({ event: null, loading: true });
  const [trending, setTrending] = useState<ScoredEvent[]>([]);
  const [nearby, setNearby] = useState<ScoredEvent[]>([]);
  const [latest, setLatest] = useState<ScoredEvent[]>([]);
  const [userName, setUserName] = useState<string>('');
  const [userId, setUserId] = useState<string>('');
  const [loggedIn, setLoggedIn] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  
  const excludedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    initializeUser();
  }, []);

  const initializeUser = async () => {
    try {
      const currentUserId = await getCurrentUserId();
      const isUserLoggedIn = await isLoggedIn();
      
      setUserId(currentUserId);
      setLoggedIn(isUserLoggedIn);
      
      console.log('[Home] User initialized:', { userId: currentUserId, loggedIn: isUserLoggedIn });
      
      // 사용자 정보 로드 후 추천 로드
      await loadRecommendations(currentUserId);
    } catch (error) {
      console.error('[Home] Failed to initialize user:', error);
      // 에러가 발생해도 추천은 로드
      await loadRecommendations();
    }
  };

  const loadRecommendations = async (currentUserId?: string) => {
    try {
      const uid = currentUserId || userId;
      
      // 1. 오늘의 추천
      await loadTodayPick(uid);
      
      // 2. 지금 떠오르는
      await loadTrending();
      
      // 3. 근처 이벤트 (위치 권한 필요)
      // TODO: 위치 권한 구현 후 활성화
      // await loadNearby();
      
      // 4. 새로 올라왔어요
      await loadLatest();
      
    } catch (error) {
      console.error('[Home] Failed to load recommendations:', error);
    }
  };

  const loadTodayPick = async (currentUserId?: string) => {
    try {
      console.log('[Home/TodayPick] Starting to load today pick...');
      setTodayPick({ event: null, loading: true });
      
      // TODO: 위치 정보 추가 (권한 구현 후)
      // const location = { lat: 37.5665, lng: 126.9780 }; // 서울시청 예시
      
      const response = await recommendationService.getTodayPick(
        currentUserId,
        undefined // location
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

  const loadTrending = async () => {
    try {
      const response = await recommendationService.getTrending({
        excludeIds: Array.from(excludedIds.current),
        limit: 10,
      });
      
      if (response.success && response.data) {
        setTrending(response.data);
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

  const loadNearby = async () => {
    try {
      // TODO: 위치 권한 요청 및 현재 위치 가져오기
      // const location = await requestLocationPermission();
      // const response = await fetch(`YOUR_API/api/recommendations/v2/nearby?lat=${location.lat}&lng=${location.lng}`);
      
      console.log('[Home/Nearby] 위치 권한 구현 필요');
    } catch (error) {
      console.error('[Home/Nearby] Error:', error);
    }
  };

  const loadLatest = async () => {
    try {
      const response = await recommendationService.getLatest({
        excludeIds: Array.from(excludedIds.current),
        limit: 10,
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
    navigation.navigate('/event-detail', { id: eventId } as any);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      excludedIds.current.clear();
      await loadRecommendations(userId);
    } catch (error) {
      console.error('[Home] Refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView 
        style={styles.scrollView} 
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {/* 인사 헤더 */}
        <View style={styles.header}>
          <Text style={styles.greeting}>👋 {userName || '안녕하세요'}, 이번 주말은?</Text>
        </View>

        {/* 오늘의 추천 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>✨ 오늘의 추천</Text>
            </View>
          </View>
          
          {todayPick.loading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" color="#3182F6" />
              <Text style={styles.loadingText}>로딩 중...</Text>
            </View>
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
              <Text style={styles.emptyText}>추천할 이벤트가 없습니다</Text>
            </View>
          )}
        </View>

        {/* 지금 떠오르는 */}
        {trending.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>🔥 지금 떠오르는</Text>
                <Text style={styles.sectionSubtitle}>24시간 인기 급상승</Text>
              </View>
            </View>
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
          </View>
        )}

        {/* 근처 이벤트 (TODO: 위치 권한) */}
        {nearby.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>📍 10분 거리</Text>
                <Text style={styles.sectionSubtitle}>지금 바로 갈 수 있어요</Text>
              </View>
            </View>
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
          </View>
        )}

        {/* 새로 올라왔어요 */}
        {latest.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>🆕 새로 올라왔어요</Text>
                <Text style={styles.sectionSubtitle}>오늘 추가된 이벤트</Text>
              </View>
            </View>
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
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: 24,
    backgroundColor: '#FFFFFF',
  },
  greeting: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1A1A1A',
    letterSpacing: -0.5,
  },
  section: {
    marginTop: 24,
    marginBottom: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
    marginTop: 2,
  },
  horizontalList: {
    paddingHorizontal: 20,
  },
  // 로딩/빈 상태
  loadingCard: {
    height: 300,
    backgroundColor: '#F8F9FA',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6B7280',
  },
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

