/**
 * 동적 인사말 유틸리티
 *
 * 시간대 및 요일에 따라 적절한 인사말을 반환합니다.
 * 모든 함수는 순수 함수로 구현되어 테스트 가능합니다.
 */

export interface GreetingOptions {
  /**
   * 사용자 이름 (옵션)
   * TODO: 향후 사용자 로그인 기능 추가 시 활용 예정
   */
  userName?: string;
  /**
   * 특정 시간을 테스트하기 위한 옵션 (주로 테스트용)
   * 지정하지 않으면 현재 시간 사용
   */
  currentDate?: Date;
}

/**
 * 시간대별 인사말 가져오기
 * - 새벽(0-5): "좋은 새벽이에요"
 * - 아침(6-11): "좋은 아침이에요"
 * - 점심(12-13): "점심 시간이네요"
 * - 오후(14-17): "좋은 오후에요"
 * - 저녁(18-21): "좋은 저녁이에요"
 * - 밤(22-23): "편안한 밤 되세요"
 */
export function getTimeBasedGreeting(currentDate: Date = new Date()): string {
  const hour = currentDate.getHours();

  if (hour >= 0 && hour < 6) {
    return '좋은 새벽이에요';
  }
  if (hour >= 6 && hour < 12) {
    return '좋은 아침이에요';
  }
  if (hour >= 12 && hour < 14) {
    return '점심 시간이네요';
  }
  if (hour >= 14 && hour < 18) {
    return '좋은 오후에요';
  }
  if (hour >= 18 && hour < 22) {
    return '좋은 저녁이에요';
  }
  return '편안한 밤 되세요';
}

/**
 * 요일별 특별 인사말 가져오기
 * - 주말(토/일): 특별 메시지 반환
 * - 평일(월-금): null 반환 (시간대별 인사말 사용)
 */
export function getDayBasedGreeting(currentDate: Date = new Date()): string | null {
  const day = currentDate.getDay(); // 0(일) ~ 6(토)

  if (day === 0) {
    // 일요일
    return '즐거운 일요일 보내세요';
  }
  if (day === 6) {
    // 토요일
    return '행복한 주말 보내세요';
  }

  // 평일에는 null 반환 (시간대별 인사말 사용)
  return null;
}

/**
 * 최종 인사말 가져오기
 * 우선순위: 요일별 인사말 > 시간대별 인사말
 *
 * @param options - 인사말 옵션
 * @returns 적절한 인사말 문자열
 */
export function getGreeting(options: GreetingOptions = {}): string {
  const { userName, currentDate = new Date() } = options;

  // TODO: 향후 사용자 로그인 기능 추가 시 userName 활용
  // 예: `${userName}님, ${greeting}` 형태로 개인화된 인사말 제공
  if (userName) {
    // 현재는 userName을 무시하지만, 타입 안전성을 위해 파라미터로 유지
  }

  // 1. 요일별 특별 인사말 확인
  const dayGreeting = getDayBasedGreeting(currentDate);
  if (dayGreeting) {
    return dayGreeting;
  }

  // 2. 시간대별 인사말 반환
  return getTimeBasedGreeting(currentDate);
}
