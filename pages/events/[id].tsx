import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  View,
  Alert,
  ActivityIndicator,
  Dimensions,
  TouchableOpacity,
  Text,
  Share,
  Platform,
  Pressable
} from 'react-native';
import { Txt, Badge, Post, BottomSheet } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import eventService from '../../src/services/eventService';
import { EventCardData } from '../../src/data/events';
import { EventImage } from '../../src/components/EventImage';
import { pushRecent, toggleLike, getLikes } from '../../src/utils/storage';
import { updateProfileOnView, updateProfileOnAction } from '../../src/utils/userProfile';
import { computePersonalScoreForEvent, formatPersonalScoreDebug } from '../../src/utils/personalScore';

type EventDetailParams = {
  id?: string;
};

export const Route = createRoute('/events/:id', {
  component: EventDetailPage,
});

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const IMAGE_HEIGHT = SCREEN_HEIGHT * 0.5;
const STICKY_BAR_HEIGHT = Platform.OS === 'ios' ? 90 : 80;

// ─────────────────────────────────────────────────
// Helper: 가격 요약 포맷터
// ─────────────────────────────────────────────────
function formatPriceSummary(event: EventCardData): string {
  if (event.isFree) {
    return '무료예요';
  }

  // priceMin/priceMax가 있으면 우선 사용
  if (event.priceMin != null || event.priceMax != null) {
    if (event.priceMin != null && event.priceMax != null) {
      if (event.priceMin === event.priceMax) {
        return `${event.priceMin.toLocaleString()}원`;
      }
      return `${event.priceMin.toLocaleString()}원 ~ ${event.priceMax.toLocaleString()}원`;
    }
    if (event.priceMin != null) {
      return `최소 ${event.priceMin.toLocaleString()}원`;
    }
    if (event.priceMax != null) {
      return `최대 ${event.priceMax.toLocaleString()}원`;
    }
  }

  // priceInfo가 길면 첫 40자만 (카드용 요약)
  if (event.priceInfo) {
    if (event.priceInfo.length > 40) {
      return event.priceInfo.substring(0, 40) + '...';
    }
    return event.priceInfo;
  }

  return '가격 정보를 더 모으고 있어요';
}

// ─────────────────────────────────────────────────
// Helper: 운영시간 요약 포맷터 (Key Info 카드용)
// ─────────────────────────────────────────────────
function formatOpeningHoursSummary(openingHours: any): string {
  if (!openingHours || typeof openingHours !== 'object') {
    return '운영 시간을 더 모으고 있어요';
  }

  const parts: string[] = [];

  if (openingHours.weekday) {
    parts.push(`평일 ${openingHours.weekday}`);
  }
  if (openingHours.weekend) {
    parts.push(`주말 ${openingHours.weekend}`);
  }

  // 최대 2개만 카드에 표시 (너무 길면 말줄임)
  if (parts.length === 0) {
    if (openingHours.notes) {
      const notes = String(openingHours.notes);
      return notes.length > 30 ? notes.substring(0, 30) + '...' : notes;
    }
    return '운영 시간을 더 모으고 있어요';
  }

  const summary = parts.slice(0, 2).join(' · ');
  return summary.length > 50 ? summary.substring(0, 50) + '...' : summary;
}

// ─────────────────────────────────────────────────
// Helper: KOPIS URL 여부 (정보성 URL — 예매 불가)
// ticketlink.co.kr 은 실제 예매 가능하므로 제외
// ─────────────────────────────────────────────────
function isKopisUrl(url: string): boolean {
  return url.includes('kopis.or.kr');
}

// ─────────────────────────────────────────────────
// Helper: Primary CTA 링크 결정
// 우선순위: 일반티켓 > 예약 > 일반공식 > KOPIS > 인스타 > null
// ─────────────────────────────────────────────────
function getPrimaryCTALink(event: EventCardData): { url: string; label: string } | null {
  const links = event.externalLinks ?? {};

  // 1. 티켓 링크 (KOPIS 제외 — 실제 예매 가능)
  if (links.ticket && !isKopisUrl(links.ticket)) {
    return { url: links.ticket, label: '티켓 예매하기' };
  }
  // 2. 사전 예약 링크
  if (links.reservation && !isKopisUrl(links.reservation)) {
    return { url: links.reservation, label: '예약하기' };
  }
  // 3. 공식 홈페이지 (KOPIS 제외)
  if (links.official && !isKopisUrl(links.official)) {
    return { url: links.official, label: '공식 홈페이지 보기' };
  }
  // 4. KOPIS 링크 (정보성)
  if (links.ticket && isKopisUrl(links.ticket)) {
    return { url: links.ticket, label: '공식 정보 보기' };
  }
  if (links.official && isKopisUrl(links.official)) {
    return { url: links.official, label: '공식 정보 보기' };
  }
  // 5. 인스타그램
  if (links.instagram) {
    return { url: links.instagram, label: '인스타그램에서 보기' };
  }

  return null;
}

