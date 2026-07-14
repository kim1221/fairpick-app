import React from 'react';
import {
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { LockedCardPreview } from '../../services/cardsService';
import { getLockedCardChoice } from './homeLogic';
import { getTicketSerial, getTicketSkin, stableTicketHash } from './ticketSkins';

const INK = '#171717';
const MUTED = '#6F6B65';
const RED = '#A52822';
const PAPER = '#F7F5EF';
const TICKET_PAPER = '#FFFDF7';

interface CultureCardStackProps {
  cards: LockedCardPreview[];
  selectedCardKey: string | null;
  loading: boolean;
  disabled: boolean;
  actionLabel: string;
  onSelectCard: (cardKey: string) => void;
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
  const visualKey = card.visualSeed ?? card.cardToken;
  return GENERIC_HEADLINES[stableTicketHash(visualKey) % GENERIC_HEADLINES.length]!;
}

export function CultureCardStack({
  cards,
  selectedCardKey,
  loading,
  disabled,
  actionLabel,
  onSelectCard,
  onOpen,
  userRegion,
}: CultureCardStackProps) {
  const { width, height } = useWindowDimensions();
  const card = cards.find((candidate) => (
    (candidate.visualSeed ?? candidate.cardToken) === selectedCardKey
  )) ?? cards[0] ?? null;
  const isCompactHeight = height <= 700;
  const ticketWidth = Math.min(width - 44, 430);
  const visualKey = card ? (card.visualSeed ?? card.cardToken) : '';
  const clues = card
    ? [card.category, card.distanceLabel ?? card.areaLabel, card.timingLabel]
      .filter((value): value is string => Boolean(value))
      .slice(0, 3)
    : [];
  const clueCopy = clues.length > 0 ? clues.join(' · ') : '오늘의 추천';

  return (
    <View style={[styles.section, isCompactHeight ? styles.sectionCompact : null]}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>TODAY&apos;S CULTURE CARD</Text>
        <Text style={[styles.title, isCompactHeight ? styles.titleCompact : null]}>
          어떤 문화를 열어볼까요?
        </Text>
        <Text style={[styles.subtitle, isCompactHeight ? styles.subtitleCompact : null]} numberOfLines={2}>
          {userRegion
            ? `${userRegion} 근처에서 고른 카드예요. 힌트를 보고 한 장을 선택해 보세요.`
            : '힌트를 보고 오늘 열어볼 컬처카드 한 장을 선택해 보세요.'}
        </Text>
      </View>

      {cards.length > 1 ? (
        <View style={styles.choiceSection}>
          <View style={styles.choiceHeader}>
            <Text style={styles.choiceEyebrow}>열어볼 카드 선택</Text>
            <Text style={styles.choiceHint}>선택해도 광고는 바로 시작되지 않아요</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.choiceList}
          >
            {cards.map((candidate, index) => {
              const candidateKey = candidate.visualSeed ?? candidate.cardToken;
              const selected = candidateKey === (card ? (card.visualSeed ?? card.cardToken) : selectedCardKey);
              const choice = getLockedCardChoice(candidate, index);
              return (
                <Pressable
                  key={candidateKey}
                  accessibilityRole="button"
                  accessibilityLabel={`${choice.label}, ${choice.description}`}
                  accessibilityHint="선택하면 메인 컬처카드의 힌트가 바뀌어요"
                  accessibilityState={{ selected, disabled }}
                  disabled={disabled}
                  onPress={() => onSelectCard(candidateKey)}
                  style={({ pressed }) => [
                    styles.choiceCard,
                    selected ? styles.choiceCardSelected : null,
                    pressed && !disabled ? styles.choiceCardPressed : null,
                    disabled ? styles.choiceCardDisabled : null,
                  ]}
                >
                  <View style={styles.choiceTop}>
                    <Text style={[styles.choiceIndex, selected ? styles.choiceTextSelected : null]}>
                      {String(index + 1).padStart(2, '0')}
                    </Text>
                    <View style={[styles.choiceDot, selected ? styles.choiceDotSelected : null]} />
                  </View>
                  <Text style={[styles.choiceLabel, selected ? styles.choiceTextSelected : null]} numberOfLines={1}>
                    {choice.label}
                  </Text>
                  <Text style={styles.choiceDescription} numberOfLines={2}>{choice.description}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {card ? (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.ticketDeck, { width: ticketWidth }]}
        >
          <View style={[styles.ticket, isCompactHeight ? styles.ticketCompact : null]}>
            <View style={styles.ticketMain}>
              <View style={styles.ticketHeader}>
                <Text style={styles.ticketBrand}>CULTURE CARD</Text>
                <Text style={styles.ticketSerial}>NO. {getTicketSerial(visualKey)}</Text>
              </View>

              <ImageBackground
                source={getTicketSkin(visualKey)}
                style={styles.ticketBody}
                imageStyle={styles.ticketArtImage}
                resizeMode="cover"
              >
                <View style={styles.ticketArtWash} pointerEvents="none" />
                <View style={styles.ticketCopyPanel}>
                  <Text style={styles.clueLine}>{card.teaserEyebrow || clueCopy}</Text>
                  <Text style={[styles.ticketHeadline, isCompactHeight ? styles.ticketHeadlineCompact : null]}>
                    {card.teaserHeadline || mysteryHeadline(card)}
                  </Text>
                  <Text style={styles.ticketMeta} numberOfLines={1}>{clueCopy}</Text>
                  <Text style={styles.lockedCopy} numberOfLines={1}>
                    행사명과 정확한 장소는 광고를 본 뒤 공개돼요
                  </Text>
                </View>
              </ImageBackground>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="광고를 보고 선택한 컬처카드 공개하기"
                accessibilityHint="광고를 끝까지 보면 행사명과 장소가 공개되고 티켓 1장부터 3장이 적립돼요"
                accessibilityState={{ disabled, busy: loading }}
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
              <View style={styles.rewardCopy}>
                <Text style={styles.rewardAmount}>1~3</Text>
                <Text style={styles.rewardUnit}>티켓</Text>
              </View>
              <Text style={styles.stubSerial}>{getTicketSerial(visualKey).slice(-3)}</Text>
            </View>
            <View pointerEvents="none" style={[styles.notch, styles.notchTop]} />
            <View pointerEvents="none" style={[styles.notch, styles.notchBottom]} />
          </View>
        </View>
      ) : null}
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
  eyebrow: {
    color: RED,
    fontSize: 10.5,
    lineHeight: 18,
    fontWeight: '900',
    letterSpacing: 1.3,
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
  choiceSection: {
    marginTop: 15,
  },
  choiceHeader: {
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  choiceEyebrow: {
    color: INK,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '900',
  },
  choiceHint: {
    flex: 1,
    color: MUTED,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '600',
    textAlign: 'right',
  },
  choiceList: {
    paddingHorizontal: 22,
    paddingTop: 8,
    gap: 8,
  },
  choiceCard: {
    width: 132,
    minHeight: 78,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D7D0C4',
    backgroundColor: '#FFFCF5',
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  choiceCardSelected: {
    borderColor: RED,
    backgroundColor: '#F4E8E2',
  },
  choiceCardPressed: {
    opacity: 0.78,
  },
  choiceCardDisabled: {
    opacity: 0.55,
  },
  choiceTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  choiceIndex: {
    color: MUTED,
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  choiceDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#A9A297',
  },
  choiceDotSelected: {
    borderColor: RED,
    backgroundColor: RED,
  },
  choiceLabel: {
    marginTop: 7,
    color: INK,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  choiceTextSelected: {
    color: RED,
  },
  choiceDescription: {
    marginTop: 2,
    color: MUTED,
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: '600',
  },
  ticketDeck: {
    alignSelf: 'center',
    marginTop: 13,
    paddingBottom: 5,
  },
  ticket: {
    minHeight: 250,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#D7D0C4',
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
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5DFD4',
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
    height: 166,
    backgroundColor: '#EEE8DA',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  ticketArtImage: {
    width: '100%',
    height: '100%',
  },
  ticketArtWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(35, 30, 22, 0.05)',
  },
  ticketCopyPanel: {
    width: '89%',
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 253, 247, 0.9)',
    justifyContent: 'center',
    shadowColor: '#171717',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 2,
  },
  clueLine: {
    color: RED,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '900',
  },
  ticketHeadline: {
    marginTop: 5,
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
  ticketMeta: {
    marginTop: 5,
    color: INK,
    fontSize: 8.5,
    lineHeight: 12,
    fontWeight: '800',
  },
  lockedCopy: {
    marginTop: 3,
    color: MUTED,
    fontSize: 8.5,
    lineHeight: 12,
    fontWeight: '600',
  },
  cardCta: {
    minHeight: 47,
    paddingHorizontal: 16,
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
    width: 60,
    position: 'relative',
    backgroundColor: '#F3EEE3',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 30,
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
    right: 52,
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
});
