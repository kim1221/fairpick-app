/**
 * 빈티지 수하물 태그(컬처카드) 공용 프리미티브.
 * 봉인(CultureCardStack)·개봉(CultureCardReveal)이 함께 쓴다.
 *
 * RN에는 CSS의 mix-blend-mode / clip-path / filter가 없으므로 시안(v13.html)의 효과를
 * 아래 방식으로 근사한다.
 *  - 태그 종이  : ImageBackground(마닐라 jpg) + borderRadius
 *  - 각진 상단  : 앱 배경색 삼각형 View 2개(border 트릭)로 좌우 상단 모서리를 깎아 사다리꼴 상단
 *  - 그로밋     : 상단 중앙 어두운 원 View + 워엄 링 보더
 *  - 콘덴스드 폰트: Anton 등록 불가(프레임워크 미지원) → fontWeight 900 + letterSpacing + scaleX
 *  - 듀오톤 사진 : 실제 Image + 네이비 반투명 오버레이(알파)
 */
import React from 'react';
import {
  ImageBackground,
  Platform,
  StyleSheet,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { manilaTagTexture } from '../../assets';

// ── 디자인 토큰 (v13 :root) ──────────────────────────────────────────────
export const TAG_TOKENS = {
  bg: '#100D09', // 앱 배경 워엄 다크(top)
  bg2: '#0A0805', // 앱 배경(bottom) · 태그 상단 깎기 색
  manila: '#D9C7A0', // CTA 솔리드 배경
  manilaDark: '#C9B688',
  ink: '#2C2A22', // 본문 잉크
  navy: '#2A386A', // 큰 글자 / 듀오톤 오버레이
  red: '#A8331F', // 스탬프 · Nº · +티켓 · TO 라벨
  sub: '#6E6350', // 서브 · 파인프린트
  // 다크 UI(태그 밖 앱 크롬)
  cardBase: '#0B0805',
  segOff: '#4A3F2C',
  ringLine: '#4A3F2C',
  navSub: '#9A8F77',
  headText: '#EDE6D6',
  ctaDisabledBg: '#2A241A',
  ctaDisabledText: '#7A6E58',
} as const;

// 태그 몸통 안쪽 여백(그로밋/깎은 상단을 피하는 top 패딩 포함)
const TAG_INNER_PADDING_TOP = 32;
const TAG_INNER_PADDING_H = 20;
const TAG_INNER_PADDING_BOTTOM = 15;
// 각진 상단 삼각형이 깎는 폭/높이(시안 clip-path 24%/7% 근사)
const CORNER_CUT_W = 40;
const CORNER_CUT_H = 20;
const GROMMET_SIZE = 20;

const MONO_FAMILY = Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' });

/** 콘덴스드 대형 라틴 글자(Anton 대체). 시스템 900 + 음수 자간 + 가로 축소로 근사. */
export function CondensedDisplay({
  children,
  color,
  size = 52,
  style,
}: {
  children: string;
  color: string;
  size?: number;
  style?: TextStyle;
}) {
  return (
    <Text
      allowFontScaling={false}
      numberOfLines={1}
      // 폭에 맞춰 자동 축소(CULTURE/SEONGSU 등 길이 달라도 안 잘리게)
      adjustsFontSizeToFit
      minimumFontScale={0.5}
      style={[
        {
          color,
          fontSize: size,
          fontWeight: '900',
          letterSpacing: -2,
          textTransform: 'uppercase',
          width: '100%',
          textAlign: 'left',
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** 태그 몸통: 마닐라 텍스처 + 각진 상단 + 그로밋. children은 z-index 위 콘텐츠. */
export function TagBody({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[tagKitStyles.tagOuter, style]}>
      <ImageBackground
        source={manilaTagTexture}
        style={tagKitStyles.tagImage}
        imageStyle={tagKitStyles.tagImageInner}
        resizeMode="cover"
      >
        {/* 워엄 채도 보정 오버레이(텍스처가 밝아 잉크 대비 확보) */}
        <View style={tagKitStyles.manilaWash} pointerEvents="none" />
        {children}
      </ImageBackground>

      {/* 각진 상단: 앱 배경색 삼각형으로 좌우 상단 모서리를 깎음 */}
      <View style={tagKitStyles.cutLeft} pointerEvents="none" />
      <View style={tagKitStyles.cutRight} pointerEvents="none" />

      {/* 그로밋(구멍) */}
      <View style={tagKitStyles.grommet} pointerEvents="none">
        <View style={tagKitStyles.grommetHole} />
      </View>
    </View>
  );
}

/** 태그 상단 로고 헤더(빨간 이중 원 + 컬처카드 / 우측 모노 프린트) */
export function TagHeader({ printedTop, printedBottom }: { printedTop: string; printedBottom: string }) {
  return (
    <View style={tagKitStyles.th}>
      <View style={tagKitStyles.logo}>
        <View style={tagKitStyles.logoMark}>
          <View style={tagKitStyles.logoMarkInner} />
        </View>
        <Text style={tagKitStyles.logoText}>컬처카드</Text>
      </View>
      <View>
        <Text style={tagKitStyles.printed}>{printedTop}</Text>
        <Text style={tagKitStyles.printed}>{printedBottom}</Text>
      </View>
    </View>
  );
}

/** 잉크 룰(구분선). variant: solid | thin | dash */
export function Rule({ variant = 'solid' }: { variant?: 'solid' | 'thin' | 'dash' }) {
  return <View style={[tagKitStyles.hr, tagKitStyles[`hr_${variant}`]]} />;
}

/** 라벨:값 한 행 (baseline 정렬) */
export function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={tagKitStyles.fieldRow}>
      <Text style={tagKitStyles.fLbl}>{label}</Text>
      <Text style={tagKitStyles.fVal} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/** 빨간 고무 스탬프(원형 이중 보더, 회전, 반투명) */
export function RubberStamp({
  top,
  bottom,
  right,
  topText,
  bottomText,
}: {
  top?: number;
  bottom?: number;
  right: number;
  topText: string;
  bottomText: string;
}) {
  return (
    <View
      style={[
        tagKitStyles.stamp,
        { right },
        top != null ? { top } : null,
        bottom != null ? { bottom } : null,
      ]}
      pointerEvents="none"
    >
      <View style={tagKitStyles.stampInner} />
      <Text style={tagKitStyles.stampTop}>{topText}</Text>
      <Text style={tagKitStyles.stampBottom}>{bottomText}</Text>
    </View>
  );
}

/** 파인프린트(모노 소문자캡스, 중앙) */
export function FinePrint({ children }: { children: string }) {
  return <Text style={tagKitStyles.fineprint}>{children}</Text>;
}

const tagKitStyles = StyleSheet.create({
  tagOuter: {
    width: 256,
    alignSelf: 'center',
    borderRadius: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.6,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 18 },
    elevation: 14,
  },
  tagImage: {
    borderRadius: 6,
    overflow: 'hidden',
    // 텍스처 로드 전/후 항상 밝은 크림 베이스 보장(어두워지지 않게)
    backgroundColor: '#EBE2CC',
    paddingTop: TAG_INNER_PADDING_TOP,
    paddingHorizontal: TAG_INNER_PADDING_H,
    paddingBottom: TAG_INNER_PADDING_BOTTOM,
  },
  tagImageInner: {
    borderRadius: 6,
  },
  // 종이를 살짝 들어올리는 밝은 워시(어둡게 X)
  manilaWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(247,241,225,0.14)',
  },
  cutLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    borderTopWidth: CORNER_CUT_H,
    borderRightWidth: CORNER_CUT_W,
    borderTopColor: TAG_TOKENS.bg2,
    borderRightColor: 'transparent',
  },
  cutRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 0,
    height: 0,
    borderTopWidth: CORNER_CUT_H,
    borderLeftWidth: CORNER_CUT_W,
    borderTopColor: TAG_TOKENS.bg2,
    borderLeftColor: 'transparent',
  },
  grommet: {
    position: 'absolute',
    top: 11,
    left: '50%',
    marginLeft: -GROMMET_SIZE / 2,
    width: GROMMET_SIZE,
    height: GROMMET_SIZE,
    borderRadius: GROMMET_SIZE / 2,
    backgroundColor: '#6B5A3A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  grommetHole: {
    width: GROMMET_SIZE - 8,
    height: GROMMET_SIZE - 8,
    borderRadius: (GROMMET_SIZE - 8) / 2,
    backgroundColor: '#0E0B07',
  },
  th: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logoMark: {
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 1.6,
    borderColor: TAG_TOKENS.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoMarkInner: {
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: TAG_TOKENS.red,
  },
  logoText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: TAG_TOKENS.ink,
  },
  printed: {
    fontFamily: MONO_FAMILY,
    fontSize: 8,
    lineHeight: 11,
    letterSpacing: 0.3,
    color: TAG_TOKENS.sub,
    textAlign: 'right',
  },
  hr: {
    backgroundColor: TAG_TOKENS.ink,
    marginVertical: 9,
  },
  hr_solid: {
    height: 1.5,
    opacity: 0.7,
  },
  hr_thin: {
    height: 1,
    opacity: 0.36,
  },
  hr_dash: {
    height: 0,
    backgroundColor: 'transparent',
    borderTopWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: TAG_TOKENS.ink,
    opacity: 0.42,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  fLbl: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: TAG_TOKENS.ink,
    opacity: 0.72,
    textTransform: 'uppercase',
  },
  fVal: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: TAG_TOKENS.ink,
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
  stamp: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 2,
    borderColor: TAG_TOKENS.red,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.4,
    transform: [{ rotate: '-13deg' }],
  },
  stampInner: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: 4,
    bottom: 4,
    borderRadius: 31,
    borderWidth: 1,
    borderColor: TAG_TOKENS.red,
  },
  stampTop: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: TAG_TOKENS.red,
  },
  stampBottom: {
    fontFamily: MONO_FAMILY,
    fontSize: 9,
    marginTop: 1,
    color: TAG_TOKENS.red,
  },
  fineprint: {
    fontFamily: MONO_FAMILY,
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 0.6,
    color: TAG_TOKENS.sub,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginTop: 10,
  },
});
