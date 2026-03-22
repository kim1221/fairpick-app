/**
 * externalApiLogger.ts
 *
 * Kakao / Naver / Cloudflare R2 외부 API 호출량 추적.
 * 설계 원칙: fire-and-forget (로깅 실패가 메인 플로우에 영향을 주지 않음)
 *
 * provider 값:
 *   'kakao'  — Kakao Local API (지오코딩)
 *   'naver'  — Naver Search API (블로그/웹/플레이스/카페/buzz)
 *   'r2'     — Cloudflare R2 Class A 오퍼레이션 (PUT/DELETE/LIST)
 *
 * api_type 값:
 *   kakao  : 'geocode'
 *   naver  : 'blog' | 'web' | 'place' | 'cafe' | 'buzz'
 *   r2     : 'put' | 'delete' | 'list'
 */

import { pool } from '../db';

export type ExternalApiProvider = 'kakao' | 'naver' | 'r2';
export type KakaoApiType = 'geocode';
export type NaverApiType = 'blog' | 'web' | 'place' | 'cafe' | 'buzz';
export type R2ApiType = 'put' | 'delete' | 'list';

export function logExternalApi(
  provider: ExternalApiProvider,
  apiType: KakaoApiType | NaverApiType | R2ApiType,
): void {
  setImmediate(() => {
    pool
      .query(`INSERT INTO external_api_logs (provider, api_type) VALUES ($1, $2)`, [provider, apiType])
      .catch((err: unknown) => {
        console.warn('[ExternalApiLogger] DB insert failed:', (err as Error)?.message);
      });
  });
}
