import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PassportResponse } from '../../services/passportService';
import { getPassportDiscoverySummary } from '../../pages/passportLogic';

const TEXT = '#171717';
const MUTED = '#716D66';

function CollectionChip({ label, value, goal }: {
  label: string;
  value: number;
  goal: number;
}) {
  return (
    <View style={styles.collectionChip}>
      <Text style={styles.collectionLabel}>{label}</Text>
      <Text style={styles.collectionValue}>{value}<Text style={styles.collectionGoal}>/{goal}</Text></Text>
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

      <View style={styles.collectionRow}>
        <CollectionChip label="지역 수집" value={summary.regionsDiscovered} goal={summary.regionGoal} />
        <CollectionChip label="장르 수집" value={summary.categoriesDiscovered} goal={summary.categoryGoal} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 18,
    marginBottom: 22,
    borderTopWidth: 3,
    borderBottomWidth: 1,
    borderColor: '#171717',
    backgroundColor: '#EFE9D8',
    paddingVertical: 14,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  eyebrow: {
    color: '#A52822',
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
    fontFamily: 'Noto Serif KR',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 0,
    backgroundColor: '#A52822',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeMark: {
    color: '#F5EDDA',
    fontSize: 11,
    fontWeight: '900',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '900',
  },
  metrics: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#171717',
    backgroundColor: 'transparent',
    paddingVertical: 13,
  },
  metric: {
    flex: 1,
    alignItems: 'center',
  },
  metricDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#171717',
  },
  metricNumber: {
    color: TEXT,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '900',
  },
  metricLabel: {
    marginTop: 3,
    color: '#5A5131',
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
  collectionRow: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 8,
  },
  collectionChip: {
    flex: 1,
    minHeight: 68,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#171717',
    backgroundColor: '#F7F5EF',
    padding: 12,
    justifyContent: 'space-between',
  },
  collectionLabel: {
    color: TEXT,
    fontSize: 11,
    fontWeight: '800',
  },
  collectionValue: {
    color: '#A52822',
    fontSize: 20,
    lineHeight: 23,
    fontWeight: '900',
  },
  collectionGoal: {
    color: '#716D66',
    fontSize: 12,
  },
});
