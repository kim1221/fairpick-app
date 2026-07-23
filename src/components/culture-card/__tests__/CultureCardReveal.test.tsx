import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import type { Card } from '../../../services/cardsService';
import { CultureCardReveal, type RevealedCultureCard } from '../CultureCardReveal';

// 실제 TDS 패키지는 jest(RN preset) 환경에서 로드가 깨진다 — BottomTabBar.test와 동일한 스텁.
jest.mock('@toss/tds-react-native', () => ({
  Icon: () => null,
}));

function card(overrides: Partial<Card> = {}): Card {
  return {
    eventId: 'event-1',
    title: '성수 팝업 스튜디오',
    category: '팝업',
    venue: '성수동 카페거리',
    region: '서울',
    startAt: '2026-07-01T00:00:00.000Z',
    endAt: '2026-07-31T00:00:00.000Z',
    dday: 11,
    imageUrl: null,
    walkMinutes: 12,
    blurb: '가까운 문화 행사예요.',
    opened: true,
    ...overrides,
  };
}

function openedCard(overrides: Partial<RevealedCultureCard> = {}): RevealedCultureCard {
  return {
    card: card(),
    earned: 1,
    ticketCount: 8,
    dailyEarned: 13,
    dailyLimit: 50,
    ...overrides,
  };
}

function renderReveal(overrides: Partial<React.ComponentProps<typeof CultureCardReveal>> = {}) {
  const props: React.ComponentProps<typeof CultureCardReveal> = {
    openedCard: openedCard(),
    canDrawNext: true,
    onDetail: jest.fn(),
    onNext: jest.fn(),
    onSave: jest.fn(),
    ...overrides,
  };

  return { ...render(<CultureCardReveal {...props} />), props };
}

describe('CultureCardReveal', () => {
  test('offers the explicit next-draw CTA only while the open cap remains', () => {
    const onNext = jest.fn();
    const screen = renderReveal({ onNext });

    fireEvent.press(screen.getByLabelText('다음 카드 뽑기'));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  test('hides the next-draw CTA once the cap is reached', () => {
    const onNext = jest.fn();
    const screen = renderReveal({ canDrawNext: false, onNext });

    expect(screen.queryByLabelText('다음 카드 뽑기')).toBeNull();

    // 대신 홈 복귀 경로는 남는다.
    fireEvent.press(screen.getByText('오늘의 뽑기 완료 · 홈으로'));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  test('marks a hidden reveal with a single restrained stamp', () => {
    const screen = renderReveal({
      openedCard: openedCard({ reveal: { slotType: 'mystery', hidden: true } }),
    });

    expect(screen.getByText('HIDDEN')).toBeTruthy();
  });

  test('does not show the hidden stamp for ordinary reveals', () => {
    const plain = renderReveal();
    expect(plain.queryByText('HIDDEN')).toBeNull();

    const mysteryButNotHidden = renderReveal({
      openedCard: openedCard({ reveal: { slotType: 'mystery', hidden: false } }),
    });
    expect(mysteryButNotHidden.queryByText('HIDDEN')).toBeNull();
  });

  test('keeps the fixed +1 ticket framing instead of random ticket counts', () => {
    const screen = renderReveal();

    expect(screen.getByText('+1 티켓')).toBeTruthy();
    expect(screen.getByText('현재 8장')).toBeTruthy();
  });

  test('shows a collection fill banner per progressed set', () => {
    const screen = renderReveal({
      openedCard: openedCard({
        collectionProgress: [
          {
            setId: 'set-1',
            slug: 'neighborhood-jongno-2026w30',
            title: '종로구 컬렉션',
            filledSlotIndex: 1,
            filledCount: 2,
            totalSlots: 4,
            completed: false,
          },
        ],
      }),
    });

    expect(screen.getByText('『종로구 컬렉션』 2/4 채움')).toBeTruthy();
  });

  test('celebrates a completed set with the badge banner', () => {
    const screen = renderReveal({
      openedCard: openedCard({
        collectionProgress: [
          {
            setId: 'set-2',
            slug: 'season-summer-2026w30',
            title: '여름 전시 4곳',
            filledSlotIndex: 3,
            filledCount: 4,
            totalSlots: 4,
            completed: true,
            badgeKey: 'set:season-summer-2026w30',
          },
        ],
      }),
    });

    expect(screen.getByText('『여름 전시 4곳』 세트 완성 — 배지를 받았어요')).toBeTruthy();
  });

  test('shows the bonus ticket count when the completion granted one', () => {
    const screen = renderReveal({
      openedCard: openedCard({
        collectionProgress: [
          {
            setId: 'set-2',
            slug: 'season-summer-2026w30',
            title: '여름 전시 4곳',
            filledSlotIndex: 3,
            filledCount: 4,
            totalSlots: 4,
            completed: true,
            badgeKey: 'set:season-summer-2026w30',
            bonusTickets: 5,
          },
        ],
      }),
    });

    expect(screen.getByText('『여름 전시 4곳』 세트 완성 — 배지 + 보너스 티켓 5장')).toBeTruthy();
  });

  test('renders no collection banner when the open filled nothing', () => {
    const absent = renderReveal();
    expect(absent.queryByText(/채움$/)).toBeNull();

    const emptyList = renderReveal({ openedCard: openedCard({ collectionProgress: [] }) });
    expect(emptyList.queryByText(/채움$/)).toBeNull();
  });
});
