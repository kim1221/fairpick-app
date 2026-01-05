/**
 * Backend HTTP 유틸리티 (Node.js fetch 기반)
 * - 외부 API 호출용 (문화정보원, KOPIS, 관광정보 등)
 * - 프론트엔드 http.ts와 유사한 구조로 에러 처리 통일
 */

const DEFAULT_TIMEOUT = 10000; // 외부 API는 10초 timeout

interface RequestOptions extends RequestInit {
  timeout?: number;
  params?: Record<string, string | number | boolean | undefined>;
}

interface HttpError extends Error {
  status?: number;
  statusText?: string;
  response?: unknown;
  type?: 'HTTP_ERROR' | 'NETWORK_ERROR' | 'TIMEOUT_ERROR';
}

class HttpClient {
  private defaultTimeout: number;

  constructor(timeout: number = DEFAULT_TIMEOUT) {
    this.defaultTimeout = timeout;
  }

  private async request<T>(url: string, options: RequestOptions = {}): Promise<T> {
    const { timeout = this.defaultTimeout, params, ...fetchOptions } = options;

    // URL 생성 (쿼리 파라미터 포함)
    let fullUrl = url;
    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        fullUrl += (url.includes('?') ? '&' : '?') + queryString;
      }
    }

    // AbortController로 timeout 구현
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(fullUrl, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // HTTP 에러 처리
      if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        const error: HttpError = new Error(`HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;
        error.statusText = response.statusText;
        error.type = 'HTTP_ERROR';

        try {
          const text = await response.text();
          const bodyPrefix = text.substring(0, 500);

          // 에러 응답 상세 로깅
          console.error('[HTTP] Error Response Details:');
          console.error(`  URL: ${fullUrl.replace(/serviceKey=[^&]+/, 'serviceKey=***')}`);
          console.error(`  Status: ${response.status} ${response.statusText}`);
          console.error(`  Content-Type: ${contentType}`);
          console.error(`  Body (first 500 chars): ${bodyPrefix}`);

          // JSON 파싱 시도
          if (contentType.includes('application/json')) {
            try {
              error.response = JSON.parse(text);
            } catch {
              error.response = text;
            }
          } else {
            error.response = text;
          }
        } catch {
          error.response = 'Failed to read response body';
        }
        throw error;
      }

      // 성공 응답 파싱 - content-type 기반 분기
      const contentType = response.headers.get('content-type') || '';

      // JSON 응답
      if (contentType.includes('application/json')) {
        const data = await response.json();
        return data as T;
      }

      // XML 응답 또는 text/html이지만 body가 XML인 경우
      const text = await response.text();

      // XML 감지 (<?xml 또는 < 로 시작)
      if (text.trim().startsWith('<?xml') || text.trim().startsWith('<')) {
        // XML은 문자열로 반환 (caller가 xml2js로 파싱)
        return text as unknown as T;
      }

      // 기타 text 응답 (HTML 에러 페이지 등)
      if (contentType.includes('text/html')) {
        console.warn('[HTTP] Received HTML response (possibly error page):');
        console.warn(`  URL: ${fullUrl.replace(/serviceKey=[^&]+/, 'serviceKey=***')}`);
        console.warn(`  Content-Type: ${contentType}`);
        console.warn(`  Body (first 300 chars): ${text.substring(0, 300)}`);
      }

      // 기본적으로 text로 반환
      return text as unknown as T;

    } catch (error: unknown) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        // 타임아웃 에러
        if (error.name === 'AbortError') {
          const timeoutError: HttpError = new Error(`Request timeout after ${timeout}ms`);
          timeoutError.name = 'TimeoutError';
          timeoutError.type = 'TIMEOUT_ERROR';
          throw timeoutError;
        }

        // 네트워크 에러
        if (error instanceof TypeError && error.message.includes('fetch')) {
          const networkError: HttpError = new Error('Network error: Failed to fetch');
          networkError.name = 'NetworkError';
          networkError.type = 'NETWORK_ERROR';
          throw networkError;
        }
      }

      // 기타 에러
      throw error;
    }
  }

  async get<T>(url: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(url, {
      ...options,
      method: 'GET',
    });
  }

  async head(url: string, options: RequestOptions = {}): Promise<Response> {
    const { timeout = this.defaultTimeout, params, ...fetchOptions } = options;

    let fullUrl = url;
    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        fullUrl += (url.includes('?') ? '&' : '?') + queryString;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(fullUrl, {
        ...fetchOptions,
        method: 'HEAD',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response;

    } catch (error: unknown) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        const timeoutError: HttpError = new Error(`Request timeout after ${timeout}ms`);
        timeoutError.name = 'TimeoutError';
        timeoutError.type = 'TIMEOUT_ERROR';
        throw timeoutError;
      }

      throw error;
    }
  }

  async post<T>(url: string, data?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(url, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    });
  }
}

const http = new HttpClient();

export default http;
export type { HttpError, RequestOptions };

