/**
 * LikesContext
 *
 * 찜 목록을 페이지 레벨에서 한 번만 읽어 Context로 공유.
 * EventCard마다 getLikesV2()를 개별 호출하던 방식 제거.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getLikesV2 } from '../utils/storage';

interface LikesContextValue {
  likedIds: Set<string>;
  setLiked: (id: string, liked: boolean) => void;
}

const LikesContext = createContext<LikesContextValue>({
  likedIds: new Set(),
  setLiked: () => {},
});

export function LikesProvider({ children }: { children: React.ReactNode }) {
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    getLikesV2()
      .then((data) => setLikedIds(new Set(data.items.map((i) => i.id))))
      .catch(() => {});
  }, []);

  const setLiked = useCallback((id: string, liked: boolean) => {
    setLikedIds((prev) => {
      const next = new Set(prev);
      if (liked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  return (
    <LikesContext.Provider value={{ likedIds, setLiked }}>
      {children}
    </LikesContext.Provider>
  );
}

export function useLikesContext(): LikesContextValue {
  return useContext(LikesContext);
}
