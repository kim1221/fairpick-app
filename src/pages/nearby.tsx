import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, Text, Pressable, Image, Alert } from 'react-native';
import { Loader, Icon } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import { Accuracy, getCurrentLocation, GetCurrentLocationPermissionError } from '@apps-in-toss/framework';
import eventService from '../services/eventService';
import { EventCardData } from '../data/events';
import { BottomTabBar } from '../components/BottomTabBar';
import { getImageSource } from '../utils/imageHelpers';
import http from '../lib/http';


export const Route = createRoute('/nearby', {
  component: NearbyPage,
});

interface EventWithDistance extends EventCardData {
  distance: number;
}

interface ReverseGeocodeResponse {
  gu: string;
  dong: string;
  label: string;
}

// 서울 시청 좌표를 기본값으로 사용 (권한 거부 시에만 fallback)
const DEFAULT_LOCATION = {
  lat: 37.5665,
  lng: 126.978,
  name: '서울',
};

type Adaptive = ReturnType<typeof useAdaptive>;

function createStyles(a: Adaptive) {
  return StyleSheet.create({
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
      paddingTop: 50,
      paddingBottom: 16,
    },
    headerTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 4,
    },
    headerTitle: {
      fontSize: 28,
      fontWeight: '700',
      color: a.grey900,
    },
    refreshButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: a.grey100,
      justifyContent: 'center',
      alignItems: 'center',
    },
    locationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 4,
    },
    locationText: {
      fontSize: 14,
      color: a.blue500,
      fontWeight: '600',
    },
    venueRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    radiusText: {
      fontSize: 13,
      color: a.grey500,
      fontWeight: '500',
    },
    eventsContainer: {
      paddingHorizontal: 20,
      paddingTop: 16,
    },
    loadingContainer: {
      paddingVertical: 60,
      alignItems: 'center',
    },
    loadingText: {
      marginTop: 16,
      fontSize: 14,
      color: a.grey500,
    },
    eventCard: {
      flexDirection: 'row',
      backgroundColor: a.background,
      borderRadius: 12,
      marginBottom: 12,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.05,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
    },
    eventImage: {
      width: 100,
      height: 100,
    },
    eventInfo: {
      flex: 1,
      padding: 12,
    },
    eventBadges: {
      flexDirection: 'row',
      marginBottom: 6,
    },
    distanceBadge: {
      backgroundColor: a.blue50,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 4,
      marginRight: 6,
    },
    distanceBadgeText: {
      fontSize: 11,
      fontWeight: '700',
      color: a.blue500,
    },
    badge: {
      backgroundColor: a.grey100,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 4,
      marginRight: 6,
    },
    badgeText: {
      fontSize: 11,
      fontWeight: '600',
      color: a.grey700,
    },
    eventTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: a.grey900,
      marginBottom: 4,
      lineHeight: 20,
    },
    eventMeta: {
      fontSize: 13,
      color: a.grey600,
      marginBottom: 4,
    },
    eventVenue: {
      fontSize: 13,
      color: a.grey500,
      flex: 1,
    },
    emptyContainer: {
      paddingVertical: 60,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 15,
      color: a.grey400,
      textAlign: 'center',
    },
  });
}

