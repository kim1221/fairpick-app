import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  View,
  Dimensions,
  TouchableOpacity,
  Text,
  Platform,
  Pressable,
  Modal,
  Image,
  StatusBar,
} from 'react-native';
import { Txt, Badge, Post, BottomSheet, Loader, Button, Icon, IconButton, useDialog } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import { InlineAd, share, getTossShareLink } from '@apps-in-toss/framework';

type Adaptive = ReturnType<typeof useAdaptive>;
type EventStyles = ReturnType<typeof createStyles>;

import eventService from '../../src/services/eventService';
import { logEventDwell, logEventCtaClick, logEventSheetOpen, logEventView, logEventSave, logEventUnsave } from '../../src/services/userEventService';
import { EventCardData } from '../../src/data/events';
import { EventImage } from '../../src/components/EventImage';
import { pushRecent } from '../../src/utils/storage';
import { updateProfileOnView, updateProfileOnAction } from '../../src/utils/userProfile';
import { computePersonalScoreForEvent, formatPersonalScoreDebug } from '../../src/utils/personalScore';
import { useLike } from '../../src/hooks/useLike';
import { LikesProvider } from '../../src/contexts/LikesContext';
import { useAuth } from '../../src/hooks/useAuth';
import http from '../../src/lib/http';

type EventDetailParams = {
  id?: string;
};

export const Route = createRoute('/events/:id', {
  validateParams: (params) => params as { id: string },
  component: () => <LikesProvider><EventDetailPage /></LikesProvider>,
});

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const IMAGE_HEIGHT = SCREEN_HEIGHT * 0.5;

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
      // 날짜 형식("2015년 7월 6일" 같은 패턴) → 잘못된 AI 추출 데이터로 판단, 폴백
      if (/\d{4}년\s*\d+월\s*\d+일/.test(notes)) {
        return '운영 시간을 더 모으고 있어요';
      }
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
// Helper: URL → cta_type enum (로그 분석용 고정값)
// 라벨 문자열 대신 링크 출처 키를 기준으로 분류
// ─────────────────────────────────────────────────
function getCtaTypeEnum(event: EventCardData, url: string): string {
  const links = event.externalLinks ?? {};
  if (links.ticket === url)      return 'ticket';
  if (links.reservation === url) return 'reservation';
  if (links.official === url)    return 'official';
  if (links.instagram === url)   return 'instagram';
  return 'other';
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
    add(links.ticket, isKopisUrl(links.ticket) ? 'KOPIS 상세 정보' : '티켓 예매처', 'ticket');
  }
  add(links.reservation, '사전 예약 페이지', 'reservation');
  if (links.official) {
    add(links.official, isKopisUrl(links.official) ? 'KOPIS 상세 정보' : '공식 홈페이지', 'official');
  }
  add(links.instagram, '공식 인스타그램', 'instagram');

  return result;
}

// ─────────────────────────────────────────────────
// Tier 1: 크리티컬 정보 — 경고 스타일 배지
// ─────────────────────────────────────────────────
function renderTier1Alerts(event: EventCardData, styles: EventStyles): React.ReactNode {
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
          <Text style={styles.tier1ChipText}>{chip.text}</Text>
        </View>
      ))}
    </View>
  );
}

