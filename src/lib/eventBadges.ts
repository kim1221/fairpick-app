import { EventCardData } from '../data/events';

/**
 * 이벤트 배지 자동 결정 유틸리티
 *
 * 이벤트의 속성(isFree, isEndingSoon, popularityScore)을 기반으로
 * 우선순위에 따라 대표 배지를 결정합니다.
 *
 * 모든 함수는 순수 함수로 구현되어 테스트 가능합니다.
 */

/**
 * 이벤트 배지 타입
 * - free: 무료 이벤트
 * - ending: 마감 임박 이벤트
 * - hot: 인기 이벤트
 * - null: 특별 배지 없음
 */
export type EventBadgeType = 'free' | 'ending' | 'hot' | null;

/**
 * 인기 이벤트 판단을 위한 기본 threshold
 * popularityScore가 이 값 이상이면 'hot' 배지 부여
 */
export const DEFAULT_HOT_THRESHOLD = 70;

/**
 * 이벤트가 인기(hot) 배지를 받을 자격이 있는지 판단
 *
 * @param popularityScore - 이벤트 인기도 점수 (0-100)
 * @param threshold - hot 판단 기준점 (기본값: 70)
 * @returns hot 배지 자격 여부
 */
export function isHotEvent(popularityScore?: number, threshold: number = DEFAULT_HOT_THRESHOLD): boolean {
  if (popularityScore === undefined || popularityScore === null) {
    return false;
  }
  return popularityScore >= threshold;
}

/**
 * 이벤트의 대표 배지 결정
 *
 * 우선순위:
 * 1. free (무료) - isFree === true
 * 2. ending (마감 임박) - isEndingSoon === true
 * 3. hot (인기) - popularityScore >= threshold
 * 4. null (배지 없음) - 위 조건 모두 해당 없음
 *
 * @param event - 이벤트 데이터
 * @param hotThreshold - hot 배지 판단 기준점 (기본값: 70)
 * @returns 대표 배지 타입
 *
 * @example
 * ```typescript
 * const event1 = { isFree: true, isEndingSoon: true, popularityScore: 90 };
 * getPrimaryBadge(event1); // 'free' (최우선)
 *
 * const event2 = { isFree: false, isEndingSoon: true, popularityScore: 90 };
 * getPrimaryBadge(event2); // 'ending' (두번째 우선순위)
 *
 * const event3 = { isFree: false, isEndingSoon: false, popularityScore: 90 };
 * getPrimaryBadge(event3); // 'hot' (세번째 우선순위)
 *
 * const event4 = { isFree: false, isEndingSoon: false, popularityScore: 50 };
 * getPrimaryBadge(event4); // null (배지 없음)
 * ```
 */
export function getPrimaryBadge(
  event: Pick<EventCardData, 'isFree' | 'isEndingSoon' | 'popularityScore'>,
  hotThreshold: number = DEFAULT_HOT_THRESHOLD,
): EventBadgeType {
  // 1순위: 무료 이벤트
  if (event.isFree === true) {
    return 'free';
  }

  // 2순위: 마감 임박 이벤트
  if (event.isEndingSoon === true) {
    return 'ending';
  }

  // 3순위: 인기 이벤트
  if (isHotEvent(event.popularityScore, hotThreshold)) {
    return 'hot';
  }

  // 특별 배지 없음
  return null;
}

/**
 * 배지 표시 텍스트 가져오기
 *
 * @param badgeType - 배지 타입
 * @returns 배지 표시 텍스트 (null이면 빈 문자열)
 */
export function getBadgeText(badgeType: EventBadgeType): string {
  switch (badgeType) {
    case 'free':
      return '무료';
    case 'ending':
      return '마감임박';
    case 'hot':
      return '인기';
    case null:
      return '';
    default:
      return '';
  }
}

/**
 * 여러 이벤트의 배지를 일괄 결정
 *
 * @param events - 이벤트 목록
 * @param hotThreshold - hot 배지 판단 기준점
 * @returns 각 이벤트의 ID와 배지 타입 매핑
 *
 * @example
 * ```typescript
 * const events = [
 *   { id: 'e1', isFree: true, ... },
 *   { id: 'e2', isEndingSoon: true, ... },
 * ];
 * const badges = getBadgesForEvents(events);
 * // { e1: 'free', e2: 'ending' }
 * ```
 */
export function getBadgesForEvents(
  events: EventCardData[],
  hotThreshold: number = DEFAULT_HOT_THRESHOLD,
): Record<string, EventBadgeType> {
  const result: Record<string, EventBadgeType> = {};

  for (const event of events) {
    result[event.id] = getPrimaryBadge(event, hotThreshold);
  }

  return result;
}
