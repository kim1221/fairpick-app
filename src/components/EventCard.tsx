/**
 * EventCard 컴포넌트
 * 
 * 다양한 스타일의 이벤트 카드를 제공합니다.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable, Image, ViewStyle } from 'react-native';
import type { ScoredEvent } from '../types/recommendation';

// ==================== 타입 정의 ====================

interface EventCardProps {
  event: ScoredEvent;
  onPress: (eventId: string) => void;
  variant?: 'default' | 'large' | 'small' | 'horizontal';
}

// ==================== 헬퍼 함수 ====================

/**
 * 날짜 포맷팅 (YYYY-MM-DD → MM.DD)
 */
function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${month}.${day}`;
  } catch {
    return dateString;
  }
}

/**
 * 기간 포맷팅
 */
function formatPeriod(startDate: string, endDate: string): string {
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

/**
 * 거리 포맷팅 (거리 + 이동 시간)
 * 
 * 계산 기준:
 * - 도보: 평균 4km/h (분속 67m)
 * - 대중교통: 평균 20km/h + 대기시간 5분
 * - 직선 거리 × 1.3 (실제 도로 우회율)
 */
function formatDistance(distanceKm?: number): string {
  if (!distanceKm) return '';
  
  // 실제 도로 거리 추정 (직선 거리 × 1.3)
  const actualKm = distanceKm * 1.3;
  
  // 거리 표시
  const distanceText = actualKm < 1 
    ? `${Math.round(actualKm * 1000)}m` 
    : `${actualKm.toFixed(1)}km`;
  
  // 1km 이하: 도보 시간
  if (actualKm <= 1) {
    const walkMin = Math.round((actualKm / 4) * 60);
    return `${distanceText} · 도보 ${walkMin}분`;
  }
  
  // 1-3km: 도보 가능
  if (actualKm <= 3) {
    const walkMin = Math.round((actualKm / 4) * 60);
    return `${distanceText} · 도보 ${walkMin}분`;
  }
  
  // 3km 이상: 대중교통 시간
  const transitMin = Math.round((actualKm / 20) * 60) + 5;
  return `${distanceText} · 대중교통 ${transitMin}분`;
}

// ==================== 메인 컴포넌트 ====================

export const EventCard: React.FC<EventCardProps> = ({ event, onPress, variant = 'default' }) => {
  const renderImage = () => (
    <View style={[styles.imageContainer, getImageStyle(variant)]}>
      {event.thumbnail_url ? (
        <Image 
          source={{ uri: event.thumbnail_url }} 
          style={styles.image}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.placeholderImage}>
          <Text style={styles.placeholderEmoji}>
            {getCategoryEmoji(event.category)}
          </Text>
        </View>
      )}
      
      {/* 카테고리 배지 */}
      <View style={styles.categoryBadge}>
        <Text style={styles.categoryBadgeText}>{event.category}</Text>
      </View>

      {/* 지역 배지 */}
      {event.region && (
        <View style={styles.regionBadge}>
          <Text style={styles.regionBadgeText}>📍 {event.region}</Text>
        </View>
      )}
    </View>
  );

  const renderContent = () => (
    <View style={[styles.content, getContentStyle(variant)]}>
      {/* 제목 */}
      <Text style={[styles.title, getTitleStyle(variant)]} numberOfLines={2}>
        {event.title}
      </Text>

      {/* 태그/이유 */}
      {event.reason && event.reason.length > 0 && (
        <View style={styles.tagsContainer}>
          {event.reason.slice(0, 3).map((tag, idx) => (
            <View key={idx} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}

      {/* 메타 정보 */}
      <View style={styles.metaContainer}>
        {event.distance_km !== undefined && (
          <Text style={styles.metaText}>
            🚶 {formatDistance(event.distance_km)}
          </Text>
        )}
        {event.start_date && event.end_date && (
          <Text style={styles.metaText}>
            📅 {formatPeriod(event.start_date, event.end_date)}
          </Text>
        )}
      </View>

      {/* 장소 (large variant만) */}
      {variant === 'large' && event.venue && (
        <Text style={styles.venue} numberOfLines={1}>
          📍 {event.venue}
        </Text>
      )}
    </View>
  );

  if (variant === 'horizontal') {
    return (
      <Pressable
        style={styles.horizontalCard}
        onPress={() => onPress(event.id)}
        android_ripple={{ color: '#E5E7EB' }}
      >
        {renderImage()}
        {renderContent()}
      </Pressable>
    );
  }

  return (
    <Pressable
      style={[styles.card, getCardStyle(variant)]}
      onPress={() => onPress(event.id)}
      android_ripple={{ color: '#E5E7EB' }}
    >
      {renderImage()}
      {renderContent()}
    </Pressable>
  );
};

// ==================== 스타일 헬퍼 ====================

function getCardStyle(variant: string): ViewStyle {
  switch (variant) {
    case 'large':
      return styles.cardLarge;
    case 'small':
      return styles.cardSmall;
    default:
      return {};
  }
}

function getImageStyle(variant: string): ViewStyle {
  switch (variant) {
    case 'large':
      return styles.imageContainerLarge;
    case 'small':
      return styles.imageContainerSmall;
    case 'horizontal':
      return styles.imageContainerHorizontal;
    default:
      return {};
  }
}

function getContentStyle(variant: string): ViewStyle {
  switch (variant) {
    case 'large':
      return styles.contentLarge;
    case 'small':
      return styles.contentSmall;
    case 'horizontal':
      return styles.contentHorizontal;
    default:
      return {};
  }
}

function getTitleStyle(variant: string) {
  switch (variant) {
    case 'large':
      return styles.titleLarge;
    case 'small':
      return styles.titleSmall;
    default:
      return {};
  }
}

function getCategoryEmoji(category: string): string {
  const emojiMap: Record<string, string> = {
    '팝업': '🏪',
    '전시': '🎨',
    '공연': '🎭',
    '축제': '🎉',
    '행사': '🎪',
    '뮤지컬': '🎵',
    '연극': '🎬',
    '콘서트': '🎤',
  };
  return emojiMap[category] || '📌';
}

// ==================== 스타일 ====================

const styles = StyleSheet.create({
  // 기본 카드
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardLarge: {
    borderRadius: 16,
  },
  cardSmall: {
    width: 160,
    marginRight: 12,
  },

  // 가로형 카드
  horizontalCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },

  // 이미지
  imageContainer: {
    width: '100%',
    height: 140,
    backgroundColor: '#F3F4F6',
    position: 'relative',
  },
  imageContainerLarge: {
    height: 200,
  },
  imageContainerSmall: {
    height: 100,
  },
  imageContainerHorizontal: {
    width: 100,
    height: 100,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholderImage: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#E5E7EB',
  },
  placeholderEmoji: {
    fontSize: 48,
  },

  // 카테고리 배지
  categoryBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  categoryBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },

  // 지역 배지
  regionBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  regionBadgeText: {
    color: '#1A1A1A',
    fontSize: 11,
    fontWeight: '500',
  },

  // 콘텐츠
  content: {
    padding: 12,
  },
  contentLarge: {
    padding: 16,
  },
  contentSmall: {
    padding: 10,
  },
  contentHorizontal: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
  },

  // 제목
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 8,
    lineHeight: 20,
  },
  titleLarge: {
    fontSize: 17,
    lineHeight: 24,
  },
  titleSmall: {
    fontSize: 13,
    lineHeight: 18,
  },

  // 태그
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  tag: {
    backgroundColor: '#EBF0FF',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 6,
    marginBottom: 4,
  },
  tagText: {
    color: '#3182F6',
    fontSize: 11,
    fontWeight: '600',
  },

  // 메타 정보
  metaContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaText: {
    fontSize: 12,
    color: '#6B7280',
    marginRight: 8,
  },

  // 장소
  venue: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
  },
});

