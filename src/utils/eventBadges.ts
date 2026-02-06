import { EventCardData } from '../data/events';

export type BadgeType = 'free' | 'hot' | 'ending';

/**
 * 이벤트 데이터 기반으로 표시할 배지 배열 반환
 * 우선순위: free > hot > ending
 */
export const getEventBadges = (event: EventCardData): BadgeType[] => {
  const badges: BadgeType[] = [];
  
  // 무료 이벤트
  if (event.isFree) {
    badges.push('free');
  }
  
  // 인기 이벤트 (popularity_score 700점 이상)
  if (event.popularityScore && event.popularityScore >= 700) {
    badges.push('hot');
  }
  
  // 마감 임박 이벤트
  if (event.isEndingSoon) {
    badges.push('ending');
  }
  
  return badges;
};

/**
 * 배지 중 가장 우선순위가 높은 하나만 반환
 */
export const getPrimaryBadge = (event: EventCardData): BadgeType | null => {
  const badges = getEventBadges(event);
  return badges.length > 0 ? badges[0] : null;
};

