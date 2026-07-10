import React from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Icon } from '@toss/tds-react-native';
import type { LockedCardPreview } from '../../services/cardsService';

const INK = '#171717';
const MUTED = '#6F6B65';
const BLUE = '#A52822';
const FALLBACK_PALETTE = { background: '#EFE9D8', foreground: '#171717', accent: '#A52822' };

interface CultureCardStackProps {
  cards: LockedCardPreview[];
  selectedToken: string | null;
  dailyOpenCount: number;
  dailyOpenLimit: number;
  loading: boolean;
  disabled: boolean;
  actionLabel: string;
  onSelect: (cardToken: string) => void;
  onOpen: () => void;
  userRegion: string | null;
}

export function CultureCardStack({
  cards,
  selectedToken,
  dailyOpenCount,
  dailyOpenLimit,
  loading,
  disabled,
  actionLabel,
  onSelect,
  onOpen,
  userRegion,
}: CultureCardStackProps) {
  const { width } = useWindowDimensions();
  const cardWidth = width - 44;
  const selectedIndex = Math.max(0, cards.findIndex((card) => card.cardToken === selectedToken));
  const handleMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.max(
      0,
      Math.min(cards.length - 1, Math.round(event.nativeEvent.contentOffset.x / (cardWidth + 12))),
    );
    const nextCard = cards[nextIndex];
    if (nextCard && nextCard.cardToken !== selectedToken) onSelect(nextCard.cardToken);
  };

  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <View style={styles.headingTop}>
          <Text style={styles.eyebrow}>THE COVER STORY</Text>
          <Text style={styles.dailyPillText}>{dailyOpenCount} / {dailyOpenLimit} OPENED</Text>
        </View>
        <Text style={styles.title}>오늘의 표지</Text>
        <Text style={styles.subtitle}>
          {userRegion
            ? `${userRegion} 근처에서 고른 세 장입니다. 표지를 넘기고 한 장을 열어보세요.`
            : '오늘의 편집부가 고른 세 장입니다. 표지를 넘기고 한 장을 열어보세요.'}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={cardWidth + 12}
        snapToAlignment="start"
        onMomentumScrollEnd={handleMomentumEnd}
        contentContainerStyle={styles.cardRail}
      >
        {cards.map((card, index) => {
          const selected = card.cardToken === selectedToken;
          const palette = card.palette ?? FALLBACK_PALETTE;
          const teaserEyebrow = card.teaserEyebrow ?? card.reasonTags?.[0] ?? '오늘의 큐레이션';
          const teaserHeadline = card.teaserHeadline ?? `오늘 가볍게 열어볼\n${card.category} 한 곳`;
          const meta = [card.category, card.distanceLabel, card.timingLabel].filter(Boolean).join(' · ');
          return (
            <Pressable
              key={card.cardToken}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${teaserEyebrow}, ${teaserHeadline.replace('\n', ' ')}`}
              onPress={() => onSelect(card.cardToken)}
              style={({ pressed }) => [
                styles.newsCard,
                { width: cardWidth, backgroundColor: palette.background },
                selected ? styles.newsCardSelected : null,
                pressed ? styles.newsCardPressed : null,
              ]}
            >
              <View
                pointerEvents="none"
                style={[styles.shapeLarge, { backgroundColor: palette.accent }]}
              />
              <View
                pointerEvents="none"
                style={[styles.shapeSmall, { borderColor: palette.accent }]}
              />
              <Text
                pointerEvents="none"
                style={[styles.posterLetter, { color: palette.accent }]}
              >
                {card.category?.trim().slice(0, 1) || 'C'}
              </Text>

              <View style={styles.cardTop}>
                <Text style={[styles.cardSerial, { color: palette.foreground }]}>VOL. 01 / NO. {String(index + 1).padStart(2, '0')}</Text>
                <View style={styles.selectionLabel}>
                    <Text style={[styles.selectionText, { color: palette.foreground }]}>
                    {selected ? 'SELECTED' : 'SWIPE'}
                  </Text>
                  <View style={[
                    styles.selectionDot,
                    {
                      borderColor: palette.foreground,
                      backgroundColor: selected ? palette.foreground : 'transparent',
                    },
                  ]} />
                </View>
              </View>

              <View style={styles.cardCopy}>
                <Text style={[styles.cardEyebrow, { color: palette.accent }]}>
                  {teaserEyebrow}
                </Text>
                <Text style={[styles.cardHeadline, { color: palette.foreground }]}>
                  {teaserHeadline}
                </Text>
              </View>

              <View style={[styles.cardFooter, { borderTopColor: `${palette.foreground}30` }]}>
                <Text style={[styles.cardMeta, { color: palette.foreground }]} numberOfLines={1}>
                  {meta}
                </Text>
                <Text style={[styles.lockedCopy, { color: palette.foreground }]}>
                  {card.isRevisit ? '다시 만난 장면 · 광고 후 전체 공개' : '행사명과 장소는 광고 뒤에 공개돼요'}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.pager} accessibilityLabel={`${selectedIndex + 1}번째 카드 선택됨`}>
        {cards.map((card, index) => (
          <View
            key={`page-${card.cardToken}`}
            style={[styles.pageDot, index === selectedIndex ? styles.pageDotActive : null]}
          />
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        style={[styles.cta, disabled ? styles.ctaDisabled : null]}
        onPress={onOpen}
        disabled={disabled}
      >
        <View style={styles.ctaIcon}>
          <Icon name="icon-play-mono" size={15} color={disabled ? '#A39F98' : '#171717'} />
        </View>
        <Text style={[styles.ctaText, disabled ? styles.ctaTextDisabled : null]}>
          {loading ? '광고 준비 중' : actionLabel}
        </Text>
      </Pressable>
      <Text style={styles.hint}>광고가 끝나면 행사 전체 정보와 문화 티켓을 함께 받아요</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingTop: 14,
  },
  heading: {
    paddingHorizontal: 22,
  },
  headingTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#171717',
  },
  eyebrow: {
    color: '#A52822',
    fontSize: 11,
    lineHeight: 18,
    fontWeight: '900',
    letterSpacing: 1.6,
  },
  dailyPillText: {
    color: '#171717',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1,
  },
  title: {
    marginTop: 5,
    color: INK,
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '900',
    letterSpacing: -1.2,
    fontFamily: 'Noto Serif KR',
  },
  subtitle: {
    marginTop: 6,
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  cardRail: {
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 12,
  },
  newsCard: {
    height: 396,
    borderRadius: 2,
    padding: 18,
    overflow: 'hidden',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#171717',
    shadowColor: '#1A1712',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  newsCardSelected: {
    borderWidth: 3,
    borderColor: '#171717',
  },
  newsCardPressed: {
    transform: [{ scale: 0.985 }],
  },
  shapeLarge: {
    position: 'absolute',
    width: 58,
    top: 0,
    bottom: 0,
    left: 0,
    opacity: 1,
  },
  shapeSmall: {
    position: 'absolute',
    width: 104,
    height: 150,
    borderRadius: 0,
    borderWidth: 1,
    right: 18,
    top: 70,
    opacity: 0.52,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginLeft: 52,
  },
  cardSerial: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    letterSpacing: 1.4,
    opacity: 0.8,
  },
  posterLetter: {
    position: 'absolute',
    right: -5,
    top: 42,
    fontSize: 210,
    lineHeight: 228,
    fontWeight: '900',
    opacity: 0.18,
    fontFamily: 'Noto Serif KR',
  },
  selectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  selectionText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  selectionDot: {
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 1.5,
  },
  cardCopy: {
    marginTop: 'auto',
    marginBottom: 24,
    marginLeft: 52,
    maxWidth: '78%',
  },
  cardEyebrow: {
    fontSize: 10,
    lineHeight: 18,
    fontWeight: '900',
  },
  cardHeadline: {
    marginTop: 9,
    fontSize: 29,
    lineHeight: 37,
    fontWeight: '900',
    letterSpacing: -1.1,
    fontFamily: 'Noto Serif KR',
  },
  cardFooter: {
    paddingTop: 10,
    borderTopWidth: 1,
    marginLeft: 52,
  },
  cardMeta: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  lockedCopy: {
    marginTop: 4,
    fontSize: 10.5,
    lineHeight: 15,
    fontWeight: '600',
    opacity: 0.76,
  },
  pager: {
    height: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pageDot: {
    width: 28,
    height: 2,
    borderRadius: 0,
    backgroundColor: '#C9C5BC',
  },
  pageDotActive: {
    width: 52,
    backgroundColor: BLUE,
  },
  cta: {
    marginHorizontal: 22,
    marginTop: 13,
    height: 58,
    borderRadius: 2,
    backgroundColor: '#171717',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaDisabled: {
    backgroundColor: '#E5E1D8',
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 15.5,
    lineHeight: 21,
    fontWeight: '900',
  },
  ctaIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EFE9D8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaTextDisabled: {
    color: '#A39F98',
  },
  hint: {
    marginTop: 10,
    textAlign: 'center',
    color: MUTED,
    fontSize: 11.5,
    lineHeight: 17,
    fontWeight: '600',
  },
});
