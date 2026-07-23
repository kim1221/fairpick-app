import type {
  Card,
  CardSlotType,
  CardsTodayResponse,
  CardsTodayV2Response,
  LockedCardPreview,
  OpenCapInfo,
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

/** 티켓 게이지: 10칸 = 포인트 뽑기 1회. */
export const TICKET_EXCHANGE_UNIT = 10;

export type TicketGaugeState = {
  filled: number; // 0~10 (표시 칸 수)
  total: number; // 10
  ready: boolean; // ticketCount ≥ 10 → 포인트 뽑기 가능
  countLabel: string; // "7/10"
  subtitle: string;
};

export function getTicketGaugeState(ticketCount: number, dailyOpenCount: number): TicketGaugeState {
  const safeTickets = Math.max(0, ticketCount);
  const filled = Math.min(safeTickets, TICKET_EXCHANGE_UNIT);
  const ready = safeTickets >= TICKET_EXCHANGE_UNIT;
  const openedLine = `오늘 ${Math.max(0, dailyOpenCount)}장 열었어요`;
  return {
    filled,
    total: TICKET_EXCHANGE_UNIT,
    ready,
    // "10/10"이 하루 제한으로 오독되던 문제(2026-07-23 피드백) — 티켓 재화임을 라벨에 박는다.
    countLabel: `티켓 ${filled}/${TICKET_EXCHANGE_UNIT}`,
    subtitle: ready
      ? `${TICKET_EXCHANGE_UNIT}장 모임 — 포인트 뽑기 1번 가능 · ${openedLine}`
      : `${TICKET_EXCHANGE_UNIT - filled}장 더 모으면 포인트 뽑기 1번 · ${openedLine}`,
  };
}

/** 구버전 백엔드(slotType 없음)는 항상 카테고리 슬롯으로 취급한다. */
export function getSlotType(card: Pick<LockedCardPreview, 'slotType'>): CardSlotType {
  return card.slotType === 'mystery' ? 'mystery' : 'category';
}

/** 미스터리 슬롯이 항상 마지막 탭에 오도록 정렬한다(카테고리 슬롯 간 순서는 유지). */
export function sortLockedCardsForTabs(cards: LockedCardPreview[]): LockedCardPreview[] {
  return [...cards].sort((a, b) => {
    const aMystery = getSlotType(a) === 'mystery' ? 1 : 0;
    const bMystery = getSlotType(b) === 'mystery' ? 1 : 0;
    return aMystery - bMystery;
  });
}

const CATEGORY_EN: Record<string, string> = {
  전시: 'EXHIBITION',
  공연: 'PERFORMANCE',
  팝업: 'POP-UP',
  축제: 'FESTIVAL',
  행사: 'EVENT',
  기타: 'CULTURE',
};

export type SlotTabContent = {
  title: string;
  subtitle: string;
  mystery: boolean;
};

/** 슬롯 탭 카피: 카테고리 슬롯 = 카테고리명+영문, 미스터리 슬롯 = "?"+행선지 미정. */
export function getSlotTabContent(card: LockedCardPreview): SlotTabContent {
  if (getSlotType(card) === 'mystery') {
    return { title: '?', subtitle: '행선지 미정', mystery: true };
  }
  const category = card.category?.trim() || '문화';
  return {
    title: category,
    subtitle: CATEGORY_EN[category] ?? 'CULTURE',
    mystery: false,
  };
}

/** 오늘 오픈 캡의 실효값. openCap이 없는 구버전 응답은 dailyOpenLimit을 그대로 쓴다. */
export function getEffectiveOpenCap(
  data: Pick<CardsTodayV2Response, 'dailyOpenLimit'> & { openCap?: OpenCapInfo },
): number {
  return data.openCap?.effective ?? data.dailyOpenLimit;
}

/** 공개 화면의 "다음 카드 뽑기" 노출 여부: 남은 캡이 있을 때만. */
export function canDrawNextCard(
  dailyOpenCount: number,
  data: (Pick<CardsTodayV2Response, 'dailyOpenLimit'> & { openCap?: OpenCapInfo }) | null,
): boolean {
  if (!data) return false;
  const cap = getEffectiveOpenCap(data);
  return cap > 0 && dailyOpenCount < cap;
}

export type CapReachedView =
  | {
    variant: 'regional_pool';
    title: string;
    description: string;
    meterLabel: string;
    ctaLabel: string;
    footnote: string;
  }
  | { variant: 'daily_max'; copy: HomeCopy };

/**
 * 캡 도달 화면 분기.
 * regional_pool = 지역 신선 풀 소진 → 한도 페널티가 아니라 지역 희소성 프레이밍(ALL ISSUED).
 * daily_max(또는 openCap 없음) = 기존 일일 한도 카피 유지.
 */
export function getCapReachedView(
  data: Pick<CardsTodayV2Response, 'dailyOpenCount' | 'dailyOpenLimit' | 'userRegion'> & {
    openCap?: OpenCapInfo;
  },
): CapReachedView {
  const openCap = data.openCap;
  if (openCap?.reason !== 'regional_pool') {
    return { variant: 'daily_max', copy: DAILY_LIMIT_COPY };
  }
  const region = openCap.regionLabel?.trim() || data.userRegion?.trim() || '내 주변';
  const cap = Math.max(1, openCap.effective);
  return {
    variant: 'regional_pool',
    title: `오늘 ${region}의 카드는\n여기까지예요`,
    description: `가까운 문화를 ${cap}곳 모두 발견했어요.\n내일 아침, 새로 발행된 카드가 도착해요.`,
    meterLabel: `TODAY ${Math.min(data.dailyOpenCount, cap)} / ${cap} ISSUED`,
    ctaLabel: '오늘 연 카드 보러 가기',
    footnote: '내일 다시 만나요 · 아침에 새 카드가 발행돼요',
  };
}

/**
 * 잠금 응답에 포함된 비식별 힌트만으로 선택지 카피를 만든다.
 * 이벤트 제목·장소·이미지는 공개 전에 사용하지 않는다.
 */
export function getLockedCardChoice(card: LockedCardPreview, index: number): LockedCardChoice {
  if (getSlotType(card) === 'mystery') {
    return { label: '행선지 미정', description: '어디로든 갈 수 있어요' };
  }
  const category = card.category?.trim() || '문화';
  const reasons = card.reasonTags ?? [];
  const isEndingSoon = Boolean(card.timingLabel?.includes('마감'));
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
