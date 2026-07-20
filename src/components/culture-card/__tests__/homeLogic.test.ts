import { describe, expect, test } from '@jest/globals';
import type { Card, CardsTodayResponse, LockedCardPreview } from '../../../services/cardsService';
import {
  AD_SHOW_REQUEST_TIMEOUT_MS,
  AD_SHOW_TERMINAL_TIMEOUT_MS,
  LOAD_FAILED_COPY,
  POOL_EMPTY_COPY,
  canDrawNextCard,
  getCapReachedView,
  getCardNextAction,
  getEarnFailureCopy,
  getEffectiveOpenCap,
  getLockedCardChoice,
  getNextOpenableCard,
  getPersonalizationCopy,
  getSlotTabContent,
  getSlotType,
  getTicketGaugeState,
  getTodayCardsAvailability,
  getTodayCardProgress,
  hasReachedDailyLimit,
  isAlreadyOpenedCardError,
  isRewardAdProgressEvent,
  markCardOpened,
  rankWeeklyActionCards,
  removeLockedCardPreview,
  sortLockedCardsForTabs,
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

function lockedCard(overrides: Partial<LockedCardPreview> = {}): LockedCardPreview {
  return {
    cardToken: 'sealed-token',
    visualSeed: 'visual-seed',
    category: '전시',
    areaLabel: '서울',
    distanceLabel: '도보 12분',
    timingLabel: '일정 여유가 있어요',
    reasonTags: [],
    teaserEyebrow: '오늘의 큐레이션',
    teaserHeadline: '오늘 열어볼\n전시 한 곳',
    palette: {
      background: '#171717',
      foreground: '#FFFFFF',
      accent: '#A52822',
    },
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

  test('uses the 50-card open count when v2 limit fields are present', () => {
    expect(hasReachedDailyLimit({
      dailyEarned: 40,
      dailyLimit: 150,
      dailyOpenCount: 50,
      dailyOpenLimit: 50,
    })).toBe(true);
    expect(hasReachedDailyLimit({
      dailyEarned: 40,
      dailyLimit: 150,
      dailyOpenCount: 49,
      dailyOpenLimit: 50,
    })).toBe(false);
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

    expect(getEarnFailureCopy(limitError).title).toBe('오늘 준비한 컬처카드는 여기까지예요');
    expect(getEarnFailureCopy(limitError).description).toContain('컬렉션');
    expect(getEarnFailureCopy(networkError).title).toBe('티켓 적립에 실패했어요');
  });

  test.each([
    'EVENT_ALREADY_OPENED',
    'CARD_ALREADY_OPENED',
    'EVENT_ALREADY_EARNED_TODAY',
  ])('recognizes stale opened-card conflicts: %s', (errorCode) => {
    expect(isAlreadyOpenedCardError({
      response: { status: 409, data: { error: errorCode } },
    })).toBe(true);
  });

  test('does not treat unrelated or non-conflict errors as stale opened cards', () => {
    expect(isAlreadyOpenedCardError({
      response: { status: 409, data: { error: 'AD_REWARD_NOT_CONFIRMED' } },
    })).toBe(false);
    expect(isAlreadyOpenedCardError({
      response: { status: 500, data: { error: 'EVENT_ALREADY_OPENED' } },
    })).toBe(false);
    expect(isAlreadyOpenedCardError(new Error('network'))).toBe(false);
  });

  test('removes only the stale locked token while preserving the response metadata', () => {
    const stale = lockedCard({ cardToken: 'stale-token', visualSeed: 'stale' });
    const fresh = lockedCard({ cardToken: 'fresh-token', visualSeed: 'fresh' });
    const data = {
      lockedCards: [stale, fresh],
      ticketCount: 7,
      dailyEarned: 12,
      dailyLimit: 150,
      dailyOpenCount: 4,
      dailyOpenLimit: 50,
      userRegion: '서울',
      weeklyDiscovery: {
        weekKey: '2026-07-13',
        openedCount: 4,
        goal: 5,
        items: [],
      },
      personalization: {
        level: 'cold' as const,
        signalCount: 0,
        topCategories: [],
      },
    };

    const next = removeLockedCardPreview(data, stale.cardToken);

    expect(next).not.toBe(data);
    expect(next.lockedCards).toEqual([fresh]);
    expect(next.ticketCount).toBe(data.ticketCount);
    expect(data.lockedCards).toEqual([stale, fresh]);
  });

  test('builds sealed-card choices only from safe preview hints', () => {
    expect(getLockedCardChoice(lockedCard({
      reasonTags: ['내 주변'],
    }), 0)).toEqual({
      label: '가까운 전시',
      description: '도보 12분 · 일정 여유가 있어요',
    });

    expect(getLockedCardChoice(lockedCard({
      category: '공연',
      distanceLabel: null,
      timingLabel: '3일 안에 마감',
    }), 1).label).toBe('놓치기 전 공연');

    expect(getLockedCardChoice(lockedCard({
      category: '팝업',
      distanceLabel: null,
      reasonTags: ['취향 팝업'],
    }), 2).label).toBe('취향 팝업');
  });

  test('ignores the legacy revisit flag instead of showing a repeat recommendation', () => {
    const choice = getLockedCardChoice(lockedCard({
      isRevisit: true,
      reasonTags: ['내 주변', '곧 마감'],
    }), 0);

    expect(choice.label).toBe('가까운 전시');
    expect(choice.label).not.toContain('다시');
  });

  test('distinguishes a depleted unopened pool from the daily limit', () => {
    const base = {
      lockedCards: [] as LockedCardPreview[],
      dailyEarned: 12,
      dailyLimit: 30,
      dailyOpenCount: 4,
      dailyOpenLimit: 50,
    };

    expect(getTodayCardsAvailability(base)).toBe('pool_empty');
    expect(getTodayCardsAvailability({
      ...base,
      dailyOpenCount: 50,
    })).toBe('daily_limit');
    expect(getTodayCardsAvailability({
      ...base,
      lockedCards: [lockedCard()],
    })).toBe('ready');
    expect(POOL_EMPTY_COPY.description).toContain('컬렉션');
    expect(LOAD_FAILED_COPY.title).toContain('불러오지 못했어요');
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

  test('keeps the weekly action area to three unique prioritized cards', () => {
    const ranked = rankWeeklyActionCards([
      { ...card('regular'), dday: 20, walkMinutes: 70 },
      { ...card('soon'), dday: 3, walkMinutes: 60 },
      { ...card('today'), dday: 0, walkMinutes: 60 },
      { ...card('near'), dday: 20, walkMinutes: 8 },
      { ...card('near'), dday: 20, walkMinutes: 8 },
      { ...card('extra'), dday: 20, walkMinutes: 20 },
    ]);

    expect(ranked.map((item) => item.eventId)).toEqual(['today', 'soon', 'near']);
    expect(getCardNextAction(ranked[0]!).label).toBe('오늘 마감');
  });

  test('falls back to category slots when the backend omits slotType', () => {
    expect(getSlotType(lockedCard())).toBe('category');
    expect(getSlotType(lockedCard({ slotType: 'category' }))).toBe('category');
    expect(getSlotType(lockedCard({ slotType: 'mystery' }))).toBe('mystery');
  });

  test('keeps the mystery slot in the last tab without reordering category slots', () => {
    const mystery = lockedCard({ cardToken: 'm', visualSeed: 'm', slotType: 'mystery' });
    const first = lockedCard({ cardToken: 'a', visualSeed: 'a', category: '공연' });
    const second = lockedCard({ cardToken: 'b', visualSeed: 'b', category: '전시' });

    const sorted = sortLockedCardsForTabs([mystery, first, second]);

    expect(sorted.map((card) => card.visualSeed)).toEqual(['a', 'b', 'm']);
  });

  test('builds slot tabs from the category, hiding everything for the mystery slot', () => {
    expect(getSlotTabContent(lockedCard({ category: '공연' }))).toEqual({
      title: '공연',
      subtitle: 'PERFORMANCE',
      mystery: false,
    });
    expect(getSlotTabContent(lockedCard({ category: '희귀장르' }))).toEqual({
      title: '희귀장르',
      subtitle: 'CULTURE',
      mystery: false,
    });
    expect(getSlotTabContent(lockedCard({
      slotType: 'mystery',
      category: null,
      areaLabel: null,
      distanceLabel: null,
      timingLabel: null,
      teaserEyebrow: null,
      teaserHeadline: null,
      reasonTags: [],
    }))).toEqual({
      title: '?',
      subtitle: '행선지 미정',
      mystery: true,
    });
  });

  test('describes the mystery slot choice without leaking server hints', () => {
    const choice = getLockedCardChoice(lockedCard({
      slotType: 'mystery',
      category: null,
      timingLabel: null,
      reasonTags: [],
    }), 2);

    expect(choice.label).toBe('행선지 미정');
    expect(choice.description).not.toContain('전시');
  });

  test('tracks the 10-cell ticket gauge toward a point draw', () => {
    const partial = getTicketGaugeState(7, 12);
    expect(partial).toMatchObject({ filled: 7, total: 10, ready: false, countLabel: '7/10' });
    expect(partial.subtitle).toBe('3장 더 모으면 포인트 뽑기 · 오늘 12장 열었어요');

    const ready = getTicketGaugeState(10, 3);
    expect(ready.ready).toBe(true);
    expect(ready.subtitle).toContain('포인트 뽑기 가능');

    // 10장이 넘어도 게이지는 가득 찬 10칸으로만 표기한다.
    expect(getTicketGaugeState(23, 0)).toMatchObject({ filled: 10, ready: true, countLabel: '10/10' });
  });

  test('draws the next card only while the effective open cap remains', () => {
    const withCap = {
      dailyOpenLimit: 50,
      openCap: { base: 50, effective: 4, reason: 'regional_pool' as const, regionLabel: '전포동' },
    };

    expect(getEffectiveOpenCap(withCap)).toBe(4);
    expect(getEffectiveOpenCap({ dailyOpenLimit: 50 })).toBe(50);
    expect(canDrawNextCard(3, withCap)).toBe(true);
    expect(canDrawNextCard(4, withCap)).toBe(false);
    expect(canDrawNextCard(49, { dailyOpenLimit: 50 })).toBe(true);
    expect(canDrawNextCard(50, { dailyOpenLimit: 50 })).toBe(false);
    expect(canDrawNextCard(0, null)).toBe(false);
  });

  test('frames the regional pool cap as scarcity instead of a penalty', () => {
    const view = getCapReachedView({
      dailyOpenCount: 4,
      dailyOpenLimit: 4,
      userRegion: '부산',
      openCap: { base: 50, effective: 4, reason: 'regional_pool', regionLabel: '전포동' },
    });

    expect(view.variant).toBe('regional_pool');
    if (view.variant === 'regional_pool') {
      expect(view.title).toContain('전포동');
      expect(view.title).toContain('여기까지예요');
      expect(view.description).toContain('4곳');
      expect(view.description).toContain('내일 아침');
      expect(view.meterLabel).toBe('TODAY 4 / 4 ISSUED');
      expect(view.ctaLabel).toBe('오늘 연 카드 보러 가기');
    }
  });

  test('keeps the existing daily-limit copy for the hard daily max', () => {
    const dailyMax = getCapReachedView({
      dailyOpenCount: 50,
      dailyOpenLimit: 50,
      userRegion: '서울',
      openCap: { base: 50, effective: 50, reason: 'daily_max', regionLabel: null },
    });
    expect(dailyMax.variant).toBe('daily_max');
    if (dailyMax.variant === 'daily_max') {
      expect(dailyMax.copy.title).toBe('오늘 준비한 컬처카드는 여기까지예요');
    }

    // 구버전 백엔드(openCap 없음)도 기존 카피를 유지한다.
    const legacy = getCapReachedView({
      dailyOpenCount: 50,
      dailyOpenLimit: 50,
      userRegion: '서울',
    });
    expect(legacy.variant).toBe('daily_max');
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
