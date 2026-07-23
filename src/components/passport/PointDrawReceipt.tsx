/**
 * 포인트 뽑기 결과 영수증 오버레이 (시안 culturecard-collection-sets-v1 ③).
 * 크림 영수증 + 레드 러버스탬프 금액 + 정직 고지(평균·범위 중심, 과장 금지 — 스펙 §2.4·§7).
 *
 * 금액은 서버가 추첨해 내려준 값(비권위 표시 전용). 여기서 계산하지 않는다.
 * 지그재그 절취선 = 보더 삼각형 트릭(SVG 불필요), 모노 폰트 = 시스템 폰트만 사용.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

const SCRIM = 'rgba(12,9,6,0.94)';
const CREAM = '#F3EDDD';
const NAVY = '#2A386A';
const RED = '#A8331F';
const INK = '#2B2620';
const INK_MUTED = '#6F6B60';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export interface PointDrawReceiptProps {
  amount: number;
  drawNo: number | null;
  usedTickets: number;
  ticketCount: number;
  ticketsPerExchange: number;
  drawnAt: Date;
  onClose: () => void;
}

export function formatReceiptDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDrawNo(drawNo: number | null): string {
  if (drawNo == null || !Number.isFinite(drawNo) || drawNo <= 0) return '—';
  return String(Math.floor(drawNo)).padStart(4, '0');
}

/** 다음 뽑기 안내 문구 + 게이지 채움 수 (정보 제공형 — 압박 문구 금지, 스펙 §7) */
export function nextDrawStatus(
  ticketCount: number,
  ticketsPerExchange: number
): { label: string; filled: number } {
  const per = ticketsPerExchange > 0 ? ticketsPerExchange : 10;
  if (ticketCount >= per) {
    return { label: '티켓이 충분해요 · 한 번 더 뽑을 수 있어요', filled: per };
  }
  const cycle = ((ticketCount % per) + per) % per;
  return { label: `다음 뽑기까지 티켓 ${per - cycle}장`, filled: cycle };
}

function DashedRule() {
  return (
    <View style={styles.dashedClip}>
      <View style={styles.dashedLine} />
    </View>
  );
}

function ZigzagEdge() {
  return (
    <View style={styles.zigzagRow} pointerEvents="none">
      {Array.from({ length: 26 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative teeth
        <View key={index} style={styles.zigzagTooth} />
      ))}
    </View>
  );
}

export function PointDrawReceipt({
  amount,
  drawNo,
  usedTickets,
  ticketCount,
  ticketsPerExchange,
  drawnAt,
  onClose,
}: PointDrawReceiptProps) {
  const stampScale = useRef(new Animated.Value(1.7)).current;
  const stampOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(stampScale, {
        toValue: 1,
        friction: 5,
        tension: 120,
        useNativeDriver: true,
      }),
      Animated.timing(stampOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [stampOpacity, stampScale]);

  const per = ticketsPerExchange > 0 ? ticketsPerExchange : 10;
  const next = nextDrawStatus(ticketCount, per);

  return (
    <View style={styles.overlay}>
      <Text style={styles.overlayKicker}>POINT DRAW</Text>

      <View style={styles.receiptWrap}>
        <View style={styles.receipt}>
          <Text style={styles.receiptTitle}>POINT DRAW</Text>
          <Text style={styles.receiptSub}>CULTURE CARD · REDEEM RECEIPT</Text>

          <DashedRule />

          <View style={styles.metaRow}>
            <Text style={styles.metaKey}>DATE</Text>
            <Text style={styles.metaValue}>{formatReceiptDate(drawnAt)}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaKey}>USED</Text>
            <Text style={styles.metaValue}>티켓 {usedTickets}장</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaKey}>DRAW Nº</Text>
            <Text style={styles.metaValue}>{formatDrawNo(drawNo)}</Text>
          </View>

          <DashedRule />

          <Animated.View
            style={[styles.stamp, { opacity: stampOpacity, transform: [{ rotate: '-5deg' }, { scale: stampScale }] }]}
          >
            <Text style={styles.stampText} allowFontScaling={false}>₩{amount.toLocaleString()}</Text>
          </Animated.View>

          <Text style={styles.paidTitle}>토스포인트로 지급됐어요</Text>
          {/* 금액 범위·평균 고지는 뽑기 "전" 화면(리워드탭 바우처)이 담당 — 결과 영수증은
              실지급액이라는 사실만 담백하게(2026-07-23 피드백: 결과에까지 반복 설명 금지). */}
          <Text style={styles.finePrint}>지급 내역은 토스포인트에서 확인할 수 있어요</Text>
        </View>
        <ZigzagEdge />
      </View>

      <Pressable accessibilityRole="button" style={styles.confirmButton} onPress={onClose}>
        <Text style={styles.confirmText}>확인</Text>
      </Pressable>

      <Text style={styles.nextLabel}>{next.label}</Text>
      <View style={styles.nextGauge}>
        {Array.from({ length: per }, (_, index) => (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed gauge slots
            key={index}
            style={[styles.nextSlot, index < next.filled ? styles.nextSlotFilled : null]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    elevation: 40,
    backgroundColor: SCRIM,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  overlayKicker: {
    color: 'rgba(243,237,221,0.55)',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 6,
    fontFamily: MONO,
    marginBottom: 18,
  },
  receiptWrap: {
    alignSelf: 'stretch',
  },
  receipt: {
    backgroundColor: CREAM,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 20,
  },
  receiptTitle: {
    color: NAVY,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
    letterSpacing: 1,
    textAlign: 'center',
  },
  receiptSub: {
    marginTop: 6,
    marginBottom: 14,
    color: INK_MUTED,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    textAlign: 'center',
    fontFamily: MONO,
  },
  dashedClip: {
    height: 1,
    overflow: 'hidden',
    marginVertical: 12,
  },
  dashedLine: {
    height: 2,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(43,38,32,0.35)',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  metaKey: {
    color: INK_MUTED,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontFamily: MONO,
  },
  metaValue: {
    color: INK,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontFamily: MONO,
  },
  stamp: {
    alignSelf: 'center',
    marginTop: 18,
    marginBottom: 14,
    borderWidth: 4,
    borderColor: RED,
    borderRadius: 8,
    paddingHorizontal: 22,
    paddingVertical: 8,
    opacity: 0.92,
  },
  stampText: {
    color: RED,
    fontSize: 46,
    lineHeight: 54,
    fontWeight: '900',
    letterSpacing: 1,
  },
  paidTitle: {
    color: INK,
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 10,
  },
  finePrint: {
    color: INK_MUTED,
    fontSize: 11.5,
    lineHeight: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  zigzagRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  zigzagTooth: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: CREAM,
  },
  confirmButton: {
    alignSelf: 'stretch',
    marginTop: 22,
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: CREAM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: {
    color: INK,
    fontSize: 16,
    fontWeight: '900',
  },
  nextLabel: {
    marginTop: 16,
    color: 'rgba(243,237,221,0.72)',
    fontSize: 12.5,
    fontWeight: '700',
  },
  nextGauge: {
    alignSelf: 'stretch',
    marginTop: 10,
    flexDirection: 'row',
    gap: 5,
  },
  nextSlot: {
    flex: 1,
    height: 8,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(243,237,221,0.4)',
  },
  nextSlotFilled: {
    backgroundColor: CREAM,
    borderColor: CREAM,
  },
});
