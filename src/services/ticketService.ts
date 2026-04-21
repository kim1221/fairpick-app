/**
 * 티켓 조각 서비스
 * 광고 시청 → 티켓 조각 → 토스포인트 교환
 */

import http from '../lib/http';
import { grantPromotionReward } from '@apps-in-toss/framework';

export const TICKETS_PER_EXCHANGE = 10;
export const PROMOTION_CODE = 'TEST_01KPNB09C9BW74TDFA9BR63P3F'; // 테스트 코드 → 승인 후 실제 코드로 교체

export interface TicketInfo {
  ticketCount: number;
  totalEarned: number;
  totalExchanged: number;
  ticketsPerExchange: number;
}

export async function getTickets(): Promise<TicketInfo> {
  const { data } = await http.get<TicketInfo>('/api/tickets');
  return data;
}

export async function earnTickets(): Promise<{ earned: number; ticketCount: number; canExchange: boolean }> {
  const { data } = await http.post('/api/tickets/earn');
  return data;
}

export async function exchangeTickets(): Promise<{ success: boolean; ticketCount: number }> {
  // 1. 백엔드에서 티켓 10개 차감
  const { data } = await http.post('/api/tickets/exchange');

  // 2. 토스 포인트 지급
  const result = await grantPromotionReward({
    params: {
      promotionCode: PROMOTION_CODE,
      amount: 1,
    },
  });

  if (!result) {
    throw new Error('UNSUPPORTED_VERSION');
  }
  if (result === 'ERROR' || 'errorCode' in result) {
    const errCode = typeof result === 'object' && 'errorCode' in result ? result.errorCode : 'ERROR';
    throw new Error(errCode);
  }

  return data;
}
