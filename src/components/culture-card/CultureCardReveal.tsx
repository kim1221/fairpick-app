import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@toss/tds-react-native';
import type { Card } from '../../services/cardsService';
import { romanizeRegion } from '../../utils/regionRomanize';
import {
  CondensedDisplay,
  FieldRow,
  FinePrint,
  Rule,
  RubberStamp,
  TagBody,
  TagHeader,
  TAG_TOKENS,
} from './tagKit';

const {
  ink: INK,
  navy: NAVY,
  red: RED,
  sub: SUB,
  manila: MANILA,
  headText: HEAD_TEXT,
  navSub: NAV_SUB,
  ringLine: RING_LINE,
} = TAG_TOKENS;

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

// 카테고리 한글 → 라틴 프린트 라벨
const CATEGORY_LATIN: Record<string, string> = {
  전시: 'EXHIBITION',
  공연: 'PERFORMANCE',
  팝업: 'POP-UP',
  축제: 'FESTIVAL',
  행사: 'EVENT',
  기타: 'CULTURE',
};

function categoryLatin(category: string | null): string {
  if (!category) return 'CULTURE';
  return CATEGORY_LATIN[category.trim()] ?? 'CULTURE';
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const [date] = iso.split('T');
  if (!date) return null;
  const [, month, day] = date.split('-');
  if (!month || !day) return date.replaceAll('-', '.');
  return `${Number(month)}.${Number(day)}`;
}

function formatDateRange(card: Card): string | null {
  const start = formatDate(card.startAt);
  const end = formatDate(card.endAt);
  if (start && end) return `${start} – ${end}`;
  return start ?? end;
}

function getDdayLabel(dday: number | null): string | null {
  if (dday == null) return null;
  if (dday === 0) return 'D-DAY';
  if (dday > 0) return `D-${dday}`;
  return '종료';
}

function buildWalkValue(card: Card): string | null {
  const walk = typeof card.walkMinutes === 'number' && card.walkMinutes > 0 ? `도보 ${card.walkMinutes}분` : null;
  const dday = getDdayLabel(card.dday);
  return [walk, dday].filter(Boolean).join(' · ') || null;
}

function createStyles() {
  return StyleSheet.create({
    wrap: {
      paddingHorizontal: 22,
      paddingTop: 4,
    },
    tagArea: {
      marginTop: 8,
    },
    lbl: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 2,
      color: RED,
      textTransform: 'uppercase',
      marginTop: 2,
    },
    destKo: {
      fontSize: 20,
      lineHeight: 25,
      fontWeight: '900',
      letterSpacing: -0.8,
      color: INK,
      marginTop: 6,
    },
    // 실제 행사 사진 — 태그 안쪽 폭에 꽉 맞춘 정렬된 인쇄 사진(틸트 없음)
    photoBand: {
      alignSelf: 'stretch',
      marginTop: 13,
      height: 150,
      borderRadius: 3,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: 'rgba(44,42,34,0.22)',
      backgroundColor: MANILA,
    },
    photoImage: {
      ...StyleSheet.absoluteFillObject,
      width: undefined,
      height: undefined,
    },
    // 원색을 살짝만 눌러 종이와 톤 통일(자연스럽게)
    photoTint: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(44,42,34,0.07)',
    },
    photoCap: {
      marginTop: 6,
      fontSize: 10.5,
      letterSpacing: 0.4,
      color: SUB,
      fontWeight: '600',
    },
    earnRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
    },
    earnLbl: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.5,
      color: INK,
      opacity: 0.72,
      textTransform: 'uppercase',
    },
    earnVal: {
      fontSize: 28,
      lineHeight: 30,
      fontWeight: '900',
      letterSpacing: 0.5,
      color: RED,
    },
    earnUnit: {
      fontSize: 12,
      fontWeight: '900',
      color: RED,
    },
    // 텍스트 폴백 하단
    fallbackBottom: {
      marginTop: 16,
      minHeight: 88,
      justifyContent: 'flex-end',
    },
    stampWrap: {
      height: 82,
    },
    // 액션
    actions: {
      marginTop: 15,
      flexDirection: 'row',
      gap: 10,
    },
    primaryButton: {
      flex: 1.5,
      height: 50,
      borderRadius: 14,
      backgroundColor: MANILA,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 7,
    },
    outlineButton: {
      flex: 1,
      height: 50,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: RING_LINE,
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
    },
    primaryText: {
      color: INK,
      fontSize: 14.5,
      lineHeight: 20,
      fontWeight: '800',
    },
    outlineText: {
      color: HEAD_TEXT,
      fontSize: 14.5,
      lineHeight: 20,
      fontWeight: '800',
    },
    next: {
      alignItems: 'center',
      marginTop: 14,
    },
    nextText: {
      color: NAV_SUB,
      fontSize: 12.5,
      lineHeight: 18,
      fontWeight: '700',
    },
  });
}

