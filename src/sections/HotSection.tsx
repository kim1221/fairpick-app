import React from 'react';
import { ScrollView, StyleSheet, View, Dimensions } from 'react-native';
import { Txt } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import { EventCardData } from '../data/events';
import { RankingCard } from '../components/RankingCard';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_WIDTH = SCREEN_WIDTH * 0.85;
const CARD_SPACING = 12;

interface HotSectionProps {
  items: EventCardData[];
  onPressItem: (id: string) => void;
}

export function HotSection({ items, onPressItem }: HotSectionProps) {
  const adaptive = useAdaptive();

  if (items.length === 0) {
    return null;
  }

  const handlePress = (event: EventCardData) => {
    onPressItem(event.id);
  };

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
      <View style={styles.header}>
        <Txt typography="h3" fontWeight="bold" color={adaptive.grey900}>
          🔥 HOT
        </Txt>
        <Txt typography="t6" color={adaptive.grey600} style={styles.subtitle}>
          지금 가장 인기 있는 이벤트
        </Txt>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        snapToInterval={CARD_WIDTH + CARD_SPACING}
        decelerationRate="fast"
      >
        {items.map((event, index) => (
          <View
            key={event.id}
            style={[
              styles.cardWrapper,
              index === 0 && styles.cardFirst,
              index === items.length - 1 && styles.cardLast,
            ]}
          >
            <RankingCard event={event} rank={index + 1} onPress={handlePress} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
    borderRadius: 16,
    paddingVertical: 20,
    shadowColor: '#001733',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  subtitle: {
    marginTop: 4,
  },
  scrollContent: {
    paddingHorizontal: 20 - CARD_SPACING / 2,
  },
  cardWrapper: {
    width: CARD_WIDTH,
    marginHorizontal: CARD_SPACING / 2,
  },
  cardFirst: {
    marginLeft: 0,
  },
  cardLast: {
    marginRight: 0,
  },
});
