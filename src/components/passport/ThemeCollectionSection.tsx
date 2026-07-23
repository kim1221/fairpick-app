/**
 * 여권 탭 최상단 "테마 컬렉션" 캐러셀 + "배지장" 섹션 (스펙 §4.5, 시안 collection-sets-v1 ①).
 * 마닐라 폴더 세트 카드(우상단 탭 노치) · 진행 도트 · 완성 세트=네이비+금박 배지.
 * 데이터는 부모(passport.tsx)가 내려준다 — 여기는 표시 전용.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CollectionBadge, ThemeCollectionSet } from '../../services/themeCollectionService';
import { ddayLabel, progressDots, setEyebrow } from './themeCollectionData';

const PAGE_BG = '#F7F5EF';
const MANILA = '#EFE4C3';
const MANILA_LINE = '#DECFA6';
const INK = '#2C2A22';
const NAVY = '#2A386A';
const NAVY_LINE = '#3D4C82';
const RED = '#A52822';
const SUB = '#716D66';
const GOLD = '#C9A35B';
const CREAM = '#EFE3C4';

// 폴더 탭 노치(우상단 대각 깎기) — clip-path 대체, 보더 삼각형 트릭
const NOTCH_W = 34;
const NOTCH_H = 16;

interface ThemeCollectionSectionProps {
  sets: ThemeCollectionSet[];
  badges: CollectionBadge[];
  onPressSet: (setId: string) => void;
}

function SetFolderCard({ set, onPress }: { set: ThemeCollectionSet; onPress: () => void }) {
  const completed = set.completed;
  const dots = progressDots(set.filledCount, set.totalSlots);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${set.title} 세트, ${set.filledCount}/${set.totalSlots} 채움`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.folderCard,
        completed ? styles.folderCardCompleted : null,
        pressed ? styles.folderCardPressed : null,
      ]}
    >
      <View style={styles.notch} pointerEvents="none" />
      <View style={styles.folderTopRow}>
        <Text style={[styles.folderEyebrow, completed ? styles.folderEyebrowCompleted : null]} numberOfLines={1}>
          {setEyebrow(set)}
        </Text>
        {completed ? (
          <View style={styles.badgeCoin}>
            <Text style={styles.badgeCoinGlyph}>✦</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.folderTitle, completed ? styles.folderTitleCompleted : null]} numberOfLines={2}>
        {set.title}
      </Text>
      {set.subtitle ? (
        <Text style={[styles.folderSubtitle, completed ? styles.folderSubtitleCompleted : null]} numberOfLines={1}>
          {set.subtitle}
        </Text>
      ) : null}
      <View style={styles.folderBottomRow}>
        <View style={styles.dotsRow}>
          {dots.map((filled, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                filled ? (completed ? styles.dotFilledGold : styles.dotFilled) : null,
                !filled && completed ? styles.dotEmptyOnNavy : null,
              ]}
            />
          ))}
          <Text style={[styles.dotCount, completed ? styles.dotCountCompleted : null]}>
            {set.filledCount}/{set.totalSlots}
          </Text>
        </View>
        <Text style={[styles.folderDday, completed ? styles.folderBadgeEarned : null]}>
          {completed ? 'BADGE EARNED' : ddayLabel(set.daysRemaining)}
        </Text>
      </View>
    </Pressable>
  );
}

export function ThemeCollectionSection({ sets, badges, onPressSet }: ThemeCollectionSectionProps) {
  if (sets.length === 0 && badges.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {sets.length > 0 ? (
        <>
          <Text style={styles.sectionEyebrow}>THEMED SETS · 이번 주 발행</Text>
          <Text style={styles.sectionTitle}>테마 컬렉션</Text>
          <Text style={styles.sectionCaption}>조건이 맞는 카드를 열면 슬롯이 자동으로 채워져요.</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carousel}
          >
            {sets.map((set) => (
              <SetFolderCard key={set.setId} set={set} onPress={() => onPressSet(set.setId)} />
            ))}
          </ScrollView>
        </>
      ) : null}

      {badges.length > 0 ? (
        <View style={styles.badgeShelf}>
          <Text style={styles.sectionEyebrow}>BADGES · 배지장</Text>
          <View style={styles.badgeGrid}>
            {badges.map((badge) => (
              // 세트 배지는 탭하면 완성했던 세트를 아카이브로 다시 본다(만료 후에도 상세 조회 가능).
              // 마일스톤 배지(setId 없음)는 눌러도 갈 곳이 없어 비활성.
              <Pressable
                key={badge.badgeKey}
                accessibilityRole="button"
                accessibilityLabel={`${badge.title} 배지${badge.setId ? ' — 세트 다시 보기' : ''}`}
                disabled={!badge.setId}
                onPress={badge.setId ? () => onPressSet(badge.setId!) : undefined}
                style={({ pressed }) => [styles.badgeChip, pressed ? styles.badgeChipPressed : null]}
              >
                <View style={styles.badgeChipCoin}>
                  <Text style={styles.badgeChipGlyph}>✦</Text>
                </View>
                <Text style={styles.badgeChipTitle} numberOfLines={1}>
                  {badge.title}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 30 },
  sectionEyebrow: { color: RED, fontSize: 10.5, lineHeight: 14, fontWeight: '900', letterSpacing: 1.6 },
  sectionTitle: {
    marginTop: 4,
    color: INK,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
    fontFamily: 'Noto Serif KR',
  },
  sectionCaption: { marginTop: 3, color: SUB, fontSize: 11.5, lineHeight: 17, fontWeight: '600' },
  carousel: { paddingTop: 14, paddingRight: 20, gap: 12 },
  folderCard: {
    width: 252,
    minHeight: 138,
    borderRadius: 4,
    borderTopRightRadius: 0,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    backgroundColor: MANILA,
    borderWidth: 1,
    borderColor: MANILA_LINE,
    overflow: 'hidden',
  },
  folderCardCompleted: {
    backgroundColor: NAVY,
    borderColor: NAVY_LINE,
  },
  folderCardPressed: { opacity: 0.88 },
  notch: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 0,
    height: 0,
    borderTopWidth: NOTCH_H,
    borderLeftWidth: NOTCH_W,
    borderTopColor: PAGE_BG,
    borderLeftColor: 'transparent',
  },
  folderTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  folderEyebrow: {
    flex: 1,
    color: SUB,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1.1,
    paddingRight: NOTCH_W - 8,
  },
  folderEyebrowCompleted: { color: '#9AA5CB' },
  badgeCoin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeCoinGlyph: { color: GOLD, fontSize: 13, lineHeight: 16, fontWeight: '900' },
  folderTitle: {
    marginTop: 7,
    color: NAVY,
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  folderTitleCompleted: { color: CREAM },
  folderSubtitle: { marginTop: 3, color: INK, fontSize: 11.5, lineHeight: 16, fontWeight: '700' },
  folderSubtitleCompleted: { color: '#C9D0E8' },
  folderBottomRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    borderWidth: 1.3,
    borderColor: 'rgba(44,42,34,0.4)',
  },
  dotFilled: { backgroundColor: RED, borderColor: RED },
  dotFilledGold: { backgroundColor: GOLD, borderColor: GOLD },
  dotEmptyOnNavy: { borderColor: 'rgba(233,219,184,0.45)' },
  dotCount: { marginLeft: 4, color: INK, fontSize: 11, fontWeight: '900' },
  dotCountCompleted: { color: CREAM },
  folderDday: { color: SUB, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.8 },
  folderBadgeEarned: { color: GOLD },
  badgeShelf: { marginTop: 22 },
  badgeGrid: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badgeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingLeft: 6,
    paddingRight: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#EFE9D8',
    borderWidth: 1,
    borderColor: '#E0D6BE',
    maxWidth: '100%',
  },
  badgeChipPressed: {
    opacity: 0.7,
  },
  badgeChipCoin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.3,
    borderColor: GOLD,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeChipGlyph: { color: GOLD, fontSize: 11, lineHeight: 14, fontWeight: '900' },
  badgeChipTitle: { flexShrink: 1, color: INK, fontSize: 11.5, fontWeight: '800' },
});
