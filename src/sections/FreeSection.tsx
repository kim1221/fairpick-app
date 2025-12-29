import React from 'react';
import { ScrollView, StyleSheet, View, Pressable, Dimensions } from 'react-native';
import { Txt, Post, Badge } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import { EventCardData } from '../data/events';
import { EventImage } from '../components/EventImage';
import { EventBadge } from '../components/EventBadge';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_WIDTH = SCREEN_WIDTH * 0.7;
const CARD_SPACING = 12;

interface FreeSectionProps {
  items: EventCardData[];
  onPressItem: (id: string) => void;
}

export function FreeSection({ items, onPressItem }: FreeSectionProps) {
  const adaptive = useAdaptive();

  if (items.length === 0) {
    return null;
  }

  const handlePress = (event: EventCardData) => {
    onPressItem(event.id);
  };

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
      <View style={styles.header}>
        <Txt typography="h3" fontWeight="bold" color={adaptive.grey900}>
          💸 FREE
        </Txt>
        <Txt typography="t6" color={adaptive.grey600} style={styles.subtitle}>
          무료로 즐길 수 있는 이벤트
        </Txt>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        snapToInterval={CARD_WIDTH + CARD_SPACING}
        decelerationRate="fast"
      >
        {items.map((event, index) => (
          <FreeCard
            key={event.id}
            event={event}
            adaptive={adaptive}
            onPress={handlePress}
            isFirst={index === 0}
            isLast={index === items.length - 1}
          />
        ))}
      </ScrollView>
    </View>
  );
}

interface FreeCardProps {
  event: EventCardData;
  adaptive: ReturnType<typeof useAdaptive>;
  onPress: (event: EventCardData) => void;
  isFirst: boolean;
  isLast: boolean;
}

function FreeCard({ event, adaptive, onPress, isFirst, isLast }: FreeCardProps) {
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
      {/* FREE Badge */}
      <View style={styles.badgeContainer}>
        <EventBadge type="free" />
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
    marginBottom: 16,
    borderRadius: 16,
    paddingVertical: 20,
    shadowColor: '#001733',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  subtitle: {
    marginTop: 4,
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
  badgeContainer: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 10,
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
