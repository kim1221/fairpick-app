import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@toss/tds-react-native';
import type { LockedCardPreview } from '../../services/cardsService';

const INK = '#100D09';
const SURFACE = '#191714';
const SURFACE_SELECTED = '#252018';
const LINE = 'rgba(255,255,255,0.10)';
const GOLD = '#D8B26A';
const TEXT = '#F5F1E9';
const MUTED = '#A7A095';
const CTA = '#F2E7CB';

interface CultureCardStackProps {
  cards: LockedCardPreview[];
  selectedToken: string | null;
  dailyEarned: number;
  dailyLimit: number;
  loading: boolean;
  disabled: boolean;
  actionLabel: string;
  onSelect: (cardToken: string) => void;
  onOpen: () => void;
  userRegion: string | null;
}

function previewTitle(card: LockedCardPreview): string {
  const area = card.areaLabel || '가까운 곳';
  return `${area}의 ${card.category}`;
}

export function CultureCardStack({
  cards,
  selectedToken,
  dailyEarned,
  dailyLimit,
  loading,
  disabled,
  actionLabel,
  onSelect,
  onOpen,
  userRegion,
}: CultureCardStackProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>오늘의 큐레이션</Text>
      <Text style={styles.title}>어떤 문화를 열어볼까요?</Text>
      <Text style={styles.subtitle}>
        {userRegion
          ? `${userRegion} 근처에서 고른 세 가지예요.`
          : '지금 가볼 만한 세 가지를 골랐어요.'}
      </Text>

      <View style={styles.candidates}>
        {cards.map((card) => {
          const selected = card.cardToken === selectedToken;
          const meta = [card.distanceLabel, card.timingLabel].filter(Boolean).join(' · ');
          return (
            <Pressable
              key={card.cardToken}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${previewTitle(card)}, ${meta}`}
              onPress={() => onSelect(card.cardToken)}
              style={({ pressed }) => [
                styles.candidate,
                selected ? styles.candidateSelected : null,
                pressed ? styles.candidatePressed : null,
              ]}
            >
              <View style={[styles.categoryMark, selected ? styles.categoryMarkSelected : null]}>
                <Text style={[styles.categoryText, selected ? styles.categoryTextSelected : null]}>
                  {card.category.slice(0, 1)}
                </Text>
              </View>
              <View style={styles.candidateCopy}>
                <View style={styles.categoryLine}>
                  <Text style={styles.category}>{card.category}</Text>
                  {(card.reasonTags ?? []).slice(0, 1).map((reason) => (
                    <Text key={reason} style={styles.reason}>{reason}</Text>
                  ))}
                </View>
                <Text style={styles.candidateTitle}>{previewTitle(card)}</Text>
                <Text style={styles.meta}>{meta || '상세 일정은 공개 후 확인할 수 있어요'}</Text>
              </View>
              <View style={[styles.radio, selected ? styles.radioSelected : null]}>
                {selected ? <View style={styles.radioDot} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        style={[styles.cta, disabled ? styles.ctaDisabled : null]}
        onPress={onOpen}
        disabled={disabled}
      >
        <Icon name="icon-play-mono" size={16} color={disabled ? '#807A70' : INK} />
        <Text style={[styles.ctaText, disabled ? styles.ctaTextDisabled : null]}>
          {loading ? '광고 준비 중' : actionLabel}
        </Text>
      </Pressable>
      <Text style={styles.hint}>광고가 끝나면 행사 정보와 티켓이 함께 열려요</Text>
      <Text style={styles.progress}>{dailyEarned} / {dailyLimit} 티켓 적립</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 22,
    paddingTop: 12,
  },
  eyebrow: {
    color: GOLD,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  title: {
    marginTop: 6,
    color: TEXT,
    fontSize: 25,
    lineHeight: 32,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  subtitle: {
    marginTop: 5,
    color: MUTED,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
  },
  candidates: {
    marginTop: 18,
    gap: 9,
  },
  candidate: {
    minHeight: 82,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: SURFACE,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  candidateSelected: {
    borderColor: 'rgba(216,178,106,0.72)',
    backgroundColor: SURFACE_SELECTED,
  },
  candidatePressed: {
    opacity: 0.8,
  },
  categoryMark: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: '#292622',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryMarkSelected: {
    backgroundColor: '#E2C98F',
  },
  categoryText: {
    color: MUTED,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
  categoryTextSelected: {
    color: INK,
  },
  candidateCopy: {
    flex: 1,
    minWidth: 0,
  },
  categoryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  category: {
    color: GOLD,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  reason: {
    color: '#99A9C7',
    fontSize: 10.5,
    lineHeight: 15,
    fontWeight: '700',
  },
  candidateTitle: {
    marginTop: 2,
    color: TEXT,
    fontSize: 15.5,
    lineHeight: 21,
    fontWeight: '800',
  },
  meta: {
    marginTop: 2,
    color: MUTED,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#68625A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: GOLD,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: GOLD,
  },
  cta: {
    marginTop: 16,
    height: 54,
    borderRadius: 15,
    backgroundColor: CTA,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaDisabled: {
    backgroundColor: '#27241F',
  },
  ctaText: {
    color: INK,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  ctaTextDisabled: {
    color: '#807A70',
  },
  hint: {
    marginTop: 10,
    textAlign: 'center',
    color: MUTED,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
  },
  progress: {
    marginTop: 3,
    textAlign: 'center',
    color: '#756F66',
    fontSize: 10.5,
    lineHeight: 15,
    fontWeight: '600',
  },
});
