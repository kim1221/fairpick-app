/**
 * HeroCard 컴포넌트
 *
 * HERO 타입 매거진 카드 — full-bleed 이미지 260px
 * - framing_label 칩 (상단 좌측)
 * - 반투명 오버레이
 * - 카테고리 뱃지 + 이벤트 제목 + 장소·지역 (하단)
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import { Analytics } from '@apps-in-toss/framework';
import type { FeedEvent } from '../services/feedService';

export interface HeroCardProps {
  framingLabel: string;
  event: FeedEvent;
  onPress: (eventId: string) => void;
}

type Adaptive = ReturnType<typeof useAdaptive>;

const createStyles = (a: Adaptive) =>
  StyleSheet.create({
    wrapper: {
      marginHorizontal: 16,
      marginBottom: 16,
    },
    container: {
      height: 260,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: a.grey300,
    },
    image: {
      ...StyleSheet.absoluteFillObject,
    },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    chip: {
      position: 'absolute',
      top: 14,
      left: 14,
      backgroundColor: 'rgba(255,255,255,0.22)',
      borderRadius: 20,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.35)',
    },
    chipText: {
      fontSize: 12,
      fontWeight: '700',
      color: '#ffffff',
      letterSpacing: -0.2,
    },
    footer: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      padding: 16,
      gap: 4,
    },
    categoryBadge: {
      alignSelf: 'flex-start',
      backgroundColor: 'rgba(255,255,255,0.2)',
      borderRadius: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
      marginBottom: 4,
    },
    categoryText: {
      fontSize: 11,
      fontWeight: '600',
      color: '#ffffff',
    },
    eventTitle: {
      fontSize: 22,
      fontWeight: '700',
      color: '#ffffff',
      lineHeight: 28,
      letterSpacing: -0.4,
    },
    venueMeta: {
      fontSize: 13,
      color: 'rgba(255,255,255,0.75)',
      marginTop: 2,
    },
  });

export const HeroCard = React.memo(({ framingLabel, event, onPress }: HeroCardProps) => {
  const adaptive = useAdaptive();
  const styles = useMemo(() => createStyles(adaptive), [adaptive]);

  const venueParts = [event.venue, event.region].filter(Boolean);
  const venueLine = venueParts.join(' · ');

  return (
    <Analytics.Press
      params={{ log_name: 'feed_hero_card_press', event_id: event.id, framing_label: framingLabel }}
    >
      <Pressable
        style={styles.wrapper}
        onPress={() => onPress(event.id)}
        android_ripple={{ color: 'rgba(0,0,0,0.1)' }}
      >
        <View style={styles.container}>
          {event.image_url ? (
            <Image
              source={{ uri: event.image_url }}
              style={styles.image}
              resizeMode="cover"
            />
          ) : null}
          <View style={styles.overlay} />

          {/* framing_label 칩 */}
          <View style={styles.chip}>
            <Text style={styles.chipText}>{framingLabel}</Text>
          </View>

          {/* 하단 정보 */}
          <View style={styles.footer}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>{event.main_category}</Text>
            </View>
            <Text style={styles.eventTitle} numberOfLines={2}>
              {event.title}
            </Text>
            {venueLine ? (
              <Text style={styles.venueMeta} numberOfLines={1}>
                {venueLine}
              </Text>
            ) : null}
          </View>
        </View>
      </Pressable>
    </Analytics.Press>
  );
});
