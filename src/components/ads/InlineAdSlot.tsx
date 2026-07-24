/**
 * 배너 광고 공용 슬롯 — adGroupId가 비어 있으면 아무것도 렌더하지 않는다.
 *
 * 레이아웃(공식 RN-BannerAd "인라인" 패턴): 너비 100%, **높이 미지정(콘텐츠 높이 자동)**.
 * 이미지·문구 강조(피드형) 배너는 96px보다 크게 렌더되므로 고정 높이를 주면 안 된다 —
 * 광고가 아래 콘텐츠를 덮어(SSP "광고 겹침 금지" 위반) 레이아웃이 깨진다.
 * 높이 자동이면 컨테이너가 광고 크기에 맞춰 늘어나고 뒤 콘텐츠가 자연히 밀린다(겹침 없음).
 *
 * 안드로이드 방어: 네이티브 광고 뷰가 신호 없이 멈추는 경우가 있어(렌더도 실패도 아님)
 * 워치독으로 일정 시간 내 아무 신호(렌더/노필/에러)도 없으면 컨테이너를 접는다.
 * 노필·렌더 실패도 접는다 → 빈 자리나 깨진 박스를 남기지 않는다.
 *
 * 노출 측정: 최상위가 IOScrollView가 아니므로 impressFallbackOnMount로 fallback.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { InlineAd } from '@apps-in-toss/framework';

// 정상 광고는 1~3초 내 렌더된다. 12초까지 아무 신호도 없으면 멈춘 것으로 보고 접는다.
const RENDER_WATCHDOG_MS = 12_000;

export function InlineAdSlot({
  adGroupId,
  style,
}: {
  adGroupId: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [failed, setFailed] = useState(false);
  const settledRef = useRef(false);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    settledRef.current = false;
    if (!adGroupId) return;
    watchdogRef.current = setTimeout(() => {
      if (!settledRef.current) setFailed(true);
    }, RENDER_WATCHDOG_MS);
    return () => {
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
    };
  }, [adGroupId]);

  const settle = () => {
    settledRef.current = true;
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
  };

  if (!adGroupId || failed) return null;

  return (
    <View collapsable={false} style={[{ width: '100%' }, style]}>
      <InlineAd
        adGroupId={adGroupId}
        impressFallbackOnMount={true}
        onAdRendered={settle}
        onAdFailedToRender={() => {
          settle();
          setFailed(true);
        }}
        onNoFill={() => {
          settle();
          setFailed(true);
        }}
      />
    </View>
  );
}
