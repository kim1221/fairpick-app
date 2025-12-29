import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View, Alert, ActivityIndicator, Dimensions, TouchableOpacity, Text } from 'react-native';
import { Txt, Badge, Post, TableRow, FixedBottomCTA, FixedBottomCTAProvider } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import eventService from '../../src/services/eventService';
import { EventCardData } from '../../src/data/events';
import { EventImage } from '../../src/components/EventImage';
import { openKakaoMap, openNaverMap } from '../../src/utils/mapLinks';

// Clipboard 대체: React Native의 기본 Share API 사용
const copyToClipboard = (text: string) => {
  // 임시로 Alert만 표시 (나중에 Clipboard 패키지 설치 후 활성화)
  Alert.alert('주소 정보', text, [
    { text: '확인', style: 'default' }
  ]);
};

type EventDetailParams = {
  id?: string;
};

export const Route = createRoute('/events/:id', {
  component: EventDetailPage,
});

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const IMAGE_HEIGHT = SCREEN_HEIGHT * 0.5;

function EventDetailPage() {
  const adaptive = useAdaptive();
  const params = Route.useParams() as EventDetailParams | undefined;
  const [event, setEvent] = useState<EventCardData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let mounted = true;

    const fetchEvent = async () => {
      if (!params?.id) {
        setStatus('error');
        return;
      }

      setStatus('loading');
      try {
        const data = await eventService.getEventById(params.id);
        if (!mounted) {
          return;
        }
        if (data) {
          setEvent(data);
          setStatus('ready');
        } else {
          setStatus('error');
        }
      } catch {
        if (mounted) {
          setStatus('error');
        }
      }
    };

    fetchEvent();

    return () => {
      mounted = false;
    };
  }, [params?.id]);

  if (status === 'loading') {
    return (
      <View style={[styles.screen, styles.centered, { backgroundColor: adaptive.background }]}>
        <ActivityIndicator color={adaptive.grey600} />
      </View>
    );
  }

  if (!event || status === 'error') {
    return (
      <View style={[styles.screen, styles.centered, { backgroundColor: adaptive.background }]}>
        <Txt typography="t5" color={adaptive.grey600}>
          해당 행사를 찾을 수 없어요.
        </Txt>
      </View>
    );
  }

  const handleOpenLink = async () => {
    try {
      const supported = await Linking.canOpenURL(event.detailLink);
      if (!supported) {
        throw new Error('링크를 열 수 없습니다.');
      }
      await Linking.openURL(event.detailLink);
    } catch {
      Alert.alert('열기 실패', '외부 페이지를 열 수 없습니다. 잠시 후 다시 시도해 주세요.');
    }
  };

  return (
    <FixedBottomCTAProvider>
      <ScrollView style={[styles.screen, { backgroundColor: adaptive.background }]} contentContainerStyle={styles.scrollContent}>
        <EventImage
          uri={event.detailImageUrl}
          height={IMAGE_HEIGHT}
          borderRadius={0}
          resizeMode="contain"
          accessibilityLabel={`${event.title} 대표 이미지`}
        />
        <View style={[styles.contentCard, { backgroundColor: adaptive.background }]}>
          <View style={styles.badgeRow}>
            <Badge key={`${event.id}-region`} style={styles.badge}>
              {event.region}
            </Badge>
            {getDisplayTagsForDetail(event).map((tag, index) => (
              <Badge key={`${event.id}-tag-${index}-${tag}`} style={styles.badge}>
                {tag}
              </Badge>
            ))}
          </View>
          <Post.H2 paddingBottom={16}>{event.title}</Post.H2>
          <View style={styles.table}>
            <TableRow
              align="right"
              left={<TableRow.LeftText>일시</TableRow.LeftText>}
              right={
                <TableRow.RightText color={adaptive.grey700} fontWeight="medium">
                  {event.periodText}
                </TableRow.RightText>
              }
              leftRatio={30}
            />
            <TableRow
              align="right"
              left={<TableRow.LeftText>장소</TableRow.LeftText>}
              right={
                <TableRow.RightText color={adaptive.grey700} fontWeight="medium">
                  {event.venue || event.region}
                </TableRow.RightText>
              }
              leftRatio={30}
            />
          </View>

          {/* 지도 및 주소 섹션 */}
          {event.venue && (
            <View style={styles.mapSection}>
              {/* 주소 정보 및 복사 버튼 */}
              <View style={styles.addressCard}>
                <View style={styles.addressInfo}>
                  <Text style={styles.venueTitle}>{event.venue}</Text>
                  {event.address && (
                    <Text style={styles.addressText}>{event.address}</Text>
                  )}
                </View>
                
                {/* 주소 복사 버튼 */}
                <TouchableOpacity
                  style={styles.copyButton}
                  onPress={() => {
                    const text = event.address
                      ? `${event.venue}\n${event.address}`
                      : event.venue;
                    copyToClipboard(text);
                  }}
                >
                  <Text style={styles.copyIcon}>📋</Text>
                  <Text style={styles.copyLabel}>주소 보기</Text>
                </TouchableOpacity>
              </View>
              
              {/* 구분선 */}
              <View style={styles.divider} />
              
              {/* 지도 앱 연동 버튼 */}
              {event.lat && event.lng && (
                <View style={styles.mapButtons}>
                  <TouchableOpacity
                    style={styles.mapButton}
                    onPress={() => openKakaoMap(event.lat!, event.lng!, event.venue)}
                  >
                    <Text style={styles.mapButtonText}>🗺️ 카카오맵에서 보기</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={styles.mapButton}
                    onPress={() => openNaverMap(event.lat!, event.lng!, event.venue)}
                  >
                    <Text style={styles.mapButtonText}>🗺️ 네이버지도에서 보기</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {event.overview ? (
            <View style={styles.overviewSection}>
              <Txt typography="t5" fontWeight="bold" color={adaptive.grey900} style={styles.overviewTitle}>
                개요
              </Txt>
              <Txt typography="t6" color={adaptive.grey700} style={styles.overviewText}>
                {event.overview}
              </Txt>
            </View>
          ) : null}
        </View>
      </ScrollView>
      <FixedBottomCTA loading={false} onPress={handleOpenLink}>
        자세히 보기
      </FixedBottomCTA>
    </FixedBottomCTAProvider>
  );
}

function getDisplayTagsForDetail(event: EventCardData): string[] {
  // 홈과 동일한 방어 로직: 주소성 태그 제거 + 중복 제거
  const isLikelyAddress = (value: string) =>
    value.length >= 12 ||
    /\d/.test(value) ||
    value.includes('특별시') ||
    value.includes('광역시') ||
    value.includes('대로') ||
    value.includes('로 ') ||
    value.includes('길 ') ||
    value.includes('번길') ||
    value.includes('번지') ||
    value.includes('동 ') ||
    value.includes('구 ') ||
    value.includes('시 ') ||
    value.includes('군 ');

  const raw = event.tags ?? [];
  const filtered = raw
    .filter((t) => Boolean(t) && t !== event.region)
    .filter((t) => !isLikelyAddress(t))
    .slice(0, 6);

  return [...new Set(filtered)];
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  contentCard: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -24,
  },
  badgeRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  badge: {
    marginRight: 8,
  },
  table: {
    gap: 12,
  },
  overviewSection: {
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#E5E8EB',
  },
  overviewTitle: {
    marginBottom: 12,
  },
  overviewText: {
    lineHeight: 24,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapSection: {
    marginTop: 20,
    backgroundColor: '#FFF',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E5E8EB',
  },
  addressCard: {
    backgroundColor: '#F8F9FA',
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  addressInfo: {
    flex: 1,
  },
  venueTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#191F28',
    marginBottom: 4,
  },
  addressText: {
    fontSize: 13,
    color: '#6B7684',
    lineHeight: 18,
  },
  copyButton: {
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  copyIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  copyLabel: {
    fontSize: 11,
    color: '#3182F6',
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E8EB',
  },
  mapButtons: {
    padding: 16,
  },
  mapButton: {
    backgroundColor: '#F2F4F6',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  mapButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#191F28',
  },
});


