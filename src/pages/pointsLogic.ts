import type { TicketHistoryResponse, TicketInfo } from '../services/ticketService';

export type PointDashboardLoadResult = {
  tickets: TicketInfo | null;
  history: TicketHistoryResponse | null;
  balanceLoadFailed: boolean;
  historyLoadFailed: boolean;
};

export async function loadPointDashboard(
  loadTickets: () => Promise<TicketInfo>,
  loadHistory: () => Promise<TicketHistoryResponse>
): Promise<PointDashboardLoadResult> {
  const [ticketsResult, historyResult] = await Promise.allSettled([
    loadTickets(),
    loadHistory(),
  ]);

  return {
    tickets: ticketsResult.status === 'fulfilled' ? ticketsResult.value : null,
    history: historyResult.status === 'fulfilled' ? historyResult.value : null,
    balanceLoadFailed: ticketsResult.status === 'rejected',
    historyLoadFailed: historyResult.status === 'rejected',
  };
}

export function resolveTicketCount(
  tickets: TicketInfo | null,
  history: TicketHistoryResponse | null,
  lastKnownTicketCount: number | null
): number {
  return tickets?.ticketCount ?? history?.ticketCount ?? lastKnownTicketCount ?? 0;
}
