import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PassportResponse } from '../../services/passportService';
import { getPassportDiscoverySummary } from '../../pages/passportLogic';

const PANEL = '#FFFFFF';
const LINE = '#DED9CF';
const GOLD = '#3157D5';
const GOLD_SOFT = '#3157D5';
const TEXT = '#171717';
const MUTED = '#716D66';
const TRACK = '#E8E5DE';
const NAVY = '#EEF3FF';

function ProgressRow({ label, value, goal, progress }: {
  label: string;
  value: number;
  goal: number;
  progress: number;
}) {
  return (
    <View style={styles.progressBlock}>
      <View style={styles.progressHead}>
        <Text style={styles.progressLabel}>{label}</Text>
        <Text style={styles.progressValue}>{value} / {goal}</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>
    </View>
  );
}

export function PassportDiscoverySummary({ passport }: { passport: PassportResponse | null }) {
  // 백엔드 선배포 전 구버전 응답에서는 잘못된 0 통계를 보여주지 않는다.
  if (!passport || typeof passport.regionsDiscovered !== 'number') return null;

  const summary = getPassportDiscoverySummary(passport);
  const favoriteCopy = summary.favoriteRegion
    ? `가장 자주 찾은 곳은 ${summary.favoriteRegion}이에요`
    : '첫 지역을 발견하면 여기에 기록돼요';

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.eyebrow}>DISCOVERY LOG</Text>
          <Text style={styles.title}>이번 달 발견 기록</Text>
        </View>
        {summary.regionsDiscovered > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeMark}>✦</Text>
            <Text style={styles.badgeText}>지역 {summary.regionsDiscovered}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Text style={styles.metricNumber}>{summary.monthDiscovered}</Text>
          <Text style={styles.metricLabel}>새로 발견</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metric}>
          <Text style={styles.metricNumber}>{summary.monthVisited}</Text>
          <Text style={styles.metricLabel}>이번 달 도장</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metric}>
          <Text style={styles.metricNumber}>{summary.regionsVisited}</Text>
          <Text style={styles.metricLabel}>다녀온 지역</Text>
        </View>
      </View>

      <Text style={styles.favorite}>{favoriteCopy}</Text>

      <ProgressRow
        label="지역 수집"
        value={summary.regionsDiscovered}
        goal={summary.regionGoal}
        progress={summary.regionProgress}
      />
      <ProgressRow
        label="장르 수집"
        value={summary.categoriesDiscovered}
        goal={summary.categoryGoal}
        progress={summary.categoryProgress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 22,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: PANEL,
    padding: 18,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  eyebrow: {
    color: GOLD,
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: 2,
    fontWeight: '800',
  },
  title: {
    marginTop: 5,
    color: TEXT,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D8E2FF',
    backgroundColor: '#EEF3FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeMark: {
    color: GOLD_SOFT,
    fontSize: 11,
    fontWeight: '900',
  },
  badgeText: {
    color: GOLD_SOFT,
    fontSize: 11.5,
    fontWeight: '900',
  },
  metrics: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: NAVY,
    paddingVertical: 13,
  },
  metric: {
    flex: 1,
    alignItems: 'center',
  },
  metricDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#D8E2FF',
  },
  metricNumber: {
    color: TEXT,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '900',
  },
  metricLabel: {
    marginTop: 3,
    color: '#66749A',
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '700',
  },
  favorite: {
    marginTop: 14,
    color: MUTED,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '700',
  },
  progressBlock: {
    marginTop: 13,
  },
  progressHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: {
    color: TEXT,
    fontSize: 12.5,
    fontWeight: '800',
  },
  progressValue: {
    color: GOLD_SOFT,
    fontSize: 11.5,
    fontWeight: '900',
  },
  progressTrack: {
    marginTop: 7,
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: TRACK,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: GOLD,
  },
});
