/**
 * 필드 스코프 유틸리티 (백엔드 전용)
 *
 * MASTER/VARIANT 필드 분류를 백엔드에서 확인하기 위한 유틸리티.
 * admin-web/fieldRegistry와 동기화 필요.
 */

export type FieldScope = 'MASTER' | 'VARIANT';

/**
 * MASTER 필드 목록 (일관성 우선 - 같은 이벤트 변형 간 동일해야 함)
 *
 * - 공통 콘텐츠: title, main_category, sub_category, image_url, overview, display_title, derived_tags
 * - 전시 핵심: artists, genre, type
 * - 공연 핵심: cast, genre
 * - 팝업 핵심: brands, collab_description, is_fnb, best_items
 */
const MASTER_FIELDS = new Set([
  // 공통 콘텐츠
  'title',
  'main_category',
  'sub_category',
  'image_url',
  'overview',
  'display_title',
  'derived_tags',

  // 전시 핵심 콘텐츠
  'metadata.display.exhibition.artists',
  'metadata.display.exhibition.genre',
  'metadata.display.exhibition.type',

  // 공연 핵심 콘텐츠
  'metadata.display.performance.cast',
  'metadata.display.performance.genre',

  // 팝업 핵심 콘텐츠
  'metadata.display.popup.brands',
  'metadata.display.popup.collab_description',
  'metadata.display.popup.is_fnb',
  'metadata.display.popup.best_items',
]);

/**
 * 필드 키의 스코프 확인
 *
 * @param fieldKey - dot-path 필드 키 (예: "overview", "metadata.display.exhibition.artists")
 * @returns 'MASTER' | 'VARIANT'
 */
export function getFieldScope(fieldKey: string): FieldScope {
  if (MASTER_FIELDS.has(fieldKey)) {
    return 'MASTER';
  }

  // MASTER가 아니면 VARIANT (기본값)
  return 'VARIANT';
}

/**
 * 여러 필드를 스코프별로 분류
 *
 * @param fieldKeys - 필드 키 배열
 * @returns { masterFields: string[], variantFields: string[] }
 */
export function classifyFieldsByScope(fieldKeys: string[]): {
  masterFields: string[];
  variantFields: string[];
} {
  const masterFields: string[] = [];
  const variantFields: string[] = [];

  for (const fieldKey of fieldKeys) {
    if (fieldKey === '*') continue; // 전체 재생성은 제외

    const scope = getFieldScope(fieldKey);
    if (scope === 'MASTER') {
      masterFields.push(fieldKey);
    } else {
      variantFields.push(fieldKey);
    }
  }

  return { masterFields, variantFields };
}
