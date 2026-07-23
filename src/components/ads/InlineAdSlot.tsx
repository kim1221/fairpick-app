/**
 * 배너 광고 공용 슬롯 — adGroupId가 비어 있으면 아무것도 렌더하지 않는다.
 *
 * iOS·Android 모두에서 노출되도록 **처음부터 고정 높이**를 잡는다(2026-07-23 요구).
 * - Android native ad SDK는 height=0이면 초기화되지 않는다.
 * - iOS도 렌더 전 height=0으로 두면 광고 뷰가 레이아웃되지 않아 노출이 안 뜰 수 있다.
 * → 두 플랫폼 다 실제 높이를 먼저 확보하고, 광고가 실패/노필일 때만 컨테이너를 접는다.
 * - 부모 opacity < 1이면 Android SurfaceView/WebView 렌더가 실패하므로 opacity 금지.
 */
import React, { useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { InlineAd } from '@apps-in-toss/framework';

export function InlineAdSlot({
  adGroupId,
  height = 96,
  style,
}: {
  adGroupId: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [failed, setFailed] = useState(false);

  if (!adGroupId || failed) return null;

  return (
    <View
      collapsable={false}
      style={[{ width: '100%', height, overflow: 'visible' }, style]}
    >
      <InlineAd
        adGroupId={adGroupId}
        impressFallbackOnMount={true}
        onAdFailedToRender={() => setFailed(true)}
        onNoFill={() => setFailed(true)}
      />
    </View>
  );
}
