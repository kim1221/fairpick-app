/**
 * 문화 여권 "북" 페이지들(시안 culturecard-passport-v5).
 *  ① 표지     : 네이비 + 금박 프레임/코너 + 티켓·별 엠블럼 + REPUBLIC OF CULTURE / 문화 여권 / CULTURE PASSPORT / No.
 *  ② 명의면   : 마닐라 보안무늬 + 사진칸 + HOLDER/여권번호/발급/도장수/취향 + MRZ 한 줄
 *  ③ 도장면   : 엠블럼 워터마크 + 보안무늬 + 출입국 도장들(원형/사각, 행사명 크게, 비스듬히 살짝 겹침)
 *
 * RN 제약 근사:
 *  - CSS gradient 없음 → 단색 + 상단 하이라이트 밴드.
 *  - 보안무늬(길로쉬) → 얇은 사선 스트로크 SVG로 근사(@granite-js/native/react-native-svg).
 *  - MRZ → 모노폰트 한 줄.
 */
import React from 'react';
import { ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { Line, Svg } from '@granite-js/native/react-native-svg';
import { manilaTagTexture } from '../../assets';
import type { PassportStamp } from '../../services/passportService';
import { PassportEmblem } from './PassportEmblem';

// 네이비 표지 · 금박
const NAVY_TOP = '#3157D5';
const NAVY_MID = '#183577';
const GOLD = '#CBA15E';
const GOLD_SOFT = '#DDB877';
const COVER_TITLE = '#F2ECDE';
const COVER_SUB = '#AEBBD6';

// 마닐라 종이면(명의/도장)
const PAPER = '#E9DEC2';
const PAPER_EDGE = '#D6C79E';
const INK = '#2C2A22';
const INK_SUB = '#6E6350';
const NAVY_STAMP = '#2A386A';
const RED_STAMP = '#A8331F';
const SECURITY_LINE = 'rgba(120,102,64,0.16)';

const MONO_FAMILY = 'monospace';

// ── 보안무늬(길로쉬 근사): 얇은 사선 반복 ────────────────────────────
function SecurityGuilloche({ tone = SECURITY_LINE }: { tone?: string }) {
  // 12개의 사선(왕복)으로 종이 위 은은한 보안 패턴 근사. pointerEvents none.
  const lines = React.useMemo(() => {
    const arr: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let i = -6; i <= 12; i += 1) {
      const off = i * 22;
      arr.push({ x1: off, y1: 0, x2: off + 160, y2: 320 });
      arr.push({ x1: off + 160, y1: 0, x2: off, y2: 320 });
    }
    return arr;
  }, []);
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      {lines.map((l, idx) => (
        <Line
          // biome-ignore lint/suspicious/noArrayIndexKey: static decorative lines, index is stable
          key={idx}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke={tone}
          strokeWidth={0.8}
        />
      ))}
    </Svg>
  );
}

// ── 도장 날짜 포맷 ──────────────────────────────────────────────────
function fmtStampDate(visitedAt: string): string {
  const d = new Date(visitedAt);
  if (Number.isNaN(d.getTime())) return '';
  const yy = String(d.getFullYear()).slice(2);
  return `${yy}.${d.getMonth() + 1}.${d.getDate()}`;
}

function fmtIssueMonth(monthKey: string | null): string {
  if (!monthKey) return '2026';
  return monthKey;
}

// ── ① 표지 페이지 ───────────────────────────────────────────────────
export function PassportCoverPage({
  width,
  passportNo,
}: {
  width: number;
  passportNo: string;
}) {
  return (
    <View style={[styles.page, { width }]}>
      <View style={styles.cover}>
        <View style={styles.coverHighlight} pointerEvents="none" />
        {/* 금박 이중 프레임 */}
        <View style={styles.coverFrame} pointerEvents="none" />
        <View style={styles.coverFrameInner} pointerEvents="none" />
        {/* 금박 코너 4개 */}
        <View style={[styles.corner, styles.cornerTL]} pointerEvents="none" />
        <View style={[styles.corner, styles.cornerTR]} pointerEvents="none" />
        <View style={[styles.corner, styles.cornerBL]} pointerEvents="none" />
        <View style={[styles.corner, styles.cornerBR]} pointerEvents="none" />

        <View style={styles.coverTop}>
          <Text style={styles.coverKicker}>REPUBLIC OF CULTURE</Text>
        </View>

        <View style={styles.coverEmblemWrap}>
          <View style={styles.coverEmblemRing}>
            <PassportEmblem size={46} color={GOLD_SOFT} />
          </View>
        </View>

        <View style={styles.coverBottom}>
          <Text style={styles.coverTitle}>문 화 여 권</Text>
          <Text style={styles.coverEnTitle}>CULTURE PASSPORT</Text>
          <View style={styles.coverDivider} />
          <Text style={styles.coverNo}>No. {passportNo} · SEOUL · 2026</Text>
        </View>
      </View>
    </View>
  );
}

