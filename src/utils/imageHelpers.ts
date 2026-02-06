import { ImageSourcePropType } from 'react-native';
import { DEFAULT_IMAGES } from '../constants/defaultImages';

type NormalizedCategory = 'festival' | 'concert' | 'exhibition' | 'general';

/**
 * 카테고리를 표준화된 키로 변환
 *
 * @param input - 원본 카테고리 (한글/영문/대소문자 혼용 가능)
 * @returns 표준화된 카테고리 키
 */
export const normalizeCategory = (input: unknown): NormalizedCategory => {
  if (!input || typeof input !== 'string') {
    return 'general';
  }

  const target = input.toLowerCase().trim();

  // 빈 문자열 체크
  if (target === '') {
    return 'general';
  }

  // 일반/기타
  if (target.includes('일반') || target.includes('general')) {
    return 'general';
  }

  // 공연 관련
  if (
    target.includes('공연') ||
    target.includes('concert') ||
    target.includes('콘서트') ||
    target.includes('연극') ||
    target.includes('뮤지컬') ||
    target.includes('클래식') ||
    target.includes('무용')
  ) {
    return 'concert';
  }

  // 전시 관련
  if (
    target.includes('전시') ||
    target.includes('exhibition') ||
    target.includes('미술') ||
    target.includes('갤러리')
  ) {
    return 'exhibition';
  }

  // 축제/행사 관련
  if (
    target.includes('축제') ||
    target.includes('festival') ||
    target.includes('행사') ||
    target.includes('이벤트')
  ) {
    return 'festival';
  }

  // 기타
  return 'general';
};

/**
 * 카테고리에 맞는 기본 이미지를 반환
 *
 * @param categoryInput - 이벤트 카테고리 (mainCategory 또는 subCategory)
 * @returns 카테고리에 맞는 기본 이미지
 *
 * 매핑 규칙:
 * - 공연/콘서트/연극/뮤지컬 → concert.png
 * - 전시/미술 → exhibition.png
 * - 축제/행사 → festival.png
 * - 기타 → general.png
 */
export const getDefaultImage = (categoryInput: unknown): ImageSourcePropType => {
  const normalizedKey = normalizeCategory(categoryInput);
  return DEFAULT_IMAGES[normalizedKey];
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

  // 더미/플레이스홀더 이미지는 유효하지 않은 것으로 간주
  const dummyDomains = [
    'default-01.png',
    'via.placeholder.com',
    'placeholder.com',
    'placehold.it',
    'dummyimage.com',
  ];

  const urlLower = imageUrl.toLowerCase();
  if (dummyDomains.some((domain) => urlLower.includes(domain))) {
    return false;
  }

  // http(s) URL만 유효
  if (!urlLower.startsWith('http://') && !urlLower.startsWith('https://')) {
    return false;
  }

  return true;
};

/**
 * 이미지 소스를 반환 (URL이 유효하면 URL, 아니면 카테고리별 기본 이미지)
 *
 * @param imageUrl - 이미지 URL
 * @param categoryInput - 이벤트 카테고리
 * @returns 이미지 소스 (URL 객체 또는 로컬 이미지)
 */
export const getImageSource = (
  imageUrl: string | null | undefined,
  categoryInput?: unknown,
): ImageSourcePropType => {
  const isValid = isValidImageUrl(imageUrl);
  const normalizedCategory = normalizeCategory(categoryInput);
  const source = isValid ? { uri: imageUrl as string } : getDefaultImage(categoryInput);

  if (__DEV__) {
    console.log('[ImageSource]', {
      inputUrl: imageUrl ? imageUrl.substring(0, 60) + '...' : null,
      rawCategory: categoryInput,
      normalizedCategory,
      resolved: isValid ? 'URL' : 'DEFAULT',
    });
  }

  return source;
};
