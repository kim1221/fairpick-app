/**
 * 배너 광고 공용 슬롯 — adGroupId가 비어 있으면 아무것도 렌더하지 않는다.
 *
 * 레이아웃(공식 RN-BannerAd "인라인" 패턴): 너비 100%, **높이 미지정(콘텐츠 높이 자동)**.
 * 이미지·문구 강조(피드형) 배너는 96px보다 크게 렌더되므로 고정 높이를 주면 안 된다 —
 * 광고가 아래 콘텐츠를 덮어(SSP "광고 겹침 금지" 위반) 레이아웃이 깨진다.
 * 높이를 자동으로 두면 컨테이너가 광고 크기에 맞춰 늘어나고 뒤 콘텐츠가 자연히 밀린다.
 *
 * 노출 측정: 최상위가 IOScrollView가 아니므로 impressFallbackOnMount로 fallback.
 * 실패/노필이면 컨테이너를 접어(null) 빈 공간을 남기지 않는다.
 */
import React, { useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { InlineAd } from '@apps-in-toss/framework';

export function InlineAdSlot({
  adGroupId,
  style,
}: {
  adGroupId: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [failed, setFailed] = useState(false);

  if (!adGroupId || failed) return null;

  return (
    <View collapsable={false} style={[{ width: '100%' }, style]}>
      <InlineAd
        adGroupId={adGroupId}
        impressFallbackOnMount={true}
        onAdFailedToRender={() => setFailed(true)}
        onNoFill={() => setFailed(true)}
      />
    </View>
  );
}
