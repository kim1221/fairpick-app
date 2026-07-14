import type {
  Card,
  CardsTodayResponse,
  CardsTodayV2Response,
  LockedCardPreview,
  PersonalizationProfile,
} from '../../services/cardsService';

export type HomeCopy = {
  title: string;
  description: string;
};

export type TodayCardProgress = {
  opened: number;
  total: number;
  current: number;
};

export type CardNextAction = {
  label: string;
  description: string;
  cta: string;
  score: number;
};

export const AD_LOAD_FAILED_COPY: HomeCopy = {
  title: '지금은 광고를 불러올 수 없어요',
  description: '잠시 후 다시 시도해 주세요. 카드는 그대로예요.',
};

export const AD_LOADING_COPY: HomeCopy = {
  title: '광고 준비 중',
  description: '광고를 불러오는 중이에요. 잠시 후 다시 눌러 주세요.',
};

export const POOL_EMPTY_COPY: HomeCopy = {
  title: '열어볼 새로운 카드를 모두 발견했어요',
  description: '공개한 카드는 컬렉션에서 다시 볼 수 있어요. 새로운 이벤트가 들어오면 새 카드가 준비돼요.',
};

export const LOAD_FAILED_COPY: HomeCopy = {
  title: '카드를 불러오지 못했어요',
  description: '네트워크 상태를 확인하고 다시 시도해 주세요.',
};

export const AD_SHOW_REQUEST_TIMEOUT_MS = 60_000;
export const AD_SHOW_TERMINAL_TIMEOUT_MS = 240_000;

const REWARD_AD_PROGRESS_EVENTS = new Set(['requested', 'show', 'impression', 'clicked']);
const ALREADY_OPENED_CARD_ERROR_CODES = new Set([
  'EVENT_ALREADY_OPENED',
  'CARD_ALREADY_OPENED',
  'EVENT_ALREADY_EARNED_TODAY',
]);

const DAILY_LIMIT_COPY: HomeCopy = {
  title: '오늘 준비한 컬처카드는 여기까지예요',
  description: '내일 새로운 카드가 도착해요. 공개한 카드는 컬렉션에서 다시 볼 수 있어요.',
};

const EARN_FAILED_COPY: HomeCopy = {
  title: '티켓 적립에 실패했어요',
  description: '광고 시청은 완료됐지만 티켓 지급에 실패했어요. 잠시 후 다시 확인해 주세요.',
};

function getServerErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const response = 'response' in error ? (error as { response?: unknown }).response : undefined;
  if (!response || typeof response !== 'object') return undefined;
  const data = 'data' in response ? (response as { data?: unknown }).data : undefined;
  if (!data || typeof data !== 'object') return undefined;
  const code = 'error' in data ? (data as { error?: unknown }).error : undefined;
  return typeof code === 'string' ? code : undefined;
}

function getServerStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const response = 'response' in error ? (error as { response?: unknown }).response : undefined;
  if (!response || typeof response !== 'object') return undefined;
  const status = 'status' in response ? (response as { status?: unknown }).status : undefined;
  return typeof status === 'number' ? status : undefined;
}

export function isDailyLimitReachedError(error: unknown): boolean {
  const code = getServerErrorCode(error);
  return getServerStatus(error) === 429
    || code === 'DAILY_LIMIT_REACHED'
    || code === 'DAILY_OPEN_LIMIT_REACHED';
}

export function isAlreadyOpenedCardError(error: unknown): boolean {
  return getServerStatus(error) === 409
    && ALREADY_OPENED_CARD_ERROR_CODES.has(getServerErrorCode(error) ?? '');
}

export function getEarnFailureCopy(error: unknown): HomeCopy {
  return isDailyLimitReachedError(error) ? DAILY_LIMIT_COPY : EARN_FAILED_COPY;
}

export function isRewardAdProgressEvent(eventType: string): boolean {
  return REWARD_AD_PROGRESS_EVENTS.has(eventType);
}

export type LockedCardChoice = {
  label: string;
  description: string;
};

export type TodayCardsAvailability = 'ready' | 'daily_limit' | 'pool_empty';

export function getTodayCardsAvailability(
  data: Pick<
    CardsTodayV2Response,
    'lockedCards' | 'dailyEarned' | 'dailyLimit' | 'dailyOpenCount' | 'dailyOpenLimit'
  >,
): TodayCardsAvailability {
  if (hasReachedDailyLimit(data)) return 'daily_limit';
  return data.lockedCards.length === 0 ? 'pool_empty' : 'ready';
}

export function removeLockedCardPreview(
  data: CardsTodayV2Response,
  cardToken: string,
): CardsTodayV2Response {
  return {
    ...data,
    lockedCards: data.lockedCards.filter((card) => card.cardToken !== cardToken),
  };
}

/**
 * 잠금 응답에 포함된 비식별 힌트만으로 선택지 카피를 만든다.
 * 이벤트 제목·장소·이미지는 공개 전에 사용하지 않는다.
 */
