import React, { useEffect, useState } from 'react';
import { Image, ImageStyle, StyleProp, ImageResizeMode } from 'react-native';
import { getImageSource } from '../utils/imageHelpers';

type Props = {
  uri?: string;
  height: number;
  borderRadius?: number;
  resizeMode?: ImageResizeMode;
  accessibilityLabel?: string;
  style?: StyleProp<ImageStyle>;
  category?: string;
};

/**
 * 이벤트 이미지 컴포넌트
 *
 * - 유효한 이미지 URL이 있으면 해당 이미지를 표시
 * - 이미지가 없거나 로드 실패 시 카테고리별 3D 기본 이미지를 표시
 */
export function EventImage({ uri, height, borderRadius = 16, resizeMode = 'cover', accessibilityLabel, style, category }: Props) {
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageError(false);
  }, [uri]);

  // 이미지 에러 발생 시 기본 이미지로 폴백
  const imageSource = imageError ? getImageSource(null, category) : getImageSource(uri, category);

  return (
    <Image
      source={imageSource}
      accessibilityLabel={accessibilityLabel}
      resizeMode={resizeMode}
      onError={() => setImageError(true)}
      style={[
        {
          width: '100%',
          height,
          borderRadius,
          backgroundColor: '#EFF2F5',
        },
        style,
      ]}
    />
  );
}
