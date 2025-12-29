import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, ActivityIndicator, Pressable } from 'react-native';
import { Txt, Post, Badge } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import eventService from '../../services/eventService';
import { EventCardData } from '../../data/events';
import { EventImage } from '../../components/EventImage';
import http from '../../lib/http';
import { openKakaoMap, openNaverMap, copyAddress } from '../../lib/mapLinks';

export const Route = createRoute('/events/:id', {
  component: Page,
});

function Page() {
  const adaptive = useAdaptive();
  const { id } = Route.useParams();
  const [event, setEvent] = useState<EventCardData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let mounted = true;

    const fetchEventAndRecordView = async () => {
      setStatus('loading');
      try {
        // 1. 이벤트 데이터 조회
        const eventData = await eventService.getEventById(id);
        if (!mounted) {
          return;
        }

        if (!eventData) {
          setStatus('error');
          return;
        }

        setEvent(eventData);
        setStatus('ready');

        // 2. 조회수 기록 (비동기, 에러 무시)
        try {
          await http.post(`/events/${id}/view`);
        } catch (viewError) {
          console.warn('[EventDetail] Failed to record view:', viewError);
          // UX에 영향 없도록 조용히 처리
        }
      } catch (error) {
        console.error('[EventDetail] Failed to fetch event:', error);
        if (mounted) {
          setStatus('error');
        }
      }
    };

    fetchEventAndRecordView();

    return () => {
      mounted = false;
    };
  }, [id]);

  if (status === 'loading') {
    return (
      <View style={[styles.container, { backgroundColor: adaptive.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={adaptive.grey600} />
          <Txt typography="t6" color={adaptive.grey600} style={styles.loadingText}>
            불러오는 중...
          </Txt>
        </View>
      </View>
    );
  }

  if (status === 'error' || !event) {
    return (
      <View style={[styles.container, { backgroundColor: adaptive.background }]}>
        <View style={styles.errorContainer}>
          <Txt typography="h3" fontWeight="bold" color={adaptive.grey900}>
            이벤트를 찾을 수 없어요
          </Txt>
          <Txt typography="t6" color={adaptive.grey600} style={styles.errorText}>
            종료되었거나 삭제된 이벤트입니다.
          </Txt>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: adaptive.background }]}>
      <View style={styles.content}>
        {/* 이미지 */}
        <EventImage
          uri={event.thumbnailUrl}
          height={300}
          borderRadius={0}
          accessibilityLabel={`${event.title} 대표 이미지`}
          style={styles.mainImage}
          category={event.category}
        />

        {/* 본문 */}
        <View style={styles.body}>
          {/* 배지 영역 */}
          <View style={styles.badgeRow}>
            <Badge style={styles.badge}>{event.region}</Badge>
            <Badge style={styles.badge}>{event.category}</Badge>
          </View>

          {/* 제목 */}
          <Post.H1 style={styles.title}>{event.title}</Post.H1>

          {/* 기간 */}
          <View style={styles.infoRow}>
            <Txt typography="t6" fontWeight="bold" color={adaptive.grey900}>
              기간
            </Txt>
            <Txt typography="t6" color={adaptive.grey700}>
              {event.periodText}
            </Txt>
          </View>

          {/* 장소 */}
          {event.venue ? (
            <View style={styles.infoRow}>
              <Txt typography="t6" fontWeight="bold" color={adaptive.grey900}>
                장소
              </Txt>
              <Txt typography="t6" color={adaptive.grey700}>
                {event.venue}
              </Txt>
            </View>
          ) : null}

          {/* 설명 */}
          {event.description ? (
            <View style={styles.descriptionSection}>
              <Txt typography="t6" fontWeight="bold" color={adaptive.grey900} style={styles.sectionTitle}>
                소개
              </Txt>
              <Post.Paragraph typography="t6" color={adaptive.grey800}>
                {event.description}
              </Post.Paragraph>
            </View>
          ) : null}

          {/* Overview */}
          {event.overview ? (
            <View style={styles.descriptionSection}>
              <Txt typography="t6" fontWeight="bold" color={adaptive.grey900} style={styles.sectionTitle}>
                상세 정보
              </Txt>
              <Post.Paragraph typography="t7" color={adaptive.grey700}>
                {event.overview}
              </Post.Paragraph>
            </View>
          ) : null}

          {/* 주소 및 지도 */}
          {event.address || (event.lat && event.lng) ? (
            <View style={styles.addressSection}>
              <Txt typography="t6" fontWeight="bold" color={adaptive.grey900} style={styles.sectionTitle}>
                위치
              </Txt>

              {event.address ? (
                <Txt typography="t6" color={adaptive.grey700} style={styles.addressText}>
                  {event.address}
                </Txt>
              ) : null}

              <View style={styles.mapButtons}>
                {event.address ? (
                  <Pressable
                    style={[styles.mapButton, { backgroundColor: adaptive.grey100 }]}
                    onPress={() => copyAddress(event.address!)}
                  >
                    <Txt typography="t7" fontWeight="semibold" color={adaptive.grey900}>
                      주소 복사
                    </Txt>
                  </Pressable>
                ) : null}

                {event.lat && event.lng ? (
                  <>
                    <Pressable
                      style={[styles.mapButton, { backgroundColor: adaptive.grey100 }]}
                      onPress={() =>
                        openKakaoMap({
                          lat: event.lat!,
                          lng: event.lng!,
                          name: event.title,
                        })
                      }
                    >
                      <Txt typography="t7" fontWeight="semibold" color={adaptive.grey900}>
                        카카오맵으로 보기
                      </Txt>
                    </Pressable>

                    <Pressable
                      style={[styles.mapButton, { backgroundColor: adaptive.grey100 }]}
                      onPress={() =>
                        openNaverMap({
                          lat: event.lat!,
                          lng: event.lng!,
                          name: event.title,
                          address: event.address,
                        })
                      }
                    >
                      <Txt typography="t7" fontWeight="semibold" color={adaptive.grey900}>
                        네이버지도로 보기
                      </Txt>
                    </Pressable>
                  </>
                ) : null}
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
  },
  loadingText: {
    marginTop: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
    paddingHorizontal: 40,
  },
  errorText: {
    marginTop: 12,
    textAlign: 'center',
  },
  mainImage: {
    width: '100%',
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  badge: {
    marginRight: 8,
    marginBottom: 8,
  },
  title: {
    marginBottom: 24,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.06)',
  },
  descriptionSection: {
    marginTop: 32,
  },
  sectionTitle: {
    marginBottom: 12,
  },
  addressSection: {
    marginTop: 32,
  },
  addressText: {
    marginBottom: 16,
    lineHeight: 22,
  },
  mapButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  mapButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