export function getLockedCardChoice(card: LockedCardPreview, index: number): LockedCardChoice {
  const category = card.category?.trim() || '문화';
  const reasons = card.reasonTags ?? [];
  const isEndingSoon = card.timingLabel.includes('마감');
  const hasTasteReason = reasons.some((reason) => reason.startsWith('취향 '));

  let label: string;
  if (reasons.includes('내 주변')) {
    label = `가까운 ${category}`;
  } else if (reasons.includes('곧 마감') || isEndingSoon) {
    label = `놓치기 전 ${category}`;
  } else if (hasTasteReason) {
    label = `취향 ${category}`;
  } else if (reasons.includes('새로 등록')) {
    label = `새로운 ${category}`;
  } else {
    label = index === 0 ? `오늘의 ${category}` : `${category} 한 장`;
  }

  const description = [card.distanceLabel, card.timingLabel]
    .filter((value): value is string => Boolean(value))
    .slice(0, 2)
    .join(' · ');

  return {
    label,
    description: description || card.areaLabel || '힌트는 카드에서 확인해요',
  };
}

export function getCardNextAction(card: Card): CardNextAction {
  if (card.dday === 0) {
    return { label: '오늘 마감', description: '오늘이 마지막 기회예요', cta: '일정 확인', score: 1_000 };
  }
  if (card.dday != null && card.dday > 0 && card.dday <= 7) {
    return {
      label: `D-${card.dday}`,
      description: `${card.dday}일 안에 끝나는 문화예요`,
      cta: '놓치기 전에 보기',
      score: 900 - card.dday,
    };
  }
  if (card.walkMinutes != null && card.walkMinutes <= 30) {
    return {
      label: `도보 ${card.walkMinutes}분`,
      description: '가볍게 다녀오기 좋은 거리예요',
      cta: '가까운 곳 확인',
      score: 700 - card.walkMinutes,
    };
  }
  return {
    label: card.category || '다시 보기',
    description: card.venue ? `${card.venue}에서 만날 수 있어요` : '열어본 정보를 다시 확인해 보세요',
    cta: '정보 다시 보기',
    score: 100,
  };
}

export function rankWeeklyActionCards(items: Card[]): Card[] {
  const unique = Array.from(new Map(items.map((item) => [item.eventId, item])).values());
  return unique
    .sort((a, b) => getCardNextAction(b).score - getCardNextAction(a).score)
    .slice(0, 3);
}

export function getTodayCards(cards: Card[]): Card[] {
  return cards.slice(0, 3);
}

export function getTodayCardProgress(data: CardsTodayResponse | null): TodayCardProgress {
  const today = getTodayCards(data?.today ?? []);
  const opened = today.filter((card) => card.opened).length;
  return {
    opened,
    total: 3,
    current: Math.min(opened + 1, 3),
  };
}

export function hasReachedDailyLimit(
  data: (Pick<CardsTodayResponse, 'dailyLimit' | 'dailyEarned'> & {
    dailyOpenCount?: number;
    dailyOpenLimit?: number;
  }) | null,
): boolean {
  if (!data) return false;
  if (typeof data.dailyOpenCount === 'number' && typeof data.dailyOpenLimit === 'number') {
    return data.dailyOpenLimit > 0 && data.dailyOpenCount >= data.dailyOpenLimit;
  }
  return data.dailyLimit > 0 && data.dailyEarned >= data.dailyLimit;
}

export function getNextOpenableCard(data: CardsTodayResponse | null): Card | null {
  if (!data || hasReachedDailyLimit(data)) return null;
  const todayCard = getTodayCards(data.today).find((card) => !card.opened);
  if (todayCard) return todayCard;
  return data.morePool.find((card) => !card.opened) ?? null;
}

export function markCardOpened(data: CardsTodayResponse, eventId: string, ticketResult: {
  ticketCount: number;
  dailyEarned: number;
  dailyLimit: number;
}): CardsTodayResponse {
  const mark = (card: Card): Card => (
    card.eventId === eventId ? { ...card, opened: true } : card
  );

  return {
    ...data,
    today: data.today.map(mark),
    morePool: data.morePool.map(mark).filter((card) => card.eventId !== eventId),
    ticketCount: ticketResult.ticketCount,
    dailyEarned: ticketResult.dailyEarned,
    dailyLimit: ticketResult.dailyLimit,
  };
}

export function getPersonalizationCopy(profile: PersonalizationProfile): HomeCopy {
  const top = profile.topCategories.map((item) => item.category).slice(0, 2);
  if (profile.level === 'cold' || top.length === 0) {
    return {
      title: '취향을 탐색하고 있어요',
      description: '카드를 열고 저장하거나 도장을 남기면 추천이 선명해져요.',
    };
  }
  if (profile.level === 'growing') {
    return {
      title: `${top.join(' · ')} 취향이 보여요`,
      description: '반응이 쌓일수록 가까운 문화 중 취향에 맞는 순서를 더 잘 골라요.',
    };
  }
  return {
    title: `${top.join(' · ')} 중심으로 골랐어요`,
    description: '익숙한 취향과 새로운 장르를 섞어 한쪽으로만 좁아지지 않게 추천해요.',
  };
}
