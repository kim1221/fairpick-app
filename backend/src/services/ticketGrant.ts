import type { PoolClient } from 'pg';

export const DAILY_OPEN_LIMIT = 50;
export const DAILY_TICKET_LIMIT = DAILY_OPEN_LIMIT * 3;

export type TicketGrantResult = {
  earned: number;
  ticketCount: number;
  totalEarned: number;
  canExchange: boolean;
  dailyEarned: number;
  dailyLimit: number;
  dailyOpenCount: number;
  dailyOpenLimit: number;
};

export class TicketGrantError extends Error {
  constructor(
    public readonly code:
      | 'EVENT_ALREADY_EARNED_TODAY'
      | 'DAILY_LIMIT_REACHED'
      | 'DAILY_OPEN_LIMIT_REACHED',
    public readonly status: 409 | 429,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

function randomTickets(): number {
  const r = Math.random();
  if (r < 0.50) return 1;
  if (r < 0.85) return 2;
  return 3;
}

/**
 * 열린 컬처카드의 티켓을 현재 트랜잭션 안에서 지급한다.
 * 호출자가 BEGIN/COMMIT/ROLLBACK을 소유해 카드 공개 상태와 원자적으로 묶을 수 있다.
 */
export async function grantTicketsForEvent(
  client: PoolClient,
  input: {
    userId: string;
    eventId: string;
    today: string;
    adAttemptId: string | null;
  },
): Promise<TicketGrantResult> {
  const { userId, eventId, today, adAttemptId } = input;
  const { rows: logRows } = await client.query(
    `INSERT INTO user_ticket_earn_log (user_id, event_id, earn_date, earned, ad_attempt_id)
     VALUES ($1, $2, $3, 0, $4)
     ON CONFLICT (user_id, event_id, earn_date) DO NOTHING
     RETURNING id`,
    [userId, eventId, today, adAttemptId],
  );

  if (logRows.length === 0) {
    throw new TicketGrantError('EVENT_ALREADY_EARNED_TODAY', 409);
  }
  const logId = logRows[0].id;

  await client.query(
    `INSERT INTO user_tickets (user_id, ticket_count, total_earned, total_exchanged)
     VALUES ($1, 0, 0, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
  const { rows: lockRows } = await client.query(
    `SELECT ticket_count, daily_earned, daily_earned_date
     FROM user_tickets WHERE user_id = $1 FOR UPDATE`,
    [userId],
  );
  const row = lockRows[0];
  const { rows: openCountRows } = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM user_ticket_earn_log
     WHERE user_id = $1 AND earn_date = $2::date`,
    [userId, today],
  );
  const dailyOpenCount = Number(openCountRows[0]?.count ?? 0);
  if (dailyOpenCount > DAILY_OPEN_LIMIT) {
    throw new TicketGrantError('DAILY_OPEN_LIMIT_REACHED', 429, {
      dailyOpenCount: dailyOpenCount - 1,
      dailyOpenLimit: DAILY_OPEN_LIMIT,
    });
  }

  const isNewDay = !row.daily_earned_date || String(row.daily_earned_date).slice(0, 10) !== today;
  const currentDailyEarned = isNewDay ? 0 : (row.daily_earned ?? 0);
  const remaining = DAILY_TICKET_LIMIT - currentDailyEarned;

  if (remaining <= 0) {
    throw new TicketGrantError('DAILY_LIMIT_REACHED', 429, {
      dailyLimitReached: true,
      dailyEarned: currentDailyEarned,
      dailyLimit: DAILY_TICKET_LIMIT,
    });
  }

  const earned = Math.min(randomTickets(), remaining);
  const newDailyEarned = currentDailyEarned + earned;
  const { rows: updated } = await client.query(
    `UPDATE user_tickets
     SET ticket_count      = ticket_count + $1,
         total_earned      = total_earned + $1,
         last_earned_at    = NOW(),
         daily_earned      = $2,
         daily_earned_date = $3,
         updated_at        = NOW()
     WHERE user_id = $4
     RETURNING ticket_count, total_earned`,
    [earned, newDailyEarned, today, userId],
  );

  await client.query(
    `UPDATE user_ticket_earn_log
     SET earned = $1,
         ad_attempt_id = COALESCE(ad_attempt_id, $3)
     WHERE id = $2`,
    [earned, logId, adAttemptId],
  );

  if (adAttemptId) {
    await client.query(
      `UPDATE ad_reward_attempts
       SET metadata = metadata || jsonb_build_object(
             'ticketEarned', $1::integer,
             'ticketEarnedAt', NOW()
           ),
           updated_at = NOW()
       WHERE attempt_id = $2 AND user_id = $3`,
      [earned, adAttemptId, userId],
    );
  }

  return {
    earned,
    ticketCount: updated[0].ticket_count,
    totalEarned: updated[0].total_earned,
    canExchange: updated[0].ticket_count >= 10,
    dailyEarned: newDailyEarned,
    dailyLimit: DAILY_TICKET_LIMIT,
    dailyOpenCount,
    dailyOpenLimit: DAILY_OPEN_LIMIT,
  };
}
