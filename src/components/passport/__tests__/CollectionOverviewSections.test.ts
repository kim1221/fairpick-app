import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import {
  buildCollectionCurationThemes,
  CollectionOverviewSections,
  filterCollectionCards,
  getCollectionCardStatus,
  type CollectionOverviewCard,
} from '../CollectionOverviewSections';

const REFERENCE_DATE = new Date(2026, 6, 13, 12, 0, 0);

function card(id: string, overrides: Partial<CollectionOverviewCard> = {}): CollectionOverviewCard {
  return {
    id,
    title: `Event ${id}`,
    category: '전시',
    endAt: '2026-07-31',
    walkMinutes: null,
    lastKnownStatus: 'active',
    openedAt: '2026-07-01T00:00:00.000Z',
    isSaved: false,
    isVisited: false,
    ...overrides,
  };
}

describe('collection overview pure logic', () => {
  test('classifies removed and server-ended cards before deriving status from endAt', () => {
    expect(
      getCollectionCardStatus(
        card('removed', {
          endAt: '2026-07-31',
          lastKnownStatus: 'deleted',
        }),
        REFERENCE_DATE
      )
    ).toBe('removed');
    expect(
      getCollectionCardStatus(
        card('removed-past', {
          endAt: '2026-07-01',
          lastKnownStatus: 'deleted',
        }),
        REFERENCE_DATE
      )
    ).toBe('removed');
    expect(
      getCollectionCardStatus(
        card('server-ended', {
          endAt: '2026-07-31',
          lastKnownStatus: 'ended',
        }),
        REFERENCE_DATE
      )
    ).toBe('ended');
  });

  test('keeps an event active through its end date and ends it the following day', () => {
    expect(getCollectionCardStatus(card('past', { endAt: '2026-07-12' }), REFERENCE_DATE)).toBe('ended');
    expect(getCollectionCardStatus(card('today', { endAt: '2026-07-13' }), REFERENCE_DATE)).toBe('active');
    expect(getCollectionCardStatus(card('future', { endAt: '2026-07-14' }), REFERENCE_DATE)).toBe('active');
    expect(getCollectionCardStatus(card('unknown', { endAt: null }), REFERENCE_DATE)).toBe('active');
  });

  test('filters against the actual card list while allowing saved and past memberships to overlap', () => {
    const cards = [
      card('today', { endAt: '2026-07-13' }),
      card('future-saved', { endAt: '2026-07-31', isSaved: true }),
      card('past-by-date', { endAt: '2026-07-12' }),
      card('ended-saved', { endAt: '2026-07-31', lastKnownStatus: 'ended', isSaved: true }),
      card('removed-saved', { endAt: '2026-07-31', lastKnownStatus: 'deleted', isSaved: true }),
    ];

    expect(filterCollectionCards(cards, 'all', REFERENCE_DATE).map((item) => item.id)).toEqual([
      'today',
      'future-saved',
      'past-by-date',
      'ended-saved',
      'removed-saved',
    ]);
    expect(filterCollectionCards(cards, 'active', REFERENCE_DATE).map((item) => item.id)).toEqual([
      'today',
      'future-saved',
    ]);
    expect(filterCollectionCards(cards, 'saved', REFERENCE_DATE).map((item) => item.id)).toEqual([
      'future-saved',
      'ended-saved',
      'removed-saved',
    ]);
    expect(filterCollectionCards(cards, 'past', REFERENCE_DATE).map((item) => item.id)).toEqual([
      'past-by-date',
      'ended-saved',
      'removed-saved',
    ]);
  });

  test('builds curation shelves in priority order from active cards only without cross-shelf duplicates', () => {
    const duplicateEnding = card('ending', {
      endAt: '2026-07-15',
      isSaved: true,
      openedAt: '2026-07-12T00:00:00.000Z',
    });
    const themes = buildCollectionCurationThemes(
      [
        duplicateEnding,
        { ...duplicateEnding, title: 'Duplicate ending event' },
        card('saved', {
          isSaved: true,
          openedAt: '2026-07-11T00:00:00.000Z',
        }),
        card('unvisited', { openedAt: '2026-07-10T00:00:00.000Z' }),
        card('visited', {
          isVisited: true,
          openedAt: '2026-07-09T00:00:00.000Z',
        }),
        card('ended', {
          endAt: '2026-07-31',
          lastKnownStatus: 'ended',
          isSaved: true,
        }),
        card('removed', {
          endAt: '2026-07-31',
          lastKnownStatus: 'deleted',
          isSaved: true,
        }),
        card('past-by-date', {
          endAt: '2026-07-12',
          isSaved: true,
        }),
      ],
      REFERENCE_DATE
    );

    expect(themes.map((theme) => theme.key)).toEqual([
      'ending-soon',
      'saved-unvisited',
      'unvisited-recent',
      'recent',
    ]);
    expect(themes.map((theme) => theme.cards.map((item) => item.id))).toEqual([
      ['ending'],
      ['saved'],
      ['unvisited'],
      ['visited'],
    ]);

    const curatedIds = themes.flatMap((theme) => theme.cards.map((item) => item.id));
    expect(new Set(curatedIds).size).toBe(curatedIds.length);
    expect(curatedIds).not.toEqual(expect.arrayContaining(['ended', 'removed', 'past-by-date']));
  });

  test('clamps each themed shelf to four through six cards', () => {
    const endingCards = Array.from({ length: 8 }, (_, index) =>
      card(`ending-${index}`, {
        endAt: `2026-07-${String(13 + index).padStart(2, '0')}`,
        openedAt: `2026-07-${String(12 - index).padStart(2, '0')}T00:00:00.000Z`,
      })
    );

    const minimum = buildCollectionCurationThemes(endingCards, REFERENCE_DATE, 0);
    const maximum = buildCollectionCurationThemes(endingCards, REFERENCE_DATE, 99);

    expect(minimum[0]).toMatchObject({ key: 'ending-soon' });
    expect(minimum[0]?.cards).toHaveLength(4);
    expect(maximum[0]).toMatchObject({ key: 'ending-soon' });
    expect(maximum[0]?.cards).toHaveLength(6);
    expect(maximum.every((theme) => theme.cards.length <= 6)).toBe(true);
  });

  test('hides themed shelves that have no eligible cards', () => {
    const themes = buildCollectionCurationThemes(
      [
        card('unvisited', { openedAt: '2026-07-12T00:00:00.000Z' }),
        card('ended', { lastKnownStatus: 'ended', isSaved: true }),
      ],
      REFERENCE_DATE
    );

    expect(themes).toHaveLength(1);
    expect(themes[0]).toMatchObject({
      key: 'unvisited-recent',
      cards: [expect.objectContaining({ id: 'unvisited' })],
    });
  });

  test('renders the vertical collection sections without the former goal or archive tabs', () => {
    const screen = render(
      React.createElement(CollectionOverviewSections, {
        openedCards: [card('active'), card('past', { lastKnownStatus: 'ended' })],
        visitRecords: [{ eventId: 'active', visitedAt: '2026-07-10T12:00:00.000Z' }],
        referenceDate: REFERENCE_DATE,
        onPressActiveCard: jest.fn(),
        onOpenNewCard: jest.fn(),
      })
    );

    expect(screen.getByText('지금 가기 좋은 내 카드')).toBeTruthy();
    expect(screen.getByText('내가 연 카드')).toBeTruthy();
    expect(screen.getByText('최근 방문 기록')).toBeTruthy();
    expect(screen.queryByText('다음 컬렉션 목표')).toBeNull();
    expect(screen.queryByText(/^공개 \d+$/)).toBeNull();
  });

  test('keeps active navigation separate from the read-only past-event snapshot', () => {
    const onPressActiveCard = jest.fn();
    const screen = render(
      React.createElement(CollectionOverviewSections, {
        openedCards: [card('active'), card('past', { lastKnownStatus: 'ended' })],
        visitRecords: [],
        referenceDate: REFERENCE_DATE,
        onPressActiveCard,
        onOpenNewCard: jest.fn(),
      })
    );

    fireEvent.press(screen.getByLabelText('Event past 보관 정보 보기'));
    expect(screen.getByText('COLLECTION ARCHIVE')).toBeTruthy();
    expect(onPressActiveCard).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('보관 정보 닫기'));
    fireEvent.press(screen.getAllByLabelText('Event active 상세 보기')[0]);
    expect(onPressActiveCard).toHaveBeenCalledWith(expect.objectContaining({ id: 'active' }));
  });

  test('shows opened-card progress in the bottom more button and forwards the active filter', () => {
    const onViewAllOpened = jest.fn();
    const screen = render(
      React.createElement(CollectionOverviewSections, {
        openedCards: Array.from({ length: 5 }, (_, index) => card(`opened-${index}`)),
        visitRecords: [],
        filter: 'active',
        referenceDate: REFERENCE_DATE,
        openedPreviewLimit: 2,
        onPressActiveCard: jest.fn(),
        onViewAllOpened,
        onOpenNewCard: jest.fn(),
      })
    );

    expect(screen.getByText('2장 표시 · 3장 더 볼 수 있어요')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('열린 카드 더 보기, 2장 표시 · 3장 더 볼 수 있어요'));

    expect(onViewAllOpened).toHaveBeenCalledTimes(1);
    expect(onViewAllOpened).toHaveBeenCalledWith('active');
  });

  test('shows visit progress in the bottom more button and invokes its callback', () => {
    const onViewAllVisits = jest.fn();
    const visitRecords = Array.from({ length: 4 }, (_, index) => ({
      eventId: `visit-${index}`,
      visitedAt: `2026-07-${String(12 - index).padStart(2, '0')}T12:00:00.000Z`,
      title: `Visit ${index}`,
    }));
    const screen = render(
      React.createElement(CollectionOverviewSections, {
        openedCards: [],
        visitRecords,
        referenceDate: REFERENCE_DATE,
        visitPreviewLimit: 2,
        onPressActiveCard: jest.fn(),
        onViewAllVisits,
        onOpenNewCard: jest.fn(),
      })
    );

    expect(screen.getByText('2개 표시 · 2개 더 볼 수 있어요')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('방문 기록 더 보기, 2개 표시 · 2개 더 볼 수 있어요'));

    expect(onViewAllVisits).toHaveBeenCalledTimes(1);
  });

  test('keeps the bottom more button visible when another server page is available', () => {
    const onViewAllOpened = jest.fn();
    const screen = render(
      React.createElement(CollectionOverviewSections, {
        openedCards: [card('only-loaded')],
        visitRecords: [],
        referenceDate: REFERENCE_DATE,
        openedPreviewLimit: 12,
        hasMoreOpened: true,
        onPressActiveCard: jest.fn(),
        onViewAllOpened,
        onOpenNewCard: jest.fn(),
      })
    );

    expect(screen.getByText('1장 표시 · 지난 기록을 더 불러올 수 있어요')).toBeTruthy();
    fireEvent.press(
      screen.getByLabelText('열린 카드 더 보기, 1장 표시 · 지난 기록을 더 불러올 수 있어요')
    );
    expect(onViewAllOpened).toHaveBeenCalledWith('all');
  });
});
