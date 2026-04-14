/**
 * Fairpick API 설정
 */

// API Base URL 설정 (환경별)
// React Native에서는 localhost 대신 로컬 IP 주소를 사용해야 합니다.
// iOS 시뮬레이터: localhost 사용 가능
// Android 에뮬레이터: 10.0.2.2 사용
// 실제 기기: 컴퓨터의 로컬 IP 주소 사용 (172.20.10.4)
export const API_BASE_URL = 'https://fairpick-app-production.up.railway.app';

// API 엔드포인트
export const API_ENDPOINTS = {
  // 추천 시스템 v2
  recommendations: {
    today: '/api/recommendations/v2/today',
    trending: '/api/recommendations/v2/trending',
    nearby: '/api/recommendations/v2/nearby',
    personalized: '/api/recommendations/v2/personalized',
    weekend: '/api/recommendations/v2/weekend',
    latest: '/api/recommendations/v2/latest',
    endingSoon: '/api/recommendations/v2/ending-soon',
    exhibition: '/api/recommendations/v2/exhibition',
    free: '/api/recommendations/v2/free',
  },
  
  // 홈 섹션 (curation_themes 기반 통합 API)
  homeSections: '/api/home/sections',

  // 매거진 피드
  homeFeed: '/api/home/feed',

  // 사용자 행동 로그
  userEvents: '/api/user-events',
  
  // 이벤트 상세
  eventDetail: '/api/events',  // GET /api/events/:id
} as const;

// API 타임아웃 설정
// Railway 콜드 스타트(비활성 후 재기동)에 여유 시간 확보
export const API_TIMEOUT = 15000; // 15초

// API 에러 메시지
export const API_ERROR_MESSAGES = {
  NETWORK_ERROR: '네트워크 연결을 확인해주세요.',
  TIMEOUT_ERROR: '요청 시간이 초과되었습니다.',
  SERVER_ERROR: '서버 오류가 발생했습니다.',
  UNKNOWN_ERROR: '알 수 없는 오류가 발생했습니다.',
} as const;

