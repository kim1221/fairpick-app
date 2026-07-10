/**
 * 포인트(돈) 화면 상단 잔액 카드 + 토스포인트 교환 CTA.
 * 시안(culturecard-flow-v1 ③): 네이비 잔액 카드("내가 모은 문화 티켓 N") +
 * "10티켓 = 토스포인트 교환 · 지금 M번 바꿀 수 있어요" + 토스블루 CTA + 안내 문구.
 *
 * 교환 로직(exchangeTickets 2-step)은 상위(points.tsx)가 소유하고, 여기선 표시/트리거만.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@toss/tds-react-native';

// 시안 네이비 잔액 카드 · 골드 · 토스블루
const NAVY_TOP = '#20304F';
const NAVY_MID = '#16233C';
const GOLD = '#CBA15E';
const GOLD_SOFT = '#DDB877';
const CARD_LABEL = '#AEBBD6';
const CARD_TITLE = '#F2ECDE';
const BLUE = '#3182F6';
const ON_BG_MUTED = '#9A8F77';

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
        <View style={styles.balanceHighlight} pointerEvents="none" />
        <Text style={styles.balanceLabel}>내가 모은 문화 티켓</Text>
        <View style={styles.balanceRow}>
          <Text style={styles.balanceNumber} allowFontScaling={false}>{ticketCount}</Text>
          <Text style={styles.balanceUnit}>티켓</Text>
        </View>
        <Text style={styles.balanceHelp}>{helpLine}</Text>
      </View>

      {/* 토스포인트로 바꾸기 */}
      <Button
        type="primary"
        size="big"
        viewStyle={styles.button}
        disabled={!canExchange || exchanging}
        onPress={onExchange}
      >
        {buttonLabel}
      </Button>

      <Text style={styles.exchangeInfo}>
        티켓 {per}장이 <Text style={styles.exchangeStrong}>토스포인트</Text>로 지급돼요 · 실제 돈처럼 써요
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  balanceCard: {
    position: 'relative',
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: NAVY_MID,
    borderWidth: 1,
    borderColor: 'rgba(203,161,94,0.30)',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.4,
    shadowRadius: 28,
    elevation: 9,
  },
  balanceHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '58%',
    backgroundColor: NAVY_TOP,
    opacity: 0.9,
  },
  balanceLabel: {
    color: CARD_LABEL,
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
    color: CARD_TITLE,
    fontSize: 44,
    lineHeight: 50,
    fontWeight: '900',
    letterSpacing: -1,
    fontFamily: 'Noto Serif KR',
  },
  balanceUnit: {
    color: GOLD_SOFT,
    fontSize: 18,
    fontWeight: '800',
  },
  balanceHelp: {
    marginTop: 12,
    color: GOLD,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '700',
  },
  button: {
    width: '100%',
    marginTop: 16,
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
