import React from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { Txt, Post, Badge } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import { EventCardData } from '../data/events';
import { EventImage } from '../components/EventImage';
import { EventBadge } from '../components/EventBadge';

interface EndingSectionProps {
  items: EventCardData[];
  onPressItem: (id: string) => void;
}

export function EndingSection({ items, onPressItem }: EndingSectionProps) {
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
          ⏳ ENDING SOON
        </Txt>
        <Txt typography="t6" color={adaptive.grey600} style={styles.subtitle}>
          곧 마감되는 이벤트를 놓치지 마세요
        </Txt>
      </View>
      <View style={styles.cardList}>
        {items.map((event) => (
          <CompactCard key={event.id} event={event} adaptive={adaptive} onPress={handlePress} />
        ))}
      </View>
    </View>
  );
}

interface CompactCardProps {
  event: EventCardData;
  adaptive: ReturnType<typeof useAdaptive>;
  onPress: (event: EventCardData) => void;
}

function CompactCard({ event, adaptive, onPress }: CompactCardProps) {
  return (
    <Pressable
      style={[styles.card, { backgroundColor: adaptive.background }]}
      accessibilityRole="button"
      accessibilityLabel={`${event.title} 상세 보기`}
      onPress={() => onPress(event)}
    >
      {/* Image */}
      <View style={styles.imageContainer}>
        <EventImage
          uri={event.thumbnailUrl}
          height={100}
          accessibilityLabel={`${event.title} 대표 이미지`}
          style={styles.cardImage}
          category={event.category}
        />
        {/* Badge */}
        <View style={styles.badgeContainer}>
          <EventBadge type="ending" />
        </View>
      </View>

      {/* Content */}
      <View style={styles.cardContent}>
        <View style={styles.badgeRow}>
          <Badge style={styles.badge}>{event.region}</Badge>
        </View>
        <Post.H4 numberOfLines={2} style={styles.title}>
          {event.title}
        </Post.H4>
        <Post.Paragraph typography="t7" color={adaptive.grey700} numberOfLines={1}>
          {event.periodText}
        </Post.Paragraph>
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
    padding: 20,
    shadowColor: '#001733',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    marginBottom: 16,
  },
  subtitle: {
    marginTop: 4,
  },
  cardList: {
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 12,
    shadowColor: '#001733',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  imageContainer: {
    width: 100,
    height: 100,
    borderRadius: 8,
    overflow: 'hidden',
    marginRight: 12,
    position: 'relative',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  badgeContainer: {
    position: 'absolute',
    top: 6,
    left: 6,
    zIndex: 10,
  },
  cardContent: {
    flex: 1,
    justifyContent: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  badge: {
    marginRight: 6,
  },
  title: {
    marginBottom: 4,
  },
});
