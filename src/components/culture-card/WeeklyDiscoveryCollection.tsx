import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { WeeklyDiscovery } from '../../services/cardsService';

export function WeeklyDiscoveryCollection({
  discovery,
  onPressCard,
}: {
  discovery: WeeklyDiscovery;
  onPressCard: (eventId: string) => void;
}) {
  const ratio = Math.min(1, discovery.openedCount / Math.max(1, discovery.goal));

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>이번 주 발견</Text>
          <Text style={styles.title}>
            {discovery.openedCount > 0
              ? `${discovery.openedCount}개의 문화를 열었어요`
              : '첫 문화를 발견해 보세요'}
          </Text>
        </View>
        <Text style={styles.count}>{discovery.openedCount}/{discovery.goal}</Text>
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%` }]} />
      </View>
      <Text style={styles.description}>
        광고로 공개한 이벤트만 이곳에 쌓여요. 열린 카드는 언제든 다시 볼 수 있어요.
      </Text>

      {discovery.items.length > 0 ? (
        <View style={styles.list}>
          {discovery.items.slice(0, 4).map((card) => (
            <Pressable
              key={card.eventId}
              accessibilityRole="button"
              accessibilityLabel={`${card.title} 다시 보기`}
              onPress={() => onPressCard(card.eventId)}
              style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
            >
              <View style={styles.rowCopy}>
                <Text style={styles.category}>{card.category}</Text>
                <Text style={styles.cardTitle} numberOfLines={1}>{card.title}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {[card.region, card.venue].filter(Boolean).join(' · ') || '장소 정보 확인하기'}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: 22,
    marginTop: 26,
    borderRadius: 20,
    backgroundColor: '#171512',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
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
  },
  eyebrow: {
    color: '#D8B26A',
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '800',
  },
  title: {
    marginTop: 4,
    color: '#F5F1E9',
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  count: {
    color: '#D8B26A',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '900',
  },
  track: {
    marginTop: 15,
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: '#302D28',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#D8B26A',
  },
  description: {
    marginTop: 10,
    color: '#9A948B',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  list: {
    marginTop: 14,
  },
  row: {
    minHeight: 66,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  category: {
    color: '#C7A567',
    fontSize: 10.5,
    lineHeight: 15,
    fontWeight: '800',
  },
  cardTitle: {
    marginTop: 2,
    color: '#F5F1E9',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  meta: {
    marginTop: 1,
    color: '#8F8980',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  chevron: {
    marginLeft: 10,
    color: '#8F8980',
    fontSize: 20,
    lineHeight: 24,
  },
});
