import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PassportResponse } from '../../services/passportService';
import { getPassportDiscoverySummary } from '../../pages/passportLogic';

const TEXT = '#171717';
const MUTED = '#716D66';
const RED = '#A52822';

function ProgressLine({ label, value, goal }: { label: string; value: number; goal: number }) {
  const progress = goal > 0 ? Math.min(1, value / goal) : 0;
  return (
    <View style={styles.progressItem}>
      <View style={styles.progressHeader}>
        <Text style={styles.progressLabel}>{label}</Text>
        <Text style={styles.progressValue}>{value}/{goal}</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
    </View>
  );
}

export function PassportDiscoverySummary({
  passport,
  onExplore,
  onOpenSaved,
}: {
  passport: PassportResponse | null;
  onExplore: () => void;
  onOpenSaved: () => void;
}) {
  if (!passport || typeof passport.regionsDiscovered !== 'number') return null;

  const summary = getPassportDiscoverySummary(passport);
  const remainingRegions = Math.max(0, summary.regionGoal - summary.regionsDiscovered);
  const remainingCategories = Math.max(0, summary.categoryGoal - summary.categoriesDiscovered);
  const hasOpenedButNotVisited = summary.monthDiscovered > 0 && summary.monthVisited === 0;

  const monthlyCopy = summary.monthDiscovered > 0
    ? `이번 달 ${summary.monthDiscovered}개를 발견하고 ${summary.monthVisited}곳에 다녀왔어요.`
    : '이번 달 첫 문화를 열면 다음 목표를 제안해 드려요.';

  const goalTitle = hasOpenedButNotVisited
    ? '열어본 문화 중 이번 달 첫 방문을 골라보세요'
    : remainingRegions > 0
      ? `새로운 지역 ${remainingRegions}곳을 더 발견해 보세요`
      : remainingCategories > 0
        ? `새로운 장르 ${remainingCategories}개를 더 만나보세요`
        : '익숙한 취향에서 한 걸음 더 나가볼까요?';

  const goalDescription = hasOpenedButNotVisited
    ? '저장한 일정과 위치를 다시 확인하면 실제 방문으로 이어가기 쉬워요.'
    : summary.favoriteRegion
      ? `${summary.favoriteRegion} 밖의 새로운 동네를 열면 컬렉션이 더 다양해져요.`
      : '오늘 탭에서 새로운 카드를 열어 컬렉션을 이어가세요.';

  const primaryLabel = hasOpenedButNotVisited ? '저장한 문화 보기' : '새로운 문화 열기';
  const primaryAction = hasOpenedButNotVisited ? onOpenSaved : onExplore;

  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>NEXT FOR YOUR COLLECTION</Text>
      <Text style={styles.title}>다음 컬렉션 목표</Text>
      <Text style={styles.monthlyCopy}>{monthlyCopy}</Text>

      <View style={styles.goalCard}>
        <Text style={styles.goalKicker}>NEXT MOVE</Text>
        <Text style={styles.goalTitle}>{goalTitle}</Text>
        <Text style={styles.goalDescription}>{goalDescription}</Text>

        <View style={styles.progressGroup}>
          <ProgressLine label="지역 컬렉션" value={summary.regionsDiscovered} goal={summary.regionGoal} />
          <ProgressLine label="장르 컬렉션" value={summary.categoriesDiscovered} goal={summary.categoryGoal} />
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={primaryAction}
          style={({ pressed }) => [styles.primaryButton, pressed ? styles.pressed : null]}
        >
          <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
          <Text style={styles.primaryButtonArrow}>→</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={hasOpenedButNotVisited ? onExplore : onOpenSaved}
          style={({ pressed }) => [styles.secondaryButton, pressed ? styles.pressed : null]}
        >
          <Text style={styles.secondaryButtonText}>
            {hasOpenedButNotVisited ? '오늘의 추천으로 돌아가기' : '저장한 문화 확인하기'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 26,
    marginBottom: 22,
  },
  eyebrow: {
    color: RED,
    fontSize: 9.5,
    lineHeight: 13,
    letterSpacing: 1.45,
    fontWeight: '900',
  },
  title: {
    marginTop: 5,
    color: TEXT,
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '900',
    fontFamily: 'Noto Serif KR',
  },
  monthlyCopy: {
    marginTop: 6,
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  goalCard: {
    marginTop: 14,
    borderRadius: 22,
    backgroundColor: '#EFE9D8',
    padding: 18,
  },
  goalKicker: {
    color: RED,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1.2,
    fontWeight: '900',
  },
  goalTitle: {
    marginTop: 7,
    color: TEXT,
    fontSize: 19,
    lineHeight: 26,
    letterSpacing: -0.55,
    fontWeight: '900',
    fontFamily: 'Noto Serif KR',
  },
  goalDescription: {
    marginTop: 7,
    color: MUTED,
    fontSize: 11.5,
    lineHeight: 17,
    fontWeight: '600',
  },
  progressGroup: {
    marginTop: 18,
    gap: 13,
  },
  progressItem: {
    gap: 6,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressLabel: {
    color: TEXT,
    fontSize: 10.5,
    fontWeight: '800',
  },
  progressValue: {
    color: RED,
    fontSize: 10.5,
    fontWeight: '900',
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(113,109,102,0.15)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: RED,
  },
  primaryButton: {
    marginTop: 20,
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: RED,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  primaryButtonArrow: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: MUTED,
    fontSize: 11,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.76,
  },
});
