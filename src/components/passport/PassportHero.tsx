import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PassportResponse, PassportStamp } from '../../services/passportService';

const INK = '#16161A';
const PAPER = '#F5F1E8';
const PAPER_HIGHLIGHT = '#FBF8F1';
const PAPER_EDGE = '#E7E0D2';
const BRONZE = '#B8924A';
const BRONZE_DARK = '#9C7635';
const MUTED = '#6B6760';
const BLUE = '#3182F6';
const EMPTY_STAMP_SLOTS = 12;

const CATEGORY_COLORS: Record<string, string> = {
  전시: '#3182F6',
  공연: '#A8324A',
  팝업: '#D08A2C',
  축제: '#3E8E5A',
};

export interface PassportHeroProps {
  passport: PassportResponse | null;
}

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? BRONZE_DARK;
}

function formatStampDate(visitedAt: string): string {
  const date = new Date(visitedAt);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}.${date.getDate()}`;
}

function StampCell({ stamp }: { stamp: PassportStamp | null }) {
  if (!stamp) {
    return (
      <View style={[styles.stampCell, styles.emptyStampCell]}>
        <Text style={styles.emptyStampText}>가보면</Text>
        <Text style={styles.emptyStampText}>도장이 찍혀요</Text>
      </View>
    );
  }

  const stampColor = getCategoryColor(stamp.category);

  return (
    <View style={[styles.stampCell, styles.visitedStampCell, { borderColor: stampColor }]}>
      <Text style={[styles.stampStatus, { color: stampColor }]}>VISITED</Text>
      <Text style={styles.stampTitle} numberOfLines={2}>
        {stamp.title}
      </Text>
      <Text style={styles.stampDate}>{formatStampDate(stamp.visitedAt)}</Text>
    </View>
  );
}

export function PassportHero({ passport }: PassportHeroProps) {
  const stamps = passport?.stamps.slice(0, EMPTY_STAMP_SLOTS) ?? [];
  const stampCells = Array.from({ length: EMPTY_STAMP_SLOTS }, (_, index) => stamps[index] ?? null);
  const tasteCategories = passport?.tasteCategories ?? [];

  return (
    <View style={styles.card}>
      <View style={styles.punchLeft} />
      <View style={styles.punchRight} />

      <View style={styles.headerRow}>
        <View>
          <Text style={styles.kicker}>MY CULTURE PASSPORT</Text>
          <Text style={styles.passportNo}>NO. {passport?.passportNo ?? '----'}</Text>
        </View>
        <View style={styles.seal}>
          <Text style={styles.sealText}>FP</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{passport?.discoveredCount ?? 0}</Text>
          <Text style={styles.statLabel}>발견</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{passport?.visitedCount ?? 0}</Text>
          <Text style={styles.statLabel}>다녀온 곳</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{passport?.monthDiscovered ?? 0}</Text>
          <Text style={styles.statLabel}>이번달</Text>
        </View>
      </View>

      <View style={styles.tasteRow}>
        {tasteCategories.length > 0 ? (
          tasteCategories.map((category) => (
            <View key={category} style={styles.tasteChip}>
              <Text style={styles.tasteChipText}>{category}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.emptyTasteText}>취향을 모으는 중이에요</Text>
        )}
      </View>

      <View style={styles.perforation} />

      <View style={styles.stampHeaderRow}>
        <Text style={styles.stampHeader}>다녀온 도장</Text>
        <Text style={styles.stampCount}>{passport?.visitedCount ?? 0}개</Text>
      </View>
      <View style={styles.stampGrid}>
        {stampCells.map((stamp, index) => (
          <StampCell key={stamp ? `${stamp.eventId}-${stamp.visitedAt}` : `empty-${index}`} stamp={stamp} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 22,
    backgroundColor: PAPER,
    borderWidth: 1,
    borderColor: PAPER_EDGE,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.26,
    shadowRadius: 28,
    elevation: 8,
  },
  punchLeft: {
    position: 'absolute',
    left: -13,
    top: 126,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: INK,
  },
  punchRight: {
    position: 'absolute',
    right: -13,
    top: 126,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: INK,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  kicker: {
    color: BRONZE_DARK,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  passportNo: {
    marginTop: 6,
    color: MUTED,
    fontSize: 13,
    fontWeight: '700',
  },
  seal: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: BRONZE,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PAPER_HIGHLIGHT,
  },
  sealText: {
    color: BRONZE_DARK,
    fontSize: 13,
    fontWeight: '900',
  },
  statsRow: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: PAPER_HIGHLIGHT,
    borderWidth: 1,
    borderColor: '#EEE6D5',
    paddingVertical: 15,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    height: 38,
    backgroundColor: '#E4DCCB',
  },
  statValue: {
    color: INK,
    fontSize: 31,
    lineHeight: 36,
    fontWeight: '900',
    fontFamily: 'Noto Serif KR',
  },
  statLabel: {
    marginTop: 3,
    color: MUTED,
    fontSize: 12,
    fontWeight: '700',
  },
  tasteRow: {
    minHeight: 38,
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  tasteChip: {
    borderRadius: 999,
    backgroundColor: '#EFE4CF',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  tasteChipText: {
    color: BRONZE_DARK,
    fontSize: 12,
    fontWeight: '800',
  },
  emptyTasteText: {
    color: MUTED,
    fontSize: 13,
    fontWeight: '700',
  },
  perforation: {
    marginHorizontal: -20,
    marginTop: 16,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#CEC4AF',
  },
  stampHeaderRow: {
    marginTop: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stampHeader: {
    color: INK,
    fontSize: 15,
    fontWeight: '900',
  },
  stampCount: {
    color: MUTED,
    fontSize: 12,
    fontWeight: '800',
  },
  stampGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  stampCell: {
    width: '31.5%',
    minHeight: 72,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  visitedStampCell: {
    borderWidth: 1,
    backgroundColor: '#FFFDF8',
  },
  emptyStampCell: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#CFC6B2',
    backgroundColor: '#F8F3E8',
  },
  stampStatus: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  stampTitle: {
    marginTop: 4,
    color: INK,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  stampDate: {
    marginTop: 5,
    color: BLUE,
    fontSize: 10,
    fontWeight: '800',
  },
  emptyStampText: {
    color: '#9A8F7A',
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
    fontWeight: '700',
  },
});
