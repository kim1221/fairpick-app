import { describe, expect, test } from '@jest/globals';
import type {
  PassportDiscoveredCard,
  PassportDiscoveredPageInfo,
  PassportResponse,
  PassportStamp,
} from '../../../services/passportService';
import type { CollectionSessionCache } from '../../../lib/collectionSessionCache';
import {
  mergeCollectionSessionSnapshots,
  mergeDiscoveredCards,
  mergeVisitStamps,
  toCollectionOverviewCards,
  toCollectionVisitRecords,
  uniqueDiscoveredCards,
} from '../collectionData';

function discoveredCard(
  eventId: string,
  discoveredAt: string,
  overrides: Partial<PassportDiscoveredCard> = {},
): PassportDiscoveredCard {
  return {
    eventId,
    title: `Event ${eventId}`,
    category: '전시',
    region: '서울',
    venue: '전시장',
    imageUrl: `https://example.com/${eventId}.jpg`,
    startAt: '2026-07-01',
    endAt: '2026-07-31',
    lat: 37.5,
    lng: 127,
    discoveredAt,
    ...overrides,
  };
}

function stamp(
  eventId: string,
  visitedAt: string,
  overrides: Partial<PassportStamp> = {},
): PassportStamp {
  return {
    eventId,
    title: `Visit ${eventId}`,
    category: '공연',
    region: '서울',
    venue: '공연장',
    imageUrl: `https://example.com/${eventId}.jpg`,
    visitedAt,
    ...overrides,
  };
}

function collectionSession({
  cards,
  pageInfo,
  visits = [],
  nextStampBook = 2,
  savedEventIds = [],
  fetchedAt,
  visitedCount = visits.length,
}: {
  cards: PassportDiscoveredCard[];
  pageInfo: PassportDiscoveredPageInfo | null;
  visits?: PassportStamp[];
  nextStampBook?: number;
  savedEventIds?: string[];
  fetchedAt: number;
  visitedCount?: number;
}): CollectionSessionCache {
  const passport: PassportResponse = {
    passportNo: '0001',
    discoveredCount: cards.length,
    visitedCount,
    monthDiscovered: 0,
    stampBook: 1,
    stampBookCount: Math.max(1, nextStampBook - 1),
    stampBookSize: 60,
    tasteCategories: [],
    stamps: visits,
    visitedEventIds: visits.map((visit) => visit.eventId),
    discoveredCards: cards.slice(0, 1),
    discoveredPageInfo: pageInfo ?? undefined,
  };
  return {
    passport,
    openedCards: cards,
    pageInfo,
    visitStamps: visits,
    nextStampBook,
    savedEventIds,
    visitedEventIds: visits.map((visit) => visit.eventId),
    fetchedAt,
  };
}

