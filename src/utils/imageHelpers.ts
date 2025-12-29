import { ImageSourcePropType } from 'react-native';

/**
 * 카테고리별 기본 이미지 매핑
 */
const defaultImages: Record<string, ImageSourcePropType> = {
  concert: require('../assets/images/defaults/concert.png'),
  exhibition: require('../assets/images/defaults/exhibition.png'),
  festival: require('../assets/images/defaults/festival.png'),
  general: require('../assets/images/defaults/general.png'),
};

/**
 * 카테고리에 맞는 기본 이미지를 반환
 *
 * @param category - 이벤트 카테고리 (mainCategory 또는 subCategory)
 * @returns 카테고리에 맞는 기본 이미지
 *
 * 매핑 규칙:
 * - 공연/콘서트/연극/뮤지컬 → concert.png
 * - 전시/미술 → exhibition.png
 * - 축제/행사 → festival.png
 * - 기타 → general.png
 */
export const getDefaultImage = (category: string = ''): ImageSourcePropType => {
  const target = category.toLowerCase();

  // 공연 관련
  if (target.includes('공연') || target.includes('콘서트') || target.includes('연극') || target.includes('뮤지컬')) {
    return defaultImages.concert;
  }

  // 전시 관련
  if (target.includes('전시') || target.includes('미술')) {
    return defaultImages.exhibition;
  }

  // 축제/행사 관련
  if (target.includes('축제') || target.includes('행사')) {
    return defaultImages.festival;
  }

  // 기본값
  return defaultImages.general;
};

/**
 * 이미지 URL이 유효한지 확인
 *
 * @param imageUrl - 체크할 이미지 URL
 * @returns 유효한 이미지 URL이면 true, 아니면 false
 */
export const isValidImageUrl = (imageUrl: string | null | undefined): boolean => {
  if (!imageUrl || imageUrl.trim() === '') {
    return false;
  }

  // PLACEHOLDER_IMAGE는 유효하지 않은 것으로 간주
  if (imageUrl.includes('default-01.png')) {
    return false;
  }

  return true;
};

/**
 * 이미지 소스를 반환 (URL이 유효하면 URL, 아니면 카테고리별 기본 이미지)
 *
 * @param imageUrl - 이미지 URL
 * @param category - 이벤트 카테고리
 * @returns 이미지 소스 (URL 객체 또는 로컬 이미지)
 */
export const getImageSource = (
  imageUrl: string | null | undefined,
  category: string = '',
): ImageSourcePropType => {
  if (isValidImageUrl(imageUrl)) {
    return { uri: imageUrl as string };
  }

  return getDefaultImage(category);
};
