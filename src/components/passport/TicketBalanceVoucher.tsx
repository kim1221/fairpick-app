/**
 * 포인트(돈) 화면 상단 잔액 카드 + 토스포인트 교환 CTA.
 * 시안(culturecard-flow-v1 ③): 네이비 잔액 카드("내가 모은 문화 티켓 N") +
 * "10티켓 = 토스포인트 교환 · 지금 M번 바꿀 수 있어요" + 토스블루 CTA + 안내 문구.
 *
 * 교환 로직(exchangeTickets 2-step)은 상위(points.tsx)가 소유하고, 여기선 표시/트리거만.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const BLUE = '#3182F6';
const ON_BG_MUTED = '#716D66';

export interface TicketBalanceVoucherProps {
  ticketCount: number;
  ticketsPerExchange: number;
  exchanging: boolean;
  onExchange: () => void;
}

export function TicketBalanceVoucher({
  ticketCount,
  ticketsPerExchange,
  exchanging,
  onExchange,
}: TicketBalanceVoucherProps) {
  const per = ticketsPerExchange > 0 ? ticketsPerExchange : 10;
  const exchangeableTimes = Math.floor(ticketCount / per);
  const canExchange = exchangeableTimes >= 1;
  const remainingTickets = Math.max(per - (ticketCount % per), 0);
  const cycleTickets = ticketCount % per || (canExchange ? per : 0);

  const helpLine = canExchange
    ? `${per}티켓 = 토스포인트 교환 · 지금 ${exchangeableTimes}번 바꿀 수 있어요`
    : `${per}티켓 = 토스포인트 교환 · ${remainingTickets}장만 더 모으면 돼요`;

  const buttonLabel = exchanging
    ? '바꾸고 있어요'
    : canExchange
      ? '토스포인트로 바꾸기'
      : `${remainingTickets}장 더 모으기`;

  return (
    <View>
      {/* 큰 잔액 카드(네이비) */}
      <View style={styles.balanceCard}>
        <View style={styles.ticketStub} pointerEvents="none">
          <Text style={styles.ticketStubText}>CULTURE CARD</Text>
        </View>
        <View style={[styles.ticketNotch, styles.ticketNotchTop]} pointerEvents="none" />
        <View style={[styles.ticketNotch, styles.ticketNotchBottom]} pointerEvents="none" />
        <Text style={styles.balanceWatermark} pointerEvents="none">CC</Text>
        <View style={styles.balanceHeader}>
          <Text style={styles.balanceLabel}>내 문화 티켓</Text>
          <View style={styles.exchangeBadge}>
            <Text style={styles.exchangeBadgeText}>{exchangeableTimes}회 교환 가능</Text>
          </View>
        </View>
        <View style={styles.balanceRow}>
          <Text style={styles.balanceNumber} allowFontScaling={false}>{ticketCount}</Text>
          <Text style={styles.balanceUnit}>티켓</Text>
        </View>
        <View style={styles.nextRewardRow}>
          <Text style={styles.nextRewardText}>{canExchange ? '지금 바로 교환할 수 있어요' : `다음 포인트까지 ${remainingTickets}티켓`}</Text>
          <Text style={styles.nextRewardCount}>{Math.min(cycleTickets, per)} / {per}</Text>
        </View>
        <View style={styles.ticketDots}>
          {Array.from({ length: per }, (_, index) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed reward punch positions
              key={index}
              style={[styles.ticketDot, index < cycleTickets ? styles.ticketDotFilled : null]}
            />
          ))}
        </View>
        <Text style={styles.balanceHelp}>{helpLine}</Text>
      </View>

      {/* 토스포인트로 바꾸기 */}
      <Pressable
        accessibilityRole="button"
        style={[styles.button, !canExchange || exchanging ? styles.buttonDisabled : null]}
        disabled={!canExchange || exchanging}
        onPress={onExchange}
      >
        <Text style={[styles.buttonText, !canExchange || exchanging ? styles.buttonTextDisabled : null]}>{buttonLabel}</Text>
        <Text style={[styles.buttonArrow, !canExchange || exchanging ? styles.buttonTextDisabled : null]}>→</Text>
      </Pressable>

      <Text style={styles.exchangeInfo}>
        티켓 {per}장이 <Text style={styles.exchangeStrong}>토스포인트</Text>로 지급돼요 · 실제 돈처럼 써요
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  balanceCard: {
    position: 'relative',
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: '#F1ECDE',
    borderWidth: 1,
    borderColor: '#D8D0C0',
    borderRadius: 13,
    paddingLeft: 92,
    paddingRight: 20,
    paddingTop: 18,
    paddingBottom: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 4,
  },
  ticketStub: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 68,
    bottom: 0,
    backgroundColor: '#A52822',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ticketStubText: {
    color: '#FFFFFF',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 1.5,
    transform: [{ rotate: '-90deg' }],
    width: 120,
    textAlign: 'center',
  },
  ticketNotch: {
    position: 'absolute',
    right: -10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#F7F5EF',
  },
  ticketNotchTop: {
    top: -10,
  },
  ticketNotchBottom: {
    bottom: -10,
  },
  balanceWatermark: {
    position: 'absolute',
    right: -12,
    top: 50,
    color: 'rgba(165,40,34,0.06)',
    fontSize: 78,
    lineHeight: 84,
    fontWeight: '900',
    letterSpacing: -5,
  },
  balanceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  balanceLabel: {
    color: '#6F6B65',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  balanceRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  balanceNumber: {
    color: '#171717',
    fontSize: 44,
    lineHeight: 50,
    fontWeight: '900',
    letterSpacing: -1,
  },
  balanceUnit: {
    color: '#A52822',
    fontSize: 18,
    fontWeight: '800',
  },
  balanceHelp: {
    marginTop: 10,
    color: '#6F6B65',
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '700',
  },
  exchangeBadge: {
    borderRadius: 0,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  exchangeBadgeText: {
    color: '#171717',
    fontSize: 11,
    fontWeight: '900',
  },
  nextRewardRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nextRewardText: {
    color: '#171717',
    fontSize: 12.5,
    fontWeight: '800',
  },
  nextRewardCount: {
    color: '#A52822',
    fontSize: 12,
    fontWeight: '900',
  },
  ticketDots: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 5,
  },
  ticketDot: {
    flex: 1,
    height: 9,
    borderRadius: 999,
    backgroundColor: '#D5D0C7',
  },
  ticketDotFilled: {
    backgroundColor: '#A52822',
  },
  button: {
    width: '100%',
    marginTop: 16,
    minHeight: 58,
    backgroundColor: '#A52822',
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  buttonDisabled: {
    backgroundColor: '#D8D3C7',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
  },
  buttonArrow: {
    color: '#FFFFFF',
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '500',
  },
  buttonTextDisabled: {
    color: '#8A857D',
  },
  exchangeInfo: {
    marginTop: 12,
    color: ON_BG_MUTED,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    fontWeight: '700',
  },
  exchangeStrong: {
    color: BLUE,
    fontWeight: '900',
  },
});
