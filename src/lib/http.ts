import axios from 'axios';
import { getToken, clearToken, clearStoredUser } from '../utils/authStorage';

const http = axios.create({
  baseURL: process.env.API_BASE_URL ?? (__DEV__ ? 'http://172.20.10.4:5001' : 'https://fairpick-app-production.up.railway.app'),
  timeout: 5000,
});

// 요청 인터셉터: URL 로깅 + 로그인 유저면 Authorization 헤더 자동 주입
http.interceptors.request.use(
  async (config) => {
    // Authorization 헤더 주입 (있을 때만)
    const token = await getToken();
    if (token) {
      config.headers = config.headers ?? {};
      config.headers['Authorization'] = `Bearer ${token}`;
    }

    if (__DEV__) {
      console.log('[HTTP][Request]', {
        method: config.method?.toUpperCase() ?? 'GET',
        url: config.url ?? '',
        params: config.params,
        authed: !!token,
      });
    }

    return config;
  },
  (error) => {
    console.error('[HTTP][Request][Error]', error);
    return Promise.reject(error);
  }
);

// 응답 인터셉터: 401 → 로컬 세션 삭제 (다음 렌더링에서 useAuth가 isLoggedIn=false로 전환)
http.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await Promise.all([clearToken(), clearStoredUser()]).catch(() => {});
    }
    return Promise.reject(error);
  }
);

export default http;
