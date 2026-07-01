import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@toss/tds-react-native';

const PAPER = '#F5F1E8';
const PAPER_EDGE = '#E7E0D2';
const INK = '#16161A';
const MUTED = '#6B6760';
const BRONZE = '#B8924A';
const BRONZE_DARK = '#947231';
const BLUE = '#3182F6';
const PIP_COUNT = 10;

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
  const filledPips = Math.min(ticketCount, PIP_COUNT);
  const remainingTickets = Math.max(ticketsPerExchange - ticketCount, 0);
  const canExchange = ticketCount >= ticketsPerExchange;
  const buttonLabel = canExchange
    ? (exchanging ? '교환하고 있어요' : '토스포인트로 바꾸기')
    : `${remainingTickets}장 더 모으기`;

  return (
    <View style={styles.card}>
      <Text style={styles.label}>모은 티켓</Text>
      <View style={styles.balanceRow}>
        <Text style={styles.balanceNumber}>{ticketCount}</Text>
        <Text style={styles.balanceUnit}>/ {ticketsPerExchange} 티켓</Text>
      </View>

      <View style={styles.pipRow}>
        {Array.from({ length: PIP_COUNT }, (_, index) => (
          <View key={index} style={[styles.pip, index < filledPips && styles.pipFilled]} />
        ))}
      </View>

      <Text style={styles.helpText}>
        {canExchange
          ? '지금 토스포인트로 바꿀 수 있어요.'
          : `${remainingTickets}장만 더 모으면 토스포인트로 바꿀 수 있어요.`}
      </Text>

      <View style={styles.perforation}>
        <View style={styles.punchLeft} />
        <View style={styles.punchRight} />
      </View>

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
        10티켓 = <Text style={styles.exchangeStrong}>토스포인트 교환</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 18,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: PAPER,
    borderWidth: 1,
    borderColor: PAPER_EDGE,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.24,
    shadowRadius: 24,
    elevation: 7,
  },
  label: {
    color: BRONZE_DARK,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  balanceRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  balanceNumber: {
    color: INK,
    fontSize: 46,
    lineHeight: 52,
    fontWeight: '900',
    fontFamily: 'Noto Serif KR',
  },
  balanceUnit: {
    color: MUTED,
    fontSize: 16,
    fontWeight: '800',
  },
  pipRow: {
    marginTop: 18,
    flexDirection: 'row',
    gap: 5,
  },
  pip: {
    flex: 1,
    height: 10,
    borderRadius: 3,
    backgroundColor: '#E2DAC8',
  },
  pipFilled: {
    backgroundColor: BRONZE,
  },
  helpText: {
    marginTop: 14,
    color: '#54504A',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  perforation: {
    position: 'relative',
    marginHorizontal: -22,
    marginTop: 18,
    borderTopWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#CFC6B2',
  },
  punchLeft: {
    position: 'absolute',
    left: -11,
    top: -12,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: INK,
  },
  punchRight: {
    position: 'absolute',
    right: -11,
    top: -12,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: INK,
  },
  button: {
    width: '100%',
    marginTop: 18,
  },
  exchangeInfo: {
    marginTop: 11,
    color: MUTED,
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '700',
  },
  exchangeStrong: {
    color: BLUE,
    fontWeight: '900',
  },
});
