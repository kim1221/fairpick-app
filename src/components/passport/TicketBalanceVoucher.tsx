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

const GOLD = '#E5A62B';
const GOLD_SOFT = '#F6C861';
const CARD_LABEL = '#716D66';
const CARD_TITLE = '#171717';
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
  const progress = ticketCount % per === 0 && ticketCount > 0 ? 1 : (ticketCount % per) / per;

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
        <View style={styles.balanceAccent} pointerEvents="none" />
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
          <Text style={styles.nextRewardCount}>{Math.min(ticketCount % per || (canExchange ? per : 0), per)} / {per}</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
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
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DED9CF',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  },
  balanceAccent: {
    position: 'absolute',
    top: 0,
    left: 20,
    width: 52,
    height: 5,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
    backgroundColor: GOLD,
  },
  balanceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  },
  balanceUnit: {
    color: GOLD_SOFT,
    fontSize: 18,
    fontWeight: '800',
  },
  balanceHelp: {
    marginTop: 10,
    color: ON_BG_MUTED,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '700',
  },
  exchangeBadge: {
    borderRadius: 999,
    backgroundColor: '#EEF3FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  exchangeBadgeText: {
    color: '#3157D5',
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
    color: CARD_TITLE,
    fontSize: 12.5,
    fontWeight: '800',
  },
  nextRewardCount: {
    color: '#3157D5',
    fontSize: 12,
    fontWeight: '900',
  },
  progressTrack: {
    marginTop: 8,
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#E8E5DE',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#3157D5',
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
