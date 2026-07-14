/**
 * 토스 로그인 훅
 *
 * 사용법:
 *   const { isLoggedIn, user, isLoading, login, logout } = useAuth();
 *
 * 흐름:
 *   1. 앱 마운트 → TossStorage에서 토큰 복원 (세션 유지)
 *   2. login() → appLogin() → POST /auth/login → 토큰 저장
 *   3. logout() → POST /auth/logout → 토큰 삭제
 */

import { useState, useEffect, useCallback } from 'react';
import { appLogin } from '@apps-in-toss/framework';
import http from '../lib/http';
import {
  getToken,
  setToken,
  clearToken,
  getStoredUser,
  setStoredUser,
  clearStoredUser,
  StoredUser,
} from '../utils/authStorage';
import { getOrCreateAnonymousId } from '../utils/anonymousUser';
import { getLikesV2, getRecentV2 } from '../utils/storage';
import { toServerLikeItem, toServerRecentItem } from '../types/serverSync';

interface AuthState {
  isLoggedIn: boolean;
  user: StoredUser | null;
  isLoading: boolean;
}

const AUTH_REVALIDATE_MS = 5 * 60 * 1000;
const INITIAL_AUTH_STATE: AuthState = {
  isLoggedIn: false,
  user: null,
  isLoading: true,
};

let sharedAuthState: AuthState | null = null;
let authHydrationPromise: Promise<AuthState> | null = null;
let lastAuthValidationAt = 0;
let authRevision = 0;
const authListeners = new Set<(state: AuthState) => void>();

function publishAuthState(next: AuthState): AuthState {
  sharedAuthState = next;
  for (const listener of authListeners) listener(next);
  return next;
}

async function restoreAuthState(): Promise<AuthState> {
  const [token, user] = await Promise.all([getToken(), getStoredUser()]);
  if (!token || !user) {
    return { isLoggedIn: false, user: null, isLoading: false };
  }

  try {
    const { data } = await http.get<{ id: string; userKey: number; name?: string | null }>('/auth/me');
    const freshUser: StoredUser = { ...user, name: data.name ?? null };
    await setStoredUser(freshUser);
    return { isLoggedIn: true, user: freshUser, isLoading: false };
  } catch {
    return { isLoggedIn: false, user: null, isLoading: false };
  }
}

function ensureAuthState(force = false): Promise<AuthState> {
  if (sharedAuthState && !force) return Promise.resolve(sharedAuthState);
  if (authHydrationPromise) return authHydrationPromise;

  const requestRevision = authRevision;
  authHydrationPromise = restoreAuthState()
    .then((next) => {
      // 로그인/로그아웃이 복원 요청보다 늦게 시작됐다면 오래된 응답으로 덮지 않는다.
      if (requestRevision !== authRevision && sharedAuthState) return sharedAuthState;
      lastAuthValidationAt = Date.now();
      return publishAuthState(next);
    })
    .finally(() => {
      authHydrationPromise = null;
    });
  return authHydrationPromise;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>(() => sharedAuthState ?? INITIAL_AUTH_STATE);

  // 최초 한 번만 세션을 복원하고, 이후 탭 마운트는 공유 상태를 즉시 사용한다.
  // 오래된 세션은 화면을 가리지 않고 백그라운드에서 재검증한다.
  useEffect(() => {
    authListeners.add(setState);
    if (sharedAuthState) setState(sharedAuthState);

    const shouldRevalidate = Boolean(
      sharedAuthState
      && Date.now() - lastAuthValidationAt >= AUTH_REVALIDATE_MS,
    );
    ensureAuthState(shouldRevalidate).catch(() => {});

    return () => {
      authListeners.delete(setState);
    };
  }, []);

  // 토스 로그인
  const login = useCallback(async () => {
    try {
      // 1. appLogin() → authorizationCode 획득 (클라이언트 → 토스)
      const { authorizationCode, referrer } = await appLogin();

      // 2. 백엔드에서 토큰 교환 → 우리 JWT 발급
      const { data } = await http.post<{ token: string; user: StoredUser }>('/auth/login', {
        authorizationCode,
        referrer,
      });

      // 3. 토큰 + 유저 정보 저장
      await Promise.all([setToken(data.token), setStoredUser(data.user)]);

      authRevision += 1;
      lastAuthValidationAt = Date.now();
      publishAuthState({ isLoggedIn: true, user: data.user, isLoading: false });

      // 4. 익명 행동 이력 → 로그인 계정으로 이전 (백그라운드)
      linkAnonymousToLogin(data.user.userKey).catch((e) => {
        if (__DEV__) console.warn('[useAuth][link-anonymous] 실패 (무시):', e?.message);
      });

      // 5. 로컬 데이터 서버 마이그레이션 (백그라운드, 실패해도 무시)
      migrateLocalDataToServer().catch((e) => {
        if (__DEV__) console.warn('[useAuth][migrate] 실패 (무시):', e.message);
      });
    } catch (err) {
      if (__DEV__) console.error('[useAuth][login]', err);
      throw err; // 호출부에서 에러 처리
    }
  }, []);

  // 로그아웃
  const logout = useCallback(async () => {
    authRevision += 1;
    try {
      const token = await getToken();
      if (token) {
        await http.post('/auth/logout').catch((e) => {
          if (__DEV__) console.warn('[useAuth][logout] 서버 로그아웃 실패 (로컬은 삭제):', e.message);
        });
      }
    } finally {
      await Promise.all([clearToken(), clearStoredUser()]);
      lastAuthValidationAt = Date.now();
      publishAuthState({ isLoggedIn: false, user: null, isLoading: false });
    }
  }, []);

  return {
    isLoggedIn: state.isLoggedIn,
    user: state.user,
    isLoading: state.isLoading,
    login,
    logout,
  };
}

// ─── 익명 → 로그인 계정 이력 이전 ────────────────────────────────────────────
// 로그인 직후 익명 ID로 쌓인 행동 이력(user_events, 취향 점수)을
// 로그인 계정(toss_user_key)으로 이전해요.

async function linkAnonymousToLogin(tossUserKey: number): Promise<void> {
  const anonymousId = await getOrCreateAnonymousId();
  await http.post('/api/user-events/link-anonymous', { anonymousId, tossUserKey });
  if (__DEV__) console.log('[useAuth][link-anonymous] 완료:', { anonymousId, tossUserKey });
}

// ─── 로컬 → 서버 마이그레이션 ──────────────────────────────────────────────
// 로그인 직후 로컬 likes/recent를 서버에 업로드해요.
// 백엔드에 batch 엔드포인트가 생기면 자동으로 동작해요.

async function migrateLocalDataToServer(): Promise<void> {
  const [likesData, recentData] = await Promise.all([getLikesV2(), getRecentV2()]);

  const likeItems = likesData.items.map(toServerLikeItem);
  const recentItems = recentData.items.map(toServerRecentItem);

  if (likeItems.length > 0) {
    await http.post('/users/me/likes/batch', { items: likeItems });
  }
  if (recentItems.length > 0) {
    await http.post('/users/me/recent/batch', { items: recentItems });
  }
}
