import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  formatSavedTicketMeta,
  getDdayBadge,
  normalizeSavedCategory,
  SAVED_CATEGORY_COLORS,
  SAVED_CATEGORY_DARK_COLORS,
} from './savedTicketUtils';

const INK = '#16161A';
const PAPER = '#F5F1E8';
const PAPER_EDGE = '#E7E0D2';
const TEXT = '#1A1A1E';
const MUTED = '#6B6760';
const BLUE = '#3182F6';
const SOON_BG = '#FBE7E7';
const SOON_TEXT = '#C0392B';
const NORMAL_BG = '#EAE4D6';
const NORMAL_TEXT = '#7C7460';
// 골드 솔리드 CTA(시안 --gold)
const GOLD = '#CBA15E';
const GOLD_INK = '#1E1608';
const STAMP = '#A8324A';

export type VisitButtonState = 'idle' | 'loading' | 'visited';

export interface SavedTicketItem {
  id: string;
  title: string;
  venue?: string | null;
  region?: string | null;
  category?: string | null;
  subCategory?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  walkMinutes?: number | null;
  lat?: number | null;
  lng?: number | null;
  detailLink?: string | null;
  lastKnownStatus?: 'active' | 'ended' | 'deleted';
}

interface SavedTicketRowProps {
  item: SavedTicketItem;
  visitState: VisitButtonState;
  stampSignal: number;
  onPress: (item: SavedTicketItem) => void;
  onDirections: (item: SavedTicketItem) => void;
  onVisit: (item: SavedTicketItem) => void;
}

