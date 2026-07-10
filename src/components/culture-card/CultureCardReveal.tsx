import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@toss/tds-react-native';
import type { Card } from '../../services/cardsService';

const SURFACE = '#F3EEE3';
const INK = '#211F1B';
const SUB = '#69645B';
const GOLD = '#B88735';
const RED = '#B43A27';
const LINE = 'rgba(33,31,27,0.14)';
const DARK_TEXT = '#F4EFE6';

export interface RevealedCultureCard {
  card: Card;
  earned: number;
  ticketCount: number;
  dailyEarned: number;
  dailyLimit: number;
}

interface CultureCardRevealProps {
  openedCard: RevealedCultureCard;
  onDetail: () => void;
  onNext: () => void;
  onSave: () => void;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = iso.split('T')[0];
  if (!date) return null;
  const [, month, day] = date.split('-');
  return month && day ? `${Number(month)}월 ${Number(day)}일` : date;
}

function dateRange(card: Card): string | null {
  const start = formatDate(card.startAt);
  const end = formatDate(card.endAt);
  if (start && end) return `${start} – ${end}`;
  return start ?? end;
}

function ddayLabel(dday: number | null): string | null {
  if (dday == null) return null;
  if (dday === 0) return '오늘 마감';
  if (dday > 0) return `D-${dday}`;
  return null;
}

export function CultureCardReveal({ openedCard, onDetail, onNext, onSave }: CultureCardRevealProps) {
  const { card, earned } = openedCard;
  const schedule = dateRange(card);
  const distance = card.walkMinutes ? `도보 ${card.walkMinutes}분` : null;
  const meta = [schedule, distance, ddayLabel(card.dday)].filter(Boolean).join(' · ');

  return (
    <View style={styles.wrap}>
      <View style={styles.openedHeader}>
        <Text style={styles.openedEyebrow}>컬처카드를 열었어요</Text>
        <View style={styles.rewardPill}>
          <Text style={styles.rewardPillText}>+{earned} 문화 티켓</Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.copy}>
          <View style={styles.categoryRow}>
            <Text style={styles.category}>{card.category}</Text>
            {(card.reasonTags ?? []).slice(0, 1).map((reason) => (
              <Text key={reason} style={styles.reason}>{reason}</Text>
            ))}
          </View>
          <Text style={styles.title}>{card.title}</Text>
          {card.venue ? <Text style={styles.venue}>{card.venue}</Text> : null}
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}
        </View>

        {card.imageUrl ? (
          <Image source={{ uri: card.imageUrl }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.imageFallback}>
            <Text style={styles.imageFallbackCategory}>{card.category}</Text>
            <Text style={styles.imageFallbackText}>오늘 발견한 문화</Text>
          </View>
        )}

        {card.blurb ? <Text style={styles.blurb} numberOfLines={3}>{card.blurb}</Text> : null}

        <View style={styles.rewardRow}>
          <View>
            <Text style={styles.rewardLabel}>이번 공개로 받은 티켓</Text>
            <Text style={styles.rewardBalance}>현재 {openedCard.ticketCount}장</Text>
          </View>
          <Text style={styles.rewardValue}>+{earned}</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={onDetail}>
          <Text style={styles.primaryText}>이벤트 자세히 보기</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.outlineButton} onPress={onSave}>
          <Icon name="icon-bookmark-mono" size={18} color={DARK_TEXT} />
          <Text style={styles.outlineText}>저장</Text>
        </Pressable>
      </View>

      <Pressable accessibilityRole="button" style={styles.next} onPress={onNext}>
        <Text style={styles.nextText}>새로운 추천 한 장 채우기 ›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 22,
    paddingTop: 10,
  },
  openedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  openedEyebrow: {
    color: DARK_TEXT,
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  rewardPill: {
    borderRadius: 999,
    backgroundColor: 'rgba(216,178,106,0.16)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rewardPillText: {
    color: '#E4BD74',
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '900',
  },
  card: {
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: SURFACE,
  },
  copy: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  category: {
    color: GOLD,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
  },
  reason: {
    color: '#526482',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  title: {
    marginTop: 7,
    color: INK,
    fontSize: 25,
    lineHeight: 33,
    fontWeight: '900',
    letterSpacing: -1,
  },
  venue: {
    marginTop: 7,
    color: INK,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  meta: {
    marginTop: 4,
    color: SUB,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '600',
  },
  image: {
    width: '100%',
    height: 218,
    backgroundColor: '#D8D0C0',
  },
  imageFallback: {
    height: 180,
    padding: 20,
    justifyContent: 'flex-end',
    backgroundColor: '#D8C9A7',
  },
  imageFallbackCategory: {
    color: RED,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
  },
  imageFallbackText: {
    marginTop: 5,
    color: INK,
    fontSize: 24,
    lineHeight: 31,
    fontWeight: '900',
  },
  blurb: {
    paddingHorizontal: 20,
    paddingTop: 16,
    color: SUB,
    fontSize: 13.5,
    lineHeight: 21,
    fontWeight: '600',
  },
  rewardRow: {
    marginHorizontal: 20,
    marginTop: 17,
    marginBottom: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: LINE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rewardLabel: {
    color: INK,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '800',
  },
  rewardBalance: {
    marginTop: 2,
    color: SUB,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  rewardValue: {
    color: RED,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '900',
  },
  actions: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 9,
  },
  primaryButton: {
    flex: 1.7,
    height: 52,
    borderRadius: 15,
    backgroundColor: '#E3C98F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineButton: {
    flex: 1,
    height: 52,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(244,239,230,0.24)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  primaryText: {
    color: INK,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: '900',
  },
  outlineText: {
    color: DARK_TEXT,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  next: {
    alignItems: 'center',
    paddingVertical: 17,
  },
  nextText: {
    color: '#A7A095',
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '700',
  },
});
