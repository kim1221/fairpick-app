/**
 * 배너 광고 공용 슬롯 — adGroupId가 비어 있으면 아무것도 렌더하지 않는다.
 *
 * 플랫폼 쿼크(이벤트 상세에서 검증된 패턴 이식):
 * - Android: height=0이면 native ad SDK가 초기화되지 않는다 → 항상 고정 높이.
 *   부모 opacity < 1이면 SurfaceView/WebView 기반 렌더가 실패하므로 opacity 금지.
 * - iOS: 렌더 성공 전 height 0(빈 공간 없음), 실패/노필이면 컨테이너 자체를 제거.
 */
import React, { useState } from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
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
  const [rendered, setRendered] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!adGroupId || failed) return null;

  return (
    <View
      collapsable={false}
      style={[
        { width: '100%' },
        Platform.OS === 'android'
          ? { height, overflow: 'visible' }
          : { height: rendered ? height : 0 },
        style,
      ]}
    >
      <InlineAd
        adGroupId={adGroupId}
        impressFallbackOnMount={true}
        onAdRendered={() => setRendered(true)}
        onAdFailedToRender={() => setFailed(true)}
        onNoFill={() => setFailed(true)}
      />
    </View>
  );
}
