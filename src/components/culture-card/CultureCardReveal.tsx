import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import type { Card } from '../../services/cardsService';

const INK = '#16161A';
const INK_LINE = '#2C2C33';
const PAPER = '#F5F1E8';
const PAPER_EDGE = '#E7E0D2';
const BRONZE = '#B8924A';
const BRONZE_DARK = '#947231';
const BLUE = '#3182F6';

const CATEGORY_COLORS: Record<string, string> = {
  전시: '#3182F6',
  공연: '#A8324A',
  팝업: '#D08A2C',
  축제: '#3E8E5A',
  기타: BRONZE_DARK,
};

type Adaptive = ReturnType<typeof useAdaptive>;

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
  const [date] = iso.split('T');
  if (!date) return null;
  const [, month, day] = date.split('-');
  if (!month || !day) return date.replaceAll('-', '.');
  return `${Number(month)}/${Number(day)}`;
}

function formatDateRange(card: Card): string | null {
  const start = formatDate(card.startAt);
  const end = formatDate(card.endAt);
  if (start && end) return `${start} - ${end}`;
  return start ?? end;
}

function getDdayLabel(dday: number | null): string | null {
  if (dday == null) return null;
  if (dday === 0) return 'D-DAY';
  if (dday > 0) return `D-${dday}`;
  return '종료';
}

