/**
 * Phase 2-B: Key Normalization Debug Utilities
 *
 * 목적: 이벤트 필드와 프로필 키 간 mismatch 탐지
 * 
 * 주의: 이 유틸리티는 탐지 전용이며, 실제 계산 로직에 영향을 주지 않습니다.
 */

/**
 * Region 키 정규화
 * 
 * 목적: '전국', 공백, null 등을 표준화하여 mismatch 탐지
 */
export function normalizeRegionKey(region: string | null | undefined): string | null {
  if (!region || region.trim() === '') {
    return null;
  }

  const normalized = region.trim();

  // '전국'은 프로필에 저장하지 않음
  if (normalized === '전국') {
    return null;
  }

  return normalized;
}

/**
 * Category 키 정규화
 * 
 * 목적: '전체', 공백, null 등을 표준화하여 mismatch 탐지
 */
export function normalizeCategoryKey(category: string | null | undefined): string | null {
  if (!category || category.trim() === '') {
    return null;
  }

  const normalized = category.trim();

  // '전체'는 프로필에 저장하지 않음
  if (normalized === '전체') {
    return null;
  }

  return normalized;
}

/**
 * ISO8601 날짜에서 시간대 추출
 * 
 * @param dateStr - ISO8601 날짜 문자열 또는 Date 객체
 * @returns { isWeekend, isDaytime, parseSuccess, error }
 */
export function getTimeBucketsFromDate(
  dateStr: string | Date | null | undefined
): {
  isWeekend: boolean | null;
  isDaytime: boolean | null;
  parseSuccess: boolean;
  error?: string;
} {
  if (!dateStr) {
    return {
      isWeekend: null,
      isDaytime: null,
      parseSuccess: false,
      error: 'date_missing',
    };
  }

  try {
    const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;

    // Invalid Date 체크
    if (isNaN(date.getTime())) {
      return {
        isWeekend: null,
        isDaytime: null,
        parseSuccess: false,
        error: 'invalid_date_format',
      };
    }

    const dayOfWeek = date.getDay(); // 0=일요일, 6=토요일
    const hour = date.getHours();

    return {
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      isDaytime: hour >= 6 && hour < 18,
      parseSuccess: true,
    };
  } catch (error) {
    return {
      isWeekend: null,
      isDaytime: null,
      parseSuccess: false,
      error: error instanceof Error ? error.message : 'unknown_error',
    };
  }
}

/**
 * 이벤트 필드와 프로필 키 간 매핑 확인
 * 
 * @returns 매핑 불일치 경고 목록
 */
export function detectKeyMappingIssues(event: {
  region?: string | null;
  category?: string | null;
  mainCategory?: string | null;
  start_at?: string | Date | null;
  is_free?: boolean | null;
}): string[] {
  const warnings: string[] = [];

  // Category 필드 혼용 체크
  if (event.category && event.mainCategory && event.category !== event.mainCategory) {
    warnings.push(
      `Category field mismatch: category='${event.category}' vs mainCategory='${event.mainCategory}'`
    );
  }

  // Region 필드 '전국' 체크
  const normalizedRegion = normalizeRegionKey(event.region);
  if (event.region && !normalizedRegion) {
    warnings.push(`Region '${event.region}' will be ignored (전국 or empty)`);
  }

  // Category 필드 '전체' 체크
  const normalizedCategory = normalizeCategoryKey(event.category);
  if (event.category && !normalizedCategory) {
    warnings.push(`Category '${event.category}' will be ignored (전체 or empty)`);
  }

  // start_at 파싱 체크
  const timeCheck = getTimeBucketsFromDate(event.start_at);
  if (!timeCheck.parseSuccess) {
    warnings.push(`start_at parse failed: ${timeCheck.error || 'unknown'}`);
  }

  // is_free 타입 체크
  if (event.is_free !== undefined && event.is_free !== null && typeof event.is_free !== 'boolean') {
    warnings.push(`is_free type mismatch: expected boolean, got ${typeof event.is_free}`);
  }

  return warnings;
}


