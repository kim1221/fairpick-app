import { createRoute, ScrollViewInertialBackground } from '@granite-js/react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Loader, useDialog } from '@toss/tds-react-native';
import { BottomTabBar } from '../components/BottomTabBar';
import { TicketBalanceVoucher } from '../components/passport/TicketBalanceVoucher';
import { TicketHistoryList } from '../components/passport/TicketHistoryList';
import {
  exchangeTickets,
  getLastKnownTicketCount,
  getTicketHistory,
  getTickets,
  subscribeTicketCount,
  TICKETS_PER_EXCHANGE,
  type TicketHistoryResponse,
  type TicketInfo,
} from '../services/ticketService';
import { loadPointDashboard, resolveTicketCount, type PointDashboardLoadResult } from './pointsLogic';

export const Route = createRoute('/points', {
  component: PointsPage,
});

const BG = '#F7F5EF';
const ON_BG = '#171717';
const ON_BG_MUTED = '#716D66';
const ERROR_BG = '#FFF0ED';

function createStyles() {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: BG,
    },
    scroll: {
      flex: 1,
    },
    content: {
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 124,
    },
    navTitle: {
      color: ON_BG,
      fontSize: 24,
      lineHeight: 31,
      fontWeight: '800',
      marginBottom: 4,
    },
    navSubtitle: {
      marginBottom: 18,
      color: ON_BG_MUTED,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: '600',
    },
    loadingBox: {
      minHeight: 240,
      alignItems: 'center',
      justifyContent: 'center',
    },
    loadingText: {
      marginTop: 12,
      color: ON_BG_MUTED,
      fontSize: 14,
      fontWeight: '700',
    },
    errorBox: {
      marginBottom: 14,
      borderRadius: 16,
      backgroundColor: ERROR_BG,
      borderWidth: 1,
      borderColor: '#FFD5CF',
      paddingHorizontal: 16,
      paddingVertical: 13,
    },
    errorTitle: {
      color: ON_BG,
      fontSize: 14,
      fontWeight: '900',
    },
    errorDescription: {
      marginTop: 4,
      color: ON_BG_MUTED,
      fontSize: 12,
      lineHeight: 18,
      fontWeight: '600',
    },
  });
}

function PointsPage() {
  const styles = useMemo(createStyles, []);
  const dialog = useDialog();

  const [tickets, setTickets] = useState<TicketInfo | null>(null);
  const [ticketHistory, setTicketHistory] = useState<TicketHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [balanceLoadError, setBalanceLoadError] = useState(false);
  const [historyLoadError, setHistoryLoadError] = useState(false);
  const [lastKnownTicketCount, setLastKnownTicketCount] = useState<number | null>(() => getLastKnownTicketCount());

  const applyDashboard = useCallback((result: PointDashboardLoadResult) => {
    if (result.tickets) setTickets(result.tickets);
    if (result.history) setTicketHistory(result.history);
    if (result.historyLoadFailed) setTicketHistory(null);
    setBalanceLoadError(result.balanceLoadFailed);
    setHistoryLoadError(result.historyLoadFailed);
  }, []);

  const load = useCallback(async () => {
    try {
      setBalanceLoadError(false);
      setHistoryLoadError(false);
      const result = await loadPointDashboard(getTickets, getTicketHistory);
      applyDashboard(result);
    } catch {
      setBalanceLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [applyDashboard]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => subscribeTicketCount(setLastKnownTicketCount), []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const handleExchange = useCallback(async () => {
    const currentTicketCount = resolveTicketCount(tickets, ticketHistory, lastKnownTicketCount);
    const ticketsPerExchange = tickets?.ticketsPerExchange ?? TICKETS_PER_EXCHANGE;

    if (exchanging || currentTicketCount < ticketsPerExchange) return;

    setExchanging(true);
    try {
      const result = await exchangeTickets();
      if (!result.success) {
        throw new Error('EXCHANGE_NOT_CONFIRMED');
      }

      setTickets((prev) => prev
        ? { ...prev, ticketCount: result.ticketCount }
        : {
            ticketCount: result.ticketCount,
            totalEarned: 0,
            totalExchanged: 0,
            ticketsPerExchange,
          });

      try {
        const nextDashboard = await loadPointDashboard(getTickets, getTicketHistory);
        applyDashboard(nextDashboard);
      } catch {
        setBalanceLoadError(true);
      }

      await dialog.openAlert({
        title: '토스포인트로 바꿨어요',
        description: '티켓 10장을 확인하고 교환을 완료했어요.',
      });
    } catch {
      await dialog.openAlert({
        title: '교환을 완료하지 못했어요',
        description: '토스포인트 지급이 확인되지 않아 티켓을 차감하지 않았어요. 잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setExchanging(false);
    }
  }, [applyDashboard, dialog, exchanging, lastKnownTicketCount, ticketHistory, tickets]);

  const ticketCount = resolveTicketCount(tickets, ticketHistory, lastKnownTicketCount);
  const ticketsPerExchange = tickets?.ticketsPerExchange ?? TICKETS_PER_EXCHANGE;
  const historyItems = ticketHistory?.history ?? [];
  const showInitialLoading = loading && !tickets && !ticketHistory;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={ON_BG_MUTED}
          />
        }
      >
        <ScrollViewInertialBackground topColor={BG} bottomColor={BG} />

        <Text style={styles.navTitle}>포인트</Text>
        <Text style={styles.navSubtitle}>문화 티켓을 모아 바로 쓸 수 있는 토스포인트로 바꿔요.</Text>

        {showInitialLoading ? (
          <View style={styles.loadingBox}>
            <Loader size="small" customStrokeColor={ON_BG_MUTED} />
            <Text style={styles.loadingText}>포인트 정보를 불러오고 있어요</Text>
          </View>
        ) : (
          <>
            {balanceLoadError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorTitle}>포인트 정보를 불러오지 못했어요</Text>
                <Text style={styles.errorDescription}>잠시 후 티켓 잔액과 내역을 다시 확인해 주세요.</Text>
              </View>
            ) : null}

            <TicketBalanceVoucher
              ticketCount={ticketCount}
              ticketsPerExchange={ticketsPerExchange}
              exchanging={exchanging}
              onExchange={handleExchange}
            />
            <TicketHistoryList items={historyItems} loading={loading} error={historyLoadError} />
          </>
        )}
      </ScrollView>
      <BottomTabBar currentTab="points" />
    </View>
  );
}
