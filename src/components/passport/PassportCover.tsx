/**
 * 문화 여권 표지.
 * 네이비 그라데이션 표지 + 골드 프레임라인 + "CULTURE PASSPORT" 소문자캡스 +
 * "문화 여권" 대형 + 부제 + 우측 원형 골드 씰("{n} STAMPS").
 *
 * RN에는 CSS gradient가 없어 155deg 네이비 그라데이션은 단색 근사 + 상단 하이라이트 오버레이로 표현한다.
 * (react-native-svg 등 추가 라이브러리 금지 규약 → 순수 View 레이어링)
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

// 시안(v1.html) 네이비 표지 · 골드 팔레트
const NAVY_TOP = '#20304F';
const NAVY_MID = '#16233C';
const GOLD = '#CBA15E';
const GOLD_SOFT = '#DDB877';
const TITLE = '#F2ECDE';
const COVER_SUB = '#AEBBD6';

export interface PassportCoverProps {
  visitedCount: number;
  /** 부제에 넣을 시작 라벨(예: "2026.3부터"). null이면 기본 문구만. */
  sinceLabel?: string | null;
}

export function PassportCover({ visitedCount, sinceLabel }: PassportCoverProps) {
  const subtitle = sinceLabel
    ? `${sinceLabel} · 다녀온 문화를 도장으로 모아요`
    : '다녀온 문화를 도장으로 모아요';

  return (
    <View style={styles.cover}>
      {/* 155deg 그라데이션 근사: 상단 밝은 네이비 하이라이트 밴드 */}
      <View style={styles.coverHighlight} pointerEvents="none" />
      {/* 골드 프레임라인(inset border) */}
      <View style={styles.frameLine} pointerEvents="none" />

      <View style={styles.textWrap}>
        <Text style={styles.kicker}>CULTURE PASSPORT</Text>
        <Text style={styles.title}>문화 여권</Text>
        <Text style={styles.sub} numberOfLines={2}>{subtitle}</Text>
      </View>

      {/* 우측 원형 골드 씰 */}
      <View style={styles.seal} pointerEvents="none">
        <View style={styles.sealDash} />
        <Text style={styles.sealNumber} allowFontScaling={false}>{visitedCount}</Text>
        <Text style={styles.sealLabel} allowFontScaling={false}>STAMPS</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'relative',
    borderRadius: 16,
    overflow: 'hidden',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    minHeight: 108,
    justifyContent: 'center',
    backgroundColor: NAVY_MID,
    borderWidth: 1,
    borderColor: 'rgba(203,161,94,0.30)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.5,
    shadowRadius: 32,
    elevation: 10,
  },
  coverHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '62%',
    backgroundColor: NAVY_TOP,
    opacity: 0.9,
  },
  frameLine: {
    position: 'absolute',
    top: 9,
    left: 9,
    right: 9,
    bottom: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(203,161,94,0.35)',
  },
  textWrap: {
    // 우측 씰 영역(약 90px)을 피하도록 여백
    paddingRight: 84,
  },
  kicker: {
    color: GOLD_SOFT,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 3,
  },
  title: {
    marginTop: 6,
    color: TITLE,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '900',
    letterSpacing: -0.6,
    fontFamily: 'Noto Serif KR',
  },
  sub: {
    marginTop: 6,
    color: COVER_SUB,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  seal: {
    position: 'absolute',
    right: 16,
    top: '50%',
    marginTop: -37,
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 2,
    borderColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.9,
    transform: [{ rotate: '-9deg' }],
  },
  sealDash: {
    position: 'absolute',
    top: 5,
    left: 5,
    right: 5,
    bottom: 5,
    borderRadius: 32,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: GOLD,
  },
  sealNumber: {
    color: GOLD_SOFT,
    fontSize: 24,
    lineHeight: 26,
    fontWeight: '900',
    fontFamily: 'Noto Serif KR',
  },
  sealLabel: {
    marginTop: 1,
    color: GOLD_SOFT,
    fontSize: 9,
    letterSpacing: 1,
    fontWeight: '700',
  },
});
