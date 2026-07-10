import { describe, expect, test } from '@jest/globals';
import type { Card, CardsTodayResponse } from '../../../services/cardsService';
import {
  AD_SHOW_REQUEST_TIMEOUT_MS,
  AD_SHOW_TERMINAL_TIMEOUT_MS,
  getEarnFailureCopy,
  getNextOpenableCard,
  getPersonalizationCopy,
  getTodayCardProgress,
  isRewardAdProgressEvent,
  markCardOpened,
} from '../homeLogic';

function card(eventId: string, opened = false): Card {
  return {
    eventId,
    title: `event-${eventId}`,
    category: '전시',
    venue: '디뮤지엄',
    region: '서울',
    startAt: '2026-07-01T00:00:00.000Z',
    endAt: '2026-07-31T00:00:00.000Z',
    dday: 30,
    imageUrl: null,
    walkMinutes: 12,
    blurb: '가까운 문화 행사예요.',
    opened,
  };
}

function response(overrides: Partial<CardsTodayResponse> = {}): CardsTodayResponse {
  return {
    today: [card('a', true), card('b'), card('c')],
    morePool: [card('d')],
    ticketCount: 7,
    dailyEarned: 12,
    dailyLimit: 30,
    userRegion: null,
    ...overrides,
  };
}

describe('culture-card home logic', () => {
  test('selects the first unopened card from the three today cards before morePool', () => {
    expect(getNextOpenableCard(response())?.eventId).toBe('b');
  });

  test('selects a morePool card after all three today cards are opened', () => {
    const next = getNextOpenableCard(response({
      today: [card('a', true), card('b', true), card('c', true)],
      morePool: [card('d'), card('e')],
    }));

    expect(next?.eventId).toBe('d');
  });

  test('does not select a card after the daily ticket limit is reached', () => {
    const next = getNextOpenableCard(response({ dailyEarned: 30, dailyLimit: 30 }));

    expect(next).toBeNull();
  });

  test('counts progress from exactly three today cards', () => {
    expect(getTodayCardProgress(response({
      today: [card('a', true), card('b'), card('c'), card('d')],
    }))).toEqual({
      opened: 1,
      total: 3,
      current: 2,
    });
  });

  test('separates daily limit copy from generic earn failures', () => {
    const limitError = { response: { status: 429, data: { error: 'DAILY_LIMIT_REACHED' } } };
    const networkError = new Error('network');

    expect(getEarnFailureCopy(limitError).title).toBe('오늘 티켓을 다 모았어요');
    expect(getEarnFailureCopy(networkError).title).toBe('티켓 적립에 실패했어요');
  });

  test('keeps waiting for terminal reward ad events after ad progress starts', () => {
    expect(isRewardAdProgressEvent('requested')).toBe(true);
    expect(isRewardAdProgressEvent('show')).toBe(true);
    expect(isRewardAdProgressEvent('impression')).toBe(true);
    expect(isRewardAdProgressEvent('clicked')).toBe(true);
    expect(isRewardAdProgressEvent('userEarnedReward')).toBe(false);
    expect(isRewardAdProgressEvent('dismissed')).toBe(false);
    expect(isRewardAdProgressEvent('failedToShow')).toBe(false);
    expect(AD_SHOW_TERMINAL_TIMEOUT_MS).toBeGreaterThan(AD_SHOW_REQUEST_TIMEOUT_MS);
  });

  test('explains growing and established taste profiles', () => {
    expect(getPersonalizationCopy({
      level: 'growing',
      signalCount: 3,
      topCategories: [{ category: '전시', score: 1, signals: 4 }],
    }).title).toBe('전시 취향이 보여요');

    expect(getPersonalizationCopy({
      level: 'established',
      signalCount: 8,
      topCategories: [
        { category: '전시', score: 1, signals: 8 },
        { category: '공연', score: 0.6, signals: 5 },
      ],
    }).description).toContain('새로운 장르');
  });

  test('preserves weekly curation and personalization after opening a card', () => {
    const data = response({
      weeklyCuration: {
        weekKey: '2026-07-06',
        region: '성동구',
        title: '성동구 이번 주 문화 3선',
        subtitle: '월요일마다 새로 골라요',
        items: [card('weekly')],
      },
      personalization: {
        level: 'growing',
        signalCount: 2,
        topCategories: [{ category: '전시', score: 1, signals: 2 }],
      },
    });

    const next = markCardOpened(data, 'b', {
      ticketCount: 9,
      dailyEarned: 14,
      dailyLimit: 30,
    });

    expect(next.weeklyCuration?.weekKey).toBe('2026-07-06');
    expect(next.personalization?.topCategories[0]?.category).toBe('전시');
  });
});
