import { createRoute, ScrollViewInertialBackground } from '@granite-js/react-native';
import { useSafeAreaInsets } from '@granite-js/native/react-native-safe-area-context';
import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View, Text, TouchableOpacity, RefreshControl } from 'react-native';
import { Loader } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import http from '../../lib/http';

export const Route = createRoute('/mypage/tickets', {
  component: TicketHistoryPage,
});

type Adaptive = ReturnType<typeof useAdaptive>;

interface HistoryItem {
  type: 'ad' | 'attendance' | 'bonus' | 'exchange';
  label: string;
  amount: number;
  occurredAt: string;
}

interface TicketHistory {
  ticketCount: number;
  totalExchanged: number;
  history: HistoryItem[];
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function createStyles(a: Adaptive) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: a.grey100 },
    scrollView: { flex: 1 },
    header: {
      backgroundColor: a.background,
      paddingHorizontal: 20,
      paddingVertical: 16,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: a.grey200,
    },
    backButton: { marginRight: 12, padding: 4 },
    backText: { fontSize: 18, color: a.grey700 },
    headerTitle: { fontSize: 18, fontWeight: '700', color: a.grey900 },
    summaryCard: {
      backgroundColor: a.background,
      marginTop: 16,
      marginHorizontal: 20,
      borderRadius: 16,
      padding: 24,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 12,
      elevation: 3,
    },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    summaryItem: { flex: 1, alignItems: 'center' },
    summaryDivider: { width: 1, backgroundColor: a.grey200 },
    summaryValue: { fontSize: 28, fontWeight: '700', color: a.blue500, marginBottom: 6 },
    summaryLabel: { fontSize: 13, color: a.grey500 },
    section: { marginTop: 24, marginHorizontal: 20 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: a.grey900, marginBottom: 12 },
    historyList: {
      backgroundColor: a.background,
      borderRadius: 12,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.04,
      shadowRadius: 8,
      elevation: 2,
    },
    historyItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: a.grey100,
    },
    historyIconBox: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: a.grey100,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    historyIcon: { fontSize: 16 },
    historyInfo: { flex: 1 },
    historyLabel: { fontSize: 14, fontWeight: '600', color: a.grey900 },
    historyDate: { fontSize: 12, color: a.grey400, marginTop: 2 },
    historyAmount: { fontSize: 15, fontWeight: '700' },
    amountPositive: { color: a.blue500 },
    amountNegative: { color: a.grey500 },
    emptyContainer: {
      backgroundColor: a.background,
      borderRadius: 12,
      paddingVertical: 48,
      alignItems: 'center',
    },
    emptyText: { fontSize: 14, color: a.grey400, marginTop: 8 },
    loadingContainer: {
      backgroundColor: a.background,
      borderRadius: 12,
      paddingVertical: 40,
      alignItems: 'center',
    },
  });
}

const TYPE_ICON: Record<string, string> = {
  ad: '📺',
  attendance: '✅',
  bonus: '🎁',
  exchange: '💰',
};

function TicketHistoryPage() {
  const navigation = Route.useNavigation();
  const { top } = useSafeAreaInsets();
  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);

  const [data, setData] = useState<TicketHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: res } = await http.get<TicketHistory>('/api/tickets/history');
      setData(res);
    } catch (e) {
      // 에러 시 기존 데이터 유지
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <ScrollViewInertialBackground topColor={adaptive.background} bottomColor={adaptive.grey100} />

        {/* 헤더 */}
        <View style={[styles.header, { paddingTop: top + 16 }]}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={styles.backText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>티켓 내역</Text>
        </View>

        {/* 요약 카드 */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>🎟 {data?.ticketCount ?? '-'}</Text>
              <Text style={styles.summaryLabel}>현재 보유 티켓</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{data?.totalExchanged ?? '-'}원</Text>
              <Text style={styles.summaryLabel}>누적 교환 포인트</Text>
            </View>
          </View>
        </View>

        {/* 내역 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>최근 3개월 내역</Text>

          {loading ? (
            <View style={styles.loadingContainer}>
              <Loader size="small" customStrokeColor={adaptive.grey400} />
            </View>
          ) : !data || data.history.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={{ fontSize: 32 }}>🎟</Text>
              <Text style={styles.emptyText}>아직 내역이 없어요.</Text>
            </View>
          ) : (
            <View style={styles.historyList}>
              {data.history.map((item, idx) => (
                <View key={idx} style={styles.historyItem}>
                  <View style={styles.historyIconBox}>
                    <Text style={styles.historyIcon}>{TYPE_ICON[item.type] ?? '🎟'}</Text>
                  </View>
                  <View style={styles.historyInfo}>
                    <Text style={styles.historyLabel}>{item.label}</Text>
                    <Text style={styles.historyDate}>{formatDate(item.occurredAt)}</Text>
                  </View>
                  <Text style={[
                    styles.historyAmount,
                    item.amount > 0 ? styles.amountPositive : styles.amountNegative,
                  ]}>
                    {item.amount > 0 ? `+${item.amount}` : item.amount}개
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>
    </View>
  );
}
