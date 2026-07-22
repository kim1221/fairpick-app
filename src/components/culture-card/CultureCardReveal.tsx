import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@toss/tds-react-native';
import type { Card, OpenCultureCardResponse } from '../../services/cardsService';
import { BoxStamp } from './tagKit';

const SURFACE = '#FFFFFF';
const INK = '#211F1B';
const SUB = '#69645B';
const RED = '#B43A27';
const LINE = 'rgba(33,31,27,0.14)';
const DARK_TEXT = '#171717';
// 다크 캔버스(태그 홈) 위 크롬 색
const CREAM = '#EFE3C4';
const CANVAS_SUB = '#8B8071';
const CTA_BG = '#E9DBB8';
const CTA_TEXT = '#2A2415';

export interface RevealedCultureCard {
  card: Card;
  earned: number;
  ticketCount: number;
  dailyEarned: number;
  dailyLimit: number;
  reveal?: OpenCultureCardResponse['reveal'];
  /** 이 오픈으로 채워진 테마 컬렉션 세트(S4). 빈 배열/부재면 연출 없음. */
  collectionProgress?: OpenCultureCardResponse['collectionProgress'];
}

interface CultureCardRevealProps {
  openedCard: RevealedCultureCard;
  /** 남은 오픈 캡이 있을 때만 true — "다음 카드 뽑기" CTA 노출 조건 */
  canDrawNext: boolean;
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

export function CultureCardReveal({
  openedCard,
  canDrawNext,
  onDetail,
  onNext,
  onSave,
}: CultureCardRevealProps) {
  const { card, earned } = openedCard;
  const schedule = dateRange(card);
  const distance = card.walkMinutes ? `도보 ${card.walkMinutes}분` : null;
  const meta = [schedule, distance, ddayLabel(card.dday)].filter(Boolean).join(' · ');
  const isHidden = openedCard.reveal?.hidden === true;

  return (
    <View style={styles.wrap}>
      <View style={styles.openedHeader}>
        <Text style={styles.openedEyebrow}>컬처카드를 열었어요</Text>
        <View style={styles.rewardPill}>
          <Text style={styles.rewardPillText}>+{earned} 티켓</Text>
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

        {/* 이 카드가 채운 테마 컬렉션 세트 — 완성 시에도 절제된 배지 표기만(글로우·콘페티 금지) */}
        {(openedCard.collectionProgress ?? []).map((entry) => (
          <View
            key={entry.setId}
            style={[styles.collectionBanner, entry.completed ? styles.collectionBannerCompleted : null]}
          >
            <Text style={[styles.collectionGlyph, entry.completed ? styles.collectionGlyphCompleted : null]}>
              {entry.completed ? '✦' : '▣'}
            </Text>
            <Text
              style={[styles.collectionBannerText, entry.completed ? styles.collectionBannerTextCompleted : null]}
              numberOfLines={2}
            >
              {entry.completed
                ? `『${entry.title}』 세트 완성 — 배지를 받았어요`
                : `『${entry.title}』 ${entry.filledCount}/${entry.totalSlots} 채움`}
            </Text>
          </View>
        ))}

        {/* ? 슬롯 히든 카드: 절제된 러버스탬프 1개만(글로우·콘페티 금지) */}
        {isHidden ? <BoxStamp text="HIDDEN" style={styles.hiddenStamp} /> : null}
      </View>

      {canDrawNext ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="다음 카드 뽑기"
          accessibilityHint="홈으로 돌아가 다음 봉인 카드를 골라요. 광고는 자동으로 시작되지 않아요"
          style={({ pressed }) => [styles.drawNext, pressed ? styles.drawNextPressed : null]}
          onPress={onNext}
        >
          <Text style={styles.drawNextText}>다음 카드 뽑기</Text>
        </Pressable>
      ) : null}

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" style={styles.outlineButton} onPress={onDetail}>
          <Text style={styles.outlineText}>상세 보기</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.outlineButton} onPress={onSave}>
          <Icon name="icon-bookmark-mono" size={18} color={DARK_TEXT} />
          <Text style={styles.outlineText}>저장</Text>
        </Pressable>
      </View>

      {!canDrawNext ? (
        <Pressable accessibilityRole="button" style={styles.next} onPress={onNext}>
          <Text style={styles.nextText}>오늘의 뽑기 완료 · 홈으로</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 8,
  },
  openedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    marginBottom: 10,
    borderTopWidth: 3,
    borderTopColor: CREAM,
  },
  openedEyebrow: {
    color: CREAM,
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '900',
    letterSpacing: -0.5,
    fontFamily: 'Noto Serif KR',
  },
  rewardPill: {
    borderRadius: 0,
    backgroundColor: '#A52822',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rewardPillText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '900',
  },
  card: {
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: '#171717',
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
    color: '#A52822',
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
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '900',
    letterSpacing: -1,
    fontFamily: 'Noto Serif KR',
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
    height: 252,
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
  hiddenStamp: {
    position: 'absolute',
    top: 14,
    right: 14,
  },
  collectionBanner: {
    marginHorizontal: 14,
    marginTop: -6,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F1E8CF',
    borderWidth: 1,
    borderColor: '#DECFA6',
  },
  collectionBannerCompleted: {
    backgroundColor: '#2A386A',
    borderColor: '#3D4C82',
  },
  collectionGlyph: {
    color: '#A52822',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
  },
  collectionGlyphCompleted: {
    color: '#C9A35B',
  },
  collectionBannerText: {
    flex: 1,
    color: '#2C2A22',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  collectionBannerTextCompleted: {
    color: '#E9DBB8',
  },
  drawNext: {
    marginTop: 14,
    borderRadius: 10,
    paddingVertical: 16,
    backgroundColor: CTA_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawNextPressed: {
    opacity: 0.86,
  },
  drawNextText: {
    color: CTA_TEXT,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
  },
  actions: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 9,
  },
  outlineButton: {
    flex: 1,
    height: 50,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#171717',
    backgroundColor: '#F7F5EF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  outlineText: {
    color: DARK_TEXT,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  next: {
    alignItems: 'center',
    paddingVertical: 15,
  },
  nextText: {
    color: CANVAS_SUB,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '700',
  },
});
