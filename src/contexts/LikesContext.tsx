/**
 * LikesContext
 *
 * useSyncExternalStore 기반 외부 스토어 패턴 사용.
 * 찜 토글 시 해당 카드만 리렌더링 (다른 30개 카드 리렌더 차단).
 */

import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { useSyncExternalStore } from 'react';
import { getLikesV2 } from '../utils/storage';

// ── 외부 스토어 ──────────────────────────────────────────────

type Listener = () => void;

interface LikesStore {
  subscribe: (listener: Listener) => () => void;
  getSnapshot: () => Set<string>;
  setLiked: (id: string, liked: boolean) => void;
  initialize: (ids: string[]) => void;
}

function createLikesStore(): LikesStore {
  let ids = new Set<string>();
  const listeners = new Set<Listener>();

  const notify = () => listeners.forEach((l) => l());

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot() {
      return ids;
    },
    setLiked(id, liked) {
      const next = new Set(ids);
      if (liked) next.add(id);
      else next.delete(id);
      ids = next;
      notify();
    },
    initialize(newIds) {
      ids = new Set(newIds);
      notify();
    },
  };
}

// ── Context ──────────────────────────────────────────────────

const StoreContext = createContext<LikesStore | null>(null);

export function LikesProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<LikesStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createLikesStore();
  }
  const store = storeRef.current;

  useEffect(() => {
    getLikesV2()
      .then((data) => store.initialize(data.items.map((i) => i.id)))
      .catch(() => {});
  }, [store]);

  return (
    <StoreContext.Provider value={store}>
      {children}
    </StoreContext.Provider>
  );
}

function useStore(): LikesStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('LikesProvider missing');
  return store;
}

/**
 * 특정 이벤트의 찜 여부만 구독.
 * 다른 이벤트의 찜 변경 시 리렌더링 없음.
 */
export function useIsLiked(eventId: string | undefined): boolean {
  const store = useStore();
  return useSyncExternalStore(
    store.subscribe,
    () => (eventId ? store.getSnapshot().has(eventId) : false),
    () => false,
  );
}

export function useSetLiked(): (id: string, liked: boolean) => void {
  const store = useStore();
  return useCallback((id, liked) => store.setLiked(id, liked), [store]);
}

// ── 하위 호환성 (useLike.ts 이외 사용처 대비) ────────────────

interface LikesContextValue {
  likedIds: Set<string>;
  setLiked: (id: string, liked: boolean) => void;
}

export function useLikesContext(): LikesContextValue {
  const store = useStore();
  const likedIds = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => new Set<string>(),
  );
  const setLiked = useCallback(
    (id: string, liked: boolean) => store.setLiked(id, liked),
    [store],
  );
  return { likedIds, setLiked };
}
