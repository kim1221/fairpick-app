import { describe, expect, test } from '@jest/globals';
import { loadPointDashboard, resolveTicketCount } from '../pointsLogic';

describe('points logic', () => {
  test('keeps ticket balance when history loading fails', async () => {
    const result = await loadPointDashboard(
      async () => ({
        ticketCount: 12,
        totalEarned: 20,
        totalExchanged: 0,
        ticketsPerExchange: 10,
      }),
      async () => {
        throw new Error('history failed');
      }
    );

    expect(result.tickets?.ticketCount).toBe(12);
    expect(result.history).toBeNull();
    expect(result.balanceLoadFailed).toBe(false);
    expect(result.historyLoadFailed).toBe(true);
  });

  test('uses the last known ticket count when dashboard calls have no balance', () => {
    expect(resolveTicketCount(null, null, 102)).toBe(102);
  });
});
