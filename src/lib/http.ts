import axios from 'axios';
import { getToken } from '../utils/authStorage';

const http = axios.create({
  baseURL: process.env.API_BASE_URL ?? 'http://172.20.10.4:5001',
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

export default http;
