import type {
  PassportDiscoveredCard,
  PassportDiscoveredPageInfo,
  PassportResponse,
  PassportStamp,
} from '../services/passportService';

export type CollectionSessionCache = {
  passport: PassportResponse;
  openedCards: PassportDiscoveredCard[];
  pageInfo: PassportDiscoveredPageInfo | null;
  visitStamps: PassportStamp[];
  nextStampBook: number;
  savedEventIds: string[];
  visitedEventIds: string[];
  fetchedAt: number;
};

const sessions = new Map<string, CollectionSessionCache>();

export function getCollectionSessionKey(isLoggedIn: boolean, userId?: string): string {
  return isLoggedIn && userId ? `user:${userId}` : 'guest';
}

export function getCollectionSession(key: string): CollectionSessionCache | null {
  return sessions.get(key) ?? null;
}

export function setCollectionSession(key: string, cache: CollectionSessionCache): void {
  sessions.set(key, cache);
}

export function updateCollectionSession(
  key: string,
  updater: (current: CollectionSessionCache) => CollectionSessionCache,
): void {
  const current = sessions.get(key);
  if (!current) return;
  sessions.set(key, updater(current));
}
