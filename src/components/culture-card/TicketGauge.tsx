/**
 * 티켓 게이지 — 10칸 = 포인트 뽑기 1회 (draw-loop-v1 시안 gauge-wrap).
 * "광고 10번 = 포인트 뽑기 1번"이 홈 상단에서 바로 읽히게 한다.
 * 헤더의 티켓칩을 대체하며, 탭하면 포인트(교환) 화면으로 이동한다.
 */
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { getTicketGaugeState } from './homeLogic';

const CELL_LINE = '#4A4234';
const CREAM = '#E5D8BB';
const SUB = '#8B8071';
const SUB_STRONG = '#D9CBA8';
const ACCENT = '#D96A4C';

const MONO_FAMILY = Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' });

interface TicketGaugeProps {
  ticketCount: number;
  dailyOpenCount: number;
  onPress: () => void;
}

export function TicketGauge({ ticketCount, dailyOpenCount, onPress }: TicketGaugeProps) {
  const gauge = getTicketGaugeState(ticketCount, dailyOpenCount);
  const cells = Array.from({ length: gauge.total }, (_, index) => index < gauge.filled);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`보유 티켓 ${ticketCount}장. ${gauge.subtitle}`}
      accessibilityHint="포인트 뽑기 화면으로 이동해요"
      onPress={onPress}
      style={({ pressed }) => [styles.wrap, pressed ? styles.wrapPressed : null]}
    >
      <View style={styles.row}>
        <View style={styles.gauge}>
          {cells.map((filled, index) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: 고정 10칸 게이지라 순서가 곧 정체성이다
              key={index}
              style={[styles.cell, filled ? styles.cellFill : null]}
            />
          ))}
        </View>
        <Text allowFontScaling={false} style={styles.count}>{gauge.countLabel}</Text>
      </View>
      <View style={styles.subRow}>
        <Text style={[styles.subtitle, gauge.ready ? styles.subtitleReady : null]} numberOfLines={1}>
          {gauge.subtitle}
        </Text>
        {gauge.ready ? <Text style={styles.readyCta}>뽑기 ›</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 4,
  },
  wrapPressed: {
    opacity: 0.75,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gauge: {
    flex: 1,
    flexDirection: 'row',
    gap: 3,
  },
  cell: {
    flex: 1,
    height: 14,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: CELL_LINE,
  },
  cellFill: {
    backgroundColor: CREAM,
    borderColor: CREAM,
  },
  count: {
    fontFamily: MONO_FAMILY,
    fontSize: 13,
    fontWeight: '700',
    color: CREAM,
  },
  subRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  subtitle: {
    flexShrink: 1,
    color: SUB,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  subtitleReady: {
    color: SUB_STRONG,
    fontWeight: '800',
  },
  readyCta: {
    color: ACCENT,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
});
