/**
 * 도장 탭 상세(시안 culturecard-passport-v5 ④).
 * 사진(imageUrl) + 카테고리 탭 + 우상단 "다녀옴 · 날짜" 씰 배지 +
 * 행사명 + 장소/기간 + "N번째 도장이에요" 안내 + [도장 취소][행사 정보 보기].
 *
 * 위치·보상 없음(자기신고). 도장 취소=unmarkVisited, 행사정보=이벤트 상세로 이동.
 * 자체 오버레이 모달(짙은 딤 + 종이 카드) — 상위에서 visible 제어.
 */
import React from 'react';
import { Image, ImageBackground, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { manilaTagTexture } from '../../assets';
import type { PassportStamp } from '../../services/passportService';

const PAPER = '#EFE7D2';
const PAPER_EDGE = '#DBCDA6';
const INK = '#2C2A22';
const INK_SUB = '#6E6350';
const NAVY = '#2A386A';
const RED = '#A8331F';
const GREY_BTN = '#E5DDC8';

const CATEGORY_LATIN: Record<string, string> = {
  전시: 'Exhibition',
  공연: 'Performance',
  팝업: 'Pop-up',
  축제: 'Festival',
  행사: 'Event',
  기타: 'Culture',
};

function categoryLatin(category: string): string {
  return CATEGORY_LATIN[category?.trim()] ?? 'Culture';
}

function fmtSealDate(visitedAt: string): string {
  const d = new Date(visitedAt);
  if (Number.isNaN(d.getTime())) return '';
  const yy = String(d.getFullYear()).slice(2);
  return `${yy}.${d.getMonth() + 1}.${d.getDate()}`;
}

function fmtLongDate(visitedAt: string): string {
  const d = new Date(visitedAt);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}`;
}

export interface StampDetailSheetProps {
  stamp: PassportStamp | null;
  /** 이 도장이 "몇 번째 도장"인지(1-base). */
  ordinal: number | null;
  canceling: boolean;
  onClose: () => void;
  onCancelStamp: (stamp: PassportStamp) => void;
  onOpenEvent: (eventId: string) => void;
}

export function StampDetailSheet({
  stamp,
  ordinal,
  canceling,
  onClose,
  onCancelStamp,
  onOpenEvent,
}: StampDetailSheetProps) {
  const visible = stamp != null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* 짙은 딤 */}
      <Pressable style={styles.dim} onPress={onClose} accessibilityRole="button" accessibilityLabel="닫기">
        {stamp ? (
          <Pressable style={styles.card} onPress={() => {}}>
            {/* 사진 + 카테고리 탭 + 다녀옴 씰 */}
            <View style={styles.photoWrap}>
              {stamp.imageUrl ? (
                <Image source={{ uri: stamp.imageUrl }} style={styles.photo} resizeMode="cover" />
              ) : (
                <ImageBackground
                  source={manilaTagTexture}
                  style={styles.photo}
                  imageStyle={styles.photoFallbackImg}
                  resizeMode="cover"
                />
              )}
              <View style={styles.photoScrim} pointerEvents="none" />

              <View style={styles.catTab}>
                <Text style={styles.catTabText}>
                  {stamp.category || '문화'} · {categoryLatin(stamp.category)}
                </Text>
              </View>

              <View style={styles.seal} pointerEvents="none">
                <View style={styles.sealInner} />
                <Text style={styles.sealTop}>다녀옴</Text>
                <Text style={styles.sealDate}>{fmtSealDate(stamp.visitedAt)}</Text>
              </View>
            </View>

            {/* 본문 */}
            <View style={styles.body}>
              <Text style={styles.title} numberOfLines={2}>{stamp.title}</Text>
              <Text style={styles.place} numberOfLines={1}>
                {[stamp.venue?.trim(), stamp.region?.trim()].filter(Boolean).join(' · ') || '장소 정보 준비 중'}
              </Text>
              {stamp.isFirstInRegion || stamp.isFirstInCategory ? (
                <View style={styles.discoveryBadges}>
                  {stamp.isFirstInRegion ? (
                    <View style={styles.discoveryBadge}>
                      <Text style={styles.discoveryBadgeText}>✦ 첫 지역 도장</Text>
                    </View>
                  ) : null}
                  {stamp.isFirstInCategory ? (
                    <View style={styles.discoveryBadge}>
                      <Text style={styles.discoveryBadgeText}>✦ 첫 장르 도장</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* 다녀옴 씰 배지 + N번째 도장 */}
              <View style={styles.doneBadge}>
                <View style={styles.doneMark}>
                  <View style={styles.doneMarkInner} />
                  <Text style={styles.doneMarkText}>다녀옴</Text>
                </View>
                <View style={styles.doneTextWrap}>
                  <Text style={styles.doneLine1}>
                    <Text style={styles.doneStrong}>{fmtLongDate(stamp.visitedAt)}</Text>에 다녀왔어요
                  </Text>
                  {ordinal != null ? (
                    <Text style={styles.doneLine2}>여권의 {ordinal}번째 도장이에요</Text>
                  ) : null}
                </View>
              </View>

              {/* 액션 */}
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="도장 취소"
                  disabled={canceling}
                  onPress={() => onCancelStamp(stamp)}
                  style={({ pressed }) => [
                    styles.cancelBtn,
                    pressed ? styles.btnPressed : null,
                    canceling ? styles.btnDisabled : null,
                  ]}
                >
                  <Text style={styles.cancelText}>{canceling ? '취소 중' : '도장 취소'}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="행사 정보 보기"
                  onPress={() => onOpenEvent(stamp.eventId)}
                  style={({ pressed }) => [styles.infoBtn, pressed ? styles.btnPressed : null]}
                >
                  <Text style={styles.infoText}>행사 정보 보기 ›</Text>
                </Pressable>
              </View>
            </View>
          </Pressable>
        ) : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: {
    flex: 1,
    backgroundColor: 'rgba(8,6,3,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: PAPER,
    borderWidth: 1,
    borderColor: PAPER_EDGE,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.5,
    shadowRadius: 34,
    elevation: 16,
  },
  photoWrap: {
    height: 210,
    backgroundColor: '#3A2E1C',
  },
  photo: {
    ...StyleSheet.absoluteFillObject,
    width: undefined,
    height: undefined,
  },
  photoFallbackImg: {
    opacity: 0.9,
  },
  photoScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 90,
    backgroundColor: 'rgba(20,14,6,0.28)',
  },
  catTab: {
    position: 'absolute',
    top: 14,
    left: 14,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(20,14,6,0.62)',
  },
  catTabText: {
    color: '#F2ECDE',
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  seal: {
    position: 'absolute',
    top: 12,
    right: 14,
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,14,6,0.28)',
    transform: [{ rotate: '-8deg' }],
  },
  sealInner: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: 4,
    bottom: 4,
    borderRadius: 27,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  sealTop: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  sealDate: {
    marginTop: 1,
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 18,
  },
  title: {
    color: INK,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '900',
    letterSpacing: -0.4,
    fontFamily: 'Noto Serif KR',
  },
  place: {
    marginTop: 7,
    color: INK_SUB,
    fontSize: 13,
    fontWeight: '700',
  },
  discoveryBadges: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  discoveryBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(42,56,106,0.28)',
    backgroundColor: 'rgba(42,56,106,0.08)',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  discoveryBadgeText: {
    color: NAVY,
    fontSize: 11,
    fontWeight: '900',
  },
  doneBadge: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(168,51,31,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(168,51,31,0.22)',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  doneMark: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1.6,
    borderColor: RED,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-9deg' }],
  },
  doneMarkInner: {
    position: 'absolute',
    top: 3,
    left: 3,
    right: 3,
    bottom: 3,
    borderRadius: 20,
    borderWidth: 0.8,
    borderColor: RED,
  },
  doneMarkText: {
    color: RED,
    fontSize: 10,
    fontWeight: '900',
  },
  doneTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  doneLine1: {
    color: INK,
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: '700',
  },
  doneStrong: {
    color: RED,
    fontWeight: '900',
  },
  doneLine2: {
    marginTop: 2,
    color: INK_SUB,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '700',
  },
  actions: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    backgroundColor: GREY_BTN,
    borderWidth: 1,
    borderColor: PAPER_EDGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    color: INK_SUB,
    fontSize: 14.5,
    fontWeight: '800',
  },
  infoBtn: {
    flex: 1.4,
    height: 50,
    borderRadius: 14,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: {
    color: '#F2ECDE',
    fontSize: 14.5,
    fontWeight: '800',
  },
  btnPressed: {
    opacity: 0.82,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
