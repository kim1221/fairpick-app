import React from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { LockedCardPreview } from '../../services/cardsService';
import { getTicketSerial, getTicketSkin, stableTicketHash } from './ticketSkins';

const INK = '#171717';
const MUTED = '#6F6B65';
const RED = '#A52822';
const PAPER = '#F7F5EF';
const TICKET_PAPER = '#FFFDF7';
const LINE = '#D8D2C7';

interface CultureCardStackProps {
  cards: LockedCardPreview[];
  selectedToken: string | null;
  dailyOpenCount: number;
  dailyOpenLimit: number;
  loading: boolean;
  disabled: boolean;
  actionLabel: string;
  onOpen: () => void;
  userRegion: string | null;
}

const GENERIC_HEADLINES = [
  '가까운 곳에 숨은\n새로운 문화',
  '오늘의 한 장을\n열어보세요',
  '이번 주가 지나기 전에\n만나볼 문화',
  '평범한 하루에 더할\n새로운 발견',
] as const;

function mysteryHeadline(card: LockedCardPreview): string {
  if (card.isRevisit) return '다시 눈에 들어온\n오늘의 문화';
  const visualKey = card.visualSeed ?? card.cardToken;
  return GENERIC_HEADLINES[stableTicketHash(visualKey) % GENERIC_HEADLINES.length]!;
}

