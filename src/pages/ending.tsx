import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, Text, Pressable, ActivityIndicator, Image } from 'react-native';
import eventService from '../services/eventService';
import { EventCardData } from '../data/events';
import { BottomTabBar } from '../components/BottomTabBar';
import { getImageSource } from '../utils/imageHelpers';
import { parseDate } from '../lib/dateUtils';

export const Route = createRoute('/ending', {
  component: EndingPage,
});

function EndingPage() {
  if (__DEV__) console.log('[RouteRender] EndingPage rendered');

  const navigation = Route.useNavigation();
  const [events, setEvents] = useState<EventCardData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEndingEvents();
  }, []);

  const loadEndingEvents = async () => {
    try {
      setLoading(true);
      const result = await eventService.getEndingEvents(1, 50);
      setEvents(result.items);
    } catch (error) {
      console.error('Failed to load ending events:', error);
    } finally {
      setLoading(false);
    }
  };

  const getDDay = (endAt: string | undefined): string => {
    if (!endAt) return '';

    const endDate = parseDate(endAt);
    if (!endDate) return '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endDateOnly = new Date(endDate);
    endDateOnly.setHours(0, 0, 0, 0);

    const diffTime = endDateOnly.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return '오늘 마감';
    if (diffDays === 1) return '내일 마감';
    if (diffDays < 0) return '마감';
    if (diffDays <= 7) return `D-${diffDays}`;
    return `${diffDays}일 남음`;
  };

  const getDDayStyle = (endAt: string | undefined): { backgroundColor: string; color: string } => {
    if (!endAt) return { backgroundColor: '#F2F4F6', color: '#4E5968' };

    const endDate = parseDate(endAt);
    if (!endDate) return { backgroundColor: '#F2F4F6', color: '#4E5968' };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endDateOnly = new Date(endDate);
    endDateOnly.setHours(0, 0, 0, 0);

    const diffTime = endDateOnly.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return { backgroundColor: '#FFEBEE', color: '#D32F2F' }; // 마감
    if (diffDays <= 3) return { backgroundColor: '#FFE5E5', color: '#FF4848' }; // 임박
    if (diffDays <= 7) return { backgroundColor: '#FFF4E5', color: '#FF9500' }; // 곧 마감
    return { backgroundColor: '#E5F4FF', color: '#3182F6' }; // 여유
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* 헤더 */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>⏳ 마감임박</Text>
          <Text style={styles.headerSubtitle}>곧 마감되는 이벤트를 놓치지 마세요</Text>
        </View>

        {/* 이벤트 리스트 */}
        <View style={styles.eventsContainer}>
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#3182F6" />
              <Text style={styles.loadingText}>로딩 중...</Text>
            </View>
          ) : events.length > 0 ? (
            events.map((event) => {
              const dDayText = getDDay(event.endAt);
              const dDayStyle = getDDayStyle(event.endAt);

              return (
                <Pressable
                  key={event.id}
                  style={styles.eventCard}
                  onPress={() => navigation.navigate('/events/:id', { id: event.id })}
                  activeOpacity={0.7}
                >
                  <Image
                    source={getImageSource(event.thumbnailUrl, event.category)}
                    style={styles.eventImage}
                    resizeMode="cover"
                  />
                  <View style={styles.eventInfo}>
                    <View style={styles.eventBadges}>
                      {dDayText && (
                        <View
                          style={[
                            styles.dDayBadge,
                            { backgroundColor: dDayStyle.backgroundColor },
                          ]}
                        >
                          <Text
                            style={[styles.dDayBadgeText, { color: dDayStyle.color }]}
                          >
                            {dDayText}
                          </Text>
                        </View>
                      )}
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{event.region}</Text>
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
                      <Text style={styles.eventVenue} numberOfLines={1}>
                        📍 {event.venue}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                마감 임박 이벤트가 없습니다
              </Text>
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
    paddingTop: 50,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#191F28',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6B7684',
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
    color: '#8B95A1',
  },
  eventCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
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
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  dDayBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 6,
    marginBottom: 4,
  },
  dDayBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  badge: {
    backgroundColor: '#F2F4F6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 6,
    marginBottom: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4E5968',
  },
  eventTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#191F28',
    marginBottom: 4,
    lineHeight: 20,
  },
  eventMeta: {
    fontSize: 13,
    color: '#6B7684',
    marginBottom: 4,
  },
  eventVenue: {
    fontSize: 13,
    color: '#8B95A1',
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: '#B0B8C1',
  },
});
