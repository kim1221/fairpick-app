import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import type { Card } from '../../services/cardsService';
import type { TodayCardProgress } from './homeLogic';

const INK = '#16161A';
const INK_LINE = '#2C2C33';
const PAPER = '#F5F1E8';
const PAPER_EDGE = '#E7E0D2';
const BRONZE = '#B8924A';
const BRONZE_DARK = '#947231';
const BLUE = '#3182F6';

interface CultureCardStackProps {
  cards: Card[];
  activeCard: Card | null;
  progress: TodayCardProgress;
  dailyEarned: number;
  dailyLimit: number;
  loading: boolean;
  disabled: boolean;
  actionLabel: string;
  onOpen: () => void;
}

function createStyles() {
  return StyleSheet.create({
    section: {
      paddingHorizontal: 22,
      paddingTop: 8,
    },
    eyebrow: {
      color: '#9A968E',
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 1.6,
    },
    title: {
      marginTop: 7,
      color: '#F2EEE5',
      fontSize: 27,
      lineHeight: 33,
      fontWeight: '800',
      fontFamily: 'Noto Serif KR',
    },
    subtitle: {
      marginTop: 9,
      color: '#9A968E',
      fontSize: 14,
      lineHeight: 21,
      fontWeight: '500',
    },
    stack: {
      position: 'relative',
      height: 330,
      marginTop: 26,
      marginHorizontal: 6,
      alignItems: 'center',
    },
    peek: {
      position: 'absolute',
      top: 14,
      width: '80%',
      height: 300,
      borderRadius: 20,
      backgroundColor: PAPER_EDGE,
      shadowColor: '#000000',
      shadowOpacity: 0.35,
      shadowRadius: 30,
      shadowOffset: { width: 0, height: 10 },
    },
    peekLeft: {
      transform: [{ rotate: '-5deg' }],
    },
    peekRight: {
      backgroundColor: '#EDE7DA',
      transform: [{ rotate: '4deg' }],
    },
    ticket: {
      position: 'absolute',
      top: 0,
      width: '88%',
      height: 316,
      borderRadius: 22,
      backgroundColor: PAPER,
      borderWidth: 1,
      borderColor: PAPER_EDGE,
      overflow: 'hidden',
      shadowColor: '#000000',
      shadowOpacity: 0.5,
      shadowRadius: 50,
      shadowOffset: { width: 0, height: 22 },
      elevation: 12,
    },
    ticketTop: {
      paddingTop: 22,
      paddingHorizontal: 22,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    ticketLabel: {
      color: BRONZE_DARK,
      fontSize: 12,
      fontWeight: '900',
      letterSpacing: 1,
    },
    ticketCount: {
      color: '#6B6760',
      fontSize: 12,
      fontWeight: '700',
    },
    seal: {
      marginTop: 26,
      alignSelf: 'center',
      width: 96,
      height: 96,
      borderRadius: 48,
      borderWidth: 2,
      borderColor: BRONZE,
      backgroundColor: 'rgba(184,146,74,0.06)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    sealInner: {
      position: 'absolute',
      top: 7,
      right: 7,
      bottom: 7,
      left: 7,
      borderRadius: 41,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: 'rgba(184,146,74,0.45)',
    },
    sealText: {
      color: BRONZE_DARK,
      fontSize: 40,
      lineHeight: 48,
      fontWeight: '900',
      fontFamily: 'Noto Serif KR',
    },
    message: {
      marginTop: 18,
      paddingHorizontal: 22,
      color: '#1A1A1E',
      textAlign: 'center',
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '700',
      fontFamily: 'Noto Serif KR',
    },
    subMessage: {
      marginTop: 6,
      color: '#6B6760',
      textAlign: 'center',
      fontSize: 12,
      lineHeight: 18,
      fontWeight: '600',
    },
    perforation: {
      position: 'relative',
      marginTop: 20,
      marginHorizontal: 20,
      borderTopWidth: 2,
      borderStyle: 'dashed',
      borderColor: '#CFC6B2',
    },
    holeLeft: {
      position: 'absolute',
      top: -12,
      left: -32,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: INK,
    },
    holeRight: {
      position: 'absolute',
      top: -12,
      right: -32,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: INK,
    },
    ctaWrap: {
      paddingHorizontal: 18,
      paddingTop: 16,
    },
    cta: {
      height: 50,
      borderRadius: 14,
      backgroundColor: BLUE,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
      shadowColor: BLUE,
      shadowOpacity: 0.3,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
    ctaDisabled: {
      backgroundColor: '#5B6068',
      shadowOpacity: 0,
    },
    ctaText: {
      color: '#FFFFFF',
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '800',
    },
    dots: {
      marginTop: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    dot: {
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: '#3A3A42',
    },
    dotOn: {
      backgroundColor: BRONZE,
    },
    dotText: {
      marginLeft: 6,
      color: '#9A968E',
      fontSize: 12,
      fontWeight: '700',
    },
    more: {
      marginTop: 22,
      marginHorizontal: 4,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: INK_LINE,
      backgroundColor: '#1D1D22',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 14,
    },
    moreTitle: {
      color: '#F2EEE5',
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '800',
    },
    moreSub: {
      marginTop: 3,
      color: '#9A968E',
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
    },
    moreAction: {
      color: BLUE,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '800',
    },
  });
}

export function CultureCardStack({
  cards,
  activeCard,
  progress,
  dailyEarned,
  dailyLimit,
  loading,
  disabled,
  actionLabel,
  onOpen,
}: CultureCardStackProps) {
  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(), []);
  const todayCards = cards.slice(0, 3);
  const openedLabel = `${progress.opened}장 열었어요`;
  const message = activeCard?.opened
    ? '오늘의 문화가 열렸어요'
    : '오늘 만날 문화가 봉인돼 있어요';
  const activeWalkLabel = typeof activeCard?.walkMinutes === 'number' && activeCard.walkMinutes > 0
    ? `도보 ${activeCard.walkMinutes}분 거리의 문화가 준비돼 있어요`
    : null;
  const subMessage = activeCard?.opened
    ? '아래에서 추천 행사와 적립 티켓을 확인해 주세요'
    : activeWalkLabel ?? '광고를 보면 카드가 열리고 티켓이 쌓여요';

  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>TODAY'S CULTURE</Text>
      <Text style={styles.title}>오늘의 문화 카드</Text>
      <Text style={styles.subtitle}>광고를 보고 카드를 열면, 가까운 문화가 펼쳐져요.</Text>

      <View style={styles.stack}>
        <View style={[styles.peek, styles.peekLeft]} />
        <View style={[styles.peek, styles.peekRight]} />
        <View style={styles.ticket}>
          <View style={styles.ticketTop}>
            <Text style={styles.ticketLabel}>오늘의 카드</Text>
            <Text style={styles.ticketCount}>{progress.current} / 3</Text>
          </View>
          <View style={styles.seal}>
            <View style={styles.sealInner} />
            <Text style={styles.sealText}>C</Text>
          </View>
          <Text style={styles.message}>{message}</Text>
          <Text style={styles.subMessage}>{subMessage}</Text>
          <View style={styles.perforation}>
            <View style={styles.holeLeft} />
            <View style={styles.holeRight} />
          </View>
          <View style={styles.ctaWrap}>
            <Pressable
              style={[styles.cta, disabled && styles.ctaDisabled]}
              onPress={onOpen}
              disabled={disabled}
            >
              <Icon name="icon-play-mono" size={18} color="#FFFFFF" />
              <Text style={styles.ctaText}>{loading ? '광고 준비 중' : actionLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.dots}>
        {todayCards.map((card, index) => (
          <View
            key={card.eventId}
            style={[styles.dot, (card.opened || index + 1 === progress.current) && styles.dotOn]}
          />
        ))}
        {Array.from({ length: Math.max(0, 3 - todayCards.length) }).map((_, index) => (
          <View key={`empty-${index}`} style={styles.dot} />
        ))}
        <Text style={styles.dotText}>{openedLabel}</Text>
      </View>

      <Pressable style={styles.more} onPress={onOpen} disabled={disabled}>
        <View>
          <Text style={styles.moreTitle}>더 뽑기</Text>
          <Text style={styles.moreSub}>오늘 {dailyEarned} / {dailyLimit} 티켓</Text>
        </View>
        <Text style={[styles.moreAction, disabled && { color: adaptive.grey500 }]}>광고 보고 더 열기 ›</Text>
      </Pressable>
    </View>
  );
}