function createStyles(a: Adaptive) {
  return StyleSheet.create({
    wrap: {
      paddingHorizontal: 22,
      paddingTop: 4,
    },
    nav: {
      height: 42,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    navTitle: {
      color: '#F2EEE5',
      fontSize: 15,
      fontWeight: '800',
    },
    closeText: {
      color: '#9A968E',
      fontSize: 24,
      lineHeight: 28,
      fontWeight: '400',
    },
    toast: {
      marginTop: 4,
      marginBottom: 16,
      paddingVertical: 13,
      paddingHorizontal: 16,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: 'rgba(184,146,74,0.35)',
      backgroundColor: 'rgba(184,146,74,0.14)',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    toastBadge: {
      width: 30,
      height: 30,
      borderRadius: 9,
      backgroundColor: BRONZE,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toastBadgeText: {
      color: '#1A1A1E',
      fontSize: 15,
      fontWeight: '900',
    },
    toastText: {
      flex: 1,
      color: '#E8D9B6',
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '700',
    },
    toastStrong: {
      color: '#F2EEE5',
      fontWeight: '900',
    },
    ticket: {
      backgroundColor: PAPER,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: PAPER_EDGE,
      overflow: 'hidden',
      shadowColor: '#000000',
      shadowOpacity: 0.5,
      shadowRadius: 50,
      shadowOffset: { width: 0, height: 22 },
      elevation: 12,
    },
    thumb: {
      height: 188,
      backgroundColor: '#16223F',
      overflow: 'hidden',
    },
    image: {
      width: '100%',
      height: '100%',
    },
    fallbackThumb: {
      flex: 1,
      backgroundColor: '#16223F',
      justifyContent: 'flex-end',
      padding: 18,
    },
    fallbackGlow: {
      position: 'absolute',
      top: -40,
      right: -32,
      width: 180,
      height: 180,
      borderRadius: 90,
      backgroundColor: 'rgba(255,214,138,0.18)',
    },
    fallbackTitle: {
      color: '#E7EEFD',
      fontSize: 22,
      lineHeight: 29,
      fontWeight: '900',
      fontFamily: 'Noto Serif KR',
    },
    categoryPill: {
      position: 'absolute',
      top: 14,
      left: 14,
      paddingVertical: 5,
      paddingHorizontal: 11,
      borderRadius: 999,
      backgroundColor: 'rgba(20,25,45,0.72)',
    },
    categoryText: {
      color: '#CFE0FF',
      fontSize: 11,
      lineHeight: 16,
      fontWeight: '900',
      letterSpacing: 0.4,
    },
    dday: {
      position: 'absolute',
      top: 14,
      right: 14,
      paddingVertical: 5,
      paddingHorizontal: 9,
      borderRadius: 8,
      backgroundColor: '#FBE7E7',
    },
    ddayText: {
      color: '#C0392B',
      fontSize: 11,
      lineHeight: 16,
      fontWeight: '900',
    },
    body: {
      paddingHorizontal: 20,
      paddingTop: 18,
    },
    title: {
      color: '#1A1A1E',
      fontSize: 21,
      lineHeight: 29,
      fontWeight: '800',
      fontFamily: 'Noto Serif KR',
    },
    meta: {
      marginTop: 10,
      color: '#6B6760',
      fontSize: 13,
      lineHeight: 19,
      fontWeight: '700',
    },
    blurb: {
      marginTop: 12,
      color: '#54504A',
      fontSize: 13,
      lineHeight: 21,
      fontWeight: '500',
    },
    perforation: {
      position: 'relative',
      marginTop: 18,
      marginHorizontal: 18,
      borderTopWidth: 2,
      borderStyle: 'dashed',
      borderColor: '#CFC6B2',
    },
    holeLeft: {
      position: 'absolute',
      top: -12,
      left: -31,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: INK,
    },
    holeRight: {
      position: 'absolute',
      top: -12,
      right: -31,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: INK,
    },
    stub: {
      paddingVertical: 14,
      paddingHorizontal: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    admit: {
      color: BRONZE_DARK,
      fontSize: 10,
      lineHeight: 15,
      letterSpacing: 2.5,
      fontWeight: '900',
    },
    earn: {
      color: '#1A1A1E',
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '900',
    },
    earnStrong: {
      color: BRONZE_DARK,
    },
    actions: {
      marginTop: 18,
      flexDirection: 'row',
      gap: 10,
    },
    primaryButton: {
      flex: 1.4,
      height: 50,
      borderRadius: 14,
      backgroundColor: BLUE,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 7,
      shadowColor: BLUE,
      shadowOpacity: 0.3,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
    darkButton: {
      flex: 1,
      height: 50,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: INK_LINE,
      backgroundColor: '#26262C',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
    },
    primaryText: {
      color: '#FFFFFF',
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '800',
    },
    darkText: {
      color: '#F2EEE5',
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '800',
    },
    next: {
      alignItems: 'center',
      marginTop: 18,
    },
    nextText: {
      color: a.grey500,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '800',
    },
  });
}

export function CultureCardReveal({ openedCard, onDetail, onNext, onSave }: CultureCardRevealProps) {
  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);
  const { card, earned, dailyEarned, dailyLimit } = openedCard;
  const categoryColor = CATEGORY_COLORS[card.category] ?? CATEGORY_COLORS['기타'];
  const dateRange = formatDateRange(card);
  const dday = getDdayLabel(card.dday);
  const meta = [card.venue, card.region, dateRange, card.walkMinutes != null ? `도보 ${card.walkMinutes}분` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.wrap}>
      <View style={styles.nav}>
        <Pressable onPress={onNext} hitSlop={10}>
          <Text style={styles.closeText}>×</Text>
        </Pressable>
        <Text style={styles.navTitle}>카드 열림</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.toast}>
        <View style={styles.toastBadge}>
          <Text style={styles.toastBadgeText}>T</Text>
        </View>
        <Text style={styles.toastText}>
          티켓 <Text style={styles.toastStrong}>{earned}장</Text>을 모았어요 · 오늘 {dailyEarned}/{dailyLimit}
        </Text>
      </View>

      <View style={styles.ticket}>
        <View style={styles.thumb}>
          {card.imageUrl ? (
            <Image source={{ uri: card.imageUrl }} style={styles.image} resizeMode="cover" />
          ) : (
            <View style={styles.fallbackThumb}>
              <View style={styles.fallbackGlow} />
              <Text style={styles.fallbackTitle} numberOfLines={2}>{card.title}</Text>
            </View>
          )}
          <View style={[styles.categoryPill, { borderColor: categoryColor }]}>
            <Text style={styles.categoryText}>● {card.category}</Text>
          </View>
          {dday ? (
            <View style={styles.dday}>
              <Text style={styles.ddayText}>{dday}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.body}>
          <Text style={styles.title}>{card.title}</Text>
          <Text style={styles.meta}>{meta || '문화 이벤트'}</Text>
          {card.blurb ? <Text style={styles.blurb}>{card.blurb}</Text> : null}
        </View>

        <View style={styles.perforation}>
          <View style={styles.holeLeft} />
          <View style={styles.holeRight} />
        </View>

        <View style={styles.stub}>
          <Text style={styles.admit}>ADMIT ONE</Text>
          <Text style={styles.earn}>
            적립 <Text style={styles.earnStrong}>+{earned} 티켓</Text>
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.primaryButton} onPress={onDetail}>
          <Text style={styles.primaryText}>자세히 보기</Text>
        </Pressable>
        <Pressable style={styles.darkButton} onPress={onSave}>
          <Icon name="icon-bookmark-mono" size={18} color="#F2EEE5" />
          <Text style={styles.darkText}>저장</Text>
        </Pressable>
      </View>

      <Pressable style={styles.next} onPress={onNext}>
        <Text style={styles.nextText}>다음 카드 열기 ›</Text>
      </Pressable>
    </View>
  );
}
