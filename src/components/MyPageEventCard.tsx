import React from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import { EventImage } from './EventImage';
import { EventCardData } from '../data/events';

type Adaptive = ReturnType<typeof useAdaptive>;

// ─────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────

export interface RenderableEventItem extends EventCardData {
  isPlaceholder?: boolean;
  lastKnownStatus?: 'active' | 'ended' | 'deleted';
  viewedAt?: string; // 최근 본 탭용 타임스탬프 (ISO string)
}

interface MyPageEventCardProps {
  event: RenderableEventItem;
  onPress: () => void;
  onDelete?: () => void; // 찜 해제(likes) 또는 기록 삭제(recent) — 없으면 버튼 미표시
  deleteStyle?: 'x' | 'heart'; // 기본값 'x' — likes 목록은 'heart' 사용
  urgentLabel?: string; // D-Day, D-1, D-2, D-3 — 마감 임박 배지
}

// ─────────────────────────────────────────────────────────
// 상대 시간 헬퍼 (dayjs 없이 순수 구현)
// ─────────────────────────────────────────────────────────

function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  if (hours < 24) return `${hours}시간 전`;
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  return `${Math.floor(days / 30)}달 전`;
}

// ─────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────

export function MyPageEventCard({ event, onPress, onDelete, deleteStyle = 'x', urgentLabel }: MyPageEventCardProps) {
  const isDeleted = event.lastKnownStatus === 'deleted';
  const isEnded = event.lastKnownStatus === 'ended';
  const isNonActive = isDeleted || isEnded;

  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);

  // deleted 아이템은 상세 이동 불가 (snapshot 데이터만 있음)
  const handlePress = () => {
    if (isDeleted) return;
    onPress();
  };

  // 가격 표시 텍스트
  const priceText = event.isFree
    ? '무료'
    : event.priceText && event.priceText !== '0원'
    ? event.priceText
    : '';

  return (
    <TouchableOpacity
      style={[styles.card, isDeleted && styles.cardDeleted]}
      onPress={handlePress}
      activeOpacity={isDeleted ? 1 : 0.8}
    >
      {/* 이미지 영역 */}
      <View>
        <EventImage
          uri={event.thumbnailUrl}
          height={160}
          borderRadius={0}
          resizeMode="cover"
          category={event.category}
          accessibilityLabel={`${event.title} 썸네일`}
        />

        {/* 카테고리 뱃지 (이미지 좌측 하단) */}
        {event.category && (
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryBadgeText}>{event.category}</Text>
          </View>
        )}

        {/* 종료/삭제 뱃지 */}
        {isNonActive && (
          <View style={styles.statusBadge}>
            <Text style={styles.statusBadgeText}>
              {isDeleted ? '종료/삭제됨' : '종료됨'}
            </Text>
          </View>
        )}

        {/* 마감 임박 D-뱃지 */}
        {urgentLabel && !isNonActive && (
          <View style={styles.urgentBadge}>
            <Text style={styles.urgentBadgeText}>{urgentLabel}</Text>
          </View>
        )}

        {/* 삭제 버튼 (우측 상단) */}
        {onDelete && (
          <Pressable
            style={deleteStyle === 'heart' ? styles.heartButton : styles.deleteButton}
            onPress={onDelete}
            hitSlop={12}
          >
            <Text style={deleteStyle === 'heart' ? styles.heartIcon : styles.deleteIcon}>
              {deleteStyle === 'heart' ? '❤️' : '✕'}
            </Text>
          </Pressable>
        )}
      </View>

      {/* 정보 영역 */}
      <View style={styles.cardInfo}>
        <Text
          style={[styles.cardTitle, isNonActive && styles.dimText]}
          numberOfLines={2}
        >
          {event.title}
        </Text>

        <Text
          style={[styles.cardMeta, isNonActive && styles.dimText]}
          numberOfLines={1}
        >
          {event.venue}
          {event.region ? ` · ${event.region}` : ''}
        </Text>

        {event.periodText ? (
          <Text
            style={[styles.cardPeriod, isNonActive && styles.dimText]}
            numberOfLines={1}
          >
            {event.periodText}
          </Text>
        ) : null}

        {/* 푸터: 가격 + 최근 본 시간 */}
        {(priceText || event.viewedAt) ? (
          <View style={styles.cardFooter}>
            {priceText ? (
              <Text style={[styles.priceText, event.isFree && styles.freePriceText]}>
                {priceText}
              </Text>
            ) : <View />}
            {event.viewedAt ? (
              <Text style={styles.relativeTime}>
                {formatRelativeTime(event.viewedAt)}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────
// 스타일
// ─────────────────────────────────────────────────────────

const createStyles = (a: Adaptive) => StyleSheet.create({
  card: {
    backgroundColor: a.background,
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  cardDeleted: {
    opacity: 0.6,
  },
  categoryBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  categoryBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  statusBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(25, 31, 40, 0.85)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  deleteButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(25, 31, 40, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteIcon: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  heartButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartIcon: {
    fontSize: 14,
  },
  cardInfo: {
    padding: 16,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: a.grey900,
    marginBottom: 6,
    lineHeight: 24,
  },
  cardMeta: {
    fontSize: 14,
    color: a.grey600,
    marginBottom: 4,
  },
  cardPeriod: {
    fontSize: 13,
    color: a.grey500,
  },
  dimText: {
    color: a.grey400,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  priceText: {
    fontSize: 13,
    fontWeight: '600',
    color: a.grey700,
  },
  freePriceText: {
    color: a.blue500,
  },
  relativeTime: {
    fontSize: 12,
    color: a.grey400,
  },
  urgentBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#F97316',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  urgentBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