// ── ② 명의면 페이지 ─────────────────────────────────────────────────
export function PassportIdentityPage({
  width,
  passportNo,
  discoveredCount,
  wishlistCount,
  visitedCount,
  monthLabel,
  tasteCategories,
}: {
  width: number;
  passportNo: string;
  discoveredCount: number;
  wishlistCount: number;
  visitedCount: number;
  monthLabel: string | null;
  tasteCategories: string[];
}) {
  const taste = tasteCategories.length > 0 ? tasteCategories.slice(0, 3).join(' · ') : '탐험 중';
  const issue = fmtIssueMonth(monthLabel);
  // MRZ 근사: P<KOR + 취향 + 여권번호 + 도장수. 라틴/숫자만(모노폰트).
  const mrzTaste = tasteCategories.length > 0 ? 'CULTURE' : 'EXPLORER';
  const mrz1 = `P<KOR<${mrzTaste}<<CULTURE<PASSPORT<<<<<<<<<<<<`;
  const mrz2 = `${passportNo}<<<KOR<ENTRY${String(discoveredCount).padStart(2, '0')}<PLAN${String(wishlistCount).padStart(2, '0')}<STAMPS${String(visitedCount).padStart(2, '0')}`;

  return (
    <View style={[styles.page, { width }]}>
      <ImageBackground
        source={manilaTagTexture}
        style={styles.paperFace}
        imageStyle={styles.paperFaceImg}
        resizeMode="cover"
      >
        <View style={styles.paperWash} pointerEvents="none" />
        <SecurityGuilloche />

        <View style={styles.idHeaderRow}>
          <Text style={styles.idHeaderText}>문화 여권 · IDENTITY</Text>
          <Text style={styles.idHeaderPage}>p.2</Text>
        </View>

        <View style={styles.idBody}>
          {/* 사진칸 */}
          <View style={styles.idPhoto}>
            <PassportEmblem size={34} color={INK_SUB} opacity={0.55} />
            <Text style={styles.idPhotoText}>PHOTO</Text>
          </View>

          {/* 필드 */}
          <View style={styles.idFields}>
            <IdField label="HOLDER / 명의" value="문화 탐험가" />
            <IdField label="여권번호" value={`No. ${passportNo}`} />
            <IdField label="발급" value={issue} />
            <IdField label="발견 카드" value={`${discoveredCount}장`} />
            <IdField label="가고 싶어요" value={`${wishlistCount}개`} />
            <IdField label="도장 수" value={`${visitedCount}개`} />
            <IdField label="취향" value={taste} />
          </View>
        </View>

        {/* MRZ */}
        <View style={styles.mrzBox}>
          <Text style={styles.mrzLine} numberOfLines={1} allowFontScaling={false}>{mrz1}</Text>
          <Text style={styles.mrzLine} numberOfLines={1} allowFontScaling={false}>{mrz2}</Text>
        </View>
      </ImageBackground>
    </View>
  );
}

