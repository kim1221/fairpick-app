import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, Pressable, ActivityIndicator, Dimensions } from 'react-native';
import { Txt, Post, Badge } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import eventService from '../services/eventService';
import { EventCardData } from '../data/events';
import { EventImage } from './EventImage';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_WIDTH = SCREEN_WIDTH * 0.7; // 카드 너비 = 화면의 70%
const CARD_SPACING = 12; // 카드 간격

interface NewArrivalSectionProps {
  onSelectEvent: (event: EventCardData) => void;
}

export function NewArrivalSection({ onSelectEvent }: NewArrivalSectionProps) {
  const adaptive = useAdaptive();
  const [events, setEvents] = useState<EventCardData[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let mounted = true;

    const fetchNewEvents = async () => {
      setStatus('loading');
      try {
        const result = await eventService.getNewEvents();
        if (!mounted) {
          return;
        }
        setEvents(result);
        setStatus('ready');
      } catch (error) {
        console.error('[NewArrivalSection] Failed to fetch new events:', error);
        if (mounted) {
          setStatus('error');
        }
      }
    };

    fetchNewEvents();

    return () => {
      mounted = false;
    };
  }, []);

  if (status === 'loading') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Txt typography="h3" fontWeight="bold" color={adaptive.grey900}>
            NEW
          </Txt>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={adaptive.grey600} />
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
        <Txt typography="h3" fontWeight="bold" color={adaptive.grey900}>
          NEW
        </Txt>
        <Txt typography="t6" color={adaptive.grey600} style={styles.subtitle}>
          최근 추가된 새로운 이벤트를 만나보세요
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
          <NewArrivalCard
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

interface NewArrivalCardProps {
  event: EventCardData;
  adaptive: ReturnType<typeof useAdaptive>;
  onPress: (event: EventCardData) => void;
  isFirst: boolean;
  isLast: boolean;
}

function NewArrivalCard({ event, adaptive, onPress, isFirst, isLast }: NewArrivalCardProps) {
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
      {/* NEW Badge - 상단 좌측 */}
      <View style={styles.newBadgeContainer}>
        <View style={[styles.newBadgePill, { backgroundColor: '#FF4D4F' }]}>
          <Txt typography="t8" fontWeight="bold" color="#FFFFFF">
            NEW
          </Txt>
        </View>
      </View>

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
          <Post.Paragraph typography="t8" color={adaptive.grey600} numberOfLines={1}>
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
    paddingHorizontal: 20 - CARD_SPACING / 2,
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
  newBadgeContainer: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 10,
  },
  newBadgePill: {
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
