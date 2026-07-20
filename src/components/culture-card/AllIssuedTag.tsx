/**
 * 오늘 발행 마감(지역 풀 소진) 화면 — draw-loop-v1 시안 ③.
 * openCap.reason='regional_pool'일 때만 쓴다: 한도 페널티가 아니라
 * "오늘 {지역}의 카드는 여기까지" 지역 희소성 프레이밍.
 * 마닐라 태그(그로밋 없음) + ALL ISSUED 레드 스탬프 + 아웃라인 CTA.
 */
import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { BoxStamp, TagBody } from './tagKit';

const MONO_FAMILY = Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' });

const TITLE_INK = '#2A2415';
const SUB_INK = '#6B5F49';
const ACCENT = '#A8331F';
const METER = '#8A7A56';
const GHOST_LINE = '#4A4234';
const GHOST_TEXT = '#D9CBA8';
const FOOT_SUB = '#8B8071';

interface AllIssuedTagProps {
  title: string;
  description: string;
  meterLabel: string;
  ctaLabel: string;
  footnote: string;
  onAction: () => void;
}

export function AllIssuedTag({
  title,
  description,
  meterLabel,
  ctaLabel,
  footnote,
  onAction,
}: AllIssuedTagProps) {
  const { width } = useWindowDimensions();
  const tagWidth = Math.min(width - 44, 380);

  // "가까운 문화를 4곳 모두 발견했어요." — 숫자 부분만 레드 강조(시안 done-sub b)
  const descriptionParts = description.split(/(\d+곳)/);

  return (
    <View style={styles.section}>
      <TagBody showGrommet={false} style={StyleSheet.flatten([styles.tag, { width: tagWidth }])}>
        <View style={styles.inner}>
          <BoxStamp text="ALL ISSUED" size="large" style={styles.stamp} />
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>
            {descriptionParts.map((part, index) => (
              /\d+곳/.test(part)
                // biome-ignore lint/suspicious/noArrayIndexKey: 정적 카피 분해라 순서가 안정적이다
                ? <Text key={index} style={styles.descriptionStrong}>{part}</Text>
                // biome-ignore lint/suspicious/noArrayIndexKey: 정적 카피 분해라 순서가 안정적이다
                : <Text key={index}>{part}</Text>
            ))}
          </Text>
          <Text style={styles.meter}>{meterLabel}</Text>
        </View>
      </TagBody>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
        onPress={onAction}
        style={({ pressed }) => [
          styles.ghostCta,
          { width: tagWidth },
          pressed ? styles.ghostCtaPressed : null,
        ]}
      >
        <Text style={styles.ghostCtaText}>{ctaLabel}</Text>
      </Pressable>
      <Text style={styles.footnote}>{footnote}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingTop: 16,
    paddingBottom: 4,
  },
  tag: {
    alignSelf: 'center',
  },
  inner: {
    minHeight: 400,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  stamp: {
    marginBottom: 26,
  },
  title: {
    color: TITLE_INK,
    fontSize: 19,
    lineHeight: 28,
    fontWeight: '800',
    textAlign: 'center',
  },
  description: {
    marginTop: 12,
    color: SUB_INK,
    fontSize: 12.5,
    lineHeight: 21,
    fontWeight: '600',
    textAlign: 'center',
  },
  descriptionStrong: {
    color: ACCENT,
    fontWeight: '800',
  },
  meter: {
    marginTop: 22,
    fontFamily: MONO_FAMILY,
    fontSize: 11,
    letterSpacing: 1,
    color: METER,
    textAlign: 'center',
  },
  ghostCta: {
    alignSelf: 'center',
    marginTop: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: GHOST_LINE,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostCtaPressed: {
    opacity: 0.75,
  },
  ghostCtaText: {
    color: GHOST_TEXT,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  footnote: {
    marginTop: 9,
    textAlign: 'center',
    color: FOOT_SUB,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
});
