import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import adminService, {
  AdminFeaturedEvent,
  AdminMetricsResponse,
  RewardReconciliationDailyStat,
  RewardReconciliationResponse,
  RewardsStatsResponse,
} from '../services/adminService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createRoute as any)('/admin', {
  component: Page,
});

function Page() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [events, setEvents] = useState<AdminFeaturedEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastCollection, setLastCollection] = useState<AdminMetricsResponse['lastCollection']>(null);
  const [isMetricsLoading, setIsMetricsLoading] = useState(false);
  const [rewardStats, setRewardStats] = useState<RewardsStatsResponse | null>(null);
  const [isRewardStatsLoading, setIsRewardStatsLoading] = useState(false);
  const [reconciliation, setReconciliation] = useState<RewardReconciliationResponse | null>(null);
  const [isReconciliationLoading, setIsReconciliationLoading] = useState(false);

  useEffect(() => {
    // Check if admin key exists in localStorage
    const checkAuth = async () => {
      const storedKey = adminService['getAdminKey']();
      if (storedKey) {
        const isValid = await adminService.verifyAdminKey(storedKey);
        if (isValid) {
          setIsAuthenticated(true);
          loadFeaturedEvents();
          loadAdminMetrics();
          loadRewardStats();
          loadReconciliation();
        } else {
          adminService.clearAdminKey();
        }
      }
    };
    checkAuth();
  }, []);

  const handleLogin = async () => {
    if (!adminKey.trim()) {
      Alert.alert('에러', 'Admin Key를 입력해주세요.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const isValid = await adminService.verifyAdminKey(adminKey);
      if (isValid) {
        adminService.setAdminKey(adminKey);
        setIsAuthenticated(true);
        loadFeaturedEvents();
        loadAdminMetrics();
        loadRewardStats();
        loadReconciliation();
      } else {
        Alert.alert('인증 실패', 'Invalid Admin Key');
      }
    } catch (error) {
      Alert.alert('에러', '인증에 실패했습니다.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const loadFeaturedEvents = async () => {
    setIsLoading(true);
    try {
      const response = await adminService.getFeaturedEvents();
      setEvents(response.items);
    } catch (error) {
      Alert.alert('에러', 'Featured 이벤트를 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadAdminMetrics = async () => {
    setIsMetricsLoading(true);
    try {
      const response = await adminService.getAdminMetrics();
      setLastCollection(response.lastCollection);
    } catch (error) {
      setLastCollection(null);
    } finally {
      setIsMetricsLoading(false);
    }
  };

  const loadRewardStats = async () => {
    setIsRewardStatsLoading(true);
    try {
      const response = await adminService.getRewardsStats(7);
      setRewardStats(response);
    } catch (error) {
      setRewardStats(null);
    } finally {
      setIsRewardStatsLoading(false);
    }
  };

  const loadReconciliation = async () => {
    setIsReconciliationLoading(true);
    try {
      const response = await adminService.getRewardReconciliation(30);
      setReconciliation(response);
    } catch (error) {
      setReconciliation(null);
    } finally {
      setIsReconciliationLoading(false);
    }
  };

  const handleRefresh = () => {
    loadFeaturedEvents();
    loadAdminMetrics();
    loadRewardStats();
    loadReconciliation();
  };

  const handleLogout = () => {
    adminService.clearAdminKey();
    setIsAuthenticated(false);
    setAdminKey('');
    setEvents([]);
    setLastCollection(null);
    setRewardStats(null);
    setReconciliation(null);
  };

  if (!isAuthenticated) {
    return (
      <View style={styles.loginContainer}>
        <View style={styles.loginBox}>
          <Text style={styles.loginTitle}>Admin Login</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter Admin Key"
            value={adminKey}
            onChangeText={setAdminKey}
            secureTextEntry
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handleLogin}
            disabled={isLoggingIn}
          >
            {isLoggingIn ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.buttonText}>Login</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Featured 이벤트 관리</Text>
        <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={handleLogout}>
          <Text style={styles.buttonText}>Logout</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.metricsBar}>
        <Text style={styles.metricsText}>
          {isMetricsLoading
            ? '최근 수집: 확인 중...'
            : formatLastCollection(lastCollection)}
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0064FF" />
        </View>
      ) : (
        <ScrollView style={styles.scrollView}>
          <TouchableOpacity style={[styles.button, styles.primaryButton, styles.refreshButton]} onPress={handleRefresh}>
            <Text style={styles.buttonText}>새로고침</Text>
          </TouchableOpacity>

          <RewardAdTelemetryPanel
            stats={rewardStats}
            isLoading={isRewardStatsLoading}
          />

          <RewardReconciliationPanel
            reconciliation={reconciliation}
            isLoading={isReconciliationLoading}
            onSaved={loadReconciliation}
          />

          {events.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>Featured 이벤트가 없습니다.</Text>
            </View>
          ) : (
            events.map((event) => <EventItem key={event.id} event={event} onUpdate={loadFeaturedEvents} />)
          )}
        </ScrollView>
      )}
    </View>
  );
}

function parseNullableInputNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNullableWon(value: number | null | undefined): string {
  if (value == null) return '-';
  return `${Math.round(value).toLocaleString()}원`;
}

function formatNullableRate(value: number | null | undefined): string {
  if (value == null) return '-';
  return `${value}%`;
}

function RewardAdTelemetryPanel({
  stats,
  isLoading,
}: {
  stats: RewardsStatsResponse | null;
  isLoading: boolean;
}) {
  const telemetry = stats?.adTelemetry;
  const summary = telemetry?.summary;
  const rows = telemetry?.dailyStats ?? [];

  return (
    <View style={styles.rewardPanel}>
      <View style={styles.rewardPanelHeader}>
        <Text style={styles.rewardPanelTitle}>리워드 광고 SDK 대조</Text>
        <Text style={styles.rewardPanelSubtitle}>
          최근 {stats?.period.days ?? 7}일 · 앱인토스 대시보드는 익일 오전 4시 이후 비교
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.rewardLoading}>
          <ActivityIndicator color="#0064FF" />
          <Text style={styles.rewardLoadingText}>확인 중...</Text>
        </View>
      ) : !summary ? (
        <Text style={styles.rewardEmptyText}>아직 광고 이벤트 로그가 없거나 조회에 실패했습니다.</Text>
      ) : (
        <>
          <View style={styles.rewardKpiGrid}>
            <RewardKpi label="SDK 시도" value={summary.attempts} sub="버튼 클릭 기준" />
            <RewardKpi label="SDK impression" value={summary.impressions} sub={`${summary.impressionRate}%`} />
            <RewardKpi label="SDK reward" value={summary.rewards} sub={`${summary.rewardToImpressionRate}%`} />
            <RewardKpi
              label="무노출 reward"
              value={summary.rewardsWithoutImpression}
              sub="0이 정상"
              danger={summary.rewardsWithoutImpression > 0}
            />
          </View>

          <View style={styles.rewardGuideBox}>
            <Text style={styles.rewardGuideText}>
              앱인토스 총 광고 노출 수는 아래 SDK impression과 같은 날짜, OS, 광고그룹 기준으로 비교하세요.
            </Text>
          </View>

          {rows.slice(0, 7).map((row) => (
            <View key={row.date} style={styles.rewardDailyRow}>
              <View style={styles.rewardDailyDateBox}>
                <Text style={styles.rewardDailyDate}>{row.date}</Text>
                <Text style={styles.rewardDailyRate}>노출률 {row.impressionRate}%</Text>
              </View>
              <View style={styles.rewardDailyMetrics}>
                <Text style={styles.rewardDailyMetric}>시도 {row.attempts}</Text>
                <Text style={styles.rewardDailyMetric}>노출 {row.impressions}</Text>
                <Text style={styles.rewardDailyMetric}>보상 {row.rewards}</Text>
                <Text
                  style={[
                    styles.rewardDailyMetric,
                    row.rewardsWithoutImpression > 0 && styles.rewardDangerText,
                  ]}
                >
                  무노출 {row.rewardsWithoutImpression}
                </Text>
              </View>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

function RewardReconciliationPanel({
  reconciliation,
  isLoading,
  onSaved,
}: {
  reconciliation: RewardReconciliationResponse | null;
  isLoading: boolean;
  onSaved: () => void;
}) {
  const rows = reconciliation?.dailyStats ?? [];
  const summary = reconciliation?.summary;

  return (
    <View style={styles.reconPanel}>
      <View style={styles.rewardPanelHeader}>
        <Text style={styles.rewardPanelTitle}>앱인토스 정산 대조</Text>
        <Text style={styles.rewardPanelSubtitle}>
          앱인토스 대시보드의 날짜별 노출/eCPM/최종정산액을 입력해 SDK 값과 비교합니다.
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.rewardLoading}>
          <ActivityIndicator color="#0064FF" />
          <Text style={styles.rewardLoadingText}>정산 대조 확인 중...</Text>
        </View>
      ) : !summary ? (
        <Text style={styles.rewardEmptyText}>정산 대조 데이터를 불러오지 못했습니다.</Text>
      ) : (
        <>
          <View style={styles.reconSummaryGrid}>
            <RewardKpi
              label="대시보드/SDK"
              value={summary.dashboardImpressions}
              sub={`SDK ${summary.sdkImpressions.toLocaleString()} · ${formatNullableRate(summary.dashboardToSdkImpressionRate)}`}
            />
            <RewardKpi
              label="예상 수익"
              value={Math.round(summary.dashboardEstimatedRevenueKrw)}
              sub={`보상비 ${formatNullableWon(summary.estimatedRewardCostKrw)}`}
            />
            <RewardKpi
              label="최종 수익"
              value={Math.round(summary.finalRevenueKrw)}
              sub={`손익 ${formatNullableWon(summary.finalGrossMarginKrw)}`}
              danger={summary.finalGrossMarginKrw < 0}
            />
            <RewardKpi
              label="사후 조정"
              value={Math.round(summary.finalAdjustmentKrw)}
              sub="최종-예상"
              danger={summary.finalAdjustmentKrw < 0}
            />
          </View>

          <View style={styles.rewardGuideBox}>
            <Text style={styles.rewardGuideText}>
              final revenue가 비어 있으면 아직 최종 정산 전입니다. 나중에 최종 정산액이 예상 수익보다 낮게 들어오면 사후 무효/차감 가능성이 있는 구간입니다.
            </Text>
          </View>

          {rows.slice(0, 10).map((row) => (
            <RewardReconciliationRow key={row.date} row={row} onSaved={onSaved} />
          ))}
        </>
      )}
    </View>
  );
}

function RewardReconciliationRow({
  row,
  onSaved,
}: {
  row: RewardReconciliationDailyStat;
  onSaved: () => void;
}) {
  const [dashboardImpressions, setDashboardImpressions] = useState(row.dashboardImpressions?.toString() ?? '');
  const [dashboardEcpmKrw, setDashboardEcpmKrw] = useState(row.dashboardEcpmKrw?.toString() ?? '');
  const [finalRevenueKrw, setFinalRevenueKrw] = useState(row.finalRevenueKrw?.toString() ?? '');
  const [note, setNote] = useState(row.note ?? '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDashboardImpressions(row.dashboardImpressions?.toString() ?? '');
    setDashboardEcpmKrw(row.dashboardEcpmKrw?.toString() ?? '');
    setFinalRevenueKrw(row.finalRevenueKrw?.toString() ?? '');
    setNote(row.note ?? '');
  }, [row.date, row.dashboardImpressions, row.dashboardEcpmKrw, row.finalRevenueKrw, row.note]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await adminService.saveRewardReconciliation(row.date, {
        dashboardImpressions: parseNullableInputNumber(dashboardImpressions),
        dashboardEcpmKrw: parseNullableInputNumber(dashboardEcpmKrw),
        finalRevenueKrw: parseNullableInputNumber(finalRevenueKrw),
        note: note.trim() || null,
      });
      onSaved();
    } catch (error) {
      Alert.alert('저장 실패', '정산 대조 값을 저장하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.reconRow}>
      <View style={styles.reconRowHeader}>
        <View>
          <Text style={styles.reconDate}>{row.date}</Text>
          <Text style={styles.reconSubText}>
            SDK 노출 {row.sdkImpressions.toLocaleString()} · 보상 {row.sdkRewards.toLocaleString()} · 티켓 {row.ticketsGranted.toLocaleString()}
          </Text>
        </View>
        <View style={styles.reconRightSummary}>
          <Text style={styles.reconSubText}>인정률 {formatNullableRate(row.dashboardToSdkImpressionRate)}</Text>
          <Text style={[styles.reconSubText, (row.finalGrossMarginKrw ?? 0) < 0 && styles.rewardDangerText]}>
            최종손익 {formatNullableWon(row.finalGrossMarginKrw)}
          </Text>
        </View>
      </View>

      <View style={styles.reconInputGrid}>
        <View style={styles.reconInputBox}>
          <Text style={styles.reconInputLabel}>대시보드 노출</Text>
          <TextInput
            style={styles.reconInput}
            value={dashboardImpressions}
            onChangeText={setDashboardImpressions}
            keyboardType="number-pad"
            placeholder="예: 100"
          />
        </View>
        <View style={styles.reconInputBox}>
          <Text style={styles.reconInputLabel}>eCPM(원)</Text>
          <TextInput
            style={styles.reconInput}
            value={dashboardEcpmKrw}
            onChangeText={setDashboardEcpmKrw}
            keyboardType="decimal-pad"
            placeholder="예: 3000"
          />
        </View>
        <View style={styles.reconInputBox}>
          <Text style={styles.reconInputLabel}>최종 정산액</Text>
          <TextInput
            style={styles.reconInput}
            value={finalRevenueKrw}
            onChangeText={setFinalRevenueKrw}
            keyboardType="decimal-pad"
            placeholder="확정 후 입력"
          />
        </View>
      </View>

      <Text style={styles.reconCalcText}>
        예상수익 {formatNullableWon(row.dashboardEstimatedRevenueKrw)} · 보상비 {formatNullableWon(row.estimatedRewardCostKrw)} · 사후조정 {formatNullableWon(row.invalidAdjustmentKrw)}
      </Text>

      <View style={styles.reconNoteRow}>
        <TextInput
          style={styles.reconNoteInput}
          value={note}
          onChangeText={setNote}
          placeholder="메모"
        />
        <TouchableOpacity
          style={[styles.button, styles.primaryButton, styles.reconSaveButton, isSaving && styles.disabledButton]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <Text style={styles.buttonText}>저장</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function RewardKpi({
  label,
  value,
  sub,
  danger = false,
}: {
  label: string;
  value: number;
  sub: string;
  danger?: boolean;
}) {
  return (
    <View style={[styles.rewardKpiCard, danger && styles.rewardKpiCardDanger]}>
      <Text style={styles.rewardKpiLabel}>{label}</Text>
      <Text style={[styles.rewardKpiValue, danger && styles.rewardDangerText]}>
        {value.toLocaleString()}
      </Text>
      <Text style={styles.rewardKpiSub}>{sub}</Text>
    </View>
  );
}

interface EventItemProps {
  event: AdminFeaturedEvent;
  onUpdate: () => void;
}

function EventItem({ event, onUpdate }: EventItemProps) {
  const [isFeatured, setIsFeatured] = useState(event.isFeatured);
  const [featuredOrder, setFeaturedOrder] = useState(event.featuredOrder?.toString() ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const orderValue = featuredOrder.trim() === '' ? null : parseInt(featuredOrder, 10);

      if (orderValue !== null && (isNaN(orderValue) || orderValue < 1)) {
        Alert.alert('에러', 'Featured Order는 1 이상의 정수여야 합니다.');
        setIsSaving(false);
        return;
      }

      await adminService.updateFeaturedStatus(event.id, {
        is_featured: isFeatured,
        featured_order: orderValue,
      });

      Alert.alert('성공', 'Featured 상태가 업데이트되었습니다.');
      onUpdate();
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || '업데이트에 실패했습니다.';
      Alert.alert('에러', errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges =
    isFeatured !== event.isFeatured ||
    (featuredOrder.trim() === '' ? null : parseInt(featuredOrder, 10)) !==
      event.featuredOrder;

  return (
    <View style={styles.eventCard}>
      <Text style={styles.eventTitle}>{event.title}</Text>
      <Text style={styles.eventSubtitle}>
        {event.mainCategory} &gt; {event.subCategory}
      </Text>
      <Text style={styles.eventInfo}>지역: {event.region}</Text>
      <Text style={styles.eventInfo}>
        기간: {formatDate(event.startAt)} ~ {formatDate(event.endAt)}
      </Text>

      <View style={styles.controlsContainer}>
        <View style={styles.toggleContainer}>
          <Text style={styles.controlLabel}>Featured:</Text>
          <TouchableOpacity
            style={[styles.toggleButton, isFeatured && styles.toggleButtonActive]}
            onPress={() => setIsFeatured(!isFeatured)}
          >
            <Text style={[styles.toggleText, isFeatured && styles.toggleTextActive]}>
              {isFeatured ? 'ON' : 'OFF'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.orderContainer}>
          <Text style={styles.controlLabel}>Order:</Text>
          <TextInput
            style={styles.orderInput}
            value={featuredOrder}
            onChangeText={setFeaturedOrder}
            keyboardType="number-pad"
            placeholder="null"
            placeholderTextColor="#999"
          />
        </View>

        <TouchableOpacity
          style={[
            styles.button,
            styles.primaryButton,
            styles.saveButton,
            (!hasChanges || isSaving) && styles.disabledButton,
          ]}
          onPress={handleSave}
          disabled={!hasChanges || isSaving}
        >
          {isSaving ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <Text style={styles.buttonText}>저장</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}.${month}.${day}`;
}

function formatLastCollection(lastCollection: AdminMetricsResponse['lastCollection']): string {
  if (!lastCollection) {
    return '최근 수집: 확인 불가';
  }

  const formattedTime = formatKstDateTime(lastCollection.completedAt);
  if (!formattedTime) {
    return '최근 수집: 확인 불가';
  }

  return `최근 수집: ${formattedTime} (KST) · 상태: ${lastCollection.status} · type: ${lastCollection.type}`;
}

function formatKstDateTime(dateStr: string | null | undefined): string | null {
  if (!dateStr) {
    return null;
  }

  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const formatted = date.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const match = formatted.match(/(\d{4})\.\s*(\d{2})\.\s*(\d{2})\.\s*(\d{2}):(\d{2})/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute] = match;
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

const styles = StyleSheet.create({
  loginContainer: {
    flex: 1,
    backgroundColor: '#F7FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loginBox: {
    backgroundColor: 'white',
    padding: 32,
    borderRadius: 12,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  loginTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1A202C',
    marginBottom: 24,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
    backgroundColor: 'white',
  },
  container: {
    flex: 1,
    backgroundColor: '#F7FAFC',
  },
  header: {
    backgroundColor: 'white',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1A202C',
  },
  metricsBar: {
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  metricsText: {
    fontSize: 13,
    color: '#4A5568',
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  refreshButton: {
    marginBottom: 16,
  },
  rewardPanel: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  reconPanel: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#CBD5E0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  rewardPanelHeader: {
    marginBottom: 14,
  },
  rewardPanelTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1A202C',
    marginBottom: 4,
  },
  rewardPanelSubtitle: {
    fontSize: 12,
    color: '#718096',
  },
  rewardLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  rewardLoadingText: {
    fontSize: 13,
    color: '#4A5568',
  },
  rewardEmptyText: {
    fontSize: 13,
    color: '#718096',
    paddingVertical: 12,
  },
  rewardKpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  rewardKpiCard: {
    minWidth: 138,
    flexGrow: 1,
    flexBasis: '22%',
    backgroundColor: '#F7FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
  },
  rewardKpiCardDanger: {
    backgroundColor: '#FFF5F5',
    borderColor: '#FEB2B2',
  },
  rewardKpiLabel: {
    fontSize: 12,
    color: '#718096',
    marginBottom: 4,
  },
  rewardKpiValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1A202C',
  },
  rewardKpiSub: {
    fontSize: 11,
    color: '#718096',
    marginTop: 2,
  },
  rewardGuideBox: {
    backgroundColor: '#EBF8FF',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  rewardGuideText: {
    fontSize: 12,
    color: '#2B6CB0',
    lineHeight: 18,
  },
  rewardDailyRow: {
    borderTopWidth: 1,
    borderTopColor: '#EDF2F7',
    paddingVertical: 10,
    gap: 8,
  },
  rewardDailyDateBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rewardDailyDate: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2D3748',
  },
  rewardDailyRate: {
    fontSize: 12,
    color: '#718096',
  },
  rewardDailyMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  rewardDailyMetric: {
    fontSize: 12,
    color: '#4A5568',
  },
  rewardDangerText: {
    color: '#E53E3E',
  },
  reconSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  reconRow: {
    borderTopWidth: 1,
    borderTopColor: '#EDF2F7',
    paddingTop: 14,
    paddingBottom: 12,
  },
  reconRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  reconDate: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1A202C',
  },
  reconSubText: {
    fontSize: 12,
    color: '#718096',
    marginTop: 2,
  },
  reconRightSummary: {
    alignItems: 'flex-end',
  },
  reconInputGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  reconInputBox: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 128,
  },
  reconInputLabel: {
    fontSize: 12,
    color: '#4A5568',
    marginBottom: 4,
    fontWeight: '600',
  },
  reconInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 8,
    fontSize: 13,
    backgroundColor: 'white',
  },
  reconCalcText: {
    fontSize: 12,
    color: '#4A5568',
    marginTop: 8,
    lineHeight: 18,
  },
  reconNoteRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  reconNoteInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 8,
    fontSize: 13,
    backgroundColor: 'white',
  },
  reconSaveButton: {
    minWidth: 72,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    padding: 48,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#718096',
  },
  eventCard: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  eventTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1A202C',
    marginBottom: 8,
  },
  eventSubtitle: {
    fontSize: 14,
    color: '#4A5568',
    marginBottom: 4,
  },
  eventInfo: {
    fontSize: 13,
    color: '#718096',
    marginBottom: 2,
  },
  controlsContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  controlLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3748',
    marginRight: 8,
  },
  toggleButton: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#CBD5E0',
  },
  toggleButtonActive: {
    backgroundColor: '#0064FF',
    borderColor: '#0064FF',
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4A5568',
  },
  toggleTextActive: {
    color: 'white',
  },
  orderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  orderInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 6,
    padding: 6,
    width: 80,
    fontSize: 14,
    textAlign: 'center',
    backgroundColor: 'white',
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  primaryButton: {
    backgroundColor: '#0064FF',
  },
  secondaryButton: {
    backgroundColor: '#718096',
  },
  saveButton: {
    marginLeft: 'auto',
  },
  disabledButton: {
    backgroundColor: '#CBD5E0',
  },
  buttonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
});
