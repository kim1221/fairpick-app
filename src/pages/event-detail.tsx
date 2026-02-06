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
  ActivityIndicator,
  Share,
  Alert,
} from 'react-native';

// API 서비스
import recommendationService from '../services/recommendationService';
import userEventService from '../services/userEventService';
import { getCurrentUserId } from '../utils/anonymousUser';

// 타입
import type { ScoredEvent } from '../types/recommendation';

export const Route = createRoute('/event-detail', {
  component: EventDetailPage,
});

interface RouteParams {
  id: string;
}

// ==================== 메인 컴포넌트 ====================

function EventDetailPage() {
  const navigation = Route.useNavigation();
  const params = Route.useParams<RouteParams>();
  const eventId = params?.id;

  // 상태 관리
  const [event, setEvent] = useState<ScoredEvent | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saved, setSaved] = useState<boolean>(false);

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
    navigation.goBack();
  };

  // 로딩 상태
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3182F6" />
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
        </View>

        {/* 이벤트 정보 */}
        <View style={styles.infoContainer}>
          {/* 제목 */}
          <Text style={styles.title}>{event.title}</Text>

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

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* 하단 액션 버튼 */}
      <View style={styles.bottomActions}>
        <Pressable 
          style={[styles.saveButton, saved && styles.saveButtonActive]}
          onPress={handleSave}
        >
          <Text style={[styles.saveButtonText, saved && styles.saveButtonTextActive]}>
            {saved ? '💙 저장됨' : '🤍 저장'}
          </Text>
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
          <Text style={styles.primaryButtonText}>자세히 보기</Text>
        </Pressable>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6B7280',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 20,
  },
  errorEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 16,
    color: '#6B7280',
    marginBottom: 24,
  },
  errorButton: {
    backgroundColor: '#3182F6',
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
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  backButtonText: {
    fontSize: 16,
    color: '#1A1A1A',
    fontWeight: '600',
  },
  shareButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  shareButtonText: {
    fontSize: 16,
    color: '#3182F6',
    fontWeight: '600',
  },

  scrollView: {
    flex: 1,
  },

  // 이미지
  imageContainer: {
    width: '100%',
    height: 300,
    backgroundColor: '#F3F4F6',
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
    backgroundColor: '#E5E7EB',
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
    color: '#1A1A1A',
    marginBottom: 12,
    lineHeight: 32,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 20,
  },
  tag: {
    backgroundColor: '#EBF0FF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  tagText: {
    color: '#3182F6',
    fontSize: 12,
    fontWeight: '600',
  },

  // 메타 정보
  metaSection: {
    backgroundColor: '#F9FAFB',
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
    color: '#6B7280',
    fontWeight: '600',
    width: 80,
  },
  metaValue: {
    flex: 1,
    fontSize: 14,
    color: '#1A1A1A',
    fontWeight: '500',
  },

  // 설명
  descriptionSection: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    lineHeight: 24,
    color: '#4B5563',
  },

  // 하단 액션
  bottomActions: {
    flexDirection: 'row',
    padding: 16,
    paddingBottom: 24,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    gap: 12,
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonActive: {
    backgroundColor: '#EBF0FF',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#6B7280',
  },
  saveButtonTextActive: {
    color: '#3182F6',
  },
  primaryButton: {
    flex: 2,
    backgroundColor: '#3182F6',
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

