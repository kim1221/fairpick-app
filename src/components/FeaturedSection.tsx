import React from 'react';
import { View, ScrollView, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Txt } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import { EventCardData } from '../data/events';
import { EventImage } from './EventImage';

interface FeaturedSectionProps {
  events: EventCardData[];
  loading: boolean;
  onPressEvent: (eventId: string) => void;
}

export const FeaturedSection: React.FC<FeaturedSectionProps> = ({
  events,
  loading,
  onPressEvent,
}) => {
  const adaptive = useAdaptive();

  // 이벤트가 없으면 렌더링하지 않음
  if (!loading && events.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* 섹션 타이틀 */}
      <View style={styles.header}>
        <Txt typography="t5" fontWeight="bold" color={adaptive.grey900}>
          ⭐ 에디터 픽
        </Txt>
      </View>

      {/* 로딩 상태 */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={adaptive.grey600} />
        </View>
      ) : (
        /* 가로 스크롤 카드 */
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {events.map((event) => (
            <Pressable
              key={event.id}
              style={styles.card}
              onPress={() => onPressEvent(event.id)}
              activeOpacity={0.8}
            >
              {/* Hero 이미지 */}
              <EventImage
                uri={event.thumbnailUrl}
                category={event.category}
                height={200}
                borderRadius={12}
                style={styles.cardImage}
              />

              {/* 카드 정보 */}
              <View style={styles.cardInfo}>
                <Txt
                  typography="t6"
                  fontWeight="bold"
                  numberOfLines={2}
                  color={adaptive.grey900}
                  style={styles.cardTitle}
                >
                  {event.title}
                </Txt>
                <Txt typography="t7" color={adaptive.grey600} numberOfLines={1}>
                  📍 {event.venue}
                </Txt>
                <Txt typography="t7" color={adaptive.grey600} numberOfLines={1}>
                  📅 {event.periodText}
                </Txt>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  loadingContainer: {
    height: 280,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    gap: 12,
  },
  card: {
    width: 260,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  cardImage: {
    width: '100%',
  },
  cardInfo: {
    padding: 12,
  },
  cardTitle: {
    marginBottom: 4,
    lineHeight: 20,
  },
});