// ─────────────────────────────────────────────────
// Helper: 관련 링크 목록 (Primary CTA 제외한 나머지)
// ─────────────────────────────────────────────────
function getRelatedLinks(
  event: EventCardData,
  primaryUrl: string | null
): { url: string; label: string; key: string }[] {
  const links = event.externalLinks ?? {};
  const result: { url: string; label: string; key: string }[] = [];

  const add = (url: string | undefined, label: string, key: string) => {
    if (url && url !== primaryUrl) {
      result.push({ url, label, key });
    }
  };

  if (links.ticket) {
    add(links.ticket, isKopisUrl(links.ticket) ? 'ℹ️ KOPIS 상세 정보' : '🎫 티켓 예매처', 'ticket');
  }
  add(links.reservation, '📋 사전 예약 페이지', 'reservation');
  if (links.official) {
    add(links.official, isKopisUrl(links.official) ? 'ℹ️ KOPIS 상세 정보' : '🌐 공식 홈페이지', 'official');
  }
  add(links.instagram, '📸 공식 인스타그램', 'instagram');

  return result;
}

// ─────────────────────────────────────────────────
// Tier 1: 크리티컬 정보 — 경고 스타일 배지
// ─────────────────────────────────────────────────
function renderTier1Alerts(event: EventCardData): React.ReactNode {
  const chips: { icon: string; text: string }[] = [];

  // 행사: 사전 등록
  if (event.registrationRequired) {
    chips.push({ icon: '🔔', text: '사전 등록 필수' });
    if (event.registrationDeadline?.trim()) {
      chips.push({ icon: '⏰', text: `등록 마감 ${event.registrationDeadline}` });
    }
  }
  // 팝업: 대기 안내
  if (event.waitingHint?.trim()) {
    chips.push({ icon: '⏳', text: event.waitingHint });
  }
  // 전시/공연: 마지막 입장
  if (event.lastAdmission?.trim()) {
    chips.push({ icon: '🚪', text: `마지막 입장 ${event.lastAdmission}` });
  }

  if (chips.length === 0) return null;

  return (
    <View style={styles.tier1Row}>
      {chips.map((chip, i) => (
        <View key={i} style={styles.tier1Chip}>
          <Text style={styles.tier1ChipText}>{chip.icon} {chip.text}</Text>
        </View>
      ))}
    </View>
  );
}

