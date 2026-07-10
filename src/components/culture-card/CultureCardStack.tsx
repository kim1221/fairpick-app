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
const BLUE = '#3157D5';
const FALLBACK_PALETTE = { background: '#3157D5', foreground: '#FFF8E8', accent: '#FFD65A' };

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
  const cardWidth = Math.min(286, width - 76);
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
          <Text style={styles.eyebrow}>TODAY’S DROP</Text>
          <View style={styles.dailyPill}>
            <Text style={styles.dailyPillText}>오늘 {dailyOpenCount} · 최대 {dailyOpenLimit}</Text>
          </View>
        </View>
        <Text style={styles.title}>오늘의 문화,{`\n`}한 장씩 발견해요</Text>
        <Text style={styles.subtitle}>
          {userRegion
            ? `${userRegion} 근처의 장면을 골랐어요. 넘겨보고 마음 가는 한 장을 열어보세요.`
            : '지금 가볼 만한 장면을 골랐어요. 넘겨보고 마음 가는 한 장을 열어보세요.'}
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
                style={[styles.shapeLarge, { backgroundColor: palette.accent, opacity: 0.22 }]}
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
                <Text style={[styles.cardSerial, { color: palette.foreground }]}>CC / {String(index + 1).padStart(2, '0')}</Text>
                <View style={styles.selectionLabel}>
                    <Text style={[styles.selectionText, { color: palette.foreground }]}>
                    {selected ? '지금 이 카드' : '넘겨보기'}
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
    paddingTop: 8,
  },
  heading: {
    paddingHorizontal: 22,
  },
  headingTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: {
    color: BLUE,
    fontSize: 11,
    lineHeight: 18,
    fontWeight: '900',
    letterSpacing: 1.6,
  },
  dailyPill: {
    borderRadius: 999,
    backgroundColor: '#171717',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dailyPillText: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '800',
  },
  title: {
    marginTop: 5,
    color: INK,
    fontSize: 31,
    lineHeight: 37,
    fontWeight: '900',
    letterSpacing: -1.2,
  },
  subtitle: {
    marginTop: 6,
    color: MUTED,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '600',
  },
  cardRail: {
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 6,
    gap: 12,
  },
  newsCard: {
    height: 318,
    borderRadius: 28,
    padding: 20,
    overflow: 'hidden',
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: 'transparent',
    shadowColor: '#1A1712',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 5,
  },
  newsCardSelected: {
    borderColor: '#FFFFFF',
    transform: [{ translateY: -3 }],
  },
  newsCardPressed: {
    transform: [{ scale: 0.985 }],
  },
  shapeLarge: {
    position: 'absolute',
    width: 250,
    height: 250,
    borderRadius: 125,
    right: -90,
    top: 48,
  },
  shapeSmall: {
    position: 'absolute',
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 18,
    left: -28,
    bottom: 42,
    opacity: 0.28,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    right: 8,
    top: 48,
    fontSize: 176,
    lineHeight: 190,
    fontWeight: '900',
    opacity: 0.22,
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
    marginBottom: 18,
  },
  cardEyebrow: {
    fontSize: 11.5,
    lineHeight: 18,
    fontWeight: '900',
  },
  cardHeadline: {
    marginTop: 9,
    fontSize: 27,
    lineHeight: 34,
    fontWeight: '900',
    letterSpacing: -1.1,
  },
  cardFooter: {
    paddingTop: 10,
    borderTopWidth: 1,
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
    height: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pageDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#C9C5BC',
  },
  pageDotActive: {
    width: 18,
    backgroundColor: BLUE,
  },
  cta: {
    marginHorizontal: 22,
    marginTop: 13,
    height: 54,
    borderRadius: 17,
    backgroundColor: '#3157D5',
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
    backgroundColor: '#F6D45D',
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
