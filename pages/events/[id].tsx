import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View, Alert, ActivityIndicator, Dimensions, TouchableOpacity, Text } from 'react-native';
import { Txt, Badge, Post, TableRow, FixedBottomCTA, FixedBottomCTAProvider } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import eventService from '../../src/services/eventService';
import { EventCardData } from '../../src/data/events';
import { EventImage } from '../../src/components/EventImage';
import { openKakaoMap, openNaverMap } from '../../src/utils/mapLinks';
import { pushRecent, toggleLike, getLikes } from '../../src/utils/storage';
import { updateProfileOnView, updateProfileOnAction } from '../../src/utils/userProfile';
import { computePersonalScoreForEvent, formatPersonalScoreDebug } from '../../src/utils/personalScore';

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
  const [isLiked, setIsLiked] = useState<boolean>(false);

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

          // [STEP 2] pushRecent 호출 추가
          try {
            console.log('[EventDetail][Recent] pushRecent start', {
              routeId: params.id,
              eventId: data.id,
              timestamp: new Date().toISOString()
            });
            await pushRecent(data.id);
            console.log('[EventDetail][Recent] pushRecent done', {
              eventId: data.id,
              timestamp: new Date().toISOString()
            });
          } catch (error) {
            console.error('[EventDetail][Recent] pushRecent failed', {
              error,
              errorMessage: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : undefined
            });
          }

          // [Phase 2-A] 프로필 업데이트 (view)
          try {
            console.log('[EventDetail][UserProfile] updateProfileOnView start', {
              eventId: data.id,
              region: data.region,
              mainCategory: data.mainCategory,
              isFree: data.isFree,
            });
            await updateProfileOnView({
              eventId: data.id,
              region: data.region,
              mainCategory: data.mainCategory,
              startAt: data.startAt,
              isFree: data.isFree,
            });
            console.log('[EventDetail][UserProfile] updateProfileOnView done');
          } catch (error) {
            console.error('[EventDetail][UserProfile] updateProfileOnView failed (non-critical)', {
              error,
              errorMessage: error instanceof Error ? error.message : String(error),
            });
          }

          // [Phase 2-B] Personal Score 계산 (개발 모드만)
          if (__DEV__) {
            try {
              const personalScoreResult = await computePersonalScoreForEvent({
                id: data.id,
                title: data.title,
                region: data.region,
                category: data.mainCategory,
                start_at: data.startAt,
                is_free: data.isFree,
              });
              console.log(formatPersonalScoreDebug(personalScoreResult));
            } catch (error) {
              console.warn('[PersonalScore] 계산 실패 (non-critical):', error);
            }
          }

          // [STEP 4] 찜 상태 로드
          try {
            console.log('[EventDetail][Like] Loading like status...', { eventId: data.id });
            const likes = await getLikes();
            const liked = likes.includes(data.id);
            setIsLiked(liked);
            console.log('[EventDetail][Like] Like status loaded', {
              eventId: data.id,
              liked,
              totalLikes: likes.length
            });
          } catch (error) {
            console.error('[EventDetail][Like] Failed to load like status', {
              error,
              errorMessage: error instanceof Error ? error.message : String(error)
            });
          }
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
    const detailLink = event.detailLink?.trim();
    if (!detailLink) {
      Alert.alert('링크 없음', '상세 페이지 링크가 제공되지 않았습니다.');
      return;
    }

    try {
      const supported = await Linking.canOpenURL(detailLink);
      if (!supported) {
        throw new Error('링크를 열 수 없습니다.');
      }
      await Linking.openURL(detailLink);
    } catch {
      Alert.alert('열기 실패', '외부 페이지를 열 수 없습니다. 잠시 후 다시 시도해 주세요.');
    }
  };

  const handleToggleLike = async () => {
    if (!event) return;

    try {
      console.log('[EventDetail][Like][Toggle] Starting...', {
        eventId: event.id,
        currentState: isLiked,
        timestamp: new Date().toISOString()
      });

      const result = await toggleLike(event.id);
      setIsLiked(result.liked);

      console.log('[EventDetail][Like][Toggle] Success', {
        eventId: event.id,
        newState: result.liked,
        totalLikes: result.likes.length,
        timestamp: new Date().toISOString()
      });

      // [Phase 2-A] 프로필 업데이트 (action: like) - 찜 추가 시에만
      if (result.liked) {
        try {
          console.log('[EventDetail][UserProfile] updateProfileOnAction start (like)', {
            eventId: event.id,
          });
          await updateProfileOnAction({
            eventId: event.id,
            actionType: 'like',
            region: event.region,
            mainCategory: event.mainCategory,
            startAt: event.startAt,
            isFree: event.isFree,
          });
          console.log('[EventDetail][UserProfile] updateProfileOnAction done');
        } catch (error) {
          console.error('[EventDetail][UserProfile] updateProfileOnAction failed (non-critical)', {
            error,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // 사용자 피드백
      Alert.alert(
        result.liked ? '찜 완료' : '찜 해제',
        result.liked ? '이벤트를 찜 목록에 추가했어요.' : '이벤트를 찜 목록에서 제거했어요.',
        [{ text: '확인', style: 'default' }]
      );
    } catch (error) {
      console.error('[EventDetail][Like][Toggle] Failed', {
        error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });
      Alert.alert('오류', '찜하기에 실패했습니다. 다시 시도해 주세요.');
    }
  };

  if (__DEV__) {
    console.log('[EventImage] detail category:', event.category, 'main:', event.mainCategory, 'sub:', event.subCategory);
  }

  return (
    <FixedBottomCTAProvider>
      <ScrollView style={[styles.screen, { backgroundColor: adaptive.background }]} contentContainerStyle={styles.scrollContent}>
        <EventImage
          uri={event.detailImageUrl}
          height={IMAGE_HEIGHT}
          borderRadius={0}
          resizeMode="contain"
          category={event.category}
          accessibilityLabel={`${event.title} 대표 이미지`}
        />

        {/* 찜하기 버튼 (Floating) */}
        <TouchableOpacity
          style={styles.likeButton}
          onPress={handleToggleLike}
          activeOpacity={0.7}
          accessibilityLabel={isLiked ? '찜 해제하기' : '찜하기'}
        >
          <Text style={styles.likeIcon}>{isLiked ? '❤️' : '🤍'}</Text>
        </TouchableOpacity>

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
  likeButton: {
    position: 'absolute',
    top: 60, // Safe area + padding
    right: 20,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    // Toss 감성: 그림자
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    zIndex: 10,
  },
  likeIcon: {
    fontSize: 28,
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
