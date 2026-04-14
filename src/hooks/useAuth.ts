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

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    isLoggedIn: false,
    user: null,
    isLoading: true,
  });

  // 앱 시작 시 저장된 세션 복원 + Toss 연결 끊기 감지
  useEffect(() => {
    (async () => {
      const [token, user] = await Promise.all([getToken(), getStoredUser()]);
      if (!token || !user) {
        setState({ isLoggedIn: false, user: null, isLoading: false });
        return;
      }
      // /auth/me로 Toss 토큰 유효성 확인 (unlink 시 401 → http 인터셉터가 토큰 자동 삭제)
      try {
        const { data } = await http.get<{ id: string; userKey: number; name?: string | null }>('/auth/me');
        const freshUser: StoredUser = { ...user, name: data.name ?? null };
        await setStoredUser(freshUser);
        setState({ isLoggedIn: true, user: freshUser, isLoading: false });
      } catch {
        setState({ isLoggedIn: false, user: null, isLoading: false });
      }
    })();
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

      setState({ isLoggedIn: true, user: data.user, isLoading: false });

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
    try {
      const token = await getToken();
      if (token) {
        await http.post('/auth/logout').catch((e) => {
          if (__DEV__) console.warn('[useAuth][logout] 서버 로그아웃 실패 (로컬은 삭제):', e.message);
        });
      }
    } finally {
      await Promise.all([clearToken(), clearStoredUser()]);
      setState({ isLoggedIn: false, user: null, isLoading: false });
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
