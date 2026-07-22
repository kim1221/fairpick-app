/**
 * 테마 컬렉션 세트 상세 (스펙 §4.5, 시안 collection-sets-v1 ②).
 * 다크 캔버스 + 마닐라 헤더 카드 + 2열 슬롯 그리드.
 * 채운 슬롯=실제 카드 사진 + 레드 날짜 스탬프, 빈 슬롯=점선 박스 + "?" + 힌트만
 * (빈 슬롯에 카드 정보 조합 노출 금지 — 실루엣은 원본 이미지를 블러+틴트로 가린다).
 */

import { createRoute } from '@granite-js/react-native';
import { useSafeAreaInsets } from '@granite-js/native/react-native-safe-area-context';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  getThemeCollectionSet,
  type ThemeCollectionSetDetail,
  type ThemeCollectionSlot,
} from '../../../services/themeCollectionService';
import { ddayLabel, formatStampDate, setEyebrow } from '../../../components/passport/themeCollectionData';

type SetDetailParams = {
  setId?: string;
};

export const Route = createRoute('/passport/collections/:setId', {
  validateParams: (params: Readonly<object> | undefined): SetDetailParams => {
    const setId = (params as SetDetailParams | undefined)?.setId;
    return { setId: typeof setId === 'string' ? setId : undefined };
  },
  component: CollectionSetDetailPage,
});

const BG = '#100D09';
const MANILA = '#EFE4C3';
const MANILA_LINE = '#DECFA6';
const INK = '#2C2A22';
const NAVY = '#2A386A';
const RED = '#A8331F';
const CREAM = '#EFE3C4';
const CANVAS_SUB = '#9A8F77';
const SLOT_LINE = 'rgba(239,227,196,0.32)';
const GOLD = '#C9A35B';

function FilledSlotCard({ slot }: { slot: ThemeCollectionSlot }) {
  const filled = slot.filled!;
  const stamp = formatStampDate(filled.filledAt);
  return (
    <View style={styles.slot}>
      {filled.imageUrl ? (
        <Image source={{ uri: filled.imageUrl }} style={styles.slotImage} resizeMode="cover" />
      ) : (
        <View style={[styles.slotImage, styles.slotImageFallback]}>
          <Text style={styles.slotImageFallbackText}>{filled.category ?? '문화'}</Text>
        </View>
      )}
      <View style={styles.slotCaption}>
        <Text style={styles.slotCaptionText} numberOfLines={1}>
          {filled.title}
        </Text>
      </View>
      {stamp ? (
        <View style={styles.dateStamp} pointerEvents="none">
          <Text style={styles.dateStampText}>{stamp}</Text>
        </View>
      ) : null}
      {filled.source === 'mystery' ? (
        <View style={styles.mysteryChip} pointerEvents="none">
          <Text style={styles.mysteryChipText}>? 카드로 발견</Text>
        </View>
      ) : null}
    </View>
  );
}

function EmptySlotCard({ slot }: { slot: ThemeCollectionSlot }) {
  const empty = slot.empty!;
  return (
    <View style={[styles.slot, styles.emptySlot]}>
      {empty.silhouetteImageUrl ? (
        <>
          {/* 실루엣: 원본을 강블러 + 다크 틴트로 가린다(내용 식별 불가 수준) */}
          <Image
            source={{ uri: empty.silhouetteImageUrl }}
            style={styles.silhouetteImage}
            resizeMode="cover"
            blurRadius={18}
          />
          <View style={styles.silhouetteTint} pointerEvents="none" />
        </>
      ) : null}
      <View style={styles.emptySlotBody}>
        <Text style={styles.emptyGlyph}>?</Text>
        <Text style={styles.emptyHint} numberOfLines={2}>
          {empty.hintText}
        </Text>
      </View>
    </View>
  );
}

