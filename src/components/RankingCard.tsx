import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { EventCardData } from '../data/events';
import { EventBadge } from './EventBadge';
import { formatEventPeriodShort } from '../lib/dateUtils';
import { getImageSource } from '../utils/imageHelpers';

const SCREEN_WIDTH = Dimensions.get('window').width;

interface RankingCardProps {
  event: EventCardData;
  rank: number; // 1~10
  onPress?: () => void;
}

export const RankingCard: React.FC<RankingCardProps> = ({ event, rank, onPress }) => {
  // 모든 카드 동일한 크기
  const cardWidth = SCREEN_WIDTH * 0.85;
  const cardHeight = 280;

  console.log('[DEBUG] RankingCard event:', {
    id: event.id,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    periodText: event.periodText,
  });
  console.log('[DEBUG] RankingCard formatEventPeriodShort result:', formatEventPeriodShort(event.startAt, event.endAt));

  return (
    <TouchableOpacity
      style={[styles.card, { width: cardWidth, height: cardHeight }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* 배경 이미지 */}
      <Image
        source={getImageSource(event.thumbnailUrl, event.category)}
        style={styles.image}
        resizeMode="cover"
      />
      
      {/* 어두운 그라데이션 오버레이 */}
      <View style={styles.overlay} />
      
      {/* 좌측 상단 HOT 배지 */}
      <EventBadge type="hot" />
      
      {/* 하단 정보 영역 */}
      <View style={styles.infoContainer}>
        {/* 왼쪽: 순위 숫자 */}
        <View style={styles.rankBadge}>
          <Text style={styles.rankText}>{rank}</Text>
        </View>
        
        {/* 오른쪽: 이벤트 정보 */}
        <View style={styles.eventInfo}>
          <Text style={styles.title} numberOfLines={2}>
            {event.title}
          </Text>
          <Text style={styles.subtitle}>
            {event.venue} · {event.region}
          </Text>
          <Text style={styles.date}>
            {formatEventPeriodShort(event.startAt, event.endAt)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    marginRight: 16,
    backgroundColor: '#000',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  image: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  infoContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 16,
  },
  rankBadge: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  rankText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
  },
  eventInfo: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
    lineHeight: 22,
  },
  subtitle: {
    fontSize: 13,
    color: '#E5E8EB',
    marginBottom: 2,
  },
  date: {
    fontSize: 12,
    color: '#C1C7CD',
  },
});