describe('collection shared data helpers', () => {
  test('deduplicates discovered events, keeps the newest supplied record, and sorts newest first', () => {
    const cards = uniqueDiscoveredCards([
      discoveredCard('repeat', '2026-07-01T00:00:00.000Z', { title: 'Old title' }),
      discoveredCard('tie-a', '2026-07-02T00:00:00.000Z'),
      discoveredCard('tie-b', '2026-07-02T00:00:00.000Z'),
      discoveredCard('repeat', '2026-07-03T00:00:00.000Z', { title: 'Fresh title' }),
    ]);

    expect(cards.map((card) => card.eventId)).toEqual(['repeat', 'tie-b', 'tie-a']);
    expect(cards.find((card) => card.eventId === 'repeat')).toMatchObject({
      title: 'Fresh title',
      discoveredAt: '2026-07-03T00:00:00.000Z',
    });
  });

  test('merges a discovered page without reintroducing an already opened event', () => {
    const cards = mergeDiscoveredCards(
      [
        discoveredCard('existing', '2026-07-02T00:00:00.000Z', { title: 'Before refresh' }),
        discoveredCard('older', '2026-07-01T00:00:00.000Z'),
      ],
      [
        discoveredCard('new', '2026-07-03T00:00:00.000Z'),
        discoveredCard('existing', '2026-07-02T00:00:00.000Z', { title: 'After refresh' }),
      ],
    );

    expect(cards.map((card) => card.eventId)).toEqual(['new', 'existing', 'older']);
    expect(cards.filter((card) => card.eventId === 'existing')).toHaveLength(1);
    expect(cards[1]?.title).toBe('After refresh');
  });

  test('keeps only the latest visit per event and orders visits newest first', () => {
    const visits = mergeVisitStamps(
      [
        stamp('repeat', '2026-07-01T12:00:00.000Z', { title: 'First visit' }),
        stamp('middle', '2026-07-02T12:00:00.000Z'),
      ],
      [
        stamp('repeat', '2026-07-04T12:00:00.000Z', { title: 'Latest visit' }),
        stamp('older', '2026-06-30T12:00:00.000Z'),
      ],
    );

    expect(visits.map((visit) => visit.eventId)).toEqual(['repeat', 'middle', 'older']);
    expect(visits.filter((visit) => visit.eventId === 'repeat')).toHaveLength(1);
    expect(visits[0]).toMatchObject({
      title: 'Latest visit',
      visitedAt: '2026-07-04T12:00:00.000Z',
    });
  });

  test('maps opened cards with archive, save, and visit metadata', () => {
    const cards = [
      discoveredCard('active', '2026-07-03T00:00:00.000Z'),
      discoveredCard('ended', '2026-07-02T00:00:00.000Z', { status: 'ended' }),
      discoveredCard('removed', '2026-07-01T00:00:00.000Z', { status: 'removed' }),
    ];
    const visits = [stamp('ended', '2026-07-10T12:00:00.000Z')];

    const mapped = toCollectionOverviewCards(
      cards,
      new Set(['active', 'removed']),
      new Set(['ended', 'removed']),
      visits,
    );

    expect(mapped).toEqual([
      expect.objectContaining({
        id: 'active',
        lastKnownStatus: 'active',
        openedAt: '2026-07-03T00:00:00.000Z',
        isSaved: true,
        isVisited: false,
        visitedAt: null,
      }),
      expect.objectContaining({
        id: 'ended',
        lastKnownStatus: 'ended',
        isSaved: false,
        isVisited: true,
        visitedAt: '2026-07-10T12:00:00.000Z',
      }),
      expect.objectContaining({
        id: 'removed',
        lastKnownStatus: 'deleted',
        isSaved: true,
        isVisited: true,
        visitedAt: null,
      }),
    ]);
  });

  test('maps visit stamps into collection visit records without losing archive fields', () => {
    const visits = [
      stamp('ended', '2026-07-10T12:00:00.000Z', {
        title: '지난 공연',
        category: '공연',
        region: '부산',
        venue: '시민회관',
        imageUrl: null,
        status: 'ended',
      }),
    ];

    expect(toCollectionVisitRecords(visits)).toEqual([
      {
        eventId: 'ended',
        title: '지난 공연',
        category: '공연',
        region: '부산',
        venue: '시민회관',
        imageUrl: null,
        visitedAt: '2026-07-10T12:00:00.000Z',
        status: 'ended',
      },
    ]);
  });

  test('keeps a newer, deeper full-screen snapshot when the mounted overview writes local state', () => {
    const current = collectionSession({
      cards: [
        discoveredCard('shared', '2026-07-03T00:00:00.000Z', { title: 'Fresh title' }),
        discoveredCard('extra', '2026-07-02T00:00:00.000Z'),
      ],
      pageInfo: { limit: 100, hasMore: true, nextCursor: 'cursor-2' },
      visits: [stamp('visit', '2026-07-14T00:00:00.000Z', { title: 'Fresh visit' })],
      nextStampBook: 3,
      fetchedAt: 200,
      visitedCount: 8,
    });
    const incoming = collectionSession({
      cards: [discoveredCard('shared', '2026-07-03T00:00:00.000Z', { title: 'Stale title' })],
      pageInfo: { limit: 100, hasMore: true, nextCursor: 'cursor-1' },
      visits: [stamp('visit', '2026-07-13T00:00:00.000Z', { title: 'Stale visit' })],
      savedEventIds: ['new-save'],
      fetchedAt: 100,
      visitedCount: 1,
    });

    const merged = mergeCollectionSessionSnapshots(current, incoming);

    expect(merged.openedCards.map((card) => card.eventId)).toEqual(['shared', 'extra']);
    expect(merged.openedCards[0]?.title).toBe('Fresh title');
    expect(merged.pageInfo?.nextCursor).toBe('cursor-2');
    expect(merged.visitStamps[0]?.title).toBe('Fresh visit');
    expect(merged.nextStampBook).toBe(3);
    expect(merged.passport.visitedCount).toBe(8);
    expect(merged.savedEventIds).toEqual(['new-save']);
  });

  test('keeps the deeper cursor while allowing a newer refresh to win duplicate card fields', () => {
    const current = collectionSession({
      cards: [discoveredCard('shared', '2026-07-03T00:00:00.000Z', { title: 'Refreshed title' })],
      pageInfo: { limit: 100, hasMore: true, nextCursor: 'cursor-1' },
      fetchedAt: 300,
    });
    const incoming = collectionSession({
      cards: [
        discoveredCard('shared', '2026-07-03T00:00:00.000Z', { title: 'Old title' }),
        discoveredCard('extra', '2026-07-02T00:00:00.000Z'),
      ],
      pageInfo: { limit: 100, hasMore: true, nextCursor: 'cursor-2' },
      fetchedAt: 200,
    });

    const merged = mergeCollectionSessionSnapshots(current, incoming);

    expect(merged.openedCards.map((card) => card.eventId)).toEqual(['shared', 'extra']);
    expect(merged.openedCards[0]?.title).toBe('Refreshed title');
    expect(merged.pageInfo?.nextCursor).toBe('cursor-2');
    expect(merged.passport).toBe(current.passport);
  });
});
