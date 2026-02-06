/**
 * 시간과 요일에 따라 동적인 인사말 생성
 * @param userName - 사용자 이름 (옵션, 토스 SDK 연동 후 사용)
 */
export const getDynamicGreeting = (userName?: string): string => {
  const name = userName ? `${userName}님, ` : '';
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=일요일, 1=월, ..., 6=토요일
  
  // 금요일 저녁 (18시 이후)
  if (day === 5 && hour >= 18) {
    return `${name}드디어 주말! 이번 주말엔 어디 갈까요? 🏃`;
  }
  
  // 주말 (토, 일)
  if (day === 0 || day === 6) {
    if (hour < 12) {
      return `${name}주말 아침이에요! 상쾌한 하루 되세요 🌈`;
    }
    return `${name}주말을 알차게 즐기고 계신가요? 🎉`;
  }
  
  // 평일 아침 (6~11시)
  if (hour >= 6 && hour < 12) {
    return `${name}좋은 아침이에요! 오늘도 화이팅! ☀️`;
  }
  
  // 평일 점심 (12~13시)
  if (hour >= 12 && hour < 14) {
    return `${name}점심 맛있게 드셨나요? 😋`;
  }
  
  // 평일 오후 (14~17시)
  if (hour >= 14 && hour < 18) {
    return `${name}오후도 힘차게! 💪`;
  }
  
  // 평일 저녁 (18~22시)
  if (hour >= 18 && hour < 22) {
    return `${name}퇴근 후 힐링 어때요? 🌙`;
  }
  
  // 늦은 밤 (22시 이후)
  if (hour >= 22 || hour < 6) {
    return `${name}내일의 재미를 미리 찾아볼까요? 🌃`;
  }
  
  // 기본값
  return `${name}오늘 뭐하고 놀까요? 🥳`;
};

// TODO: 토스 SDK 연동 시 사용자 정보 가져오기
// import { useTossUserInfo } from '@toss/tds-react-native';
// const { name } = useTossUserInfo();
// getDynamicGreeting(name);

