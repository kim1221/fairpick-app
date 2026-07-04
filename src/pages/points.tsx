import { createRoute, ScrollViewInertialBackground } from '@granite-js/react-native';
import { useSafeAreaInsets } from '@granite-js/native/react-native-safe-area-context';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Loader, useDialog } from '@toss/tds-react-native';
import { BottomTabBar } from '../components/BottomTabBar';
import { PassportCover } from '../components/passport/PassportCover';
import { StampGrid } from '../components/passport/StampGrid';
import { TicketBalanceVoucher } from '../components/passport/TicketBalanceVoucher';
import { TicketHistoryList } from '../components/passport/TicketHistoryList';
import { TAG_TOKENS } from '../components/culture-card/tagKit';
import { getPassport, type PassportResponse } from '../services/passportService';
import {
  exchangeTickets,
  getTicketHistory,
  getTickets,
  TICKETS_PER_EXCHANGE,
  type TicketHistoryResponse,
  type TicketInfo,
} from '../services/ticketService';

export const Route = createRoute('/points', {
  component: PointsPage,
});

const BG = TAG_TOKENS.bg;
const ON_BG = TAG_TOKENS.headText;
const ON_BG_MUTED = TAG_TOKENS.navSub;
const ERROR_BG = '#2A2222';

// stamps(내림차순)에서 가장 오래된 방문 월 → "2026.3부터" 라벨
function deriveSinceLabel(stamps: PassportResponse['stamps']): string | null {
  const oldest = stamps[stamps.length - 1];
  if (!oldest) return null;
  const date = new Date(oldest.visitedAt);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}.${date.getMonth() + 1}부터`;
}

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
      paddingBottom: 132,
    },
    navTitle: {
      color: ON_BG,
      fontSize: 24,
      lineHeight: 31,
      fontWeight: '800',
      fontFamily: 'Noto Serif KR',
      marginBottom: 14,
    },
    sectionLabel: {
      marginTop: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    sectionLabelText: {
      color: ON_BG_MUTED,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 2,
    },
    sectionLabelCount: {
      color: ON_BG_MUTED,
      fontSize: 11.5,
      fontWeight: '700',
    },
    exchangeLabel: {
      marginTop: 26,
      color: ON_BG_MUTED,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 2,
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
      borderColor: '#473131',
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
  const { top } = useSafeAreaInsets();
  const navigation = Route.useNavigation();
  const styles = useMemo(createStyles, []);
  const dialog = useDialog();

  const [passport, setPassport] = useState<PassportResponse | null>(null);
  const [tickets, setTickets] = useState<TicketInfo | null>(null);
  const [ticketHistory, setTicketHistory] = useState<TicketHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoadError(false);
      const [nextPassport, nextTickets, nextHistory] = await Promise.all([
        getPassport(),
        getTickets(),
        getTicketHistory(),
      ]);
      setPassport(nextPassport);
      setTickets(nextTickets);
      setTicketHistory(nextHistory);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const handleStampPress = useCallback((eventId: string) => {
    navigation.navigate('/events/:id', { id: eventId });
  }, [navigation]);

  const handleExchange = useCallback(async () => {
    const currentTicketCount = tickets?.ticketCount ?? ticketHistory?.ticketCount ?? 0;
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
        const [nextTickets, nextHistory] = await Promise.all([getTickets(), getTicketHistory()]);
        setTickets(nextTickets);
        setTicketHistory(nextHistory);
      } catch {
        setLoadError(true);
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
  }, [dialog, exchanging, ticketHistory?.ticketCount, tickets?.ticketCount, tickets?.ticketsPerExchange]);

  const ticketCount = tickets?.ticketCount ?? ticketHistory?.ticketCount ?? 0;
  const ticketsPerExchange = tickets?.ticketsPerExchange ?? TICKETS_PER_EXCHANGE;
  const historyItems = ticketHistory?.history ?? [];
  const showInitialLoading = loading && !passport && !tickets && !ticketHistory;

  const stamps = passport?.stamps ?? [];
  const visitedCount = passport?.visitedCount ?? 0;
  const sinceLabel = useMemo(() => deriveSinceLabel(stamps), [stamps]);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: top + 18 }]}
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

        <Text style={styles.navTitle}>내 문화</Text>

        {showInitialLoading ? (
          <View style={styles.loadingBox}>
            <Loader size="small" customStrokeColor={ON_BG_MUTED} />
            <Text style={styles.loadingText}>내 문화 정보를 불러오고 있어요</Text>
          </View>
        ) : (
          <>
            {loadError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorTitle}>내 문화 정보를 불러오지 못했어요</Text>
                <Text style={styles.errorDescription}>잠시 후 여권과 티켓 잔액을 다시 확인해 주세요.</Text>
              </View>
            ) : null}

            <PassportCover visitedCount={visitedCount} sinceLabel={sinceLabel} />

            <View style={styles.sectionLabel}>
              <Text style={styles.sectionLabelText}>STAMPS · 다녀온 문화</Text>
              <Text style={styles.sectionLabelCount}>{visitedCount}개</Text>
            </View>
            <StampGrid stamps={stamps} onPressStamp={handleStampPress} />

            <Text style={styles.exchangeLabel}>티켓 교환</Text>
            <TicketBalanceVoucher
              ticketCount={ticketCount}
              ticketsPerExchange={ticketsPerExchange}
              exchanging={exchanging}
              onExchange={handleExchange}
            />
            <TicketHistoryList items={historyItems} loading={loading} />
          </>
        )}
      </ScrollView>
      <BottomTabBar currentTab="points" />
    </View>
  );
}