function EventDetailPage() {
  const adaptive = useAdaptive();
  const params = Route.useParams() as EventDetailParams | undefined;
  const [event, setEvent] = useState<EventCardData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [isLiked, setIsLiked] = useState<boolean>(false);
  const [activeSheet, setActiveSheet] = useState<'price' | 'hours' | 'overview' | null>(null);

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

          // DEV: 데이터 타입 확인
          if (__DEV__) {
            console.log('[EventDetail] openingHours typeof:', typeof data.openingHours, data.openingHours);
            console.log('[EventDetail] priceInfo:', data.priceInfo);
            console.log('[EventDetail] priceText:', data.priceText);
          }

          // 최근 본 이벤트에 추가
          try {
            await pushRecent(data.id);
          } catch (error) {
            console.error('[EventDetail] Failed to add to recent:', error);
          }

          // 사용자 프로필 업데이트 (조회 기록)
          try {
            await updateProfileOnView({
              eventId: data.id,
              region: data.region,
              mainCategory: data.mainCategory,
              startAt: data.startAt,
              isFree: data.isFree,
            });
          } catch (error) {
            console.warn('[EventDetail] Failed to update profile:', error);
          }

          // Personal Score 계산 (개발 모드만)
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
              console.warn('[PersonalScore] Failed to compute:', error);
            }
          }

          // 찜 상태 로드
          try {
            const likes = await getLikes();
            setIsLiked(likes.includes(data.id));
          } catch (error) {
            console.error('[EventDetail] Failed to load like status:', error);
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

  const handleOpenLink = async (url?: string) => {
    const targetUrl = url ?? getPrimaryCTALink(event!)?.url;
    if (!targetUrl) {
      Alert.alert('링크 없음', '상세 페이지 링크가 제공되지 않았습니다.');
      return;
    }

    try {
      const supported = await Linking.canOpenURL(targetUrl);
      if (!supported) {
        throw new Error('링크를 열 수 없습니다.');
      }
      await Linking.openURL(targetUrl);
    } catch {
      Alert.alert('열기 실패', '외부 페이지를 열 수 없습니다. 잠시 후 다시 시도해 주세요.');
    }
  };

  const handleToggleLike = async () => {
    if (!event) return;

    try {
      const result = await toggleLike(event.id);
      setIsLiked(result.liked);

      // 사용자 프로필 업데이트 (찜 추가 시에만)
      if (result.liked) {
        try {
          await updateProfileOnAction({
            eventId: event.id,
            actionType: 'like',
            region: event.region,
            mainCategory: event.mainCategory,
            startAt: event.startAt,
            isFree: event.isFree,
          });
        } catch (error) {
          console.warn('[EventDetail] Failed to update profile on like:', error);
        }
      }
    } catch (error) {
      console.error('[EventDetail] Failed to toggle like:', error);
      Alert.alert('오류', '찜하기에 실패했습니다. 다시 시도해 주세요.');
    }
  };

  const handleShare = async () => {
    if (!event) return;

    try {
      const message = `${event.title}\n${event.venue || event.region}\n${event.periodText || ''}`;
      await Share.share({
        message,
        title: event.title,
      });
    } catch (error) {
      console.error('[EventDetail] Failed to share:', error);
    }
  };

  if (status === 'loading') {
    return (
      <View style={[styles.page, styles.centered, { backgroundColor: adaptive.background }]}>
        <ActivityIndicator color={adaptive.grey600} />
      </View>
    );
  }

  if (!event || status === 'error') {
    return (
      <View style={[styles.page, styles.centered, { backgroundColor: adaptive.background }]}>
        <Txt typography="t5" color={adaptive.grey600}>
          해당 행사를 찾을 수 없어요.
        </Txt>
      </View>
    );
  }

  const primaryCTALink = getPrimaryCTALink(event);
  const relatedLinks = getRelatedLinks(event, primaryCTALink?.url ?? null);

  return (
    <View style={styles.page}>
      <ScrollView
        style={{ backgroundColor: adaptive.background }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Image with Overlay Badges */}
        <View style={styles.heroContainer}>
          <EventImage
            uri={event.detailImageUrl}
            height={IMAGE_HEIGHT}
            borderRadius={0}
            resizeMode="cover"
            category={event.category}
            accessibilityLabel={`${event.title} 대표 이미지`}
          />

          {/* Hero Overlay Badges */}
          <View style={styles.heroBadgeContainer}>
            {event.isFree && (
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>💰 무료</Text>
              </View>
            )}
            {event.isEndingSoon && (
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>⏰ 마감임박</Text>
              </View>
            )}
            {(event.buzzScore ?? 0) >= 70 && (
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>🔥 인기</Text>
              </View>
            )}
          </View>
        </View>

        <View style={[styles.contentCard, { backgroundColor: adaptive.background }]}>
          {/* Region & Tags Badges */}
          <View style={styles.badgeRow}>
            <Badge key={`${event.id}-region`} badgeStyle="weak" type="blue" size="small" style={styles.badge}>
              {event.region}
            </Badge>
            {getDisplayTagsForDetail(event).map((tag, index) => (
              <Badge key={`${event.id}-tag-${index}-${tag}`} badgeStyle="weak" type="elephant" size="small" style={styles.badge}>
                {tag}
              </Badge>
            ))}
          </View>

          {/* DEV: 파일 확인 */}
          {__DEV__ && (
            <Text style={{ fontSize: 10, color: '#999', marginBottom: 8 }}>
              DETAIL FILE: pages/events/[id].tsx
            </Text>
          )}

          {/* Title */}
          <Post.H2 paddingBottom={16}>{event.title}</Post.H2>

          {/* Tier 1: 크리티컬 알림 (사전 등록, 대기, 마지막 입장) */}
          {renderTier1Alerts(event)}

          {/* 상세정보 판단 */}
          {(() => {
            // 가격 데이터 존재 여부 (카드 노출 조건)
            const hasPriceData =
              event.isFree === true ||
              event.priceMin != null ||
              event.priceMax != null ||
              !!event.priceInfo?.trim();

            // 가격 상세정보 존재 여부 (자세히 버튼 조건)
            const hasPriceDetail =
              hasPriceData &&
              (!!event.priceInfo?.trim() ||
               (event.priceMin != null && event.priceMax != null && event.priceMin !== event.priceMax));

            // 운영시간 상세정보 존재 여부
            const hasHoursDetail =
              !!event.openingHours?.weekday ||
              !!event.openingHours?.weekend ||
              !!event.openingHours?.holiday ||
              !!event.openingHours?.notes;

            // 홀수 그리드 여부 (마지막 카드 full-width 처리)
            const gridCardCount = 2 + (hasPriceData ? 1 : 0) + (hasHoursDetail ? 1 : 0);
            const isOddGrid = gridCardCount % 2 !== 0;

            // 오버뷰 상세정보 존재 여부 (공연 크루 포함)
            const hasOverviewDetail =
              !!event.overview?.trim() ||
              !!event.crewDirector || !!event.crewWriter || !!event.crewComposer;

            return (
              <>
                {/* Key Info Grid (2x2) */}
          <View style={styles.keyInfoGrid}>
            <View style={styles.keyInfoCard}>
              <Text style={styles.keyInfoIcon}>📅</Text>
              <Text style={styles.keyInfoLabel}>기간</Text>
              <Text style={styles.keyInfoValue} numberOfLines={2}>
                {event.periodText || '정보 없음'}
              </Text>
            </View>

            <View style={styles.keyInfoCard}>
              <Text style={styles.keyInfoIcon}>📍</Text>
              <Text style={styles.keyInfoLabel}>장소</Text>
              <Text style={styles.keyInfoValue} numberOfLines={2}>
                {event.venue || event.region}
              </Text>
            </View>

            {/* 가격 카드 — 데이터 있을 때만 노출 */}
            {hasPriceData && (
              <Pressable
                style={[styles.keyInfoCard, (isOddGrid && !hasHoursDetail) && styles.keyInfoCardFull]}
                onPress={() => hasPriceDetail && setActiveSheet('price')}
                disabled={!hasPriceDetail}
              >
                <Text style={styles.keyInfoIcon}>💰</Text>
                <View style={styles.keyInfoContent}>
                  <Text style={styles.keyInfoLabel}>가격</Text>
                  <Text style={styles.keyInfoValue} numberOfLines={2} ellipsizeMode="tail">
                    {formatPriceSummary(event)}
                  </Text>
                </View>
                {hasPriceDetail && (
                  <View style={styles.keyInfoAction}>
                    <Text style={styles.actionLabel}>자세히</Text>
                    <Text style={styles.actionChevron}>›</Text>
                  </View>
                )}
              </Pressable>
            )}

            {/* 운영시간 카드 — 데이터 있을 때만 노출 */}
            {hasHoursDetail && (
              <Pressable
                style={[styles.keyInfoCard, isOddGrid && styles.keyInfoCardFull]}
                onPress={() => setActiveSheet('hours')}
              >
                <Text style={styles.keyInfoIcon}>🕐</Text>
                <View style={styles.keyInfoContent}>
                  <Text style={styles.keyInfoLabel}>운영시간</Text>
                  <Text style={styles.keyInfoValue} numberOfLines={2} ellipsizeMode="tail">
                    {formatOpeningHoursSummary(event.openingHours)}
                  </Text>
                </View>
                <View style={styles.keyInfoAction}>
                  <Text style={styles.actionLabel}>자세히</Text>
                  <Text style={styles.actionChevron}>›</Text>
                </View>
              </Pressable>
            )}
          </View>

          {/* 오버뷰 카드 */}
          {hasOverviewDetail && (
            <Pressable
              style={styles.overviewCard}
              onPress={() => setActiveSheet('overview')}
            >
              <Text style={styles.overviewCardIcon}>📝</Text>
              <View style={styles.overviewCardContent}>
                <Text style={styles.overviewCardTitle}>이 이벤트는요</Text>
                <Text style={styles.overviewCardValue} numberOfLines={3} ellipsizeMode="tail">
                  {event.overview}
                </Text>
              </View>
              <View style={styles.overviewCardAction}>
                <Text style={styles.actionLabel}>자세히</Text>
                <Text style={styles.actionChevron}>›</Text>
              </View>
            </Pressable>
          )}
              </>
            );
          })()}

          {/* 카테고리별 상세 정보 */}
          {renderCategoryMeta(event)}

          {/* 교통 / 주차 섹션 */}
          {(event.publicTransportInfo || event.parkingAvailable !== undefined || event.parkingInfo) && (
            <View style={styles.infoSection}>
              <Text style={styles.infoSectionTitle}>교통 · 주차</Text>
              {event.publicTransportInfo ? (
                <View style={styles.infoRow}>
                  <Text style={styles.infoRowIcon}>🚇</Text>
                  <View style={styles.infoRowContent}>
                    <Text style={styles.infoRowLabel}>대중교통</Text>
                    <Text style={styles.infoRowValue}>{event.publicTransportInfo}</Text>
                  </View>
                </View>
              ) : null}
              {event.parkingAvailable !== undefined && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoRowIcon}>🅿️</Text>
                  <View style={styles.infoRowContent}>
                    <Text style={styles.infoRowLabel}>주차</Text>
                    <Text style={styles.infoRowValue}>
                      {event.parkingAvailable ? '주차 가능' : '주차 불가'}
                      {event.parkingInfo ? `\n${event.parkingInfo}` : ''}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* 관련 링크 */}
          {relatedLinks.length > 0 && (
            <View style={styles.infoSection}>
              <Text style={styles.infoSectionTitle}>관련 링크</Text>
              {relatedLinks.map((link) => (
                <TouchableOpacity
                  key={link.key}
                  style={styles.linkRow}
                  onPress={() => handleOpenLink(link.url)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.linkRowText}>{link.label}</Text>
                  <Text style={styles.linkRowChevron}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* 지도 및 주소 섹션 */}
          {event.venue && (
            <View style={styles.mapSection}>
              <View style={styles.addressCard}>
                <View style={styles.addressInfo}>
                  <Text style={styles.venueTitle}>{event.venue}</Text>
                  {event.address && (
                    <Text style={styles.addressText}>{event.address}</Text>
                  )}
                </View>
              </View>

              <View style={styles.divider} />

              {event.lat && event.lng && (
                <View style={styles.mapButtons}>
                  <TouchableOpacity
                    style={styles.mapButton}
                    onPress={() => {
                      const url = `https://map.kakao.com/link/map/${encodeURIComponent(event.venue || '')},${event.lat},${event.lng}`;
                      Linking.openURL(url).catch(() =>
                        Alert.alert('오류', '지도를 열 수 없습니다.')
                      );
                    }}
                  >
                    <Text style={styles.mapButtonText}>🗺️ 지도에서 보기</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

        </View>

        {/* Bottom Spacer */}
        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Sticky Bottom Action Bar */}
      <View style={[styles.stickyBar, { backgroundColor: adaptive.background }]}>
        {primaryCTALink ? (
          <>
            {/* 찜 버튼 (아이콘 원형) */}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleToggleLike}
              activeOpacity={0.7}
              accessibilityLabel={isLiked ? '찜 해제하기' : '찜하기'}
            >
              <Text style={styles.actionIcon}>{isLiked ? '❤️' : '🤍'}</Text>
            </TouchableOpacity>

            {/* 공유 버튼 (아이콘 원형) */}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleShare}
              activeOpacity={0.7}
              accessibilityLabel="공유하기"
            >
              <Text style={styles.actionIcon}>🔗</Text>
            </TouchableOpacity>

            {/* Primary CTA */}
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => handleOpenLink(primaryCTALink.url)}
              activeOpacity={0.7}
            >
              <Text style={styles.primaryButtonText}>
                {primaryCTALink.label}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {/* 링크 없음: 찜+공유 50:50 full-width */}
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleToggleLike}
              activeOpacity={0.7}
              accessibilityLabel={isLiked ? '찜 해제하기' : '찜하기'}
            >
              <Text style={styles.secondaryButtonText}>{isLiked ? '❤️ 찜 해제' : '🤍 찜하기'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleShare}
              activeOpacity={0.7}
              accessibilityLabel="공유하기"
            >
              <Text style={styles.secondaryButtonText}>🔗 공유하기</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* TDS BottomSheet */}
      <BottomSheet.Root
        open={activeSheet !== null}
        onClose={() => setActiveSheet(null)}
        onDimmerClick={() => setActiveSheet(null)}
      >
        {activeSheet === 'price' && (
          <>
            <BottomSheet.Header title="가격 정보" />
            <View style={styles.sheetContent}>
              {event?.isFree && (
                <View style={styles.sheetSection}>
                  <Text style={styles.sheetText}>💰 무료로 즐길 수 있어요</Text>
                </View>
              )}
              {event?.priceMin != null && event?.priceMax != null && event.priceMin !== event.priceMax && (
                <View style={styles.sheetSection}>
                  <Text style={styles.sheetLabel}>가격 범위</Text>
                  <Text style={styles.sheetText}>
                    {event.priceMin.toLocaleString()}원 ~ {event.priceMax.toLocaleString()}원
                  </Text>
                </View>
              )}
              {event?.priceInfo && (
                <View style={styles.sheetSection}>
                  <Text style={styles.sheetLabel}>상세 정보</Text>
                  <Text style={styles.sheetText}>{event.priceInfo}</Text>
                </View>
              )}
              {!event?.isFree && !event?.priceInfo && !event?.priceMin && !event?.priceMax && (
                <View style={styles.sheetSection}>
                  <Text style={styles.sheetText}>지금은 가격 정보를 더 모으고 있어요</Text>
                </View>
              )}
            </View>
          </>
        )}

        {activeSheet === 'hours' && (
          <>
            <BottomSheet.Header title="운영 시간" />
            <View style={styles.sheetContent}>
              {event?.openingHours?.weekday && (
                <View style={styles.sheetSection}>
                  <Text style={styles.sheetLabel}>평일</Text>
                  <Text style={styles.sheetText}>{event.openingHours.weekday}</Text>
                </View>
              )}
              {event?.openingHours?.weekend && (
                <View style={styles.sheetSection}>
                  <Text style={styles.sheetLabel}>주말</Text>
                  <Text style={styles.sheetText}>{event.openingHours.weekend}</Text>
                </View>
              )}
              {event?.openingHours?.holiday && (
                <View style={styles.sheetSection}>
                  <Text style={styles.sheetLabel}>공휴일</Text>
                  <Text style={styles.sheetText}>{event.openingHours.holiday}</Text>
                </View>
              )}
              {event?.openingHours?.closedDays && (
                <View style={styles.sheetSection}>
                  <Text style={styles.sheetLabel}>휴무일</Text>
                  <Text style={styles.sheetText}>{event.openingHours.closedDays}</Text>
                </View>
              )}
              {event?.openingHours?.notes && (
                <View style={styles.sheetSection}>
                  <Text style={styles.sheetLabel}>추가 정보</Text>
                  <Text style={styles.sheetText}>{event.openingHours.notes}</Text>
                </View>
              )}
              {!event?.openingHours?.weekday &&
               !event?.openingHours?.weekend &&
               !event?.openingHours?.holiday &&
               !event?.openingHours?.notes && (
                <View style={styles.sheetSection}>
                  <Text style={styles.sheetText}>지금은 운영 시간을 더 모으고 있어요</Text>
                </View>
              )}
            </View>
          </>
        )}

        {activeSheet === 'overview' &&
          event &&
          (event.overview?.trim() || event.crewDirector || event.crewWriter || event.crewComposer) && (
          <>
            <BottomSheet.Header title="이 이벤트는요" />
            <View style={styles.sheetContent}>
              {event.overview?.trim() && (
                <View style={styles.sheetSection}>
                  <Text style={styles.sheetText}>{event.overview}</Text>
                </View>
              )}
              {/* Tier 3: 공연 스태프 */}
              {(event.crewDirector || event.crewWriter || event.crewComposer) && (
                <>
                  {event.overview?.trim() && <View style={styles.sheetDivider} />}
                  <View style={styles.sheetSection}>
                    <Text style={styles.sheetLabel}>🎬 스태프</Text>
                  </View>
                  {event.crewDirector && (
                    <View style={styles.sheetSection}>
                      <Text style={styles.sheetLabel}>연출/감독</Text>
                      <Text style={styles.sheetText}>{event.crewDirector}</Text>
                    </View>
                  )}
                  {event.crewWriter && (
                    <View style={styles.sheetSection}>
                      <Text style={styles.sheetLabel}>작가/작사</Text>
                      <Text style={styles.sheetText}>{event.crewWriter}</Text>
                    </View>
                  )}
                  {event.crewComposer && (
                    <View style={styles.sheetSection}>
                      <Text style={styles.sheetLabel}>작곡가</Text>
                      <Text style={styles.sheetText}>{event.crewComposer}</Text>
                    </View>
                  )}
                </>
              )}
            </View>
          </>
        )}
      </BottomSheet.Root>
    </View>
  );
}

// ─────────────────────────────────────────────────
// 카테고리별 상세 메타데이터 렌더링 (Tier 2)
// ─────────────────────────────────────────────────
function renderCategoryMeta(event: EventCardData): React.ReactNode {
  const rows: { icon: string; label: string; value: string }[] = [];
  const featureChips: { icon: string; text: string; negative?: boolean }[] = [];

  const v = (val: unknown): string => {
    if (val == null) return '';
    const s = typeof val === 'string' ? val : String(val);
    return s.trim();
  };

  if (event.category === '공연' || event.mainCategory === '공연') {
    const cast = v(event.cast); if (cast) rows.push({ icon: '🎭', label: '출연진', value: cast });
    const genre = v(event.genre); if (genre) rows.push({ icon: '🎵', label: '장르', value: genre });
    // Tier 2 칩: 공연 시간
    if (event.durationMinutes) featureChips.push({ icon: '⏱️', text: `공연 ${event.durationMinutes}분` });

  } else if (event.category === '전시' || event.mainCategory === '전시') {
    const artists = v(event.artists); if (artists) rows.push({ icon: '🎨', label: '참여 작가', value: artists });
    const genre = v(event.genre); if (genre) rows.push({ icon: '🖼️', label: '분야', value: genre });
    // Tier 2 칩: 촬영 여부, 포토존 (관람 시간은 노출 안 함)
    if (event.photographyAllowed === true) featureChips.push({ icon: '📸', text: '촬영 가능' });
    else if (event.photographyAllowed === false) featureChips.push({ icon: '🚫', text: '촬영 불가', negative: true });
    if (event.photoZone) featureChips.push({ icon: '🤳', text: '포토존 있음' });

  } else if (event.mainCategory === '팝업') {
    const brands = v(event.brands); if (brands) rows.push({ icon: '🏷️', label: '브랜드', value: brands });
    // popupType → 레이블 (isFnb 불필요, popupType 직접 사용)
    const typeLabel =
      event.popupType === 'fnb' ? 'F&B' :
      event.popupType === 'collab' ? '콜라보' : null;
    if (typeLabel) rows.push({ icon: '🏪', label: '유형', value: typeLabel });
    const bestItems = v(event.bestItems); if (bestItems) rows.push({ icon: '⭐', label: '시그니처 메뉴', value: bestItems });
    const collabDesc = v(event.collabDescription); if (collabDesc) rows.push({ icon: '🤝', label: '콜라보', value: collabDesc });
    // 굿즈: 상세 텍스트 있으면 infoRow, 없으면 칩
    const goodsText = v(event.goodsItems);
    if (goodsText) {
      rows.push({ icon: '🛍️', label: '굿즈', value: goodsText });
    }
    // 포토존: 상세 설명 있으면 infoRow, 없으면 칩
    const photoZoneDesc = v(event.photoZoneDesc);
    if (event.photoZone && photoZoneDesc) {
      rows.push({ icon: '🤳', label: '포토존', value: photoZoneDesc });
    } else if (event.photoZone) {
      featureChips.push({ icon: '🤳', text: '포토존 있음' });
    }

  } else if (event.category === '축제' || event.mainCategory === '축제') {
    const organizer = v(event.organizer); if (organizer) rows.push({ icon: '🏢', label: '주최', value: organizer });
    const highlights = v(event.programHighlights); if (highlights) rows.push({ icon: '🎪', label: '주요 프로그램', value: highlights });

  } else if (event.category === '행사' || event.mainCategory === '행사') {
    // Tier 2 InfoRow: 참가 대상, 정원
    const audience = v(event.targetAudience); if (audience) rows.push({ icon: '👥', label: '참가 대상', value: audience });
    const capacity = v(event.eventCapacity); if (capacity) rows.push({ icon: '📊', label: '정원', value: capacity });
  }

  if (rows.length === 0 && featureChips.length === 0) return null;

  return (
    <View style={styles.infoSection}>
      <Text style={styles.infoSectionTitle}>상세 정보</Text>
      {rows.map((row, i) => (
        <View key={i} style={styles.infoRow}>
          <Text style={styles.infoRowIcon}>{row.icon}</Text>
          <View style={styles.infoRowContent}>
            <Text style={styles.infoRowLabel}>{row.label}</Text>
            <Text style={styles.infoRowValue}>{row.value}</Text>
          </View>
        </View>
      ))}
      {featureChips.length > 0 && (
        <View style={[styles.featureChipRow, rows.length > 0 && styles.featureChipRowBordered]}>
          {featureChips.map((chip, i) => (
            <View key={i} style={[styles.featureChip, chip.negative && styles.featureChipNeg]}>
              <Text style={[styles.featureChipText, chip.negative && styles.featureChipTextNeg]}>
                {chip.icon} {chip.text}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function getDisplayTagsForDetail(event: EventCardData): string[] {
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
    .filter((t) => t?.trim().length > 0 && t !== event.region)  // 빈 문자열·공백 방어
    .filter((t) => !isLikelyAddress(t))
    .slice(0, 6);

  return [...new Set(filtered)];
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: STICKY_BAR_HEIGHT + (Platform.OS === 'ios' ? 34 : 20),
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroContainer: {
    position: 'relative',
  },
  heroBadgeContainer: {
    position: 'absolute',
    top: 16,
    left: 16,
    gap: 8,
  },
  heroBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  heroBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
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
    flexWrap: 'wrap',
  },
  badge: {
    marginRight: 8,
    marginBottom: 8,
  },
  keyInfoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 20,
    marginBottom: 24,
  },
  keyInfoCard: {
    width: '48%',
    minHeight: 100,
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 16,
    position: 'relative',
    // border 대신 subtle shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  keyInfoCardFull: {
    width: '100%',
  },
  keyInfoIcon: {
    fontSize: 24,
    marginBottom: 8,
  },
  keyInfoContent: {
    flex: 1,
  },
  keyInfoLabel: {
    fontSize: 12,
    color: '#6B7684',
    marginBottom: 4,
    fontWeight: '600',
  },
  keyInfoValue: {
    fontSize: 14,
    color: '#191F28',
    fontWeight: '600',
    flexShrink: 1,
    lineHeight: 20,
  },
  keyInfoAction: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  actionLabel: {
    fontSize: 12,
    color: '#3182F6',
    fontWeight: '600',
  },
  actionChevron: {
    fontSize: 16,
    color: '#3182F6',
    fontWeight: '700',
  },
  mapSection: {
    marginTop: 20,
    backgroundColor: '#FFF',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  addressCard: {
    backgroundColor: '#F8F9FA',
    padding: 16,
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
  bottomSpacer: {
    height: 20,
  },
  stickyBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E8EB',
    zIndex: 10,
    elevation: 10,
  },
  actionButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F2F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionIcon: {
    fontSize: 24,
  },
  primaryButton: {
    flex: 1,
    height: 48,
    backgroundColor: '#3182F6',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    flex: 1,
    height: 48,
    backgroundColor: '#F2F4F6',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  secondaryButtonText: {
    color: '#4E5968',
    fontSize: 15,
    fontWeight: '600',
  },
  // Overview Card
  overviewCard: {
    marginTop: 20,
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  overviewCardIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  overviewCardContent: {
    flex: 1,
  },
  overviewCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#191F28',
    marginBottom: 8,
  },
  overviewCardValue: {
    fontSize: 14,
    color: '#6B7684',
    lineHeight: 20,
  },
  overviewCardAction: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  // 카테고리별 메타 + 교통/주차
  infoSection: {
    marginTop: 20,
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  infoSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#191F28',
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  infoRowIcon: {
    fontSize: 18,
    marginRight: 10,
    lineHeight: 22,
  },
  infoRowContent: {
    flex: 1,
  },
  infoRowLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7684',
    marginBottom: 2,
  },
  infoRowValue: {
    fontSize: 14,
    color: '#191F28',
    lineHeight: 20,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E8EB',
  },
  linkRowText: {
    fontSize: 15,
    color: '#3182F6',
    fontWeight: '600',
  },
  linkRowChevron: {
    fontSize: 18,
    color: '#3182F6',
    fontWeight: '700',
  },
  // Tier 1: 크리티컬 경고 칩
  tier1Row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
    marginBottom: 4,
  },
  tier1Chip: {
    backgroundColor: '#FFF3CD',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tier1ChipText: {
    color: '#92400E',
    fontSize: 13,
    fontWeight: '600',
  },
  // Tier 2: 피처 칩 (상세 정보 섹션 내)
  featureChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  featureChipRowBordered: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E8EB',
  },
  featureChip: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  featureChipNeg: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  featureChipText: {
    color: '#1D4ED8',
    fontSize: 12,
    fontWeight: '600',
  },
  featureChipTextNeg: {
    color: '#DC2626',
  },
  // BottomSheet
  sheetContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 100, // 여유있는 하단 여백
  },
  sheetSection: {
    marginBottom: 20,
  },
  sheetDivider: {
    height: 1,
    backgroundColor: '#E5E8EB',
    marginVertical: 16,
  },
  sheetLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7684',
    marginBottom: 8,
  },
  sheetText: {
    fontSize: 15,
    color: '#191F28',
    lineHeight: 24,
  },
});
