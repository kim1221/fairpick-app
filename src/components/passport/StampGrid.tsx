/**
 * 다녀온 문화 스탬프 스텁 그리드(2열).
 * 각 셀 = 마닐라 카드 + 세피아 사진 밴드 + 회전 "다녀옴·MM·DD" 원형 도장 + 행사명(2줄) + "M.D 방문 · 지역".
 * 도장은 네이비/레드 교차. imageUrl 없으면 마닐라 폴백. 탭 → 이벤트 상세.
 *
 * tagKit 세계관(마닐라/네이비/레드/잉크) 재사용 — TAG_TOKENS 팔레트로 톤 일관.
 * 세피아: RN에 CSS filter 없음 → 워엄 오버레이(알파)로 근사.
 */
import React from 'react';
import { Image, ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { manilaTagTexture } from '../../assets';
import type { PassportStamp } from '../../services/passportService';
import { TAG_TOKENS } from '../culture-card/tagKit';

const SEPIA_OVERLAY = 'rgba(120,86,42,0.26)';
const PERF_LINE = 'rgba(44,42,34,0.28)';
const MANILA_FALLBACK = '#CDC4AB';

export interface StampGridProps {
  stamps: PassportStamp[];
  onPressStamp: (eventId: string) => void;
}

function formatVisitedShort(visitedAt: string): { dot: string; dotDate: string } {
  const date = new Date(visitedAt);
  if (Number.isNaN(date.getTime())) return { dot: '', dotDate: '' };
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return {
    dot: `${date.getMonth() + 1}.${date.getDate()}`, // 6.28
    dotDate: `${mm}·${dd}`, // 06·28 (도장용)
  };
}

function StampCell({
  stamp,
  navy,
  onPress,
}: {
  stamp: PassportStamp;
  navy: boolean;
  onPress: (eventId: string) => void;
}) {
  const { dot, dotDate } = formatVisitedShort(stamp.visitedAt);
  const stampColor = navy ? TAG_TOKENS.navy : TAG_TOKENS.red;
  const meta = [dot ? `${dot} 방문` : '방문', stamp.region?.trim() || stamp.venue?.trim()]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${stamp.title} 다녀온 기록 보기`}
      onPress={() => onPress(stamp.eventId)}
      style={({ pressed }) => [styles.stub, pressed ? styles.stubPressed : null]}
    >
      <View style={styles.photo}>
        {stamp.imageUrl ? (
          <Image source={{ uri: stamp.imageUrl }} style={styles.photoImage} resizeMode="cover" />
        ) : (
          // 사진 없으면 마닐라 텍스처 폴백(세계관 톤 유지)
          <ImageBackground
            source={manilaTagTexture}
            style={styles.photoFallback}
            imageStyle={styles.photoFallbackImage}
            resizeMode="cover"
          />
        )}
        {/* 세피아 근사 워엄 오버레이 */}
        <View style={styles.sepia} pointerEvents="none" />

        {/* 다녀옴 원형 도장(회전) */}
        <View style={[styles.stamp, { borderColor: stampColor }]} pointerEvents="none">
          <View style={[styles.stampInner, { borderColor: stampColor }]} />
          <Text style={[styles.stampTop, { color: stampColor }]} allowFontScaling={false}>다녀옴</Text>
          <Text style={[styles.stampDate, { color: stampColor }]} allowFontScaling={false}>{dotDate}</Text>
        </View>
      </View>

      {/* 절취선 */}
      <View style={styles.perf} pointerEvents="none" />

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={2}>{stamp.title}</Text>
        <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
      </View>
    </Pressable>
  );
}

export function StampGrid({ stamps, onPressStamp }: StampGridProps) {
  if (stamps.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>아직 도장이 없어요</Text>
        <Text style={styles.emptyDesc}>문화를 즐기고 ‘다녀왔어요’로 남겨보세요</Text>
      </View>
    );
  }

  return (
    <View style={styles.grid}>
      {stamps.map((stamp, index) => (
        <View key={`${stamp.eventId}-${stamp.visitedAt}`} style={styles.cellWrap}>
          <StampCell stamp={stamp} navy={index % 2 === 0} onPress={onPressStamp} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  cellWrap: {
    width: '48.5%',
    marginBottom: 11,
  },
  stub: {
    position: 'relative',
    borderRadius: 9,
    overflow: 'hidden',
    backgroundColor: TAG_TOKENS.manila,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 6,
  },
  stubPressed: {
    opacity: 0.88,
  },
  photo: {
    height: 82,
    overflow: 'hidden',
    backgroundColor: MANILA_FALLBACK,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: MANILA_FALLBACK,
  },
  photoFallbackImage: {
    opacity: 0.9,
  },
  sepia: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SEPIA_OVERLAY,
  },
  stamp: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.85,
    backgroundColor: 'rgba(231,220,192,0.35)',
    transform: [{ rotate: '-12deg' }],
  },
  stampInner: {
    position: 'absolute',
    top: 3,
    left: 3,
    right: 3,
    bottom: 3,
    borderRadius: 23,
    borderWidth: 1,
  },
  stampTop: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  stampDate: {
    marginTop: 1,
    fontSize: 8,
    fontWeight: '700',
  },
  perf: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 82,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: PERF_LINE,
  },
  info: {
    paddingHorizontal: 11,
    paddingTop: 9,
    paddingBottom: 11,
  },
  name: {
    minHeight: 32,
    color: TAG_TOKENS.ink,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  meta: {
    marginTop: 5,
    color: TAG_TOKENS.sub,
    fontSize: 10.5,
    fontWeight: '700',
  },
  empty: {
    marginTop: 14,
    minHeight: 132,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: TAG_TOKENS.ringLine,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  emptyTitle: {
    color: TAG_TOKENS.headText,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyDesc: {
    marginTop: 6,
    color: TAG_TOKENS.navSub,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
});