export function CultureCardReveal({ openedCard, onDetail, onNext, onSave }: CultureCardRevealProps) {
  const styles = React.useMemo(() => createStyles(), []);
  const { card, earned } = openedCard;
  const catLatin = categoryLatin(card.category);
  const dest = romanizeRegion(card.region);
  const dateRange = formatDateRange(card);
  const walkValue = buildWalkValue(card);
  const ddayLabel = getDdayLabel(card.dday);
  const finePrintTail = [ddayLabel ? `Valid until ${ddayLabel}` : 'Valid today', card.region, '컬처카드']
    .filter(Boolean)
    .join(' · ');
  const capText = card.venue ?? card.region ?? '컬처카드';

  return (
    <View style={styles.wrap}>
      <View style={styles.tagArea}>
        <TagBody>
          <TagHeader printedTop={catLatin} printedBottom="SEOUL · No.0704.25" />
          <Rule />
          <Text style={styles.lbl}>TO · {card.category || '문화'}</Text>
          <CondensedDisplay color={NAVY} size={48}>{dest}</CondensedDisplay>
          <Text style={styles.destKo} numberOfLines={2}>{card.title}</Text>

          {card.imageUrl ? (
            // ── 실제 행사 사진: 태그에 정렬된 깔끔한 인쇄 사진(틸트/폴라로이드 X) ──
            <>
              <View style={styles.photoBand}>
                <Image source={{ uri: card.imageUrl }} style={styles.photoImage} resizeMode="cover" />
                <View style={styles.photoTint} pointerEvents="none" />
              </View>
              <Text style={styles.photoCap} numberOfLines={1}>{capText}</Text>
              <Rule variant="thin" />
              {dateRange ? <FieldRow label="Date" value={dateRange} /> : null}
              {walkValue ? <FieldRow label="Walk" value={walkValue} /> : null}
              <Rule />
              <View style={styles.earnRow}>
                <Text style={styles.earnLbl}>적립 · Ticket</Text>
                <Text style={styles.earnVal}>
                  +{earned}
                  <Text style={styles.earnUnit}> 티켓</Text>
                </Text>
              </View>
            </>
          ) : (
            // ── §5 텍스트 폴백(사진 없음) ──
            <>
              <Rule variant="thin" />
              {dateRange ? <FieldRow label="Date" value={dateRange} /> : null}
              {card.venue ? <FieldRow label="Place" value={card.venue} /> : null}
              {walkValue ? <FieldRow label="Walk" value={walkValue} /> : null}
              <Rule />
              <View style={styles.earnRow}>
                <Text style={styles.earnLbl}>적립 · Ticket</Text>
                <Text style={styles.earnVal}>
                  +{earned}
                  <Text style={styles.earnUnit}> 티켓</Text>
                </Text>
              </View>
              <View style={styles.fallbackBottom}>
                <View style={styles.stampWrap}>
                  <RubberStamp right={18} bottom={2} topText="ADMIT" bottomText="ONE" />
                </View>
                <Rule variant="dash" />
                <FinePrint>{finePrintTail}</FinePrint>
              </View>
            </>
          )}
        </TagBody>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.primaryButton} onPress={onDetail}>
          <Text style={styles.primaryText}>자세히 보기</Text>
        </Pressable>
        <Pressable style={styles.outlineButton} onPress={onSave}>
          <Icon name="icon-bookmark-mono" size={18} color={HEAD_TEXT} />
          <Text style={styles.outlineText}>저장</Text>
        </Pressable>
      </View>

      <Pressable style={styles.next} onPress={onNext}>
        <Text style={styles.nextText}>다음 카드 열기 ›</Text>
      </Pressable>
    </View>
  );
}
