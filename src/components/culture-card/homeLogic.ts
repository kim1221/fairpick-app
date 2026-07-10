import type { Card, CardsTodayResponse, PersonalizationProfile } from '../../services/cardsService';

export type HomeCopy = {
  title: string;
  description: string;
};

export type TodayCardProgress = {
  opened: number;
  total: number;
  current: number;
};

export const AD_LOAD_FAILED_COPY: HomeCopy = {
  title: '지금은 광고를 불러올 수 없어요',
  description: '잠시 후 다시 시도해 주세요. 카드는 그대로예요.',
};

export const AD_LOADING_COPY: HomeCopy = {
  title: '광고 준비 중',
  description: '광고를 불러오는 중이에요. 잠시 후 다시 눌러 주세요.',
};

export const AD_SHOW_REQUEST_TIMEOUT_MS = 60_000;
export const AD_SHOW_TERMINAL_TIMEOUT_MS = 240_000;

const REWARD_AD_PROGRESS_EVENTS = new Set(['requested', 'show', 'impression', 'clicked']);

const DAILY_LIMIT_COPY: HomeCopy = {
  title: '오늘 티켓을 다 모았어요',
  description: '내일 다시 새로운 문화카드를 열 수 있어요.',
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
  return getServerStatus(error) === 429 || getServerErrorCode(error) === 'DAILY_LIMIT_REACHED';
}

export function getEarnFailureCopy(error: unknown): HomeCopy {
  return isDailyLimitReachedError(error) ? DAILY_LIMIT_COPY : EARN_FAILED_COPY;
}

export function isRewardAdProgressEvent(eventType: string): boolean {
  return REWARD_AD_PROGRESS_EVENTS.has(eventType);
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
  data: Pick<CardsTodayResponse, 'dailyLimit' | 'dailyEarned'> | null,
): boolean {
  if (!data) return false;
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
