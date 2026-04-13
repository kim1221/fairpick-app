/**
 * TrendCard 컴포넌트
 *
 * TREND 타입 매거진 카드: 인기 순위 리스트 형태
 * 예) "이번 주 뜨는 팝업", "요즘 가장 화제인 전시"
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import { Analytics } from '@apps-in-toss/framework';
import type { FeedEvent } from '../services/feedService';

interface TrendCardProps {
  title: string;
  events: FeedEvent[];
  onPress: (eventId: string) => void;
}

type Adaptive = ReturnType<typeof useAdaptive>;

const createStyles = (a: Adaptive) =>
  StyleSheet.create({
    container: {
      marginHorizontal: 16,
      marginBottom: 16,
      backgroundColor: a.background,
      borderRadius: 16,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.07,
      shadowRadius: 8,
      elevation: 3,
    },
    header: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: a.grey100,
    },
    headerTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: a.grey900,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: a.grey50,
    },
    rowLast: {
      borderBottomWidth: 0,
    },
    rank: {
      width: 24,
      fontSize: 15,
      fontWeight: '700',
      color: a.blue500,
      marginRight: 12,
    },
    rankHigh: {
      color: '#FF3B30',
    },
    thumbnail: {
      width: 48,
      height: 48,
      borderRadius: 8,
      backgroundColor: a.grey100,
      marginRight: 12,
    },
    info: {
      flex: 1,
    },
    eventTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: a.grey900,
      marginBottom: 2,
    },
    meta: {
      fontSize: 12,
      color: a.grey500,
    },
  });

export const TrendCard: React.FC<TrendCardProps> = ({ title, events, onPress }) => {
  const adaptive = useAdaptive();
  const styles = useMemo(() => createStyles(adaptive), [adaptive]);

  const displayEvents = events.slice(0, 5);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
      {displayEvents.map((event, idx) => {
        const isLast = idx === displayEvents.length - 1;
        return (
          <Analytics.Press
            key={event.id}
            params={{ log_name: 'trend_card_item', text: event.title }}
          >
            <Pressable
              style={[styles.row, isLast && styles.rowLast]}
              onPress={() => onPress(event.id)}
              android_ripple={{ color: adaptive.grey100 }}
            >
              <Text style={[styles.rank, idx < 3 && styles.rankHigh]}>
                {idx + 1}
              </Text>
              {event.image_url ? (
                <Image
                  source={{ uri: event.image_url }}
                  style={styles.thumbnail}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.thumbnail, { justifyContent: 'center', alignItems: 'center' }]}>
                  <Text style={{ fontSize: 10, color: adaptive.grey400 }}>{event.main_category}</Text>
                </View>
              )}
              <View style={styles.info}>
                <Text style={styles.eventTitle} numberOfLines={1}>
                  {event.title}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {[event.region, event.venue].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </Pressable>
          </Analytics.Press>
        );
      })}
    </View>
  );
};
