import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import type { LockedCardPreview } from '../../../services/cardsService';
import { CultureCardStack } from '../CultureCardStack';

function lockedCard(
  visualSeed: string,
  overrides: Partial<LockedCardPreview> = {},
): LockedCardPreview {
  return {
    cardToken: `token-${visualSeed}`,
    visualSeed,
    category: '전시',
    areaLabel: '성수동 근처',
    distanceLabel: '도보 12분',
    timingLabel: '일정 여유가 있어요',
    reasonTags: ['내 주변'],
    teaserEyebrow: '내 주변 발견',
    teaserHeadline: '익숙한 동네에서\n열어볼 전시',
    palette: {
      background: '#171717',
      foreground: '#FFFFFF',
      accent: '#A52822',
    },
    ...overrides,
  };
}

const cards = [
  lockedCard('a', { slotType: 'category' }),
  lockedCard('m', {
    slotType: 'mystery',
    category: null,
    areaLabel: null,
    distanceLabel: null,
    timingLabel: null,
    reasonTags: [],
    teaserEyebrow: null,
    teaserHeadline: null,
  }),
  lockedCard('b', {
    slotType: 'category',
    category: '공연',
    distanceLabel: null,
    timingLabel: '3일 안에 마감',
    reasonTags: ['곧 마감'],
    teaserEyebrow: '곧 마감',
    teaserHeadline: '이번 주가 지나기 전에\n열어볼 공연',
  }),
];

function renderStack(overrides: Partial<React.ComponentProps<typeof CultureCardStack>> = {}) {
  const props: React.ComponentProps<typeof CultureCardStack> = {
    cards,
    selectedCardKey: 'a',
    loading: false,
    disabled: false,
    actionLabel: '광고 보고 카드 열기',
    onSelectCard: jest.fn(),
    onOpen: jest.fn(),
    userRegion: '성수동',
    nextCardNumber: 13,
    ...overrides,
  };

  return { ...render(<CultureCardStack {...props} />), props };
}

describe('CultureCardStack', () => {
  test('does not expose the daily quota as ticket inventory', () => {
    const screen = renderStack();

    expect(screen.queryByText(/오늘 \d+장 공개/)).toBeNull();
    expect(screen.queryByText(/열어본 티켓/)).toBeNull();
    expect(screen.queryByText(/최대 \d+장/)).toBeNull();
    expect(screen.queryByText(/오늘 남은 티켓/)).toBeNull();
  });

  test('renders category tabs with english labels and the mystery tab last', () => {
    const screen = renderStack();

    expect(screen.getByText('전시')).toBeTruthy();
    expect(screen.getByText('EXHIBITION')).toBeTruthy();
    expect(screen.getByText('공연')).toBeTruthy();
    expect(screen.getByText('PERFORMANCE')).toBeTruthy();
    // 미스터리 탭: ? + 행선지 미정(카테고리 은닉)
    expect(screen.getByText('?')).toBeTruthy();
    expect(screen.getByText('행선지 미정')).toBeTruthy();
  });

  test('selects a sealed card without starting the ad and opens only from the main CTA', () => {
    const onSelectCard = jest.fn();
    const onOpen = jest.fn();
    const screen = renderStack({ onSelectCard, onOpen });

    fireEvent.press(screen.getByLabelText(/놓치기 전 공연/));
    expect(onSelectCard).toHaveBeenCalledWith('b');
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('광고를 보고 선택한 컬처카드 공개하기'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test('shows the navy mystery hero without any category or venue hints', () => {
    const screen = renderStack({ selectedCardKey: 'm' });

    expect(screen.getByText('DESTINATION UNKNOWN')).toBeTruthy();
    expect(screen.getByText('행선지 미정 — 어디로든 갈 수 있어요')).toBeTruthy();
    expect(screen.getAllByText('? ? ?').length).toBe(2);
    expect(screen.getByText('컬렉션 조각 확률 ↑')).toBeTruthy();
    // 카테고리 히어로 전용 요소는 나오지 않는다.
    expect(screen.queryByText('TICKET TO CULTURE')).toBeNull();
    expect(screen.queryByText(/봉인돼 있어요/)).toBeNull();
  });

  test('shows the manila category hero for category slots', () => {
    const screen = renderStack({ selectedCardKey: 'a' });

    expect(screen.getByText('TICKET TO CULTURE')).toBeTruthy();
    expect(screen.getByText('오늘의 전시 한 장이 봉인돼 있어요')).toBeTruthy();
    expect(screen.getByText('성수동 근처')).toBeTruthy();
    expect(screen.getByText('TODAY ONLY')).toBeTruthy();
    expect(screen.queryByText('DESTINATION UNKNOWN')).toBeNull();
  });

  test('marks the active choice and locks selection while an ad is showing', () => {
    const onSelectCard = jest.fn();
    const screen = renderStack({ disabled: true, onSelectCard });
    const selected = screen.getByLabelText(/가까운 전시/);
    const other = screen.getByLabelText(/놓치기 전 공연/);

    expect(selected.props.accessibilityState).toEqual({ selected: true, disabled: true });
    expect(other.props.accessibilityState).toEqual({ selected: false, disabled: true });
    fireEvent.press(other);
    expect(onSelectCard).not.toHaveBeenCalled();
  });

  test('captions the CTA with the running card number and the fixed +1 ticket', () => {
    const screen = renderStack({ nextCardNumber: 13 });

    expect(screen.getByText(/13번째/)).toBeTruthy();
    expect(screen.getByText(/\+1 티켓/)).toBeTruthy();
  });
});