function IdField({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.idField}>
      <Text style={styles.idLabel}>{label}</Text>
      <Text style={styles.idValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ── ③ 도장면 페이지 ─────────────────────────────────────────────────
// 페이지당 도장 슬롯(비스듬히 살짝 겹침). 시안: 원형/사각 혼재, 행사명 크게.
type StampSlot = {
  top: number;
  left?: number;
  right?: number;
  rotate: string;
  shape: 'square' | 'circle';
};

const STAMP_SLOTS: StampSlot[] = [
  { top: 8, left: 4, rotate: '-6deg', shape: 'square' },
  { top: 26, right: 6, rotate: '5deg', shape: 'circle' },
  { top: 118, left: 2, rotate: '3deg', shape: 'square' },
  { top: 150, right: 4, rotate: '-7deg', shape: 'square' },
  { top: 236, left: 8, rotate: '-3deg', shape: 'square' },
  { top: 262, right: 10, rotate: '6deg', shape: 'circle' },
];

const DEFAULT_STAMP_SLOT: StampSlot = { top: 8, left: 4, rotate: '0deg', shape: 'square' };

const CATEGORY_STAMP_COLOR: Record<string, string> = {
  전시: NAVY_STAMP,
  공연: RED_STAMP,
  팝업: NAVY_STAMP,
  축제: RED_STAMP,
  행사: NAVY_STAMP,
  기타: NAVY_STAMP,
};

function stampColor(category: string, index: number): string {
  const byCat = CATEGORY_STAMP_COLOR[category?.trim()];
  if (byCat) return byCat;
  return index % 2 === 0 ? NAVY_STAMP : RED_STAMP;
}

export function PassportStampPage({
  width,
  stamps,
  pageIndex,
  bookLabel,
  rangeLabel,
  pageMonthLabel,
  onPressStamp,
}: {
  width: number;
  stamps: PassportStamp[];
  pageIndex: number;
  bookLabel: string;
  rangeLabel: string;
  pageMonthLabel: string;
  onPressStamp: (stamp: PassportStamp) => void;
}) {
  return (
    <View style={[styles.page, { width }]}>
      <ImageBackground
        source={manilaTagTexture}
        style={styles.paperFace}
        imageStyle={styles.paperFaceImg}
        resizeMode="cover"
      >
        <View style={styles.paperWash} pointerEvents="none" />
        <SecurityGuilloche />
        {/* 엠블럼 워터마크(중앙, 연하게) */}
        <View style={styles.watermark} pointerEvents="none">
          <PassportEmblem size={168} color={INK} opacity={0.05} />
        </View>

        <View style={styles.idHeaderRow}>
          <View style={styles.idHeaderTextWrap}>
            <Text style={styles.idHeaderText} numberOfLines={1}>{bookLabel}</Text>
            <Text style={styles.idHeaderSubText} numberOfLines={1}>
              Stamps · {rangeLabel} · {pageMonthLabel}
            </Text>
          </View>
          <Text style={styles.idHeaderPage}>p.{pageIndex + 3}</Text>
        </View>

        <View style={styles.stampArea}>
          {stamps.map((stamp, i) => {
            const slot = STAMP_SLOTS[i % STAMP_SLOTS.length] ?? DEFAULT_STAMP_SLOT;
            const color = stampColor(stamp.category, i);
            const region = stamp.region?.trim() || stamp.venue?.trim() || '서울';
            return (
              <Pressable
                key={`${stamp.eventId}-${stamp.visitedAt}`}
                accessibilityRole="button"
                accessibilityLabel={`${stamp.title} 도장 상세 보기`}
                onPress={() => onPressStamp(stamp)}
                style={({ pressed }) => [
                  styles.stamp,
                  slot.shape === 'circle' ? styles.stampCircle : styles.stampSquare,
                  {
                    borderColor: color,
                    top: slot.top,
                    left: slot.left,
                    right: slot.right,
                    transform: [{ rotate: slot.rotate }],
                  },
                  pressed ? styles.stampPressed : null,
                ]}
              >
                {slot.shape === 'circle' ? (
                  <View style={[styles.stampInnerCircle, { borderColor: color }]} pointerEvents="none" />
                ) : (
                  <View style={[styles.stampInnerSquare, { borderColor: color }]} pointerEvents="none" />
                )}
                <Text style={[styles.stampAdmit, { color }]} allowFontScaling={false}>
                  ADMIT · {stamp.category || '문화'}
                </Text>
                {stamp.isFirstInRegion || stamp.isFirstInCategory ? (
                  <Text style={[styles.stampFirst, { color }]} numberOfLines={1} allowFontScaling={false}>
                    {[stamp.isFirstInRegion ? '첫 지역' : null, stamp.isFirstInCategory ? '첫 장르' : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                ) : null}
                <Text style={[styles.stampName, { color }]} numberOfLines={1} allowFontScaling={false}>
                  {stamp.title}
                </Text>
                <Text style={[styles.stampMeta, { color }]} numberOfLines={1} allowFontScaling={false}>
                  {region} · {fmtStampDate(stamp.visitedAt)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.stampHint}>도장을 탭하면 그 문화의 상세·사진을 봐요</Text>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: 20,
  },
  // ── 표지 ──
  cover: {
    flex: 1,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: NAVY_MID,
    borderWidth: 1,
    borderColor: 'rgba(203,161,94,0.34)',
    paddingHorizontal: 22,
    paddingVertical: 22,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    elevation: 7,
  },
  coverHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '48%',
    backgroundColor: NAVY_TOP,
    opacity: 0.85,
  },
  coverFrame: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 14,
    bottom: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(203,161,94,0.5)',
  },
  coverFrameInner: {
    position: 'absolute',
    top: 18,
    left: 18,
    right: 18,
    bottom: 18,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: 'rgba(203,161,94,0.28)',
  },
  corner: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderColor: GOLD,
  },
  cornerTL: { top: 22, left: 22, borderTopWidth: 1.5, borderLeftWidth: 1.5, borderTopLeftRadius: 4 },
  cornerTR: { top: 22, right: 22, borderTopWidth: 1.5, borderRightWidth: 1.5, borderTopRightRadius: 4 },
  cornerBL: { bottom: 22, left: 22, borderBottomWidth: 1.5, borderLeftWidth: 1.5, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 22, right: 22, borderBottomWidth: 1.5, borderRightWidth: 1.5, borderBottomRightRadius: 4 },
  coverTop: {
    alignItems: 'center',
    marginTop: 4,
  },
  coverKicker: {
    color: GOLD_SOFT,
    fontSize: 11,
    letterSpacing: 3,
    fontWeight: '700',
  },
  coverEmblemWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverEmblemRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1.5,
    borderColor: 'rgba(203,161,94,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(203,161,94,0.06)',
  },
  coverBottom: {
    alignItems: 'center',
    marginBottom: 2,
  },
  coverTitle: {
    color: COVER_TITLE,
    fontSize: 27,
    lineHeight: 34,
    fontWeight: '900',
    letterSpacing: 2,
    fontFamily: 'Noto Serif KR',
  },
  coverEnTitle: {
    marginTop: 8,
    color: GOLD_SOFT,
    fontSize: 12,
    letterSpacing: 4,
    fontWeight: '700',
  },
  coverDivider: {
    marginTop: 18,
    width: 54,
    height: 1,
    backgroundColor: 'rgba(203,161,94,0.6)',
  },
  coverNo: {
    marginTop: 12,
    color: COVER_SUB,
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700',
  },
  // ── 종이면 공통(명의/도장) ──
  paperFace: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: PAPER,
    borderWidth: 1,
    borderColor: PAPER_EDGE,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.42,
    shadowRadius: 30,
    elevation: 11,
  },
  paperFaceImg: {
    borderRadius: 16,
    opacity: 0.85,
  },
  paperWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(233,222,194,0.55)',
  },
  idHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(110,99,80,0.3)',
    paddingBottom: 8,
  },
  idHeaderTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  idHeaderText: {
    color: INK_SUB,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: 'Noto Serif KR',
  },
  idHeaderSubText: {
    marginTop: 2,
    color: INK_SUB,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '700',
    opacity: 0.82,
  },
  idHeaderPage: {
    color: INK_SUB,
    fontSize: 12,
    fontWeight: '700',
  },
  // ── 명의면 ──
  idBody: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 18,
  },
  idPhoto: {
    width: 92,
    height: 116,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(110,99,80,0.42)',
    backgroundColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  idPhotoText: {
    color: INK_SUB,
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '700',
  },
  idFields: {
    flex: 1,
    justifyContent: 'center',
    gap: 11,
  },
  idField: {
    gap: 2,
  },
  idLabel: {
    color: INK_SUB,
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  idValue: {
    color: INK,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  mrzBox: {
    marginTop: 'auto',
    borderTopWidth: 1,
    borderTopColor: 'rgba(110,99,80,0.3)',
    paddingTop: 10,
  },
  mrzLine: {
    fontFamily: MONO_FAMILY,
    color: INK,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 1,
  },
  // ── 도장면 ──
  watermark: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stampArea: {
    flex: 1,
    marginTop: 12,
    position: 'relative',
  },
  stamp: {
    position: 'absolute',
    width: 158,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'flex-start',
    justifyContent: 'center',
    backgroundColor: 'rgba(233,222,194,0.35)',
    opacity: 0.92,
  },
  stampSquare: {
    borderWidth: 1.8,
    borderRadius: 4,
  },
  stampCircle: {
    width: 118,
    height: 118,
    borderRadius: 59,
    borderWidth: 1.8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  stampInnerSquare: {
    position: 'absolute',
    top: 3,
    left: 3,
    right: 3,
    bottom: 3,
    borderRadius: 2,
    borderWidth: 0.8,
  },
  stampInnerCircle: {
    position: 'absolute',
    top: 5,
    left: 5,
    right: 5,
    bottom: 5,
    borderRadius: 54,
    borderWidth: 0.8,
  },
  stampPressed: {
    opacity: 0.72,
  },
  stampAdmit: {
    fontSize: 9,
    letterSpacing: 1,
    fontWeight: '700',
    marginBottom: 3,
  },
  stampName: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
    letterSpacing: -0.4,
    fontFamily: 'Noto Serif KR',
    maxWidth: '100%',
  },
  stampFirst: {
    alignSelf: 'flex-start',
    marginBottom: 3,
    fontSize: 8.5,
    lineHeight: 11,
    letterSpacing: 0.6,
    fontWeight: '900',
  },
  stampMeta: {
    marginTop: 3,
    fontSize: 10.5,
    fontWeight: '700',
    opacity: 0.9,
  },
  stampHint: {
    textAlign: 'center',
    color: INK_SUB,
    fontSize: 11.5,
    fontWeight: '700',
    marginTop: 8,
  },
});
