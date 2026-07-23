import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon, Loader } from '@toss/tds-react-native';
import type { TicketHistoryItem } from '../../services/ticketService';

const LINE = '#E5E1D9';
const ON_INK = '#171717';
const ON_INK_MUTED = '#716D66';
const BRONZE = '#B8924A';
// 토스블루 대신 앱 네이비 — 리워드탭 색 통일(2026-07-23).
const NAVY = '#2A386A';

export interface TicketHistoryListProps {
  items: TicketHistoryItem[];
  loading: boolean;
  error?: boolean;
}

type HistoryMeta = {
  label: string;
  iconName: string;
  iconColor: string;
};

function getHistoryMeta(item: TicketHistoryItem): HistoryMeta {
  if (item.type === 'ad') {
    return { label: '광고 보고 카드 열기', iconName: 'icon-star-mono', iconColor: BRONZE };
  }
  if (item.type === 'visit' || item.type === 'stamp') {
    return { label: '다녀왔어요 도장', iconName: 'icon-check-mono', iconColor: BRONZE };
  }
  if (item.type === 'attendance') {
    return { label: '출석 체크', iconName: 'icon-calendar-mono', iconColor: BRONZE };
  }
  if (item.type === 'exchange') {
    return { label: '포인트 뽑기', iconName: 'icon-star-mono', iconColor: NAVY };
  }
  return { label: item.label, iconName: 'icon-star-mono', iconColor: item.amount >= 0 ? BRONZE : NAVY };
}

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((today - target) / 86_400_000);

  if (diffDays === 0) return '오늘';
  if (diffDays === 1) return '어제';
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function formatAmount(amount: number): string {
  if (amount > 0) return `+${amount} 티켓`;
  return `${amount} 티켓`;
}

export function TicketHistoryList({ items, loading, error = false }: TicketHistoryListProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionKicker}>TICKET LOG</Text>
      <Text style={styles.sectionTitle}>최근 티켓 기록</Text>

      <View style={styles.list}>
        {loading ? (
          <View style={styles.loadingBox}>
            <Loader size="small" customStrokeColor={ON_INK_MUTED} />
          </View>
        ) : error ? (
          <Text style={styles.emptyText}>최근 내역은 잠시 후 다시 확인해 주세요.</Text>
        ) : items.length === 0 ? (
          <Text style={styles.emptyText}>아직 티켓 내역이 없어요.</Text>
        ) : (
          items.slice(0, 20).map((item, index) => {
            const meta = getHistoryMeta(item);
            const isPositive = item.amount >= 0;

            return (
              <View key={`${item.type}-${item.occurredAt}-${index}`} style={styles.row}>
                <View style={styles.iconBox}>
                  <Icon name={meta.iconName} size={17} color={meta.iconColor} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {meta.label}
                  </Text>
                  <Text style={styles.rowDate}>
                    {item.type === 'exchange' && item.paidAmount != null
                      ? `${formatHistoryDate(item.occurredAt)} · ${item.paidAmount}원 지급`
                      : formatHistoryDate(item.occurredAt)}
                  </Text>
                </View>
                <Text style={[styles.amount, isPositive ? styles.amountPlus : styles.amountMinus]}>
                  {formatAmount(item.amount)}
                </Text>
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    marginTop: 4,
    marginBottom: 8,
    color: ON_INK,
    fontSize: 20,
    fontWeight: '900',
    fontFamily: 'Noto Serif KR',
  },
  sectionKicker: {
    color: '#A52822',
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  list: {
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: '#FBF9F4',
  },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: LINE,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: '#EFE9D8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    color: ON_INK,
    fontSize: 14,
    fontWeight: '800',
  },
  rowDate: {
    marginTop: 3,
    color: ON_INK_MUTED,
    fontSize: 12,
    fontWeight: '600',
  },
  amount: {
    minWidth: 64,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '900',
  },
  amountPlus: {
    color: '#A52822',
  },
  amountMinus: {
    color: NAVY,
  },
  emptyText: {
    paddingVertical: 28,
    color: ON_INK_MUTED,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    fontWeight: '700',
  },
  loadingBox: {
    paddingVertical: 30,
    alignItems: 'center',
  },
});
