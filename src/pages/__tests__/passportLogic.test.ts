import { describe, expect, test } from '@jest/globals';
import {
  buildPassportBookPages,
  getActivePassportBookmark,
  getPassportSectionCopy,
  getPassportSectionIndexes,
  getPassportTabLabel,
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
  test('describes every segment as a passport page', () => {
    expect(getPassportSectionCopy('discovered')).toMatchObject({
      eyebrow: 'ENTRY CARDS',
      title: '발견한 카드',
      description: '광고를 보고 발급받은 문화 카드',
    });
    expect(getPassportSectionCopy('visited')).toMatchObject({
      eyebrow: 'PASSPORT STAMPS',
      title: '다녀왔어요',
      description: '다녀온 문화에 남긴 도장',
    });
    expect(getPassportSectionCopy('wishlist')).toMatchObject({
      eyebrow: 'TRAVEL PLAN',
      title: '가고 싶어요',
      description: '다음에 들를 문화 일정',
    });
  });

  test('keeps tab labels short while counts change', () => {
    expect(getPassportTabLabel('discovered', 67)).toBe('발견한 카드 67');
    expect(getPassportTabLabel('visited', 2)).toBe('다녀왔어요 2');
    expect(getPassportTabLabel('wishlist', 3)).toBe('가고 싶어요 3');
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

  test('chunks discovered and wishlist tickets into three-card pages', () => {
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

    expect(discoveredPages.map((page) => page.type === 'discovered' ? page.items.length : 0)).toEqual([3, 3, 1]);
    expect(wishlistPages.map((page) => page.type === 'wishlist' ? page.items.length : 0)).toEqual([3, 1]);
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
});
