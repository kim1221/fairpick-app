import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import type { CollectionBadge, ThemeCollectionSet } from '../../../services/themeCollectionService';
import { ThemeCollectionSection } from '../ThemeCollectionSection';

function set(overrides: Partial<ThemeCollectionSet> = {}): ThemeCollectionSet {
  return {
    setId: 'set-1',
    slug: 'neighborhood-jongno-2026w30',
    title: '종로구 컬렉션',
    subtitle: '팝업 둘, 전시 하나, 공연 하나',
    template: 'neighborhood',
    tier: 'normal',
    regionScope: '서울',
    status: 'active',
    publishedAt: '2026-07-20T00:00:00.000Z',
    expiresAt: '2026-08-17T00:00:00.000Z',
    daysRemaining: 14,
    totalSlots: 4,
    filledCount: 1,
    completed: false,
    slots: [],
    ...overrides,
  };
}

function badge(overrides: Partial<CollectionBadge> = {}): CollectionBadge {
  return {
    badgeKey: 'set:neighborhood-jongno-2026w30',
    setId: 'set-1',
    tier: 'normal',
    title: '종로구 컬렉션',
    awardedAt: '2026-07-21T00:00:00.000Z',
    ...overrides,
  };
}

describe('ThemeCollectionSection', () => {
  test('renders nothing when there are no sets and no badges', () => {
    const screen = render(<ThemeCollectionSection sets={[]} badges={[]} onPressSet={jest.fn()} />);
    expect(screen.toJSON()).toBeNull();
  });

  test('renders set folder cards with progress and forwards presses', () => {
    const onPressSet = jest.fn();
    const screen = render(
      <ThemeCollectionSection sets={[set()]} badges={[]} onPressSet={onPressSet} />
    );

    expect(screen.getByText('테마 컬렉션')).toBeTruthy();
    expect(screen.getByText('종로구 컬렉션')).toBeTruthy();
    expect(screen.getByText('1/4')).toBeTruthy();
    expect(screen.getByText('D-14')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('종로구 컬렉션 세트, 1/4 채움'));
    expect(onPressSet).toHaveBeenCalledWith('set-1');
  });

  test('marks completed sets with the earned badge instead of D-day', () => {
    const screen = render(
      <ThemeCollectionSection
        sets={[set({ filledCount: 4, completed: true })]}
        badges={[]}
        onPressSet={jest.fn()}
      />
    );

    expect(screen.getByText('BADGE EARNED')).toBeTruthy();
    expect(screen.queryByText('D-14')).toBeNull();
  });

  test('shows the badge shelf only when badges exist', () => {
    const withoutBadges = render(
      <ThemeCollectionSection sets={[set()]} badges={[]} onPressSet={jest.fn()} />
    );
    expect(withoutBadges.queryByText('BADGES · 배지장')).toBeNull();

    const withBadges = render(
      <ThemeCollectionSection sets={[set()]} badges={[badge()]} onPressSet={jest.fn()} />
    );
    expect(withBadges.getByText('BADGES · 배지장')).toBeTruthy();
    expect(withBadges.getAllByText('종로구 컬렉션').length).toBeGreaterThanOrEqual(2);
  });
});
