/**
 * 이벤트 상세 페이지
 *
 * 이벤트의 상세 정보를 표시하고 사용자 행동(저장, 공유)을 처리합니다.
 */

import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  Text,
  Image,
  Pressable,
  Share,
  Alert,
} from 'react-native';
import { Loader } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import { InlineAd } from '@apps-in-toss/framework';

// API 서비스
import recommendationService from '../services/recommendationService';
import userEventService from '../services/userEventService';

// 타입
import type { ScoredEvent } from '../types/recommendation';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createRoute as any)('/event-detail', {
  component: EventDetailPage,
});

interface RouteParams {
  id: string;
}

type Adaptive = ReturnType<typeof useAdaptive>;

// ==================== 메인 컴포넌트 ====================

function EventDetailPage() {
  console.log('❌ LEGACY event-detail.tsx HIT - 이 파일은 렌더링되면 안 됨!');

  const navigation = Route.useNavigation();
  const params = (Route.useParams as () => RouteParams)();
  const eventId = params?.id;

  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);

  // 상태 관리
  const [event, setEvent] = useState<ScoredEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (eventId) {
      loadEventDetail(eventId);
      logView(eventId);
    }
  }, [eventId]);

  const loadEventDetail = async (id: string) => {
    try {
      setLoading(true);

      const response = await recommendationService.getEventDetail(id);

      if (response.success && response.data) {
        setEvent(response.data);
        console.log('[EventDetail] Loaded event:', response.data.title);
      } else {
        setEvent(null);
        Alert.alert('오류', response.error || '이벤트 정보를 불러올 수 없습니다.');
      }
    } catch (error: any) {
      console.error('[EventDetail] Failed to load event:', error);
      Alert.alert('오류', error.message || '이벤트 정보를 불러올 수 없습니다.');
      setEvent(null);
    } finally {
      setLoading(false);
    }
  };

  const logView = async (id: string) => {
    try {
      await userEventService.logEventView(id);
      console.log('[EventDetail] View logged');
    } catch (error) {
      console.error('[EventDetail] Failed to log view:', error);
    }
  };

  const handleSave = async () => {
    if (!eventId) return;

    try {
      if (saved) {
        await userEventService.logEventUnsave(eventId);
        setSaved(false);
        Alert.alert('저장 취소', '저장 목록에서 제거되었습니다.');
      } else {
        await userEventService.logEventSave(eventId);
        setSaved(true);
        Alert.alert('저장 완료', '저장 목록에 추가되었습니다.');
      }
    } catch (error) {
      console.error('[EventDetail] Failed to save/unsave:', error);
      Alert.alert('오류', '저장에 실패했습니다.');
    }
  };

  const handleShare = async () => {
    if (!event) return;

    try {
      const result = await Share.share({
        message: `${event.title}\n${event.detail_link || ''}`,
        title: event.title,
      });

      if (result.action === Share.sharedAction && eventId) {
        await userEventService.logEventShare(eventId, 'other');
        console.log('[EventDetail] Share logged');
      }
    } catch (error) {
      console.error('[EventDetail] Failed to share:', error);
      Alert.alert('오류', '공유에 실패했습니다.');
    }
  };

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  // 로딩 상태
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Loader size="large" type="primary" />
        <Text style={styles.loadingText}>이벤트 정보를 불러오는 중...</Text>
      </View>
    );
  }

  // 이벤트가 없는 경우
  if (!event) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorEmoji}>😢</Text>
        <Text style={styles.errorText}>이벤트를 찾을 수 없습니다</Text>
        <Pressable style={styles.errorButton} onPress={handleBack}>
          <Text style={styles.errorButtonText}>돌아가기</Text>
        </Pressable>
      </View>
    );
  }

  // 메인 렌더링
  return (
    <View style={styles.container}>
      {/* 🟡 Phase 2A 디버그 배너 (항상 표시) */}
      <View style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        elevation: 99999,
        backgroundColor: '#FFD400',
        paddingTop: 44,
        paddingBottom: 8,
        alignItems: 'center',
      }}>
        <Text style={{ fontWeight: '900', color: '#000', fontSize: 14 }}>
          ✅ Phase2A ACTIVE: event-detail.tsx
        </Text>
      </View>

      {/* 상단 헤더 */}
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>← 뒤로</Text>
        </Pressable>
        <Pressable style={styles.shareButton} onPress={handleShare}>
          <Text style={styles.shareButtonText}>공유</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* 이벤트 이미지 */}
        <View style={styles.imageContainer}>
          {event.thumbnail_url ? (
            <Image
              source={{ uri: event.thumbnail_url }}
              style={styles.image}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.placeholderImage}>
              <Text style={styles.placeholderEmoji}>🖼️</Text>
            </View>
          )}

          {/* 카테고리 배지 */}
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryBadgeText}>{event.category}</Text>
          </View>

          {/* Phase 2A: 상태 배지 (우측 상단) */}
          <View style={{
            position: 'absolute',
            top: 16,
            right: 16,
            flexDirection: 'column',
            gap: 8,
          }}>
            {event.is_ending_soon && (
              <View style={{
                backgroundColor: '#FF3B30',
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 12,
              }}>
                <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>
                  ⏰ 마감임박
                </Text>
              </View>
            )}
            {event.is_free && (
              <View style={{
                backgroundColor: '#34C759',
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 12,
              }}>
                <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>
                  💰 무료
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* 이벤트 정보 */}
        <View style={styles.infoContainer}>
          {/* 제목 */}
          <Text style={styles.title}>{event.title}</Text>

          {/* Phase 2A: 초록 디버그 박스 */}
          <View style={{ backgroundColor: '#00FF00', padding: 8, marginVertical: 12, borderRadius: 8 }}>
            <Text style={{ fontWeight: '900', color: '#000', fontSize: 16, textAlign: 'center' }}>
              ✅ Phase2A: 핵심 정보 영역
            </Text>
          </View>

          {/* Phase 2A: Key Info Grid (2x2) */}
          <View style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            marginBottom: 16,
            gap: 12,
          }}>
            {/* 기간 */}
            {event.start_date && event.end_date && (
              <View style={{
                flex: 1,
                minWidth: '45%',
                backgroundColor: adaptive.grey100,
                padding: 16,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: adaptive.grey200,
              }}>
                <Text style={{ fontSize: 24, marginBottom: 8 }}>📅</Text>
                <Text style={{ fontSize: 12, color: adaptive.grey500, marginBottom: 4 }}>기간</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: adaptive.grey900 }}>
                  {formatDate(event.start_date)}
                </Text>
                <Text style={{ fontSize: 12, color: adaptive.grey500 }}>~</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: adaptive.grey900 }}>
                  {formatDate(event.end_date)}
                </Text>
              </View>
            )}

            {/* 장소 */}
            {event.venue && (
              <View style={{
                flex: 1,
                minWidth: '45%',
                backgroundColor: adaptive.grey100,
                padding: 16,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: adaptive.grey200,
              }}>
                <Text style={{ fontSize: 24, marginBottom: 8 }}>📍</Text>
                <Text style={{ fontSize: 12, color: adaptive.grey500, marginBottom: 4 }}>장소</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: adaptive.grey900 }} numberOfLines={2}>
                  {event.venue}
                </Text>
              </View>
            )}

            {/* 가격 */}
            <View style={{
              flex: 1,
              minWidth: '45%',
              backgroundColor: adaptive.grey100,
              padding: 16,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: adaptive.grey200,
            }}>
              <Text style={{ fontSize: 24, marginBottom: 8 }}>💰</Text>
              <Text style={{ fontSize: 12, color: adaptive.grey500, marginBottom: 4 }}>가격</Text>
              <Text style={{ fontSize: 14, fontWeight: '600', color: adaptive.grey900 }}>
                {event.is_free ? '무료' : '유료'}
              </Text>
            </View>

            {/* 거리 */}
            {event.distance_km !== undefined && (
              <View style={{
                flex: 1,
                minWidth: '45%',
                backgroundColor: adaptive.grey100,
                padding: 16,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: adaptive.grey200,
              }}>
                <Text style={{ fontSize: 24, marginBottom: 8 }}>🚶</Text>
                <Text style={{ fontSize: 12, color: adaptive.grey500, marginBottom: 4 }}>거리</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: adaptive.grey900 }}>
                  {formatDistance(event.distance_km)}
                </Text>
              </View>
            )}
          </View>

          {/* 태그 */}
          {event.reason && event.reason.length > 0 && (
            <View style={styles.tagsContainer}>
              {event.reason.map((tag, idx) => (
                <View key={idx} style={styles.tag}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* 기본 정보 */}
          <View style={styles.metaSection}>
            {event.start_date && event.end_date && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>📅 기간</Text>
                <Text style={styles.metaValue}>
                  {formatDate(event.start_date)} - {formatDate(event.end_date)}
                </Text>
              </View>
            )}

            {event.venue && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>📍 장소</Text>
                <Text style={styles.metaValue}>{event.venue}</Text>
              </View>
            )}

            {event.distance_km !== undefined && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>🚶 거리</Text>
                <Text style={styles.metaValue}>
                  {formatDistance(event.distance_km)}
                </Text>
              </View>
            )}
          </View>

          {/* 설명 */}
          {event.description && (
            <View style={styles.descriptionSection}>
              <Text style={styles.sectionTitle}>상세 정보</Text>
              <Text style={styles.description}>{event.description}</Text>
            </View>
          )}

          {/* TODO: 추가 정보 섹션 */}
          {/* - 운영 시간
              - 요금
              - 주차 정보
              - 교통편
              - 기타 메타데이터 */}
        </View>

        {/* 하단 여백: 배너(96) + 액션바 높이만큼 확보 */}
        <View style={{ height: 200 }} />
      </ScrollView>

      {/* 하단 영역: 배너 광고 + 액션 바 */}
      <View style={styles.bottomArea}>
        <View style={styles.adBannerContainer}>
          <InlineAd
            adGroupId="ait-ad-test-banner-id"
            impressFallbackOnMount={true}
          />
        </View>
        <View style={styles.bottomActions}>
          <Pressable
            style={[styles.saveButton, saved && styles.saveButtonActive]}
            onPress={handleSave}
          >
            <Text style={[styles.saveButtonText, saved && styles.saveButtonTextActive]}>
              {saved ? '💙' : '🤍'}
            </Text>
          </Pressable>

          <Pressable
            style={styles.shareButton2}
            onPress={handleShare}
          >
            <Text style={styles.shareButtonText2}>🔗</Text>
          </Pressable>

          <Pressable
            style={styles.primaryButton}
            onPress={() => {
              // TODO: 티켓 예매 또는 상세 링크로 이동
              if (event.detail_link) {
                Alert.alert('알림', '외부 링크로 이동합니다.');
              }
            }}
          >
            <Text style={styles.primaryButtonText}>[CTA] 예매하기</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ==================== 헬퍼 함수 ====================

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}.${month}.${day}`;
  } catch {
    return dateString;
  }
}

function formatDistance(distanceKm: number): string {
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)}m`;
  return `${distanceKm.toFixed(1)}km`;
}

