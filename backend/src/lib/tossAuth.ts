/**
 * 토스 로그인 파트너 API 래퍼
 *
 * 모든 엔드포인트는 서버 간(server-to-server) 호출이에요.
 * accessToken / refreshToken 은 절대 클라이언트에 노출하면 안 돼요.
 *
 * 참고 문서: https://developers-apps-in-toss.toss.im/api/
 */

import axios from 'axios';
import { config } from '../config';
import { decryptTossValue } from './tossDecrypt';

const BASE = config.toss.apiBaseUrl;

// ─── Toss API 공통 응답 래퍼 ────────────────────────────────────────────────

type TossResultType =
  | 'SUCCESS'
  | 'HTTP_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'EXECUTION_FAIL'
  | 'INTERRUPTED'
  | 'INTERNAL_ERROR'
  | 'FAIL';

interface TossResponse<T> {
  resultType?: TossResultType;
  success?: T;
  error?: { code: string; message: string } | string;
  error_description?: string;
}

/**
 * Toss API 응답에서 success 페이로드를 꺼내요.
 * 두 가지 오류 포맷을 모두 처리해요:
 *   1. { resultType: 'FAIL', error: { code, message } }  — 파트너 API 공통 포맷
 *   2. { error: 'invalid_grant', error_description: '...' } — OAuth2 표준 오류 포맷
 */
function unwrap<T>(res: TossResponse<T>, label: string): T {
  // OAuth2 표준 오류 포맷 (error가 문자열)
  if (typeof res.error === 'string') {
    const desc = res.error_description ?? res.error;
    throw new Error(`[tossAuth][${label}] ${desc}`);
  }

  // 파트너 API 공통 포맷
  if (res.resultType !== 'SUCCESS' || !res.success) {
    const msg = (res.error as { message?: string } | undefined)?.message ?? res.resultType ?? 'unknown error';
    throw new Error(`[tossAuth][${label}] ${msg}`);
  }

  return res.success;
}

// ─── 파트너 API 인증 헤더 ───────────────────────────────────────────────────
// 앱인토스 파트너 API는 Basic 인증(clientId:clientSecret)을 사용해요.
// 개발자센터에서 정확한 인증 방식을 확인 후 필요하면 수정하세요.

function partnerAuthHeader(): Record<string, string> {
  const creds = Buffer.from(
    `${config.toss.clientId}:${config.toss.clientSecret}`
  ).toString('base64');
  return { Authorization: `Basic ${creds}` };
}

// ─── 타입 정의 ──────────────────────────────────────────────────────────────

export interface TossTokens {
  accessToken: string;
  refreshToken: string;
  /** access token 만료까지 남은 초 (서버 저장용) */
  expiresIn: number;
}

export interface TossUserInfo {
  userKey: number;
  name?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
}

// ─── API 호출 함수 ──────────────────────────────────────────────────────────

/**
 * Authorization Code → Access Token + Refresh Token 교환
 * POST /api-partner/v1/apps-in-toss/user/oauth2/generate-token
 */
export async function generateTossToken(
  authorizationCode: string,
  referrer: string
): Promise<TossTokens> {
  const { data } = await axios.post<TossResponse<TossTokens>>(
    `${BASE}/api-partner/v1/apps-in-toss/user/oauth2/generate-token`,
    { authorizationCode, referrer },
    { headers: { 'Content-Type': 'application/json', ...partnerAuthHeader() } }
  );
  return unwrap(data, 'generateTossToken');
}

/**
 * Refresh Token → 새 Access Token + Refresh Token 재발급
 * POST /api-partner/v1/apps-in-toss/user/oauth2/refresh-token
 *
 * Toss는 refresh 시 refreshToken도 새로 발급해요.
 * 기존 refreshToken은 무효화되므로 반드시 DB에 저장해야 해요.
 */
export async function refreshTossToken(refreshToken: string): Promise<TossTokens> {
  const { data } = await axios.post<TossResponse<TossTokens>>(
    `${BASE}/api-partner/v1/apps-in-toss/user/oauth2/refresh-token`,
    { refreshToken },
    { headers: { 'Content-Type': 'application/json', ...partnerAuthHeader() } }
  );
  return unwrap(data, 'refreshTossToken');
}

/**
 * Access Token으로 사용자 정보 조회
 * GET /api-partner/v1/apps-in-toss/user/oauth2/login-me
 *
 * name, phoneNumber, email은 AES-256-GCM으로 암호화되어 있어요.
 * TOSS_DECRYPT_KEY / TOSS_DECRYPT_AAD가 없으면 해당 필드는 null로 반환돼요.
 */
export async function getTossUser(accessToken: string): Promise<TossUserInfo> {
  const { data } = await axios.get<TossResponse<TossUserInfo>>(
    `${BASE}/api-partner/v1/apps-in-toss/user/oauth2/login-me`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
  const raw = unwrap(data, 'getTossUser');

  return {
    userKey: raw.userKey,
    name: decryptTossValue(raw.name),
    phoneNumber: decryptTossValue(raw.phoneNumber),
    email: decryptTossValue(raw.email),
  };
}

/**
 * Access Token으로 연결 해제 (로그아웃)
 * POST /api-partner/v1/apps-in-toss/user/oauth2/access/remove-by-access-token
 */
export async function revokeTossToken(accessToken: string): Promise<void> {
  const { data } = await axios.post<TossResponse<unknown>>(
    `${BASE}/api-partner/v1/apps-in-toss/user/oauth2/access/remove-by-access-token`,
    {},
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
  // 연결 해제는 SUCCESS가 아니어도 무시 (이미 해제된 경우 등)
  if (data.resultType !== 'SUCCESS') {
    const errMsg = typeof data.error === 'string' ? data.error : data.error?.message;
    console.warn('[tossAuth][revokeTossToken]', data.resultType, errMsg);
  }
}
