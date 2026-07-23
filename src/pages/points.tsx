import { createRoute, ScrollViewInertialBackground } from '@granite-js/react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Loader, useDialog } from '@toss/tds-react-native';
import { BottomTabBar } from '../components/BottomTabBar';
import { PointDrawReceipt } from '../components/passport/PointDrawReceipt';
import { TicketBalanceVoucher } from '../components/passport/TicketBalanceVoucher';
import { TicketHistoryList } from '../components/passport/TicketHistoryList';
import { useAuth } from '../hooks/useAuth';
import {
  EXCHANGE_AMOUNT_RANGE_FALLBACK,
  exchangeTickets,
  getTicketConfig,
  getTicketHistory,
  getTickets,
  subscribeTicketCount,
  TICKETS_PER_EXCHANGE,
  type ExchangeAmountRange,
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

type PointDashboardSessionCache = {
  tickets: TicketInfo | null;
  ticketHistory: TicketHistoryResponse | null;
  balanceLoadError: boolean;
  historyLoadError: boolean;
  lastKnownTicketCount: number | null;
};

const pointDashboardSessionCache = new Map<string, PointDashboardSessionCache>();

function getDashboardCacheKey(isLoggedIn: boolean, userId?: string): string {
  return isLoggedIn && userId ? `user:${userId}` : 'guest';
}

const emptyDashboardCache = (): PointDashboardSessionCache => ({
  tickets: null,
  ticketHistory: null,
  balanceLoadError: false,
  historyLoadError: false,
  lastKnownTicketCount: null,
});

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
      // 컬렉션 탭 navTitle(34/41)과 통일 — 탭 간 위계가 달라 보이던 문제(2026-07-23).
      fontSize: 34,
      lineHeight: 41,
      fontWeight: '900',
      letterSpacing: -1,
      fontFamily: 'Noto Serif KR',
      marginTop: 5,
      marginBottom: 7,
    },
    navEyebrow: {
      color: '#A52822',
      fontSize: 10.5,
      lineHeight: 14,
      fontWeight: '900',
      letterSpacing: 1.6,
    },
    navSubtitle: {
      marginBottom: 20,
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
  const { isLoggedIn, user, isLoading: authLoading } = useAuth();
  const dashboardCacheKey = authLoading
    ? null
    : getDashboardCacheKey(isLoggedIn, user?.id);
  const cachedDashboard = dashboardCacheKey
    ? pointDashboardSessionCache.get(dashboardCacheKey) ?? null
    : null;
  const activeDashboardCacheKeyRef = useRef(dashboardCacheKey);
  activeDashboardCacheKeyRef.current = dashboardCacheKey;

  const [tickets, setTickets] = useState<TicketInfo | null>(() => cachedDashboard?.tickets ?? null);
  const [ticketHistory, setTicketHistory] = useState<TicketHistoryResponse | null>(
    () => cachedDashboard?.ticketHistory ?? null
  );
  const [loading, setLoading] = useState(() => cachedDashboard === null);
  const [refreshing, setRefreshing] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [balanceLoadError, setBalanceLoadError] = useState(
    () => cachedDashboard?.balanceLoadError ?? false
  );
  const [historyLoadError, setHistoryLoadError] = useState(
    () => cachedDashboard?.historyLoadError ?? false
  );
  const [renderedDashboardKey, setRenderedDashboardKey] = useState<string | null>(
    () => dashboardCacheKey
  );
  const [lastKnownTicketCount, setLastKnownTicketCount] = useState<number | null>(
    () => cachedDashboard?.lastKnownTicketCount ?? null
  );
  // 뽑기 결과 영수증(시안 collection-sets-v1 ③). 금액·회차는 서버 응답값 그대로(비권위 표시 전용).
  const [drawResult, setDrawResult] = useState<{
    amount: number;
    drawNo: number | null;
    drawnAt: Date;
  } | null>(null);
  const [amountRange, setAmountRange] = useState<ExchangeAmountRange>(EXCHANGE_AMOUNT_RANGE_FALLBACK);

  useEffect(() => {
    let mounted = true;
    getTicketConfig()
      .then((config) => {
        if (mounted && config.exchangeAmount) setAmountRange(config.exchangeAmount);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const commitDashboard = useCallback((
    cacheKey: string,
    update: (previous: PointDashboardSessionCache) => PointDashboardSessionCache
  ) => {
    const next = update(pointDashboardSessionCache.get(cacheKey) ?? emptyDashboardCache());
    pointDashboardSessionCache.set(cacheKey, next);
    if (activeDashboardCacheKeyRef.current !== cacheKey) return;
    setTickets(next.tickets);
    setTicketHistory(next.ticketHistory);
    setBalanceLoadError(next.balanceLoadError);
    setHistoryLoadError(next.historyLoadError);
    setLastKnownTicketCount(next.lastKnownTicketCount);
  }, []);

  const applyDashboard = useCallback((cacheKey: string, result: PointDashboardLoadResult) => {
    commitDashboard(cacheKey, (previous) => ({
      tickets: result.tickets ?? previous.tickets,
      ticketHistory: result.history ?? previous.ticketHistory,
      balanceLoadError: result.balanceLoadFailed,
      historyLoadError: result.historyLoadFailed,
      lastKnownTicketCount: result.tickets?.ticketCount
        ?? result.history?.ticketCount
        ?? previous.lastKnownTicketCount,
    }));
  }, [commitDashboard]);

  const load = useCallback(async (cacheKey: string) => {
    try {
      const result = await loadPointDashboard(getTickets, getTicketHistory);
      applyDashboard(cacheKey, result);
    } catch {
      commitDashboard(cacheKey, (previous) => ({
        ...previous,
        balanceLoadError: true,
        historyLoadError: true,
      }));
    } finally {
      if (activeDashboardCacheKeyRef.current === cacheKey) setLoading(false);
    }
  }, [applyDashboard, commitDashboard]);

  useEffect(() => {
    if (!dashboardCacheKey) return;

    const cached = pointDashboardSessionCache.get(dashboardCacheKey);
    setRenderedDashboardKey(dashboardCacheKey);
    if (cached) {
      setTickets(cached.tickets);
      setTicketHistory(cached.ticketHistory);
      setBalanceLoadError(cached.balanceLoadError);
      setHistoryLoadError(cached.historyLoadError);
      setLastKnownTicketCount(cached.lastKnownTicketCount);
      setLoading(false);
    } else {
      setTickets(null);
      setTicketHistory(null);
      setBalanceLoadError(false);
      setHistoryLoadError(false);
      setLastKnownTicketCount(null);
      setLoading(true);
    }

    load(dashboardCacheKey);
  }, [dashboardCacheKey, load]);

  useEffect(() => {
    if (!dashboardCacheKey) return;
    return subscribeTicketCount((ticketCount) => {
      commitDashboard(dashboardCacheKey, (previous) => ({
        ...previous,
        tickets: previous.tickets ? { ...previous.tickets, ticketCount } : null,
        ticketHistory: previous.ticketHistory
          ? { ...previous.ticketHistory, ticketCount }
          : null,
        lastKnownTicketCount: ticketCount,
      }));
    });
  }, [commitDashboard, dashboardCacheKey]);

  const refresh = useCallback(async () => {
    if (!dashboardCacheKey) return;
    setRefreshing(true);
    try {
      await load(dashboardCacheKey);
    } finally {
      setRefreshing(false);
    }
  }, [dashboardCacheKey, load]);

  const handleExchange = useCallback(async () => {
    if (!dashboardCacheKey) return;
    const currentTicketCount = resolveTicketCount(tickets, ticketHistory, lastKnownTicketCount);
    const ticketsPerExchange = tickets?.ticketsPerExchange ?? TICKETS_PER_EXCHANGE;

    if (exchanging || currentTicketCount < ticketsPerExchange) return;

    setExchanging(true);
    try {
      const result = await exchangeTickets();
      if (!result.success) {
        throw new Error('EXCHANGE_NOT_CONFIRMED');
      }

      commitDashboard(dashboardCacheKey, (previous) => ({
        ...previous,
        tickets: previous.tickets
          ? { ...previous.tickets, ticketCount: result.ticketCount }
          : {
              ticketCount: result.ticketCount,
              totalEarned: 0,
              totalExchanged: 0,
              ticketsPerExchange,
            },
        balanceLoadError: false,
        lastKnownTicketCount: result.ticketCount,
      }));

      try {
        const nextDashboard = await loadPointDashboard(getTickets, getTicketHistory);
        applyDashboard(dashboardCacheKey, nextDashboard);
      } catch {
        commitDashboard(dashboardCacheKey, (previous) => ({
          ...previous,
          balanceLoadError: true,
          historyLoadError: true,
        }));
      }

      setDrawResult({
        amount: result.amount,
        drawNo: result.totalExchanged ?? null,
        drawnAt: new Date(),
      });
    } catch {
      await dialog.openAlert({
        title: '교환을 완료하지 못했어요',
        description: '토스포인트 지급이 확인되지 않아 티켓을 차감하지 않았어요. 잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setExchanging(false);
    }
  }, [applyDashboard, commitDashboard, dashboardCacheKey, dialog, exchanging, lastKnownTicketCount, ticketHistory, tickets]);

  const ticketCount = resolveTicketCount(tickets, ticketHistory, lastKnownTicketCount);
  const ticketsPerExchange = tickets?.ticketsPerExchange ?? TICKETS_PER_EXCHANGE;
  const historyItems = ticketHistory?.history ?? [];
  const showInitialLoading = authLoading
    || dashboardCacheKey !== renderedDashboardKey
    || (loading && !tickets && !ticketHistory);

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

        <Text style={styles.navEyebrow}>CULTURE CARD REWARDS</Text>
        <Text style={styles.navTitle}>문화 리워드</Text>
        <Text style={styles.navSubtitle}>카드를 열어 모은 티켓 {ticketsPerExchange}장으로 포인트를 뽑아요.</Text>

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
              amountRange={amountRange}
            />
            <TicketHistoryList items={historyItems} loading={loading} error={historyLoadError} />
          </>
        )}
      </ScrollView>
      <BottomTabBar currentTab="points" />
      {drawResult ? (
        <PointDrawReceipt
          amount={drawResult.amount}
          drawNo={drawResult.drawNo}
          usedTickets={ticketsPerExchange}
          ticketCount={ticketCount}
          ticketsPerExchange={ticketsPerExchange}
          drawnAt={drawResult.drawnAt}
          onClose={() => setDrawResult(null)}
        />
      ) : null}
    </View>
  );
}
