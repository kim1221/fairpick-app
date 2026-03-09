/**
 * EventCard 컴포넌트
 *
 * 다양한 스타일의 이벤트 카드를 제공합니다.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Image, ViewStyle } from 'react-native';
import type { ScoredEvent } from '../types/recommendation';
import { useAdaptive } from '@toss/tds-react-native/private';
import { IconButton } from '@toss/tds-react-native';
import { formatEventPeriodHuman, getDateUrgency, type DateUrgency } from '../lib/dateUtils';
import { Analytics } from '@apps-in-toss/framework';
import { useLike } from '../hooks/useLike';

// ==================== 타입 정의 ====================

interface EventCardProps {
  event: ScoredEvent;
  onPress: (eventId: string) => void;
  variant?: 'default' | 'large' | 'small' | 'horizontal';
  contextLabel?: string;       // 섹션별 핵심 신호 (예: "무료", "D-3", "5일 전 등록")
  contextLabelColor?: string;  // 신호 텍스트 색상
}

// ==================== 헬퍼 함수 ====================

// ==================== 스타일 헬퍼 ====================

function getCardStyle(variant: string): ViewStyle {
  switch (variant) {
    case 'large':
      return staticStyles.cardLarge;
    case 'small':
      return staticStyles.cardSmall;
    default:
      return {};
  }
}

function getImageStyle(variant: string): ViewStyle {
  switch (variant) {
    case 'large':
      return staticStyles.imageContainerLarge;
    case 'small':
      return staticStyles.imageContainerSmall;
    case 'horizontal':
      return staticStyles.imageContainerHorizontal;
    default:
      return {};
  }
}

function getContentStyle(variant: string): ViewStyle {
  switch (variant) {
    case 'large':
      return staticStyles.contentLarge;
    case 'small':
      return staticStyles.contentSmall;
    case 'horizontal':
      return staticStyles.contentHorizontal;
    default:
      return {};
  }
}

function getTitleStyle(variant: string) {
  switch (variant) {
    case 'large':
      return staticStyles.titleLarge;
    case 'small':
      return staticStyles.titleSmall;
    default:
      return {};
  }
}

function getCategoryColor(category: string): string {
  const colorMap: Record<string, string> = {
    '팝업': '#E8F4FD',
    '전시': '#EDF7EE',
    '공연': '#F3F0FF',
    '축제': '#FFF4E5',
    '행사': '#FFF0F0',
    '뮤지컬': '#E8F4FD',
    '연극': '#F3F0FF',
    '콘서트': '#FFF4E5',
  };
  return colorMap[category] || '#F3F4F6';
}

// 긴박도 → 색상 매핑 (라이트 배경용)
// critical: 시스템 레드  / soon: 앰버  / normal: TDS grey600  / upcoming: TDS grey400
const DATE_URGENCY_COLOR: Record<DateUrgency, string> = {
  critical: '#FF3B30',
  soon:     '#FF9500',
  normal:   '',          // adaptive.grey600 로 처리
  upcoming: '',          // adaptive.grey400 로 처리
};

// ==================== 정적 스타일 (색상 없음) ====================

const staticStyles = StyleSheet.create({
  cardLarge: {
    borderRadius: 16,
  },
  cardSmall: {
    width: 160,
    marginRight: 12,
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
  },
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
  regionBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  smallLikeButton: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 14,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
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
  titleLarge: {
    fontSize: 17,
    lineHeight: 24,
  },
  titleSmall: {
    fontSize: 13,
    lineHeight: 18,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  tag: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 6,
    marginBottom: 4,
  },
  metaContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaText: {
    fontSize: 12,
    marginRight: 8,
  },
});

// ==================== 어댑티브 스타일 ====================

type Adaptive = ReturnType<typeof useAdaptive>;

const createStyles = (a: Adaptive) => StyleSheet.create({
  // 기본 카드
  card: {
    backgroundColor: a.background,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },

  // 가로형 카드
  horizontalCard: {
    flexDirection: 'row',
    backgroundColor: a.background,
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
    backgroundColor: a.grey100,
    position: 'relative',
  },

  // 플레이스홀더 텍스트
  placeholderText: {
    fontSize: 13,
    fontWeight: '600',
    color: a.grey600,
  },

  // 지역 배지 텍스트
  regionBadgeText: {
    color: a.grey900,
    fontSize: 11,
    fontWeight: '500',
  },

  // 콘텐츠
  content: {
    padding: 12,
  },

  // 제목
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: a.grey900,
    marginBottom: 8,
    lineHeight: 20,
  },

  // 태그
  tag: {
    backgroundColor: a.blue50,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 6,
    marginBottom: 4,
  },
  tagText: {
    color: a.blue500,
    fontSize: 11,
    fontWeight: '600',
  },

  // 메타 정보
  metaText: {
    fontSize: 12,
    color: a.grey600,
    marginRight: 8,
  },

  // 장소
  venue: {
    fontSize: 12,
    color: a.grey500,
    marginTop: 4,
  },

  // 섹션별 신호 라벨 (budget_pick 가격, discovery 등록일, ending_soon D-N)
  contextLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
});

// ==================== 메인 컴포넌트 ====================

export const EventCard: React.FC<EventCardProps> = ({ event, onPress, variant = 'default', contextLabel, contextLabelColor }) => {
  const adaptive = useAdaptive();
  const styles = useMemo(() => createStyles(adaptive), [adaptive]);
  const { isLiked, toggle } = useLike({ eventId: event.id });

  const dateUrgency = useMemo(
    () => getDateUrgency(event.start_date, event.end_date),
    [event.start_date, event.end_date],
  );

  // 긴박도별 색상: critical/soon은 고정색, 나머지는 adaptive 토큰
  const dateColor =
    dateUrgency === 'critical' ? DATE_URGENCY_COLOR.critical :
    dateUrgency === 'soon'     ? DATE_URGENCY_COLOR.soon :
    dateUrgency === 'upcoming' ? adaptive.grey400 :
    adaptive.grey600;

  const dateFontWeight: '400' | '600' | '700' =
    dateUrgency === 'critical' ? '700' :
    dateUrgency === 'soon'     ? '600' :
    '400';

  const renderImage = () => (
    <View style={[styles.imageContainer, getImageStyle(variant)]}>
      {event.thumbnail_url ? (
        <Image
          source={{ uri: event.thumbnail_url }}
          style={staticStyles.image}
          resizeMode="cover"
        />
      ) : (
        <View style={[staticStyles.placeholderImage, { backgroundColor: getCategoryColor(event.category) }]}>
          <Text style={styles.placeholderText}>{event.category}</Text>
        </View>
      )}

      {/* 카테고리 배지 */}
      <View style={staticStyles.categoryBadge}>
        <Text style={staticStyles.categoryBadgeText}>{event.category}</Text>
      </View>

      {/* 지역 배지 */}
      {event.region && (
        <View style={staticStyles.regionBadge}>
          <Text style={styles.regionBadgeText}>{event.region}</Text>
        </View>
      )}

      {/* small 카드 전용 찜 버튼 */}
      {variant === 'small' && (
        <IconButton
          name="icon-heart-mono"
          variant="clear"
          iconSize={13}
          color={isLiked ? adaptive.red500 : adaptive.grey300}
          style={staticStyles.smallLikeButton}
          onPress={toggle}
          hitSlop={8}
        />
      )}
    </View>
  );

  const renderContent = () => (
    <View style={[styles.content, getContentStyle(variant)]}>
      {/* 제목 */}
      <Text style={[styles.title, getTitleStyle(variant)]} numberOfLines={2}>
        {event.title}
      </Text>

      {/* 섹션별 핵심 신호 (budget_pick 가격, discovery 등록일, ending_soon D-N) */}
      {contextLabel ? (
        <Text style={[styles.contextLabel, { color: contextLabelColor ?? adaptive.grey500 }]}>
          {contextLabel}
        </Text>
      ) : event.reason && event.reason.length > 0 ? (
        <View style={staticStyles.tagsContainer}>
          {event.reason.slice(0, 3).map((tag, idx) => (
            <View key={idx} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* 날짜 — 긴박도에 따라 색상·굵기 변화 */}
      <Text style={[styles.metaText, { color: dateColor, fontWeight: dateFontWeight }]}>
        {formatEventPeriodHuman(event.start_date, event.end_date)}
      </Text>

      {/* 장소 (large variant만) */}
      {variant === 'large' && event.venue && (
        <Text style={styles.venue} numberOfLines={1}>
          {event.venue}
        </Text>
      )}
    </View>
  );

  if (variant === 'horizontal') {
    return (
      <Analytics.Press params={{ log_name: 'event_card', text: event.title }}>
        <Pressable
          style={styles.horizontalCard}
          onPress={() => onPress(event.id)}
          android_ripple={{ color: '#E5E7EB' }}
        >
          {renderImage()}
          {renderContent()}
        </Pressable>
      </Analytics.Press>
    );
  }

  return (
    <Analytics.Press params={{ log_name: 'event_card', text: event.title }}>
      <Pressable
        style={[styles.card, getCardStyle(variant)]}
        onPress={() => onPress(event.id)}
        android_ripple={{ color: '#E5E7EB' }}
      >
        {renderImage()}
        {renderContent()}
      </Pressable>
    </Analytics.Press>
  );
};
