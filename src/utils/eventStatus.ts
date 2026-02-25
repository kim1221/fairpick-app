/**
 * 이벤트 종료/활성 여부 판정 공통 유틸
 *
 * - Pattern A (isEventEnded): API EventCardData의 endAt 기반 판정
 * - Pattern B (isStoredItemActive): 스토리지 아이템의 lastKnownStatus + snapshot.endAt 기반 판정
 */

/** 오늘 자정 기준 Date 반환 */
export function getTodayMidnight(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/**
 * [Pattern A] endAt 문자열 기반 종료 여부 판정
 * - API 응답의 EventCardData.endAt에 사용 (likes.tsx, recent.tsx loadLikes/loadRecent)
 */
export function isEventEnded(
  endAt: string | null | undefined,
  today: Date = getTodayMidnight()
): boolean {
  if (!endAt) return false;
  return new Date(endAt) < today;
}

/**
 * [Pattern B] 스토리지 아이템의 활성 여부 판정
 * - snapshot.endAt이 있으면 날짜 직접 비교, 없으면 lastKnownStatus fallback
 * - mypage.tsx activeCount 계산, likes.tsx handleClearEnded 필터링에 사용
 */
export function isStoredItemActive(
  item: { lastKnownStatus: string; snapshot?: { endAt?: string } },
  today: Date = getTodayMidnight()
): boolean {
  if (item.lastKnownStatus === 'deleted') return false;
  const endAt = item.snapshot?.endAt;
  if (endAt) return new Date(endAt) >= today;
  return item.lastKnownStatus === 'active';
}