function EventDetailPage() {
  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);
  const params = Route.useParams() as EventDetailParams | undefined;
  const [event, setEvent] = useState<EventCardData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [activeSheet, setActiveSheet] = useState<'price' | 'hours' | 'overview' | null>(null);
  const [adRendered, setAdRendered] = useState(false);
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  // event 로드 후 snapshot 추출 → useLike에 전달 (찜 시 로컬 snapshot 저장)
  const eventSnapshot = React.useMemo(() => event ? {
    title: event.title,
    venue: event.venue,
    imageUrl: event.thumbnailUrl,
    region: event.region as string,
    mainCategory: event.mainCategory,
    subCategory: event.subCategory,
    startAt: event.startAt,
    endAt: event.endAt,
  } : undefined, [event]);
  const { isLiked, toggle: toggleLikeWithSync } = useLike({ eventId: params?.id, snapshot: eventSnapshot });
  const { isLoggedIn } = useAuth();
  const dialog = useDialog();

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

          // 이벤트 상세 진입 로그
          logEventView(data.id).catch(() => {});

          // DEV: 데이터 타입 확인
          if (__DEV__) {
            console.log('[EventDetail] openingHours typeof:', typeof data.openingHours, data.openingHours);
            console.log('[EventDetail] priceInfo:', data.priceInfo);
            console.log('[EventDetail] priceText:', data.priceText);
          }

          // 최근 본 이벤트에 추가 (로컬 + 서버 fire-and-forget)
          // snapshot 저장 → MyPage에서 API 없이 표시 가능
          try {
            await pushRecent(data.id, {
              title: data.title,
              venue: data.venue,
              imageUrl: data.thumbnailUrl,
              region: data.region as string,
              mainCategory: data.mainCategory,
              subCategory: data.subCategory,
              startAt: data.startAt,
              endAt: data.endAt,
            });
            if (isLoggedIn) {
              http.post('/users/me/recent/batch', {
                items: [{ eventId: data.id, viewedAt: new Date().toISOString() }],
              }).catch(() => {});
            }
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

  // dwell 시간 측정: 이벤트 데이터가 로드된 시점부터 페이지 이탈까지
  // 5초 미만은 노이즈로 간주하여 기록하지 않음
  useEffect(() => {
    if (!event?.id) return;
    const mountTime = Date.now();
    return () => {
      const dwellSeconds = Math.round((Date.now() - mountTime) / 1000);
      if (dwellSeconds >= 5) {
        logEventDwell(event.id, dwellSeconds).catch(() => {});
      }
    };
  }, [event?.id]);

  // sheet open 핸들러 (로그 + 상태 변경)
  const handleOpenSheet = (sheetType: 'price' | 'hours' | 'overview') => {
    if (event?.id) {
      logEventSheetOpen(event.id, sheetType).catch(() => {});
    }
    setActiveSheet(sheetType);
  };

  const handleOpenLink = async (url?: string) => {
    const primaryLink = getPrimaryCTALink(event!);
    const targetUrl = url ?? primaryLink?.url;
    if (!targetUrl) {
      await dialog.openAlert({ title: '링크 없음', description: '연결된 링크가 없어요.' });
      return;
    }

    // cta_click 로그: URL → enum (ticket|reservation|official|instagram|other)
    if (event?.id) {
      logEventCtaClick(event.id, getCtaTypeEnum(event, targetUrl)).catch(() => {});
    }

    try {
      const supported = await Linking.canOpenURL(targetUrl);
      if (!supported) {
        throw new Error('링크를 열 수 없습니다.');
      }
      await Linking.openURL(targetUrl);
    } catch {
      await dialog.openAlert({ title: '열기 실패', description: '외부 페이지를 열 수 없어요. 잠시 후 다시 시도해주세요.' });
    }
  };

  const handleToggleLike = async () => {
    if (!event) return;

    try {
      const result = await toggleLikeWithSync();

      // 찜 행동 로그
      if (result.liked) {
        logEventSave(event.id).catch(() => {});
      } else {
        logEventUnsave(event.id).catch(() => {});
      }

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
      await dialog.openAlert({ title: '오류', description: '찜하기에 실패했어요. 다시 시도해주세요.' });
    }
  };

  const handleShare = async () => {
    if (!event) return;

    try {
      let message: string;
      try {
        message = await getTossShareLink(
          `intoss://fairpick-app/events/${event.id}`,
          event.thumbnailUrl ?? undefined,
        );
      } catch {
        // 앱 미출시 환경(샌드박스/개발)에서는 단순 메시지로 폴백
        message = `${event.title}\n${event.venue || event.region}\n${event.periodText || ''}`;
      }
      await share({ message });
    } catch (error) {
      console.error('[EventDetail] Failed to share:', error);
    }
  };

  if (status === 'loading') {
    return (
      <View style={[styles.page, styles.centered, { backgroundColor: adaptive.background }]}>
        <Loader customStrokeColor={adaptive.grey600} />
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
        style={[{ backgroundColor: adaptive.background }, styles.scrollFlex]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Image with Overlay Badges */}
        <View style={styles.heroContainer}>
          <TouchableOpacity
            activeOpacity={0.95}
            onPress={() => setImageViewerVisible(true)}
            accessibilityLabel="이미지 전체보기"
          >
            <EventImage
              uri={event.detailImageUrl}
              height={IMAGE_HEIGHT}
              borderRadius={0}
              resizeMode="cover"
              category={event.category}
              accessibilityLabel={`${event.title} 대표 이미지`}
            />
          </TouchableOpacity>

          {/* Hero Overlay Badges */}
          <View style={styles.heroBadgeContainer}>
            {event.isFree && (
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>무료</Text>
              </View>
            )}
            {event.isEndingSoon && (
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>마감임박</Text>
              </View>
            )}
            {(event.buzzScore ?? 0) >= 70 && (
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>인기</Text>
              </View>
            )}
          </View>

          {/* Hero Action Buttons (우상단) */}
          <View style={styles.heroActionsContainer}>
            <IconButton
              name="icon-share-dots-mono"
              variant="fill"
              bgColor="rgba(0,0,0,0.45)"
              color="#FFFFFF"
              iconSize={20}
              style={styles.heroActionBtn}
              onPress={handleShare}
              accessibilityLabel="공유하기"
            />
            <IconButton
              name="icon-heart-mono"
              variant="fill"
              bgColor="rgba(0,0,0,0.45)"
              color={isLiked ? adaptive.red500 : '#FFFFFF'}
              iconSize={20}
              style={styles.heroActionBtn}
              onPress={handleToggleLike}
              accessibilityLabel={isLiked ? '찜 해제하기' : '찜하기'}
            />
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

          {/* Title */}
          <Post.H2 paddingBottom={event.overview?.trim() ? 6 : 16}>{event.title}</Post.H2>

          {/* Overview 인라인 — 제목 바로 아래 흥미 유도 + 더보기 */}
          {event.overview?.trim() && (
            <Pressable onPress={() => handleOpenSheet('overview')}>
              <Text style={styles.inlineOverview} numberOfLines={2} ellipsizeMode="tail">
                {event.overview.trim()}
              </Text>
              <Text style={styles.inlineOverviewMore}>더보기 ›</Text>
            </Pressable>
          )}

          {/* Tier 1: 크리티컬 알림 (사전 등록, 대기, 마지막 입장) */}
          {renderTier1Alerts(event, styles)}

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

            // 운영시간 상세정보 존재 여부 (날짜 형식 notes는 잘못된 AI 추출 → 제외)
            const isValidNotes = event.openingHours?.notes
              ? !/\d{4}년\s*\d+월\s*\d+일/.test(String(event.openingHours.notes))
              : false;
            const hasHoursDetail =
              !!event.openingHours?.weekday ||
              !!event.openingHours?.weekend ||
              !!event.openingHours?.holiday ||
              isValidNotes;

            // 홀수 그리드 여부 (마지막 카드 full-width 처리)
            const gridCardCount = 2 + (hasPriceData ? 1 : 0) + (hasHoursDetail ? 1 : 0);
            const isOddGrid = gridCardCount % 2 !== 0;

            // 공연 크루 정보 존재 여부 (overview는 인라인으로 처리하므로 분리)
            const hasCrew =
              !!event.crewDirector || !!event.crewWriter || !!event.crewComposer;

            return (
              <>
                {/* Key Info Grid (2x2) */}
          <View style={styles.keyInfoGrid}>
            <View style={styles.keyInfoCard}>
              <Icon name="icon-calendar-check-mono" size={20} color={adaptive.grey600} />
              <Text style={styles.keyInfoLabel}>기간</Text>
              <Text style={styles.keyInfoValue} numberOfLines={2}>
                {event.periodText || '날짜를 모으고 있어요'}
              </Text>
            </View>

            {event.lat && event.lng ? (
              <Pressable
                style={styles.keyInfoCard}
                onPress={async () => {
                  const url = `https://map.kakao.com/link/map/${encodeURIComponent(event.venue || '')},${event.lat},${event.lng}`;
                  try { await Linking.openURL(url); }
                  catch { await dialog.openAlert({ title: '오류', description: '지도를 열 수 없어요.' }); }
                }}
              >
                <Icon name="icon-pin-mono" size={20} color={adaptive.grey600} />
                <View style={styles.keyInfoContent}>
                  <Text style={styles.keyInfoLabel}>장소</Text>
                  <Text style={styles.keyInfoValue} numberOfLines={2}>
                    {event.venue || event.region}
                  </Text>
                </View>
                <View style={styles.keyInfoAction}>
                  <Text style={styles.actionLabel}>지도</Text>
                  <Text style={styles.actionChevron}>›</Text>
                </View>
              </Pressable>
            ) : (
              <View style={styles.keyInfoCard}>
                <Icon name="icon-pin-mono" size={20} color={adaptive.grey600} />
                <Text style={styles.keyInfoLabel}>장소</Text>
                <Text style={styles.keyInfoValue} numberOfLines={2}>
                  {event.venue || event.region}
                </Text>
              </View>
            )}

            {/* 가격 카드 — 데이터 있을 때만 노출 */}
            {hasPriceData && (
              <Pressable
                style={[styles.keyInfoCard, (isOddGrid && !hasHoursDetail) && styles.keyInfoCardFull]}
                onPress={() => hasPriceDetail && handleOpenSheet('price')}
                disabled={!hasPriceDetail}
              >
                <Icon name="icon-won-mono" size={20} color={adaptive.grey600} />
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
                onPress={() => handleOpenSheet('hours')}
              >
                <Icon name="icon-clock-mono" size={20} color={adaptive.grey600} />
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

          {/* 공연 크루 카드 — crew 정보가 있을 때만 노출 (overview는 인라인으로 처리) */}
          {hasCrew && (
            <Pressable
              style={styles.overviewCard}
              onPress={() => handleOpenSheet('overview')}
            >
              <Icon name="icon-star-mono" size={20} color={adaptive.grey600} style={{ marginRight: 12, marginTop: 2 }} />
              <View style={styles.overviewCardContent}>
                <View style={styles.overviewCardTitleRow}>
                  <Text style={styles.overviewCardTitle}>공연 정보</Text>
                </View>
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
          {renderCategoryMeta(event, styles)}

          {/* 교통 / 주차 섹션 */}
          {(event.publicTransportInfo || event.parkingAvailable != null || event.parkingInfo) && (
            <View style={styles.infoSection}>
              <Text style={styles.infoSectionTitle}>교통 · 주차</Text>
              {event.publicTransportInfo ? (
                <View style={styles.infoRow}>
                  <Icon name="icon-subway-mono" size={16} color={adaptive.grey600} style={styles.infoRowIconStyle} />
                  <View style={styles.infoRowContent}>
                    <Text style={styles.infoRowLabel}>대중교통</Text>
                    <Text style={styles.infoRowValue}>{event.publicTransportInfo}</Text>
                  </View>
                </View>
              ) : null}
              {event.parkingAvailable != null && (
                <View style={styles.infoRow}>
                  <Icon name="icon-car-mono" size={16} color={adaptive.grey600} style={styles.infoRowIconStyle} />
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

          {/* 오시는 길 섹션 */}
          {event.venue && (
            <>
              <Text style={[styles.infoSectionTitle, { marginTop: 20 }]}>오시는 길</Text>
              <View style={[styles.mapSection, { marginTop: 0 }]}>
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
                    onPress={async () => {
                      const url = `https://map.kakao.com/link/map/${encodeURIComponent(event.venue || '')},${event.lat},${event.lng}`;
                      try {
                        await Linking.openURL(url);
                      } catch {
                        await dialog.openAlert({ title: '오류', description: '지도를 열 수 없어요.' });
                      }
                    }}
                  >
                    <Text style={styles.mapButtonText}>지도에서 보기</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
            </>
          )}

        </View>

        {/* 광고 — 스크롤 콘텐츠 마지막 요소, 광고 아래 스크롤 불가 */}
        <View style={[styles.adBannerContainer, { height: adRendered ? 96 : 0 }]}>
          <InlineAd
            adGroupId="ait.v2.live.6526c6e693454a28"
            impressFallbackOnMount={true}
            onAdRendered={() => setAdRendered(true)}
          />
        </View>

      </ScrollView>

      {/* 하단 CTA — ScrollView 아래 일반 View로 배치 (iOS/Android 모두 오버스크롤 없음) */}
      {primaryCTALink && (
        <View style={[
          styles.stickyBar,
          { backgroundColor: adaptive.background },
          primaryCTALink.label === '티켓 예매하기' && { paddingTop: 6 },
        ]}>
          {primaryCTALink.label === '티켓 예매하기' && (
            <Text style={styles.ctaHint}>
              {getTicketSiteName(primaryCTALink.url)}에서 예매할 수 있어요
            </Text>
          )}
          <Button
            type="primary"
            size="big"
            viewStyle={{ width: '100%' }}
            onPress={() => handleOpenLink(primaryCTALink.url)}
          >
            {primaryCTALink.label}
          </Button>
        </View>
      )}

      {/* TDS BottomSheet */}
      <BottomSheet.Root
        open={activeSheet !== null}
        onClose={() => setActiveSheet(null)}
        onDimmerClick={() => setActiveSheet(null)}
      >
        {activeSheet === 'price' && (
          <>
            <BottomSheet.Header>가격 정보</BottomSheet.Header>
            <View style={styles.sheetContent}>
              {event?.isFree && (
                <View style={styles.sheetSection}>
                  <Text style={styles.sheetText}>무료로 즐길 수 있어요</Text>
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
            <BottomSheet.Header>운영 시간</BottomSheet.Header>
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
              {event?.openingHours?.notes &&
               !/\d{4}년\s*\d+월\s*\d+일/.test(String(event.openingHours.notes)) && (
                <View style={styles.sheetSection}>
                  <Text style={styles.sheetLabel}>추가 정보</Text>
                  <Text style={styles.sheetText}>{event.openingHours.notes}</Text>
                </View>
              )}
              {!event?.openingHours?.weekday &&
               !event?.openingHours?.weekend &&
               !event?.openingHours?.holiday &&
               !(event?.openingHours?.notes && !/\d{4}년\s*\d+월\s*\d+일/.test(String(event.openingHours.notes))) && (
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
            <BottomSheet.Header>이 이벤트는요</BottomSheet.Header>
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
                    <Text style={styles.sheetLabel}>스태프</Text>
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

      {/* 전체화면 이미지 뷰어 */}
      <Modal
        visible={imageViewerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setImageViewerVisible(false)}
        statusBarTranslucent
      >
        <StatusBar hidden />
        <View style={imageViewerStyles.overlay}>
          <TouchableOpacity
            style={imageViewerStyles.closeButton}
            onPress={() => setImageViewerVisible(false)}
            activeOpacity={0.7}
          >
            <Icon name="icon-x-mono" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={imageViewerStyles.imageArea}
            activeOpacity={1}
            onPress={() => setImageViewerVisible(false)}
          >
            <Image
              source={{ uri: event.detailImageUrl || event.thumbnailUrl }}
              style={imageViewerStyles.fullImage}
              resizeMode="contain"
            />
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const { width: SCREEN_WIDTH, height: FULL_SCREEN_HEIGHT } = Dimensions.get('screen');

const imageViewerStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageArea: {
    width: SCREEN_WIDTH,
    height: FULL_SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImage: {
    width: SCREEN_WIDTH,
    height: FULL_SCREEN_HEIGHT,
  },
  closeButton: {
    position: 'absolute',
    top: 52,
    right: 20,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

// ─────────────────────────────────────────────────
// 카테고리별 상세 메타데이터 렌더링 (Tier 2)
// ─────────────────────────────────────────────────
function renderCategoryMeta(event: EventCardData, styles: EventStyles): React.ReactNode {
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
                {chip.text}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// 상세 페이지에서 제거할 태그
// - 카테고리 중복: badge row에서 이미 mainCategory로 표시
// - 별도 UI 표시: 무료(hero badge + 가격카드), 주차/교통(섹션별도)
// - 추천 알고리즘용: 상세 페이지 맥락과 맞지 않음
// - 계절 추천: 시간적 컨텍스트 의존, 지나면 의미 없음
const DETAIL_TAG_BLACKLIST = new Set([
  '공연', '전시',
  '무료',
  '주차가능', '지하철근처',
  '주말추천',
  '연말맞이', '봄나들이', '여름휴가', '가을감성', '겨울감성',
]);

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
    .filter((t) => t?.trim().length > 0 && t !== event.region)
    .filter((t) => !isLikelyAddress(t))
    .filter((t) => !DETAIL_TAG_BLACKLIST.has(t))
    .slice(0, 6);

  return [...new Set(filtered)];
}

// ticket 링크 URL에서 사이트 이름 추출 (CTA 보조 문구용)
function getTicketSiteName(url: string): string {
  const TICKET_SITES: [string, string][] = [
    ['ticketlink.co.kr', 'ticketlink'],
    ['interpark.com', 'interpark'],
    ['yes24.com', 'YES24'],
    ['melon.com', 'melon ticket'],
    ['nol.co.kr', 'NOL'],
    ['auction.co.kr', 'auction ticket'],
  ];
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    for (const [domain, name] of TICKET_SITES) {
      if (hostname.includes(domain)) return name;
    }
    return hostname;
  } catch {
    return '예매처';
  }
}

const createStyles = (a: Adaptive) => StyleSheet.create({
  page: {
    flex: 1,
  },
  scrollFlex: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 0,
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
  inlineOverview: {
    fontSize: 14,
    lineHeight: 20,
    color: a.grey600,
    marginBottom: 4,
  },
  inlineOverviewMore: {
    fontSize: 12,
    color: a.grey400,
    textAlign: 'right',
    marginBottom: 16,
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
    backgroundColor: a.grey50,
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
    color: a.grey600,
    marginBottom: 4,
    fontWeight: '600',
  },
  keyInfoValue: {
    fontSize: 14,
    color: a.grey900,
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
    color: a.blue500,
    fontWeight: '600',
  },
  actionChevron: {
    fontSize: 16,
    color: a.blue500,
    fontWeight: '700',
  },
  mapSection: {
    marginTop: 20,
    backgroundColor: a.background,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  addressCard: {
    backgroundColor: a.grey50,
    padding: 16,
  },
  addressInfo: {
    flex: 1,
  },
  venueTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: a.grey900,
    marginBottom: 4,
  },
  addressText: {
    fontSize: 13,
    color: a.grey600,
    lineHeight: 18,
  },
  divider: {
    height: 1,
    backgroundColor: a.grey200,
  },
  mapButtons: {
    padding: 16,
  },
  mapButton: {
    backgroundColor: a.grey100,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  mapButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: a.grey900,
  },
  overviewSection: {
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: a.grey200,
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
  bottomArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    elevation: 10,
    backgroundColor: a.background,
  },
  adBannerContainer: {
    width: '100%',
    overflow: 'hidden',
  },
  ctaHint: {
    fontSize: 11,
    color: a.grey500,
    textAlign: 'center',
    marginBottom: 6,
  },
  stickyBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 30 : 12,
    borderTopWidth: 1,
    borderTopColor: a.grey200,
    zIndex: 10,
    elevation: 10,
  },
  heroActionsContainer: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    gap: 8,
  },
  heroActionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  secondaryButtonText: {
    color: a.grey700,
    fontSize: 15,
    fontWeight: '600',
  },
  // Overview Card
  overviewCard: {
    marginTop: 20,
    backgroundColor: a.grey50,
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
  overviewCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  overviewCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: a.grey900,
  },
  aiLabel: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: a.blue50,
    borderRadius: 4,
  },
  aiLabelText: {
    fontSize: 10,
    fontWeight: '600',
    color: a.blue500,
  },
  overviewCardValue: {
    fontSize: 14,
    color: a.grey600,
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
    backgroundColor: a.grey50,
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
    color: a.grey900,
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
  infoRowIconStyle: {
    marginRight: 10,
    marginTop: 2,
  },
  infoRowContent: {
    flex: 1,
  },
  infoRowLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: a.grey600,
    marginBottom: 2,
  },
  infoRowValue: {
    fontSize: 14,
    color: a.grey900,
    lineHeight: 20,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: a.grey200,
  },
  linkRowText: {
    fontSize: 15,
    color: a.blue500,
    fontWeight: '600',
  },
  linkRowChevron: {
    fontSize: 18,
    color: a.blue500,
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
    borderTopColor: a.grey200,
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
    backgroundColor: a.grey200,
    marginVertical: 16,
  },
  sheetLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: a.grey600,
    marginBottom: 8,
  },
  sheetText: {
    fontSize: 15,
    color: a.grey900,
    lineHeight: 24,
  },
});
