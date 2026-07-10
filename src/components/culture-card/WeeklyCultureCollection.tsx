import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { WeeklyCuration } from '../../services/cardsService';
import { TAG_TOKENS } from './tagKit';

const BG = '#17130E';
const LINE = 'rgba(203,161,94,0.28)';
const GOLD = '#CBA15E';
const TEXT = TAG_TOKENS.headText;
const MUTED = TAG_TOKENS.navSub;
const NAVY = TAG_TOKENS.navy;

export function WeeklyCultureCollection({
  curation,
  onPressCard,
}: {
  curation: WeeklyCuration;
  onPressCard: (eventId: string) => void;
}) {
  if (curation.items.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>WEEKLY LOCAL EDIT</Text>
          <Text style={styles.title}>{curation.title}</Text>
          <Text style={styles.subtitle}>{curation.subtitle}</Text>
        </View>
        <View style={styles.weekBadge}>
          <Text style={styles.weekBadgeText}>WEEK</Text>
        </View>
      </View>

      <View style={styles.list}>
        {curation.items.map((card, index) => (
          <Pressable
            key={card.eventId}
            accessibilityRole="button"
            accessibilityLabel={`${card.title} 상세 보기`}
            onPress={() => onPressCard(card.eventId)}
            style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
          >
            <Text style={styles.index}>{String(index + 1).padStart(2, '0')}</Text>
            <View style={styles.rowBody}>
              <View style={styles.categoryRow}>
                <Text style={styles.category}>{card.category}</Text>
                {(card.reasonTags ?? []).slice(0, 1).map((reason) => (
                  <Text key={reason} style={styles.reason}>{reason}</Text>
                ))}
              </View>
              <Text style={styles.cardTitle} numberOfLines={1}>{card.title}</Text>
              <Text style={styles.meta} numberOfLines={1}>
                {[card.region, card.venue].filter(Boolean).join(' · ') || '장소 정보 준비 중'}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: 22,
    marginTop: 24,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: BG,
    padding: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: GOLD,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 2,
  },
  title: {
    marginTop: 5,
    color: TEXT,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
    fontFamily: 'Noto Serif KR',
  },
  subtitle: {
    marginTop: 4,
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  weekBadge: {
    borderRadius: 999,
    backgroundColor: NAVY,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  weekBadgeText: {
    color: '#DDB877',
    fontSize: 9.5,
    lineHeight: 12,
    letterSpacing: 1,
    fontWeight: '900',
  },
  list: {
    marginTop: 15,
  },
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(203,161,94,0.14)',
    paddingVertical: 12,
  },
  rowPressed: {
    opacity: 0.7,
  },
  index: {
    width: 32,
    color: GOLD,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 1,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  category: {
    color: GOLD,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '900',
  },
  reason: {
    color: '#AEBBD6',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
  },
  cardTitle: {
    marginTop: 3,
    color: TEXT,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  meta: {
    marginTop: 2,
    color: MUTED,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  chevron: {
    marginLeft: 10,
    color: GOLD,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
  },
});