export function SavedTicketRow({
  item,
  visitState,
  stampSignal,
  onPress,
  onDirections,
  onVisit,
}: SavedTicketRowProps) {
  const category = normalizeSavedCategory(item.category, item.subCategory);
  const color = SAVED_CATEGORY_COLORS[category];
  const darkColor = SAVED_CATEGORY_DARK_COLORS[category];
  const dday = getDdayBadge(item.endAt);
  const meta = formatSavedTicketMeta({
    venue: item.venue,
    region: item.region,
    walkMinutes: item.walkMinutes,
  });

  const stampOpacity = useRef(new Animated.Value(visitState === 'visited' ? 0.88 : 0)).current;
  const stampScale = useRef(new Animated.Value(visitState === 'visited' ? 1 : 0.55)).current;

  useEffect(() => {
    if (visitState !== 'visited') {
      stampOpacity.setValue(0);
      stampScale.setValue(0.55);
      return;
    }

    if (stampSignal <= 0) {
      stampOpacity.setValue(0.88);
      stampScale.setValue(1);
      return;
    }

    stampOpacity.setValue(0);
    stampScale.setValue(0.55);
    Animated.parallel([
      Animated.timing(stampOpacity, {
        toValue: 0.92,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.spring(stampScale, {
        toValue: 1,
        friction: 5,
        tension: 130,
        useNativeDriver: true,
      }),
    ]).start();
  }, [stampOpacity, stampScale, stampSignal, visitState]);

  const visitLabel = useMemo(() => {
    if (visitState === 'loading') return '기록 중';
    if (visitState === 'visited') return '다녀옴 ✓';
    return '◉ 다녀왔어요';
  }, [visitState]);

  const isDeleted = item.lastKnownStatus === 'deleted';
  const canOpenDirections = Boolean(item.venue || item.region);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title} 상세 보기`}
      disabled={isDeleted}
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.row, pressed && !isDeleted ? styles.rowPressed : null, isDeleted ? styles.rowMuted : null]}
    >
      <View style={[styles.thumbnail, { backgroundColor: darkColor }]}>
        <View style={[styles.thumbBlock, { backgroundColor: color }]} />
        <View style={styles.thumbGloss} />
        <Text style={styles.thumbText}>{category}</Text>
      </View>
      <View style={styles.perforation} />
      <View style={[styles.notch, styles.notchLeft]} />
      <View style={[styles.notch, styles.notchRight]} />

      <View style={styles.content}>
        <View style={styles.categoryRow}>
          <Text style={[styles.categoryText, { color }]}>● {category}</Text>
          {isDeleted ? <Text style={styles.deletedText}>확인 필요</Text> : null}
        </View>
        <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
        <View style={styles.bottomRow}>
          <Text style={[styles.dday, dday.urgent ? styles.ddayUrgent : styles.ddayNormal]}>{dday.label}</Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                visitState === 'visited' ? `${item.title} 다녀옴 취소` : `${item.title} 다녀왔어요`
              }
              disabled={visitState === 'loading' || isDeleted}
              onPress={() => onVisit(item)}
              style={[
                styles.visitButton,
                visitState === 'visited' ? styles.visitButtonDone : styles.visitButtonIdle,
                visitState === 'loading' || isDeleted ? styles.actionDisabled : null,
              ]}
            >
              <Text style={[styles.visitButtonText, visitState === 'visited' ? styles.visitButtonDoneText : styles.visitButtonIdleText]}>
                {visitLabel}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title} 길찾기`}
              disabled={!canOpenDirections}
              onPress={() => onDirections(item)}
              style={!canOpenDirections ? styles.actionDisabled : null}
            >
              <Text style={styles.directions}>길찾기 ›</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.stamp,
          {
            opacity: stampOpacity,
            transform: [{ rotate: '-8deg' }, { scale: stampScale }],
          },
        ]}
      >
        <Text style={styles.stampText}>다녀옴</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 126,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: PAPER,
    flexDirection: 'row',
    position: 'relative',
    borderWidth: 1,
    borderColor: PAPER_EDGE,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 22,
    elevation: 8,
  },
  rowPressed: {
    opacity: 0.9,
  },
  rowMuted: {
    opacity: 0.72,
  },
  thumbnail: {
    width: 96,
    flexShrink: 0,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbBlock: {
    position: 'absolute',
    left: -16,
    top: -12,
    width: 86,
    height: 86,
    borderRadius: 48,
    opacity: 0.82,
  },
  thumbGloss: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    height: 54,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  thumbText: {
    color: '#F2EEE5',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  perforation: {
    position: 'absolute',
    left: 96,
    top: 10,
    bottom: 10,
    borderLeftWidth: 2,
    borderStyle: 'dashed',
    borderLeftColor: '#CFC6B2',
  },
  notch: {
    position: 'absolute',
    top: '50%',
    width: 16,
    height: 16,
    marginTop: -8,
    borderRadius: 8,
    backgroundColor: INK,
    zIndex: 2,
  },
  notchLeft: {
    left: 88,
  },
  notchRight: {
    right: -8,
  },
  content: {
    flex: 1,
    minWidth: 0,
    paddingTop: 13,
    paddingBottom: 13,
    paddingLeft: 18,
    paddingRight: 14,
  },
  categoryRow: {
    minHeight: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  categoryText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  deletedText: {
    color: MUTED,
    fontSize: 11,
    fontWeight: '800',
  },
  title: {
    marginTop: 5,
    color: TEXT,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    fontFamily: 'Noto Serif KR',
  },
  meta: {
    marginTop: 5,
    color: MUTED,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '600',
  },
  bottomRow: {
    marginTop: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  dday: {
    flexShrink: 0,
    overflow: 'hidden',
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
  },
  ddayUrgent: {
    backgroundColor: SOON_BG,
    color: SOON_TEXT,
  },
  ddayNormal: {
    backgroundColor: NORMAL_BG,
    color: NORMAL_TEXT,
  },
  actions: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  visitButton: {
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visitButtonIdle: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  visitButtonDone: {
    backgroundColor: 'rgba(168,50,74,0.10)',
    borderColor: 'rgba(168,50,74,0.30)',
  },
  visitButtonText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  visitButtonIdleText: {
    color: GOLD_INK,
  },
  visitButtonDoneText: {
    color: STAMP,
  },
  directions: {
    color: BLUE,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '800',
  },
  actionDisabled: {
    opacity: 0.48,
  },
  stamp: {
    position: 'absolute',
    right: 15,
    top: 36,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: STAMP,
    paddingHorizontal: 11,
    paddingVertical: 5,
    backgroundColor: 'rgba(251,231,231,0.72)',
  },
  stampText: {
    color: STAMP,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
    fontFamily: 'Noto Serif KR',
  },
});
