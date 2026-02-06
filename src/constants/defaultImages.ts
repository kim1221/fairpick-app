/**
 * 카테고리별 기본 이미지 (GitHub raw URL)
 */

import { ImageSourcePropType } from 'react-native';

type DefaultImageKey = 'concert' | 'exhibition' | 'festival' | 'general';

export const DEFAULT_IMAGES: Record<DefaultImageKey, ImageSourcePropType> = {
  // 공연/콘서트/연극/뮤지컬
  concert: {
    uri: 'https://raw.githubusercontent.com/kim1221/fairpick-app/main/src/assets/images/defaults/concert.png',
  },

  // 전시/미술
  exhibition: {
    uri: 'https://raw.githubusercontent.com/kim1221/fairpick-app/main/src/assets/images/defaults/exhibition.png',
  },

  // 축제/행사
  festival: {
    uri: 'https://raw.githubusercontent.com/kim1221/fairpick-app/main/src/assets/images/defaults/festival.png',
  },

  // 기타
  general: {
    uri: 'https://raw.githubusercontent.com/kim1221/fairpick-app/main/src/assets/images/defaults/general.png',
  },
} as const;