function NearbyPage() {
  const navigation = Route.useNavigation();
  const [events, setEvents] = useState<EventWithDistance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [locationText, setLocationText] = useState(DEFAULT_LOCATION.name);
  const [_userLat, setUserLat] = useState<number>(DEFAULT_LOCATION.lat);
  const [_userLng, setUserLng] = useState<number>(DEFAULT_LOCATION.lng);

  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);

  useEffect(() => {
    // 앱 진입 시 위치 자동 감지 1회
    initializeLocation();
  }, []);

  const initializeLocation = async () => {
    await requestLocationAndLoadEvents();
  };

  const requestLocationAndLoadEvents = async () => {
    try {
      setLoading(true);

      // Toss Web Framework의 getCurrentLocation 사용
      try {
        const location = await getCurrentLocation({ accuracy: Accuracy.Balanced });
        const { latitude, longitude } = location.coords;

        console.log('[GPS] 현재 위치:', { lat: latitude, lng: longitude });

        setUserLat(latitude);
        setUserLng(longitude);

        // 백엔드 reverse geocode API 호출 (카카오 coord2address)
        try {
          const response = await http.get<ReverseGeocodeResponse>('/geo/reverse', {
            params: { lat: latitude, lng: longitude },
          });

          const label = response.data.label || DEFAULT_LOCATION.name;
          console.log('[Reverse] 주소:', label);
          setLocationText(label);
        } catch (error: any) {
          console.error('[Reverse] 역지오코딩 실패:', error?.response?.status, error?.message);
          // 백엔드 API 실패 시 기본 주소 사용
          setLocationText(`위도 ${latitude.toFixed(4)}, 경도 ${longitude.toFixed(4)}`);
        }

        // 이벤트 로드
        await loadNearbyEvents(latitude, longitude);
        setLoading(false);
      } catch (error) {
        // 위치 권한 거부 또는 실패
        if (error instanceof GetCurrentLocationPermissionError) {
          console.warn('[GPS] 위치 권한 거부 - 기본 위치 사용');
          Alert.alert(
            '위치 권한 필요',
            '주변 이벤트를 보려면 위치 권한이 필요해요. 지금은 서울 기준으로 표시할게요.',
            [{ text: '확인' }]
          );
        } else {
          console.error('[GPS] 위치 가져오기 실패:', error);
        }

        // 기본 위치 사용
        setLocationText(DEFAULT_LOCATION.name);
        setUserLat(DEFAULT_LOCATION.lat);
        setUserLng(DEFAULT_LOCATION.lng);
        await loadNearbyEvents(DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lng);
        setLoading(false);
      }
    } catch (error) {
      console.error('[GPS] Unexpected error:', error);
      setLocationText(DEFAULT_LOCATION.name);
      setUserLat(DEFAULT_LOCATION.lat);
      setUserLng(DEFAULT_LOCATION.lng);
      await loadNearbyEvents(DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lng);
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);

    // 권한 상태 확인
    try {
      const permission = await getCurrentLocation.getPermission();

      if (permission === 'denied') {
        // 권한이 거부된 경우 다이얼로그 표시
        const newPermission = await getCurrentLocation.openPermissionDialog();

        if (newPermission === 'denied') {
          Alert.alert(
            '위치 권한 필요',
            '주변 이벤트를 보려면 위치 권한이 필요해요.',
            [{ text: '확인' }]
          );
          setRefreshing(false);
          return;
        }
      }
    } catch (error) {
      console.warn('[Permission] 권한 확인 실패:', error);
    }

    await requestLocationAndLoadEvents();
    setRefreshing(false);
  };

  const loadNearbyEvents = async (userLat: number, userLng: number) => {
    try {
      setLoading(true);

      // 다중 페이지 fetch (최대 10 페이지, size=100씩)
      const allEvents: EventCardData[] = [];
      const maxPages = 10;
      const pageSize = 100;

      for (let page = 1; page <= maxPages; page++) {
        const result = await eventService.getEventList({
          category: '전체',
          region: '전국',
          page,
          size: pageSize,
        });

        allEvents.push(...result.items);

        // 더 이상 데이터가 없으면 중단
        if (result.items.length < pageSize) {
          break;
        }
      }

      // 좌표가 있는 이벤트만 필터링
      const eventsWithCoords = allEvents.filter((event) => event.lat && event.lng);

      // 거리 계산
      const eventsWithDistance = eventsWithCoords.map((event) => ({
        ...event,
        distance: calculateDistance(userLat, userLng, event.lat!, event.lng!),
      }));

      // 5km 이내만 필터링
      const within5km = eventsWithDistance.filter((event) => event.distance <= 5);

      // 거리순 정렬
      within5km.sort((a, b) => a.distance - b.distance);

      if (__DEV__) {
        console.log('[NearbyPage][DataCount] 전체 fetch:', allEvents.length, '좌표 있음:', eventsWithCoords.length, '5km 이내:', within5km.length);
        console.log('[NearbyPage][DataCount] 필터 비율 - 좌표:', Math.round((eventsWithCoords.length / allEvents.length) * 100) + '%', '5km:', Math.round((within5km.length / eventsWithCoords.length) * 100) + '%');
        console.log('[NearbyPage][INFO] ⚠️ This is /nearby page client-side filtering, NOT TodayBanner');
      }

      setEvents(within5km);
    } catch (error) {
      console.error('Failed to load nearby events:', error);
      Alert.alert('오류', '주변 이벤트를 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371; // 지구 반지름 (km)
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const formatDistance = (distanceKm: number): string => {
    if (distanceKm < 1) {
      return `${Math.round(distanceKm * 1000)}m`;
    }
    return `${distanceKm.toFixed(1)}km`;
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* 헤더 */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.headerTitle}>내 주변</Text>
            <Pressable
              style={styles.refreshButton}
              onPress={handleRefresh}
              disabled={refreshing}
            >
              <Icon name="icon-refresh-mono" size={20} color={adaptive.grey700} />
            </Pressable>
          </View>
          <View style={styles.locationRow}>
            <Icon name="icon-pin-mono" size={12} color={adaptive.blue500} style={{ marginRight: 4 }} />
            <Text style={styles.locationText}>{locationText}</Text>
          </View>
          <Text style={styles.radiusText}>반경 5km · {events.length}개</Text>
        </View>

        {/* 이벤트 리스트 */}
        <View style={styles.eventsContainer}>
          {loading ? (
            <View style={styles.loadingContainer}>
              <Loader size="large" type="primary" />
              <Text style={styles.loadingText}>주변 이벤트 검색 중...</Text>
            </View>
          ) : events.length > 0 ? (
            events.map((event, index) => (
              <Pressable
                key={`${event.id}-${index}`}
                style={styles.eventCard}
                onPress={() => navigation.navigate('/events/:id', { id: event.id })}
              >
                <Image
                  source={getImageSource(event.thumbnailUrl, event.category)}
                  style={styles.eventImage}
                  resizeMode="cover"
                />
                <View style={styles.eventInfo}>
                  <View style={styles.eventBadges}>
                    <View style={styles.distanceBadge}>
                      <Text style={styles.distanceBadgeText}>
                        {formatDistance(event.distance)}
                      </Text>
                    </View>
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{event.category}</Text>
                    </View>
                  </View>
                  <Text style={styles.eventTitle} numberOfLines={2}>
                    {event.title}
                  </Text>
                  <Text style={styles.eventMeta}>{event.periodText}</Text>
                  {event.venue && (
                    <View style={styles.venueRow}>
                      <Icon name="icon-pin-mono" size={11} color={adaptive.grey500} style={{ marginRight: 3 }} />
                      <Text style={styles.eventVenue} numberOfLines={1}>{event.venue}</Text>
                    </View>
                  )}
                </View>
              </Pressable>
            ))
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                주변에 진행 중인 이벤트가 없어요
              </Text>
            </View>
          )}
        </View>

        {/* 하단 여백 */}
        <View style={{ height: 100 }} />
      </ScrollView>

      <BottomTabBar currentTab={"explore" as any} />
    </View>
  );
}
