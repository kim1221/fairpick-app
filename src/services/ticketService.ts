/**
 * 티켓 조각 서비스
 * 광고 시청 → 티켓 조각 → 토스포인트 교환
 *
 * Phase 2: 교환 2-step confirm 구조 + promotionCode 서버 런타임 수신
 */

import http from '../lib/http';
import { grantPromotionReward } from '@apps-in-toss/framework';

export const TICKETS_PER_EXCHANGE = 10;

export interface TicketInfo {
  ticketCount: number;
  totalEarned: number;
  totalExchanged: number;
  ticketsPerExchange: number;
}

export type TicketHistoryItem = {
  type: 'ad' | 'attendance' | 'bonus' | 'exchange' | 'visit' | 'stamp' | string;
  label: string;
  amount: number;
  occurredAt: string;
};

export type TicketHistoryResponse = {
  ticketCount: number;
  totalExchanged: number;
  history: TicketHistoryItem[];
};

export interface TicketConfig {
  promotionCode: string;
  ticketsPerExchange: number;
  dailyLimit: number;
  dailyOpenLimit?: number;
}

export type RewardAdEventType =
  | 'requested'
  | 'show'
  | 'impression'
  | 'clicked'
  | 'userEarnedReward'
  | 'dismissed'
  | 'failedToShow'
  | 'error';

export interface RewardAdEventLogPayload {
  attemptId: string;
  eventType: RewardAdEventType;
  eventId?: string;
  adGroupId: string;
  placement: string;
  eventData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// 메모리 캐시 (앱 세션 내 재사용, Storage 저장 안 함)
let _configCache: TicketConfig | null = null;

// ── 티켓 수 실시간 동기화 ────────────────────────────────────────
// earn 성공 시 notifyTicketCountUpdate를 호출하면 구독자에게 즉시 전달
// Context/이벤트버스 없이 서비스 모듈 레벨에서 완결
type TicketCountListener = (ticketCount: number) => void;
const _ticketListeners = new Set<TicketCountListener>();
let _lastKnownTicketCount: number | null = null;

export function subscribeTicketCount(fn: TicketCountListener): () => void {
  _ticketListeners.add(fn);
  return () => _ticketListeners.delete(fn);
}

export function getLastKnownTicketCount(): number | null {
  return _lastKnownTicketCount;
}

function rememberTicketCount(ticketCount: number) {
  if (!Number.isFinite(ticketCount)) return;
  _lastKnownTicketCount = ticketCount;
  _ticketListeners.forEach((fn) => fn(ticketCount));
}

export async function getTicketConfig(): Promise<TicketConfig> {
  if (_configCache) return _configCache;
  const { data } = await http.get<TicketConfig>('/api/tickets/config');
  _configCache = data;
  return data;
}

export async function getTickets(): Promise<TicketInfo> {
  const { data } = await http.get<TicketInfo>('/api/tickets');
  rememberTicketCount(data.ticketCount);
  return data;
}

export async function getTicketHistory(): Promise<TicketHistoryResponse> {
  const { data } = await http.get<TicketHistoryResponse>('/api/tickets/history');
  rememberTicketCount(data.ticketCount);
  return data;
}

export async function getEarnStatus(eventId: string): Promise<{ earnedToday: boolean }> {
  const { data } = await http.get<{ earnedToday: boolean }>(`/api/tickets/earn-status/${eventId}`);
  return data;
}

export function createRewardAdAttemptId(): string {
  return `reward_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function logRewardAdEvent(payload: RewardAdEventLogPayload): Promise<void> {
  await http.post('/api/tickets/ad-attempt-events', {
    ...payload,
    clientCreatedAt: new Date().toISOString(),
  });
}

export async function earnTickets(eventId: string, adAttemptId?: string): Promise<{
  earned: number;
  ticketCount: number;
  canExchange: boolean;
  dailyEarned: number;
  dailyLimit: number;
  dailyOpenCount?: number;
  dailyOpenLimit?: number;
}> {
  const { data } = await http.post('/api/tickets/earn', { eventId, adAttemptId });
  rememberTicketCount(data.ticketCount);
  return data;
}

/**
 * 교환 2-step:
 * 1. POST /exchange → exchangeId 수신 (티켓 미차감)
 * 2. grantPromotionReward() 성공
 * 3. POST /exchange/confirm → 티켓 차감 확정
 *
 * grantPromotionReward() 실패 시 confirm 미호출 → 티켓 미차감 보장
 */
export async function exchangeTickets(): Promise<{ success: boolean; ticketCount: number; amount: number }> {
  // 교환 직전 서버에서 promotionCode 수신 (하드코딩 없음)
  const { promotionCode } = await getTicketConfig();

  // 1. pending 생성 (티켓 미차감) — 지급 금액은 서버가 추첨해 내려준다(금액 서버권위)
  const { data: exchangeData } = await http.post<{ exchangeId: string; amount?: number }>('/api/tickets/exchange');
  const { exchangeId } = exchangeData;
  const amount = exchangeData.amount ?? 1;

  // 2. 토스 포인트 지급 — "최대 금액" 방식 프로모션은 여기 보낸 amount가 그대로 지급된다
  const result = await grantPromotionReward({
    params: {
      promotionCode,
      amount,
    },
  });

  if (!result) {
    throw new Error('UNSUPPORTED_VERSION');
  }
  if (result === 'ERROR' || 'errorCode' in result) {
    const errCode = typeof result === 'object' && 'errorCode' in result ? result.errorCode : 'ERROR';
    throw new Error(errCode);
  }

  // grantPromotionReward() 결과에서 식별값 추출 (있으면 저장)
  const grantResultKey = typeof result === 'object' && result !== null && 'key' in result
    ? String((result as Record<string, unknown>).key)
    : undefined;

  // 3. 지급 성공 확인 후 confirm (티켓 차감 확정)
  const { data } = await http.post<{ success: boolean; ticketCount: number; amount?: number }>('/api/tickets/exchange/confirm', {
    exchangeId,
    grantResultKey,
  });

  rememberTicketCount(data.ticketCount);
  return { ...data, amount: data.amount ?? amount };
}
