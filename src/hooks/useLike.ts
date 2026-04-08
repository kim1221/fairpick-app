/**
 * 찜하기 훅
 *
 * useIsLiked / useSetLiked를 사용해 per-card 선택적 구독.
 * 다른 카드 찜 토글 시 이 카드는 리렌더링되지 않음.
 *
 * 사용법:
 *   const { isLiked, toggle } = useLike({ eventId: 'abc123' });
 */

import { useCallback } from 'react';
import { generateHapticFeedback } from '@apps-in-toss/framework';
import { toggleLike, StoredEventItemV2 } from '../utils/storage';
import { useAuth } from './useAuth';
import { useIsLiked, useSetLiked } from '../contexts/LikesContext';
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
  const isLiked = useIsLiked(eventId);
  const setLiked = useSetLiked();

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
