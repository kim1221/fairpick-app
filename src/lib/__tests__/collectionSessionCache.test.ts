import { describe, expect, test } from '@jest/globals';
import type { CollectionSessionCache } from '../collectionSessionCache';
import {
  getCollectionSession,
  getCollectionSessionKey,
  setCollectionSession,
  updateCollectionSession,
} from '../collectionSessionCache';

function session(passportNo: string, fetchedAt: number): CollectionSessionCache {
  return {
    passport: {
      passportNo,
      discoveredCount: 0,
      visitedCount: 0,
      monthDiscovered: 0,
      stampBook: 1,
      stampBookCount: 1,
      stampBookSize: 60,
      tasteCategories: [],
      stamps: [],
      visitedEventIds: [],
      discoveredCards: [],
    },
    openedCards: [],
    pageInfo: null,
    visitStamps: [],
    nextStampBook: 2,
    savedEventIds: [],
    visitedEventIds: [],
    fetchedAt,
  };
}

describe('collection session cache', () => {
  test('uses one guest key and distinct keys for signed-in users', () => {
    expect(getCollectionSessionKey(false)).toBe('guest');
    expect(getCollectionSessionKey(false, 'ignored-user')).toBe('guest');
    expect(getCollectionSessionKey(true)).toBe('guest');
    expect(getCollectionSessionKey(true, 'user-a')).toBe('user:user-a');
    expect(getCollectionSessionKey(true, 'user-b')).toBe('user:user-b');
  });

  test('keeps guest and user snapshots isolated and updates only the selected session', () => {
    const guest = session('guest-passport', 1);
    const user = session('user-passport', 2);
    const userKey = getCollectionSessionKey(true, 'cache-test-user');

    setCollectionSession('guest', guest);
    setCollectionSession(userKey, user);
    updateCollectionSession(userKey, (current) => ({
      ...current,
      fetchedAt: 3,
      savedEventIds: ['saved-event'],
    }));

    expect(getCollectionSession('guest')).toBe(guest);
    expect(getCollectionSession('guest')).toMatchObject({
      passport: { passportNo: 'guest-passport' },
      fetchedAt: 1,
      savedEventIds: [],
    });
    expect(getCollectionSession(userKey)).toMatchObject({
      passport: { passportNo: 'user-passport' },
      fetchedAt: 3,
      savedEventIds: ['saved-event'],
    });
  });

  test('does not create a session when updating a missing key', () => {
    const missingKey = 'user:cache-test-missing';

    updateCollectionSession(missingKey, () => session('unexpected', 1));

    expect(getCollectionSession(missingKey)).toBeNull();
  });
});
