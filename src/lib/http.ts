import axios from 'axios';

const http = axios.create({
  baseURL: process.env.API_BASE_URL ?? 'http://172.20.10.4:5001',
  timeout: 5000,
});

// [FIX B] 요청 인터셉터 - 실제 전송되는 URL 로깅
http.interceptors.request.use(
  (config) => {
    const url = config.url || '';
    const method = config.method?.toUpperCase() || 'GET';
    const params = config.params;

    console.log('[HTTP][Request]', {
      method,
      url,
      params,
      fullURL: `${config.baseURL}${url}`,
    });

    return config;
  },
  (error) => {
    console.error('[HTTP][Request][Error]', error);
    return Promise.reject(error);
  }
);

export default http;
