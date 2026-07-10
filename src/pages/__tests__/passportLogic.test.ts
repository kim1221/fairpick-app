import { describe, expect, test } from '@jest/globals';
import {
  buildPassportBookPages,
  getActivePassportBookmark,
  getPassportSectionCopy,
  getPassportSectionIndexes,
  getPassportTabLabel,
  getPassportDiscoverySummary,
  getStampBookMeta,
} from '../passportLogic';

type TestTicket = { id: string; title: string };
type TestStamp = { eventId: string; visitedAt: string };

const tickets = (count: number): TestTicket[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `event-${index + 1}`,
    title: `Event ${index + 1}`,
  }));

const stamps = (count: number): TestStamp[] =>
  Array.from({ length: count }, (_, index) => ({
    eventId: `stamp-${index + 1}`,
    visitedAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
  }));

describe('passport logic', () => {
  test('describes every segment as a collection story', () => {
    expect(getPassportSectionCopy('discovered')).toMatchObject({
      eyebrow: 'OPENED STORIES',
      title: '공개한 문화',
      description: '광고를 보고 전체 내용을 확인한 카드',
    });
    expect(getPassportSectionCopy('visited')).toMatchObject({
      eyebrow: 'VISITED STORIES',
      title: '직접 다녀온 문화',
      description: '방문한 카드에 남긴 기록',
    });
    expect(getPassportSectionCopy('wishlist')).toMatchObject({
      eyebrow: 'SAVED STORIES',
      title: '저장한 문화',
      description: '다음에 보고 싶은 문화 일정',
    });
  });

  test('keeps tab labels short while counts change', () => {
    expect(getPassportTabLabel('discovered', 67)).toBe('공개한 문화 67');
    expect(getPassportTabLabel('visited', 2)).toBe('직접 다녀온 문화 2');
    expect(getPassportTabLabel('wishlist', 3)).toBe('저장한 문화 3');
  });

  test('builds discovery progress with the next region milestone', () => {
    expect(getPassportDiscoverySummary({
      monthDiscovered: 4,
      monthVisited: 2,
      regionsDiscovered: 6,
      categoriesDiscovered: 3,
      regionsVisited: 2,
      topRegions: [{ region: '성동구', count: 3 }],
    })).toEqual({
      monthDiscovered: 4,
      monthVisited: 2,
      regionsDiscovered: 6,
      categoriesDiscovered: 3,
      regionsVisited: 2,
      regionGoal: 10,
      categoryGoal: 5,
      regionProgress: 0.6,
      categoryProgress: 0.6,
      favoriteRegion: '성동구',
    });
  });

  test('keeps discovery summary compatible with the previous passport response', () => {
    expect(getPassportDiscoverySummary({ monthDiscovered: 2 })).toMatchObject({
      monthDiscovered: 2,
      monthVisited: 0,
      regionsDiscovered: 0,
      categoriesDiscovered: 0,
      regionGoal: 3,
    });
  });

  test('builds one passport book in story order', () => {
    const pages = buildPassportBookPages<TestTicket, TestStamp>({
      discoveredItems: tickets(2),
      wishlistItems: tickets(2),
      stamps: stamps(2),
      visitedIds: new Set(),
      passportLoading: false,
      passportError: false,
      savedLoading: false,
      savedError: false,
    });

    expect(pages.map((page) => page.type)).toEqual([
      'cover',
      'identity',
      'discovered',
      'wishlist',
      'stamps',
    ]);
  });

  test('chunks discovered and wishlist tickets into two-card pages', () => {
    const pages = buildPassportBookPages<TestTicket, TestStamp>({
      discoveredItems: tickets(7),
      wishlistItems: tickets(4),
      stamps: stamps(1),
      visitedIds: new Set(),
      passportLoading: false,
      passportError: false,
      savedLoading: false,
      savedError: false,
    });

    const discoveredPages = pages.filter((page) => page.type === 'discovered');
    const wishlistPages = pages.filter((page) => page.type === 'wishlist');

    expect(discoveredPages.map((page) => page.type === 'discovered' ? page.items.length : 0)).toEqual([2, 2, 2, 1]);
    expect(wishlistPages.map((page) => page.type === 'wishlist' ? page.items.length : 0)).toEqual([2, 2]);
  });

  test('normalizes invalid page sizes to prevent stalled pagination', () => {
    const pages = buildPassportBookPages<TestTicket, TestStamp>({
      discoveredItems: tickets(2),
      wishlistItems: tickets(2),
      stamps: stamps(2),
      visitedIds: new Set(),
      passportLoading: false,
      passportError: false,
      savedLoading: false,
      savedError: false,
      discoveredItemsPerPage: 0,
      wishlistItemsPerPage: -2,
      stampsPerPage: 0,
    });

    expect(pages.map((page) => page.type)).toEqual([
      'cover',
      'identity',
      'discovered',
      'discovered',
      'wishlist',
      'wishlist',
      'stamps',
      'stamps',
    ]);
  });

  test('keeps empty sections inside the passport book', () => {
    const pages = buildPassportBookPages<TestTicket, TestStamp>({
      discoveredItems: [],
      wishlistItems: [],
      stamps: [],
      visitedIds: new Set(),
      passportLoading: false,
      passportError: false,
      savedLoading: false,
      savedError: false,
    });

    expect(pages.map((page) => `${page.type}:${page.section}`)).toEqual([
      'cover:cover',
      'identity:cover',
      'empty:discovered',
      'empty:wishlist',
      'empty:stamps',
    ]);
  });

  test('filters visited saved events out of the wishlist section', () => {
    const pages = buildPassportBookPages<TestTicket, TestStamp>({
      discoveredItems: tickets(1),
      wishlistItems: tickets(3),
      stamps: stamps(1),
      visitedIds: new Set(['event-2']),
      passportLoading: false,
      passportError: false,
      savedLoading: false,
      savedError: false,
    });

    const wishlistPage = pages.find((page) => page.type === 'wishlist');
    expect(wishlistPage?.type).toBe('wishlist');
    expect(wishlistPage?.type === 'wishlist' ? wishlistPage.items.map((item) => item.id) : []).toEqual([
      'event-1',
      'event-3',
    ]);
  });

  test('holds wishlist page while visited ids are still loading', () => {
    const pages = buildPassportBookPages<TestTicket, TestStamp>({
      discoveredItems: tickets(1),
      wishlistItems: tickets(2),
      stamps: [],
      visitedIds: new Set(),
      passportLoading: true,
      passportError: false,
      savedLoading: false,
      savedError: false,
    });

    expect(pages.map((page) => `${page.type}:${page.section}`)).toEqual([
      'cover:cover',
      'identity:cover',
      'discovered:discovered',
      'loading:wishlist',
      'loading:stamps',
    ]);
  });

  test('calculates bookmark indexes and active bookmark', () => {
    const pages = buildPassportBookPages<TestTicket, TestStamp>({
      discoveredItems: tickets(4),
      wishlistItems: tickets(1),
      stamps: stamps(7),
      visitedIds: new Set(),
      passportLoading: false,
      passportError: false,
      savedLoading: false,
      savedError: false,
    });

    expect(getPassportSectionIndexes(pages)).toEqual({
      cover: 0,
      discovered: 2,
      wishlist: 4,
      stamps: 5,
    });
    expect(getActivePassportBookmark(pages, 0)).toBe('cover');
    expect(getActivePassportBookmark(pages, 3)).toBe('discovered');
    expect(getActivePassportBookmark(pages, 4)).toBe('wishlist');
    expect(getActivePassportBookmark(pages, 6)).toBe('stamps');
  });

  test('describes stamp passport books in chronological volume order', () => {
    expect(getStampBookMeta(0, 1)).toMatchObject({
      bookIndex: 1,
      totalBooks: 1,
      volumeNumber: 1,
      startOrdinal: 0,
      endOrdinal: 0,
      hasNewerBook: false,
      hasOlderBook: false,
    });

    expect(getStampBookMeta(72, 1)).toMatchObject({
      bookIndex: 1,
      totalBooks: 2,
      volumeNumber: 2,
      startOrdinal: 61,
      endOrdinal: 72,
      hasNewerBook: false,
      hasOlderBook: true,
    });

    expect(getStampBookMeta(72, 2)).toMatchObject({
      bookIndex: 2,
      totalBooks: 2,
      volumeNumber: 1,
      startOrdinal: 1,
      endOrdinal: 60,
      hasNewerBook: true,
      hasOlderBook: false,
    });
  });
});
