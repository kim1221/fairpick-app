import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, Text, Pressable, Image } from 'react-native';
import { Loader, Icon } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import eventService from '../services/eventService';
import { EventCardData } from '../data/events';
import { BottomTabBar } from '../components/BottomTabBar';
import { getImageSource } from '../utils/imageHelpers';


export const Route = createRoute('/hot', {
  component: HotPage,
});

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
    headerTitle: {
      fontSize: 28,
      fontWeight: '700',
      color: a.grey900,
      marginBottom: 4,
    },
    headerSubtitle: {
      fontSize: 14,
      color: a.grey600,
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
      position: 'relative',
    },
    rankBadge: {
      position: 'absolute',
      top: 8,
      left: 8,
      width: 28,
      height: 28,
      borderRadius: 14,
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 10,
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
    },
    rankText: {
      fontSize: 13,
      fontWeight: '700',
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
      flexWrap: 'wrap',
      marginBottom: 6,
    },
    badge: {
      backgroundColor: a.grey100,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 4,
      marginRight: 6,
      marginBottom: 4,
    },
    badgeText: {
      fontSize: 11,
      fontWeight: '600',
      color: a.grey700,
    },
    freeBadge: {
      backgroundColor: a.blue50,
    },
    freeBadgeText: {
      fontSize: 11,
      fontWeight: '600',
      color: a.blue500,
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
    venueRow: {
      flexDirection: 'row',
      alignItems: 'center',
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
    },
  });
}

function HotPage() {
  if (__DEV__) console.log('[RouteRender] HotPage rendered');

  const navigation = Route.useNavigation();
  const [events, setEvents] = useState<EventCardData[]>([]);
  const [loading, setLoading] = useState(true);

  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);

  useEffect(() => {
    loadHotEvents();
  }, []);

  const loadHotEvents = async () => {
    try {
      setLoading(true);
      const result = await eventService.getHotEvents(1, 50);
      setEvents(result.items);
    } catch (error) {
      console.error('Failed to load hot events:', error);
    } finally {
      setLoading(false);
    }
  };

  const getRankBadgeStyle = (rank: number) => {
    if (rank === 1) return { backgroundColor: '#FFD700', color: '#000000' };
    if (rank === 2) return { backgroundColor: '#C0C0C0', color: '#000000' };
    if (rank === 3) return { backgroundColor: '#CD7F32', color: '#FFFFFF' };
    return { backgroundColor: adaptive.grey100, color: adaptive.grey700 };
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* 헤더 */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>HOT</Text>
          <Text style={styles.headerSubtitle}>지금 가장 인기 있는 이벤트</Text>
        </View>

        {/* 이벤트 리스트 */}
        <View style={styles.eventsContainer}>
          {loading ? (
            <View style={styles.loadingContainer}>
              <Loader size="large" type="primary" />
              <Text style={styles.loadingText}>로딩 중...</Text>
            </View>
          ) : events.length > 0 ? (
            events.map((event, index) => {
              const rank = index + 1;
              const rankStyle = getRankBadgeStyle(rank);

              return (
                <Pressable
                  key={event.id}
                  style={styles.eventCard}
                  onPress={() => navigation.navigate('/events/:id', { id: event.id })}
                >
                  {/* 랭킹 배지 */}
                  <View
                    style={[styles.rankBadge, { backgroundColor: rankStyle.backgroundColor }]}
                  >
                    <Text style={[styles.rankText, { color: rankStyle.color }]}>
                      {rank}
                    </Text>
                  </View>

                  <Image
                    source={getImageSource(event.thumbnailUrl, event.category)}
                    style={styles.eventImage}
                    resizeMode="cover"
                  />
                  <View style={styles.eventInfo}>
                    <View style={styles.eventBadges}>
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{event.region}</Text>
                      </View>
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{event.category}</Text>
                      </View>
                      {event.isFree && (
                        <View style={[styles.badge, styles.freeBadge]}>
                          <Text style={styles.freeBadgeText}>무료</Text>
                        </View>
                      )}
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
              );
            })
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>현재 인기 이벤트가 없어요</Text>
            </View>
          )}
        </View>

        {/* 하단 여백 */}
        <View style={{ height: 100 }} />
      </ScrollView>

      <BottomTabBar currentTab="home" />
    </View>
  );
}
