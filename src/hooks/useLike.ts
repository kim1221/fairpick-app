/**
 * 찜하기 훅
 *
 * 로컬 스토리지 업데이트 + 로그인 상태면 서버에도 반영 (fire-and-forget)
 *
 * 사용법:
 *   const { isLiked, toggle } = useLike({ eventId: 'abc123' });
 */

import { useState, useEffect, useCallback } from 'react';
import { generateHapticFeedback } from '@apps-in-toss/framework';
import { getLikesV2, toggleLike, StoredEventItemV2 } from '../utils/storage';
import { useAuth } from './useAuth';
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
  const [isLiked, setIsLiked] = useState(false);

  // 로컬 스토리지에서 찜 상태 초기화
  useEffect(() => {
    if (!eventId) return;
    getLikesV2()
      .then((data) => setIsLiked(data.items.some((item) => item.id === eventId)))
      .catch(() => {});
  }, [eventId]);

  const toggle = useCallback(async (): Promise<{ liked: boolean }> => {
    if (!eventId) return { liked: false };

    const result = await toggleLike(eventId, snapshot);
    setIsLiked(result.liked);
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
  }, [eventId, isLoggedIn, snapshot]);

  return { isLiked, toggle };
}