// ==================== 스타일 ====================

const createStyles = (a: Adaptive) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: a.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: a.background,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: a.grey500,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: a.background,
    padding: 20,
  },
  errorEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 16,
    color: a.grey500,
    marginBottom: 24,
  },
  errorButton: {
    backgroundColor: a.blue500,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  errorButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },

  // 헤더
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 50,
    backgroundColor: a.background,
    borderBottomWidth: 1,
    borderBottomColor: a.grey200,
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  backButtonText: {
    fontSize: 16,
    color: a.grey900,
    fontWeight: '600',
  },
  shareButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  shareButtonText: {
    fontSize: 16,
    color: a.blue500,
    fontWeight: '600',
  },

  scrollView: {
    flex: 1,
  },

  // 이미지
  imageContainer: {
    width: '100%',
    height: 300,
    backgroundColor: a.grey100,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholderImage: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: a.grey200,
  },
  placeholderEmoji: {
    fontSize: 80,
  },
  categoryBadge: {
    position: 'absolute',
    top: 16,
    left: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  categoryBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },

  // 정보 섹션
  infoContainer: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: a.grey900,
    marginBottom: 12,
    lineHeight: 32,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 20,
  },
  tag: {
    backgroundColor: a.blue50,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  tagText: {
    color: a.blue500,
    fontSize: 12,
    fontWeight: '600',
  },

  // 메타 정보
  metaSection: {
    backgroundColor: a.grey100,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  metaLabel: {
    fontSize: 14,
    color: a.grey500,
    fontWeight: '600',
    width: 80,
  },
  metaValue: {
    flex: 1,
    fontSize: 14,
    color: a.grey900,
    fontWeight: '500',
  },

  // 설명
  descriptionSection: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: a.grey900,
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    lineHeight: 24,
    color: a.grey700,
  },

  // 하단 영역 (배너 + 액션바 wrapper)
  bottomArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 99999,
    elevation: 99999,
    backgroundColor: a.background,
  },
  adBannerContainer: {
    width: '100%',
    height: 96,
    overflow: 'hidden',
  },
  // 하단 액션
  bottomActions: {
    flexDirection: 'row',
    padding: 16,
    paddingBottom: 24,
    backgroundColor: a.background,
    borderTopWidth: 1,
    borderTopColor: a.grey200,
    gap: 12,
  },
  saveButton: {
    flex: 1,
    backgroundColor: a.grey100,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonActive: {
    backgroundColor: a.blue50,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: a.grey500,
  },
  saveButtonTextActive: {
    color: a.blue500,
  },
  shareButton2: {
    flex: 1,
    backgroundColor: a.grey100,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButtonText2: {
    fontSize: 18,
    fontWeight: '600',
  },
  primaryButton: {
    flex: 3,
    backgroundColor: a.blue500,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

export default EventDetailPage;
