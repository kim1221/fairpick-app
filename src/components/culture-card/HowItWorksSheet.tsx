/**
 * 홈 첫 진입 1회 + 헤더 "?" 칩으로 여는 이용 방법 안내 오버레이.
 * "10/10이 하루 제한? ?는 뭐지? 컬렉션은 어떻게 채워?" — 규칙이 화면만으로 안 읽힌다는
 * 피드백(2026-07-23)에 대한 응답. 크림 카드 + 잉크 스타일로 홈 태그 무드를 따른다.
 * 문구는 평균·범위 중심(과장 금지, 스펙 §7).
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Storage as TossStorage } from '@apps-in-toss/framework';

const SCRIM = 'rgba(12,9,6,0.94)';
const CREAM = '#F3EDDD';
const NAVY = '#2A386A';
const RED = '#A8331F';
const INK = '#2B2620';
const INK_MUTED = '#6F6B60';

const SEEN_KEY = 'home:howItWorks:v1';

export async function shouldShowHowItWorks(): Promise<boolean> {
  try {
    return (await TossStorage.getItem(SEEN_KEY)) !== 'seen';
  } catch {
    return false;
  }
}

export async function markHowItWorksSeen(): Promise<void> {
  try {
    await TossStorage.setItem(SEEN_KEY, 'seen');
  } catch {
    // 저장 실패 시 다음 진입에 한 번 더 보일 뿐 — 치명적이지 않다.
  }
}

const STEPS: Array<{ no: string; title: string; description: string }> = [
  {
    no: '1',
    title: '광고 보고 오늘의 카드를 열어요',
    description: '카드 1장 = 티켓 1장. 전시·공연·팝업 슬롯은 매일 바뀌고, "?" 카드는 열기 전까지 행선지를 숨겨요.',
  },
  {
    no: '2',
    title: '티켓 10장 = 포인트 뽑기 1번',
    description: '리워드 탭에서 뽑으면 매번 10원~500원 사이 토스포인트가 지급돼요 · 평균 20원.',
  },
  {
    no: '3',
    title: '연 카드가 컬렉션을 자동으로 채워요',
    description: '조건이 맞는 세트의 빈 칸이 저절로 채워지고, "?" 카드는 진행 중인 세트를 우선 도와줘요. 세트를 완성하면 배지와 보너스 티켓을 받아요.',
  },
];

export function HowItWorksSheet({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <Text style={styles.kicker}>HOW IT WORKS</Text>
        <Text style={styles.title}>컬처카드 이용 방법</Text>

        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {STEPS.map((step) => (
            <View key={step.no} style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>{step.no}</Text>
              </View>
              <View style={styles.stepCopy}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepDescription}>{step.description}</Text>
              </View>
            </View>
          ))}
          <Text style={styles.finePrint}>
            하루에 열 수 있는 카드 수는 우리 동네의 새 카드 수에 따라 정해져요. 다 열면 내일 새 카드가 와요.
          </Text>
        </ScrollView>

        <Pressable accessibilityRole="button" style={styles.confirmButton} onPress={onClose}>
          <Text style={styles.confirmText}>알겠어요</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    elevation: 30,
    backgroundColor: SCRIM,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
  },
  card: {
    alignSelf: 'stretch',
    maxHeight: '100%',
    backgroundColor: CREAM,
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 20,
  },
  kicker: {
    color: RED,
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 2.5,
    textAlign: 'center',
  },
  title: {
    marginTop: 6,
    marginBottom: 14,
    color: NAVY,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '900',
    textAlign: 'center',
  },
  body: {
    flexGrow: 0,
  },
  stepRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 10,
  },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepBadgeText: {
    color: NAVY,
    fontSize: 13,
    fontWeight: '900',
  },
  stepCopy: {
    flex: 1,
    minWidth: 0,
  },
  stepTitle: {
    color: INK,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '900',
  },
  stepDescription: {
    marginTop: 3,
    color: INK_MUTED,
    fontSize: 12.5,
    lineHeight: 19,
    fontWeight: '600',
  },
  finePrint: {
    marginTop: 10,
    color: INK_MUTED,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  confirmButton: {
    marginTop: 16,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: {
    color: CREAM,
    fontSize: 15,
    fontWeight: '900',
  },
});
