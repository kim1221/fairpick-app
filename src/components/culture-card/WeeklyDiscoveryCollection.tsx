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
        <View style={styles.countBadge}>
          <Text style={styles.count}>{discovery.openedCount}</Text>
        </View>
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
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD8CE',
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
    color: '#3157D5',
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '800',
  },
  title: {
    marginTop: 4,
    color: '#171717',
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  countBadge: {
    minWidth: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EEF1FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    color: '#3157D5',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '900',
  },
  description: {
    marginTop: 9,
    color: '#6F6B65',
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
    borderTopColor: '#ECE8E0',
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
    color: '#3157D5',
    fontSize: 10.5,
    lineHeight: 15,
    fontWeight: '800',
  },
  cardTitle: {
    marginTop: 2,
    color: '#171717',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  meta: {
    marginTop: 1,
    color: '#817C74',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  chevron: {
    marginLeft: 10,
    color: '#817C74',
    fontSize: 20,
    lineHeight: 24,
  },
});
