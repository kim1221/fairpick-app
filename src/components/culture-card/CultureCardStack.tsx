import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
  const cardWidth = Math.min(302, width - 70);

  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>오늘의 컬처카드</Text>
        <Text style={styles.title}>마음이 가는 한 장을{`\n`}열어보세요</Text>
        <Text style={styles.subtitle}>
          {userRegion
            ? `${userRegion} 근처에서 고른 카드예요. 한 장을 열면 새로운 카드가 채워져요.`
            : '지금 가볼 만한 문화를 골랐어요. 한 장을 열면 새로운 카드가 채워져요.'}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={cardWidth + 12}
        snapToAlignment="start"
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

              <View style={styles.cardTop}>
                <View style={[styles.numberBadge, { backgroundColor: palette.accent }]}>
                  <Text style={[styles.numberText, { color: palette.background }]}>
                    {String(index + 1).padStart(2, '0')}
                  </Text>
                </View>
                <View style={styles.selectionLabel}>
                    <Text style={[styles.selectionText, { color: palette.foreground }]}>
                    {selected ? '선택됨' : '선택하기'}
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
                  {card.isRevisit ? '다시 추천된 카드 · 광고 후 상세 확인' : '광고 후 행사명과 장소 공개'}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.progressRow}>
        <Text style={styles.progressStrong}>오늘 {dailyOpenCount}장 공개</Text>
        <Text style={styles.progressMuted}>최대 {dailyOpenLimit}장까지</Text>
      </View>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.min(100, Math.round((dailyOpenCount / Math.max(1, dailyOpenLimit)) * 100))}%` },
          ]}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        style={[styles.cta, disabled ? styles.ctaDisabled : null]}
        onPress={onOpen}
        disabled={disabled}
      >
        <Icon name="icon-play-mono" size={17} color={disabled ? '#A39F98' : '#FFFFFF'} />
        <Text style={[styles.ctaText, disabled ? styles.ctaTextDisabled : null]}>
          {loading ? '광고 준비 중' : actionLabel}
        </Text>
      </Pressable>
      <Text style={styles.hint}>광고가 끝나면 이벤트 정보와 문화 티켓을 함께 받아요</Text>
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
  eyebrow: {
    color: BLUE,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  title: {
    marginTop: 7,
    color: INK,
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '900',
    letterSpacing: -1.2,
  },
  subtitle: {
    marginTop: 8,
    color: MUTED,
    fontSize: 13.5,
    lineHeight: 21,
    fontWeight: '600',
  },
  cardRail: {
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 8,
    gap: 12,
  },
  newsCard: {
    height: 356,
    borderRadius: 25,
    padding: 20,
    overflow: 'hidden',
    justifyContent: 'space-between',
    borderWidth: 3,
    borderColor: 'transparent',
    shadowColor: '#1A1712',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 5,
  },
  newsCardSelected: {
    borderColor: '#171717',
  },
  newsCardPressed: {
    transform: [{ scale: 0.985 }],
  },
  shapeLarge: {
    position: 'absolute',
    width: 230,
    height: 230,
    borderRadius: 115,
    right: -105,
    top: 58,
  },
  shapeSmall: {
    position: 'absolute',
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 18,
    left: -28,
    bottom: 58,
    opacity: 0.28,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  numberBadge: {
    width: 36,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
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
    marginBottom: 28,
  },
  cardEyebrow: {
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '900',
  },
  cardHeadline: {
    marginTop: 9,
    fontSize: 27,
    lineHeight: 35,
    fontWeight: '900',
    letterSpacing: -1.1,
  },
  cardFooter: {
    paddingTop: 14,
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
  progressRow: {
    marginTop: 8,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressStrong: {
    color: INK,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '900',
  },
  progressMuted: {
    color: MUTED,
    fontSize: 11.5,
    lineHeight: 17,
    fontWeight: '600',
  },
  progressTrack: {
    marginHorizontal: 22,
    marginTop: 8,
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: '#DDD9CF',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: BLUE,
  },
  cta: {
    marginHorizontal: 22,
    marginTop: 16,
    height: 56,
    borderRadius: 17,
    backgroundColor: INK,
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