export function CollectionSetDetailPage() {
  const navigation = Route.useNavigation();
  const params = Route.useParams();
  const { top, bottom } = useSafeAreaInsets();
  const setId = params.setId ?? null;
  const mountedRef = useRef(true);

  const [detail, setDetail] = useState<ThemeCollectionSetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const load = useCallback(async () => {
    if (!setId) {
      setLoading(false);
      setError(true);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const next = await getThemeCollectionSet(setId);
      if (!mountedRef.current) return;
      setDetail(next);
    } catch (loadError) {
      if (!mountedRef.current) return;
      setError(true);
      if (__DEV__) console.error('[CollectionSetDetail][load]', loadError);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [setId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: top + 8 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="컬렉션으로 돌아가기"
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={styles.backButton}
        >
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>테마 컬렉션</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={CREAM} />
          <Text style={styles.stateDescription}>세트를 불러오고 있어요.</Text>
        </View>
      ) : error || !detail ? (
        <View style={styles.centerState}>
          <Text style={styles.stateTitle}>세트를 불러오지 못했어요</Text>
          <Text style={styles.stateDescription}>잠시 후 다시 시도해 주세요.</Text>
          <Pressable accessibilityRole="button" onPress={() => load().catch(() => {})} style={styles.retryButton}>
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: bottom + 36 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerCard}>
            <View style={styles.headerNotch} pointerEvents="none" />
            <Text style={styles.headerEyebrow} numberOfLines={1}>
              {setEyebrow(detail)} · {detail.completed ? 'COMPLETE' : ddayLabel(detail.daysRemaining)}
            </Text>
            <Text style={styles.headerCardTitle}>{detail.title}</Text>
            <Text style={styles.headerCardSub} numberOfLines={1}>
              {[detail.subtitle, `${detail.filledCount}/${detail.totalSlots}`].filter(Boolean).join(' · ')}
            </Text>
          </View>

          <View style={styles.grid}>
            {detail.slots.map((slot) =>
              slot.state === 'filled' && slot.filled ? (
                <FilledSlotCard key={slot.slotIndex} slot={slot} />
              ) : (
                <EmptySlotCard key={slot.slotIndex} slot={slot} />
              )
            )}
          </View>

          {detail.completed ? (
            <View style={[styles.rewardCard, styles.rewardCardDone]}>
              <View style={styles.rewardCoin}>
                <Text style={styles.rewardCoinGlyph}>✦</Text>
              </View>
              <View style={styles.rewardCopy}>
                <Text style={styles.rewardTitleDone}>세트 완성 — 배지를 받았어요</Text>
                <Text style={styles.rewardDescriptionDone}>
                  {detail.badge?.awardedAt
                    ? `배지장에 보관돼 있어요 · ${formatStampDate(detail.badge.awardedAt) ?? ''}`
                    : '배지장에 보관돼 있어요'}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.rewardCard}>
              <View style={styles.rewardCoin}>
                <Text style={styles.rewardCoinGlyph}>✦</Text>
              </View>
              <View style={styles.rewardCopy}>
                <Text style={styles.rewardTitle}>완성 보상 — 컬렉션 배지</Text>
                <Text style={styles.rewardDescription}>
                  {detail.totalSlots}곳을 모두 발견하면 컬렉션 표지에 금박 스탬프가 찍혀요.
                </Text>
              </View>
            </View>
          )}

          <Text style={styles.finePrint}>
            빈 슬롯은 조건이 맞는 카드를 열면 자동으로 채워져요{'\n'}발행 후에 연 카드만 인정돼요
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const NOTCH_W = 40;
const NOTCH_H = 18;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 6,
  },
  backButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  backIcon: { color: CREAM, fontSize: 30, lineHeight: 34, fontWeight: '600', marginTop: -3 },
  headerTitle: { flex: 1, textAlign: 'center', color: CREAM, fontSize: 15, fontWeight: '800' },
  headerSpacer: { width: 44 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  stateTitle: { color: CREAM, fontSize: 16, lineHeight: 22, fontWeight: '900', textAlign: 'center' },
  stateDescription: {
    marginTop: 8,
    color: CANVAS_SUB,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    minHeight: 44,
    borderRadius: 999,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: MANILA,
  },
  retryText: { color: INK, fontSize: 12.5, fontWeight: '900' },
  headerCard: {
    borderRadius: 6,
    borderTopRightRadius: 0,
    backgroundColor: MANILA,
    borderWidth: 1,
    borderColor: MANILA_LINE,
    paddingHorizontal: 18,
    paddingVertical: 16,
    overflow: 'hidden',
  },
  headerNotch: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 0,
    height: 0,
    borderTopWidth: NOTCH_H,
    borderLeftWidth: NOTCH_W,
    borderTopColor: BG,
    borderLeftColor: 'transparent',
  },
  headerEyebrow: {
    color: '#8A7C5C',
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1.2,
    paddingRight: NOTCH_W - 6,
  },
  headerCardTitle: {
    marginTop: 6,
    color: NAVY,
    fontSize: 27,
    lineHeight: 33,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  headerCardSub: { marginTop: 5, color: INK, fontSize: 12.5, lineHeight: 18, fontWeight: '700' },
  grid: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  slot: {
    width: '48.4%',
    height: 172,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#1A150E',
  },
  slotImage: { width: '100%', height: '100%' },
  slotImageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2A2418',
  },
  slotImageFallbackText: { color: CREAM, fontSize: 14, fontWeight: '900' },
  slotCaption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(10,8,5,0.74)',
  },
  slotCaptionText: { color: CREAM, fontSize: 11.5, lineHeight: 16, fontWeight: '800' },
  dateStamp: {
    position: 'absolute',
    top: 10,
    right: 10,
    borderWidth: 1.6,
    borderColor: RED,
    backgroundColor: 'rgba(239,227,196,0.9)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    transform: [{ rotate: '-4deg' }],
  },
  dateStampText: { color: RED, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  mysteryChip: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: NAVY,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 3,
  },
  mysteryChipText: { color: '#E9DBB8', fontSize: 9.5, fontWeight: '900', letterSpacing: 0.4 },
  emptySlot: {
    borderWidth: 1.4,
    borderColor: SLOT_LINE,
    borderStyle: 'dashed',
    backgroundColor: 'rgba(239,227,196,0.05)',
  },
  silhouetteImage: {
    ...StyleSheet.absoluteFillObject,
    width: undefined,
    height: undefined,
    opacity: 0.5,
  },
  silhouetteTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,8,5,0.78)',
  },
  emptySlotBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  emptyGlyph: { color: 'rgba(239,227,196,0.55)', fontSize: 34, lineHeight: 42, fontWeight: '900' },
  emptyHint: {
    marginTop: 8,
    color: CANVAS_SUB,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  rewardCard: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239,227,196,0.18)',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rewardCardDone: { backgroundColor: NAVY, borderColor: '#3D4C82' },
  rewardCoin: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.6,
    borderColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardCoinGlyph: { color: GOLD, fontSize: 18, lineHeight: 22, fontWeight: '900' },
  rewardCopy: { flex: 1 },
  rewardTitle: { color: CREAM, fontSize: 13.5, lineHeight: 19, fontWeight: '900' },
  rewardDescription: { marginTop: 3, color: CANVAS_SUB, fontSize: 11.5, lineHeight: 16, fontWeight: '600' },
  rewardTitleDone: { color: '#E9DBB8', fontSize: 13.5, lineHeight: 19, fontWeight: '900' },
  rewardDescriptionDone: { marginTop: 3, color: '#9AA5CB', fontSize: 11.5, lineHeight: 16, fontWeight: '600' },
  finePrint: {
    marginTop: 20,
    color: '#6E6350',
    fontSize: 10.5,
    lineHeight: 16,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.4,
  },
});

export default CollectionSetDetailPage;
