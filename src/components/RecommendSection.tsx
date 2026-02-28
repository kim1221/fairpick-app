import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, Pressable, Dimensions } from 'react-native';
import { Txt, Post, Badge, Loader } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import eventService from '../services/eventService';
import { EventCardData } from '../data/events';
import { EventImage } from './EventImage';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_WIDTH = SCREEN_WIDTH * 0.7; // 카드 너비 = 화면의 70%
const CARD_SPACING = 12; // 카드 간격

interface RecommendSectionProps {
  onSelectEvent: (event: EventCardData) => void;
}

export function RecommendSection({ onSelectEvent }: RecommendSectionProps) {
  const adaptive = useAdaptive();
  const [events, setEvents] = useState<EventCardData[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let mounted = true;

    const fetchRecommendedEvents = async () => {
      setStatus('loading');
      try {
        const result = await eventService.getRecommendedEvents();
        if (!mounted) {
          return;
        }
        setEvents(result.items);
        setStatus('ready');
      } catch (error) {
        console.error('[RecommendSection] Failed to fetch recommended events:', error);
        if (mounted) {
          setStatus('error');
        }
      }
    };

    fetchRecommendedEvents();

    return () => {
      mounted = false;
    };
  }, []);

  if (status === 'loading') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Txt typography="t4" fontWeight="bold" color={adaptive.grey900}>
            지금 주목할 만한 일정
          </Txt>
        </View>
        <View style={styles.loadingContainer}>
          <Loader customStrokeColor={adaptive.grey600} />
        </View>
      </View>
    );
  }

  if (status === 'error' || events.length === 0) {
    // 에러이거나 데이터가 없으면 섹션을 렌더링하지 않음
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Txt typography="t4" fontWeight="bold" color={adaptive.grey900}>
          지금 주목할 만한 일정
        </Txt>
        <Txt typography="t6" color={adaptive.grey600} style={styles.subtitle}>
          진행 중이거나 곧 시작할 이벤트를 확인하세요
        </Txt>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        snapToInterval={CARD_WIDTH + CARD_SPACING}
        decelerationRate="fast"
      >
        {events.map((event, index) => (
          <RecommendCard
            key={event.id}
            event={event}
            adaptive={adaptive}
            onPress={onSelectEvent}
            isFirst={index === 0}
            isLast={index === events.length - 1}
          />
        ))}
      </ScrollView>
    </View>
  );
}

interface RecommendCardProps {
  event: EventCardData;
  adaptive: ReturnType<typeof useAdaptive>;
  onPress: (event: EventCardData) => void;
  isFirst: boolean;
  isLast: boolean;
}

function RecommendCard({ event, adaptive, onPress, isFirst, isLast }: RecommendCardProps) {
  // badge 속성은 EventCardData에 없으므로 제거

  return (
    <Pressable
      style={[
        styles.card,
        { backgroundColor: adaptive.background },
        isFirst && styles.cardFirst,
        isLast && styles.cardLast,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${event.title} 상세 보기`}
      onPress={() => onPress(event)}
    >
      {/* Badge - 무료 또는 마감 임박 표시 */}
      {(event.isFree || event.isEndingSoon) && (
        <View style={styles.badgeContainer}>
          <View style={[styles.badgePill, { backgroundColor: event.isFree ? '#52C41A' : '#FF6B6B' }]}>
            <Txt typography="t7" fontWeight="bold" color="#FFFFFF">
              {event.isFree ? '무료' : '마감임박'}
            </Txt>
          </View>
        </View>
      )}

      {/* Image */}
      <EventImage
        uri={event.thumbnailUrl}
        height={160}
        accessibilityLabel={`${event.title} 대표 이미지`}
        style={styles.cardImage}
        category={event.category}
      />

      {/* Content */}
      <View style={styles.cardContent}>
        {/* Region Badge */}
        <Badge style={styles.regionBadge}>{event.region}</Badge>

        {/* Title */}
        <Post.H3 numberOfLines={2} style={styles.title}>
          {event.title}
        </Post.H3>

        {/* Period */}
        <Post.Paragraph typography="t7" color={adaptive.grey700} numberOfLines={1}>
          {event.periodText}
        </Post.Paragraph>

        {/* Venue */}
        {event.venue ? (
          <Post.Paragraph typography="t7" color={adaptive.grey600} numberOfLines={1}>
            {event.venue}
          </Post.Paragraph>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 32,
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  subtitle: {
    marginTop: 4,
  },
  loadingContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20 - CARD_SPACING / 2, // 첫 카드와 마지막 카드가 화면 가장자리에 맞도록
  },
  card: {
    width: CARD_WIDTH,
    borderRadius: 20,
    marginHorizontal: CARD_SPACING / 2,
    overflow: 'hidden',
    shadowColor: '#001733',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  cardFirst: {
    marginLeft: 0,
  },
  cardLast: {
    marginRight: 0,
  },
  badgeContainer: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 10,
  },
  badgePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  cardImage: {
    width: '100%',
  },
  cardContent: {
    padding: 16,
  },
  regionBadge: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  title: {
    marginBottom: 8,
  },
});
