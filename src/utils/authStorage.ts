/**
 * 인증 토큰 저장소
 * 우리 앱 JWT를 Toss Storage(영구 저장)에 보관해요.
 * Toss accessToken / refreshToken은 절대 여기에 저장하지 않아요.
 */

import { Storage as TossStorage } from '@apps-in-toss/framework';

const KEY_TOKEN = 'auth:token';
const KEY_USER = 'auth:user';

export interface StoredUser {
  id: string;
  userKey: number;
}

export async function getToken(): Promise<string | null> {
  try {
    return await TossStorage.getItem(KEY_TOKEN);
  } catch {
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  await TossStorage.setItem(KEY_TOKEN, token);
}

export async function clearToken(): Promise<void> {
  await TossStorage.removeItem(KEY_TOKEN);
}

export async function getStoredUser(): Promise<StoredUser | null> {
  try {
    const raw = await TossStorage.getItem(KEY_USER);
    if (!raw) return null;
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export async function setStoredUser(user: StoredUser): Promise<void> {
  await TossStorage.setItem(KEY_USER, JSON.stringify(user));
}

export async function clearStoredUser(): Promise<void> {
  await TossStorage.removeItem(KEY_USER);
}
