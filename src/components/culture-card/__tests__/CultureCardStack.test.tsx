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
    areaLabel: '서울',
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
  lockedCard('a'),
  lockedCard('b', {
    category: '공연',
    distanceLabel: null,
    timingLabel: '3일 안에 마감',
    reasonTags: ['곧 마감'],
    teaserEyebrow: '곧 마감',
    teaserHeadline: '이번 주가 지나기 전에\n열어볼 공연',
  }),
  lockedCard('c', {
    category: '팝업',
    distanceLabel: null,
    reasonTags: ['새로 등록'],
    teaserEyebrow: '새로 등록',
    teaserHeadline: '오늘의 목록에 더해진\n팝업 한 곳',
  }),
];

function renderStack(overrides: Partial<React.ComponentProps<typeof CultureCardStack>> = {}) {
  const props: React.ComponentProps<typeof CultureCardStack> = {
    cards,
    selectedCardKey: 'a',
    loading: false,
    disabled: false,
    actionLabel: '광고 보고 컬처카드 공개하기',
    onSelectCard: jest.fn(),
    onOpen: jest.fn(),
    userRegion: '서울',
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
});
