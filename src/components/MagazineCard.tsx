/**
 * MagazineCard 컴포넌트
 *
 * BUNDLE/SPOTLIGHT 타입 매거진 카드
 * - BUNDLE: 헤드라인 + Gemini 소개문 + 이벤트 썸네일 가로 스크롤
 * - SPOTLIGHT: 헤드라인 + Gemini 소개문 + 단일 이벤트 크게
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Image, ScrollView } from 'react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import { Analytics } from '@apps-in-toss/framework';
import type { FeedEvent } from '../services/feedService';

interface MagazineCardProps {
  contentType: 'BUNDLE' | 'SPOTLIGHT';
  title: string;
  body: string | null;
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
      paddingBottom: body => (body ? 4 : 12),
    },
    badge: {
      alignSelf: 'flex-start',
      backgroundColor: a.blue50,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
      marginBottom: 8,
    },
    badgeText: {
      fontSize: 11,
      fontWeight: '600',
      color: a.blue500,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: a.grey900,
      lineHeight: 24,
    },
    body: {
      fontSize: 13,
      color: a.grey600,
      lineHeight: 19,
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    // BUNDLE: 가로 스크롤 썸네일
    thumbnailScroll: {
      paddingLeft: 16,
      paddingBottom: 16,
    },
    thumbnailItem: {
      width: 120,
      marginRight: 10,
    },
    thumbnail: {
      width: 120,
      height: 90,
      borderRadius: 10,
      backgroundColor: a.grey100,
      marginBottom: 6,
    },
    thumbnailTitle: {
      fontSize: 12,
      fontWeight: '600',
      color: a.grey800,
      lineHeight: 16,
    },
    thumbnailMeta: {
      fontSize: 11,
      color: a.grey400,
      marginTop: 1,
    },
    // SPOTLIGHT: 단일 이벤트 크게
    spotlightImage: {
      width: '100%',
      height: 180,
      backgroundColor: a.grey100,
    },
    spotlightInfo: {
      padding: 16,
    },
    spotlightTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: a.grey900,
      marginBottom: 4,
    },
    spotlightMeta: {
      fontSize: 13,
      color: a.grey500,
    },
  });

export const MagazineCard: React.FC<MagazineCardProps> = ({
  contentType,
  title,
  body,
  events,
  onPress,
}) => {
  const adaptive = useAdaptive();
  const styles = useMemo(() => createStyles(adaptive), [adaptive]);

  if (contentType === 'SPOTLIGHT' && events.length > 0) {
    const event = events[0]!;
    return (
      <Analytics.Press params={{ log_name: 'spotlight_card', text: title }}>
        <Pressable
          style={styles.container}
          onPress={() => onPress(event.id)}
          android_ripple={{ color: adaptive.grey100 }}
        >
          <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 }}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>에디터 추천</Text>
            </View>
            <Text style={styles.headerTitle}>{title}</Text>
          </View>
          {body ? <Text style={styles.body}>{body}</Text> : null}
          {event.image_url ? (
            <Image
              source={{ uri: event.image_url }}
              style={styles.spotlightImage}
              resizeMode="cover"
            />
          ) : null}
          <View style={styles.spotlightInfo}>
            <Text style={styles.spotlightTitle} numberOfLines={2}>
              {event.title}
            </Text>
            <Text style={styles.spotlightMeta}>
              {[event.region, event.venue].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </Pressable>
      </Analytics.Press>
    );
  }

  // BUNDLE
  return (
    <View style={styles.container}>
      <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: body ? 4 : 12 }}>
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.thumbnailScroll}
        removeClippedSubviews
      >
        {events.slice(0, 6).map((event) => (
          <Analytics.Press
            key={event.id}
            params={{ log_name: 'bundle_card_item', text: event.title }}
          >
            <Pressable
              style={styles.thumbnailItem}
              onPress={() => onPress(event.id)}
              android_ripple={{ color: adaptive.grey100 }}
            >
              {event.image_url ? (
                <Image
                  source={{ uri: event.image_url }}
                  style={styles.thumbnail}
                  resizeMode="cover"
                />
              ) : (
                <View
                  style={[
                    styles.thumbnail,
                    { justifyContent: 'center', alignItems: 'center', backgroundColor: adaptive.grey100 },
                  ]}
                >
                  <Text style={{ fontSize: 11, color: adaptive.grey400 }}>{event.main_category}</Text>
                </View>
              )}
              <Text style={styles.thumbnailTitle} numberOfLines={2}>
                {event.title}
              </Text>
              <Text style={styles.thumbnailMeta} numberOfLines={1}>
                {event.region ?? ''}
              </Text>
            </Pressable>
          </Analytics.Press>
        ))}
      </ScrollView>
    </View>
  );
};
