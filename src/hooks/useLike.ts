/**
 * 찜하기 훅
 *
 * LikesContext에서 상태를 읽어 per-card 스토리지 호출 제거.
 * 로컬 스토리지 업데이트 + 로그인 상태면 서버에도 반영 (fire-and-forget)
 *
 * 사용법:
 *   const { isLiked, toggle } = useLike({ eventId: 'abc123' });
 */

import { useCallback } from 'react';
import { generateHapticFeedback } from '@apps-in-toss/framework';
import { toggleLike, StoredEventItemV2 } from '../utils/storage';
import { useAuth } from './useAuth';
import { useLikesContext } from '../contexts/LikesContext';
import http from '../lib/http';

interface UseLikeOptions {
  eventId: string | undefined;
  snapshot?: StoredEventItemV2['snapshot'];
}

interface UseLikeResult {
  isLiked: boolean;
  toggle: () => Promise<{ liked: boolean }>;
}

export function useLike({ eventId, snapshot }: UseLikeOptions): UseLikeResult {
  const { isLoggedIn } = useAuth();
  const { likedIds, setLiked } = useLikesContext();

  const isLiked = eventId ? likedIds.has(eventId) : false;

  const toggle = useCallback(async (): Promise<{ liked: boolean }> => {
    if (!eventId) return { liked: false };

    const result = await toggleLike(eventId, snapshot);
    setLiked(eventId, result.liked);
    generateHapticFeedback({ type: 'tickWeak' }).catch(() => {});

    // 로그인 상태면 서버에도 반영 (fire-and-forget)
    if (isLoggedIn) {
      if (result.liked) {
        http.post(`/users/me/likes/${eventId}`).catch(() => {});
      } else {
        http.delete(`/users/me/likes/${eventId}`).catch(() => {});
      }
    }

    return { liked: result.liked };
  }, [eventId, isLoggedIn, snapshot, setLiked]);

  return { isLiked, toggle };
}
