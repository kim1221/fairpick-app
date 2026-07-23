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
  isLoggedIn: boolean;  // 세션 있음(익명 또는 linked). 카드 구경·열기·티켓 적립 가능.
  isLinked: boolean;    // 토스 연결됨. 환전 가능(익명이면 false).
  user: StoredUser | null;
  isLoading: boolean;
}

const AUTH_REVALIDATE_MS = 5 * 60 * 1000;
const INITIAL_AUTH_STATE: AuthState = {
  isLoggedIn: false,
  isLinked: false,
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

// 익명 세션 부트스트랩 — 로그인 없이 서버 상태(카드·티켓)에 접근할 수 있게 익명 JWT를 받는다.
async function bootstrapAnonymousSession(): Promise<AuthState> {
  try {
    const anonymousId = await getOrCreateAnonymousId();
    const { data } = await http.post<{ token: string; user: StoredUser }>('/auth/anonymous', { anonymousId });
    await Promise.all([setToken(data.token), setStoredUser(data.user)]);
    return { isLoggedIn: true, isLinked: false, user: data.user, isLoading: false };
  } catch {
    // 부트스트랩 실패(오프라인 등) → 세션 없음. 다음 마운트에서 재시도한다.
    return { isLoggedIn: false, isLinked: false, user: null, isLoading: false };
  }
}

async function restoreAuthState(): Promise<AuthState> {
  const [token, user] = await Promise.all([getToken(), getStoredUser()]);
  if (token && user) {
    try {
      // /auth/session은 익명·linked 공통(토스 토큰 요구 안 함).
      const { data } = await http.get<{ id: string; userKey: number | null; anonymous: boolean }>('/auth/session');
      const freshUser: StoredUser = { ...user, id: data.id, userKey: data.userKey ?? null };
      await setStoredUser(freshUser);
      return { isLoggedIn: true, isLinked: !data.anonymous, user: freshUser, isLoading: false };
    } catch {
      // 토큰 무효(만료 등) → http 인터셉터가 세션을 이미 지웠다. 익명으로 새로 부트스트랩.
    }
  }
  return bootstrapAnonymousSession();
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

  // 토스 로그인 (첫 환전 게이트에서 호출) — 익명 데이터는 서버 reconcileLogin이 계정으로 화해.
  const login = useCallback(async () => {
    try {
      // 1. appLogin() → authorizationCode 획득 (클라이언트 → 토스)
      const { authorizationCode, referrer } = await appLogin();

      // 2. 익명 세션 데이터를 계정으로 이전하도록 anonymousId 함께 전달(서버가 promote/merge).
      const anonymousId = await getOrCreateAnonymousId().catch(() => undefined);

      // 3. 백엔드에서 토큰 교환 + 화해 → 우리 JWT 발급
      const { data } = await http.post<{ token: string; user: StoredUser }>('/auth/login', {
        authorizationCode,
        referrer,
        anonymousId,
      });

      // 4. 토큰 + 유저 정보 저장
      await Promise.all([setToken(data.token), setStoredUser(data.user)]);

      authRevision += 1;
      lastAuthValidationAt = Date.now();
      publishAuthState({ isLoggedIn: true, isLinked: true, user: data.user, isLoading: false });

      // 5. 로컬 데이터 서버 마이그레이션 (백그라운드, 실패해도 무시)
      migrateLocalDataToServer().catch((e) => {
        if (__DEV__) console.warn('[useAuth][migrate] 실패 (무시):', e.message);
      });
    } catch (err) {
      if (__DEV__) console.error('[useAuth][login]', err);
      throw err; // 호출부에서 에러 처리(토스트)
    }
  }, []);

  // 로그아웃 — 토스 연결 해제 후 익명 세션으로 되돌린다(계속 구경 가능).
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
      const anon = await bootstrapAnonymousSession();
      lastAuthValidationAt = Date.now();
      publishAuthState(anon);
    }
  }, []);

  return {
    isLoggedIn: state.isLoggedIn,
    isLinked: state.isLinked,
    user: state.user,
    isLoading: state.isLoading,
    login,
    logout,
  };
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