export function CultureCardStack({
  cards,
  selectedToken,
  dailyOpenCount,
  dailyOpenLimit,
  loading,
  disabled,
  actionLabel,
  onOpen,
  userRegion,
}: CultureCardStackProps) {
  const { width, height } = useWindowDimensions();
  const card = cards.find((candidate) => candidate.cardToken === selectedToken) ?? cards[0] ?? null;
  const isCompactHeight = height <= 700;
  const ticketWidth = Math.min(width - 44, 430);
  const progress = dailyOpenLimit > 0 ? Math.min(1, dailyOpenCount / dailyOpenLimit) : 0;
  const remaining = Math.max(0, dailyOpenLimit - dailyOpenCount);
  const visualKey = card ? (card.visualSeed ?? card.cardToken) : '';
  const clues = card
    ? [card.distanceLabel, card.timingLabel].filter((value): value is string => Boolean(value)).slice(0, 2)
    : [];

  return (
    <View style={[styles.section, isCompactHeight ? styles.sectionCompact : null]}>
      <View style={styles.heading}>
        <View style={styles.headingTop}>
          <Text style={styles.eyebrow}>TODAY&apos;S CULTURE TICKET</Text>
          <Text style={styles.dailyCount}>오늘 {dailyOpenCount}장 공개</Text>
        </View>
        <Text style={[styles.title, isCompactHeight ? styles.titleCompact : null]}>
          오늘의 문화 티켓이 도착했어요
        </Text>
        <Text style={[styles.subtitle, isCompactHeight ? styles.subtitleCompact : null]} numberOfLines={2}>
          {userRegion
            ? `${userRegion} 근처에서 당신에게 맞춰 고른 한 장이에요.`
            : '겉표지는 랜덤, 오늘의 문화는 당신에게 맞춰 골랐어요.'}
        </Text>
        <View style={styles.progressHeader}>
          <Text style={styles.progressCopy}>열어본 티켓 {dailyOpenCount}</Text>
          <Text style={styles.progressLimit}>최대 {dailyOpenLimit}장</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
      </View>

      {card ? (
        <View style={[styles.ticketDeck, { width: ticketWidth }]}>
          <View pointerEvents="none" style={[styles.backTicket, styles.backTicketSecond]} />
          <View pointerEvents="none" style={[styles.backTicket, styles.backTicketFirst]} />
          <View style={[styles.ticket, isCompactHeight ? styles.ticketCompact : null]}>
            <View style={styles.ticketMain}>
              <View style={styles.ticketHeader}>
                <Text style={styles.ticketBrand}>CULTURE TICKET</Text>
                <Text style={styles.ticketSerial}>NO. {getTicketSerial(visualKey)}</Text>
              </View>

              <View style={styles.ticketBody}>
                <Image
                  source={getTicketSkin(visualKey)}
                  style={styles.ticketArt}
                  resizeMode="cover"
                  accessibilityIgnoresInvertColors
                />
                <View style={styles.ticketCopyPanel}>
                  <View style={styles.clueRow}>
                    {(clues.length > 0 ? clues : ['오늘의 추천']).map((clue) => (
                      <View key={clue} style={styles.cluePill}>
                        <Text style={styles.clueText}>{clue}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={[styles.ticketHeadline, isCompactHeight ? styles.ticketHeadlineCompact : null]}>
                    {mysteryHeadline(card)}
                  </Text>
                  <Text style={styles.lockedCopy} numberOfLines={1}>
                    행사명과 장소는 광고 뒤에 공개돼요
                  </Text>
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${actionLabel}, 광고가 끝나면 행사 정보가 공개돼요`}
                onPress={onOpen}
                disabled={disabled}
                style={({ pressed }) => [
                  styles.cardCta,
                  disabled ? styles.cardCtaDisabled : null,
                  pressed && !disabled ? styles.cardCtaPressed : null,
                ]}
              >
                <Text style={[styles.cardCtaText, disabled ? styles.cardCtaTextDisabled : null]}>
                  {loading ? '광고 준비 중' : actionLabel}
                </Text>
                <Text style={[styles.cardCtaArrow, disabled ? styles.cardCtaTextDisabled : null]}>→</Text>
              </Pressable>
            </View>

            <View style={styles.rewardStub}>
              <View style={styles.perforation} />
              <Text style={styles.rewardLabel}>REWARD</Text>
              <View style={styles.rewardCopy}>
                <Text style={styles.rewardAmount}>+2~3</Text>
                <Text style={styles.rewardUnit}>티켓</Text>
              </View>
              <Text style={styles.stubSerial}>{getTicketSerial(visualKey).slice(-3)}</Text>
            </View>
            <View pointerEvents="none" style={[styles.notch, styles.notchTop]} />
            <View pointerEvents="none" style={[styles.notch, styles.notchBottom]} />
          </View>
        </View>
      ) : null}

      <View style={styles.afterTicket}>
        <Text style={styles.remainingCopy}>오늘 남은 티켓 {remaining}장</Text>
        <Text style={styles.hint}>한 장을 열면 다음 추천 티켓이 이어져요</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingTop: 14,
  },
  sectionCompact: {
    paddingTop: 7,
  },
  heading: {
    paddingHorizontal: 22,
  },
  headingTop: {
    paddingBottom: 7,
    borderBottomWidth: 1,
    borderBottomColor: INK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: {
    color: RED,
    fontSize: 10.5,
    lineHeight: 18,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  dailyCount: {
    color: INK,
    fontSize: 10,
    lineHeight: 16,
    fontWeight: '800',
  },
  title: {
    marginTop: 9,
    color: INK,
    fontSize: 27,
    lineHeight: 35,
    fontWeight: '900',
    letterSpacing: -1.25,
    fontFamily: 'Noto Serif KR',
  },
  titleCompact: {
    marginTop: 6,
    fontSize: 23,
    lineHeight: 30,
  },
  subtitle: {
    marginTop: 5,
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  subtitleCompact: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 16,
  },
  progressHeader: {
    marginTop: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressCopy: {
    color: INK,
    fontSize: 10.5,
    lineHeight: 15,
    fontWeight: '800',
  },
  progressLimit: {
    color: MUTED,
    fontSize: 10.5,
    lineHeight: 15,
    fontWeight: '700',
  },
  progressTrack: {
    marginTop: 6,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: '#DDD8CE',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: RED,
  },
  ticketDeck: {
    alignSelf: 'center',
    marginTop: 17,
    paddingTop: 8,
    paddingBottom: 5,
  },
  backTicket: {
    position: 'absolute',
    height: 204,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#CFC8BB',
  },
  backTicketFirst: {
    top: 4,
    left: 9,
    right: 9,
    backgroundColor: '#F3B64A',
    opacity: 0.7,
  },
  backTicketSecond: {
    top: 0,
    left: 18,
    right: 18,
    backgroundColor: '#2D6A66',
    opacity: 0.5,
  },
  ticket: {
    minHeight: 250,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#C8C1B5',
    backgroundColor: TICKET_PAPER,
    overflow: 'hidden',
    flexDirection: 'row',
    shadowColor: '#171717',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.13,
    shadowRadius: 14,
    elevation: 4,
  },
  ticketCompact: {
    minHeight: 230,
  },
  ticketMain: {
    flex: 1,
  },
  ticketHeader: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ticketBrand: {
    color: INK,
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 1.15,
  },
  ticketSerial: {
    color: MUTED,
    fontSize: 8,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  ticketBody: {
    flex: 1,
    minHeight: 160,
    flexDirection: 'row',
  },
  ticketArt: {
    width: '41%',
    height: '100%',
    backgroundColor: '#EEE8DA',
  },
  ticketCopyPanel: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 13,
    justifyContent: 'center',
  },
  clueRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  cluePill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D6D0C5',
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: '#F7F3EA',
  },
  clueText: {
    color: MUTED,
    fontSize: 8.5,
    lineHeight: 11,
    fontWeight: '800',
  },
  ticketHeadline: {
    marginTop: 10,
    color: INK,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
    letterSpacing: -0.55,
    fontFamily: 'Noto Serif KR',
  },
  ticketHeadlineCompact: {
    marginTop: 7,
    fontSize: 16,
    lineHeight: 21,
  },
  lockedCopy: {
    marginTop: 8,
    color: MUTED,
    fontSize: 8.5,
    lineHeight: 12,
    fontWeight: '600',
  },
  cardCta: {
    minHeight: 47,
    paddingHorizontal: 14,
    backgroundColor: RED,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardCtaDisabled: {
    backgroundColor: '#CAC5BB',
  },
  cardCtaPressed: {
    opacity: 0.88,
  },
  cardCtaText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '900',
  },
  cardCtaArrow: {
    color: '#FFFFFF',
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '500',
  },
  cardCtaTextDisabled: {
    color: '#817C74',
  },
  rewardStub: {
    width: 66,
    position: 'relative',
    backgroundColor: '#F4EFE4',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    paddingHorizontal: 5,
  },
  perforation: {
    position: 'absolute',
    left: 0,
    top: 9,
    bottom: 9,
    borderLeftWidth: 1,
    borderStyle: 'dashed',
    borderLeftColor: '#9E978B',
  },
  rewardLabel: {
    color: MUTED,
    fontSize: 7.5,
    lineHeight: 10,
    fontWeight: '900',
    letterSpacing: 1.1,
    transform: [{ rotate: '90deg' }],
    marginTop: 22,
  },
  rewardCopy: {
    alignItems: 'center',
  },
  rewardAmount: {
    color: RED,
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  rewardUnit: {
    marginTop: 1,
    color: RED,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
  },
  stubSerial: {
    color: MUTED,
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  notch: {
    position: 'absolute',
    right: 58,
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: PAPER,
    borderWidth: 1,
    borderColor: '#C8C1B5',
  },
  notchTop: {
    top: -8,
  },
  notchBottom: {
    bottom: -8,
  },
  afterTicket: {
    marginTop: 9,
    paddingHorizontal: 22,
    alignItems: 'center',
  },
  remainingCopy: {
    color: INK,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  hint: {
    marginTop: 4,
    color: MUTED,
    fontSize: 10.5,
    lineHeight: 15,
    fontWeight: '600',
  },
});
