import type { PoolClient } from 'pg';
import { upsertEventArchive } from './eventArchive';

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
      | 'EVENT_ALREADY_OPENED'
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

  const { rows: identityRows } = await client.query<{
    content_key: string | null;
    canonical_key: string | null;
  }>(
    `SELECT content_key, canonical_key
     FROM canonical_events
     WHERE id::text = $1
     LIMIT 1
     FOR SHARE`,
    [eventId],
  );
  const contentKey = identityRows[0]?.content_key ?? null;
  const canonicalKey = identityRows[0]?.canonical_key ?? null;

  // Serialize every Culture Card open for one user. This closes the race where
  // two different canonical ids carrying the same content/source key are opened
  // at the same time before either earn-log row becomes visible.
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext('culturecard-open'))`,
    [userId],
  );

  // content_key and canonical_key are intentionally compared across both stable
  // key types. It prevents a collector migration that moves a value between the
  // two columns from making an old card look new.
  const { rows: openedRows } = await client.query(
    `SELECT 1
     FROM user_card_opened_keys
     WHERE user_id = $1
       AND (
         (key_type = 'event_id' AND key_value = $2)
         OR (
           key_type IN ('content_key', 'canonical_key')
           AND key_value = ANY(ARRAY_REMOVE(ARRAY[$3::text, $4::text], NULL))
         )
       )
     LIMIT 1`,
    [userId, eventId, contentKey, canonicalKey],
  );
  if (openedRows.length > 0) {
    throw new TicketGrantError('EVENT_ALREADY_OPENED', 409);
  }

  const { rows: claimedRows } = await client.query<{
    expected_count: number | string;
    inserted_count: number | string;
  }>(
    `WITH aliases(key_type, key_value) AS (
       VALUES
         ('event_id'::text, $2::text),
         ('content_key'::text, $3::text),
         ('canonical_key'::text, $4::text)
     ), valid_aliases AS (
       SELECT DISTINCT key_type, key_value
       FROM aliases
       WHERE key_value IS NOT NULL AND BTRIM(key_value) <> ''
     ), inserted AS (
       INSERT INTO user_card_opened_keys (
         user_id, key_type, key_value, first_event_id, first_opened_at
       )
       SELECT $1, key_type, key_value, $2, NOW()
       FROM valid_aliases
       ON CONFLICT DO NOTHING
       RETURNING key_type, key_value
     )
     SELECT
       (SELECT COUNT(*)::int FROM valid_aliases) AS expected_count,
       (SELECT COUNT(*)::int FROM inserted) AS inserted_count`,
    [userId, eventId, contentKey, canonicalKey],
  );
  const claimed = claimedRows[0];
  if (!claimed || Number(claimed.inserted_count) !== Number(claimed.expected_count)) {
    throw new TicketGrantError('EVENT_ALREADY_OPENED', 409);
  }

  const { rows: logRows } = await client.query(
    `INSERT INTO user_ticket_earn_log (user_id, event_id, earn_date, earned, ad_attempt_id)
     VALUES ($1, $2, $3, 0, $4)
     ON CONFLICT (user_id, event_id, earn_date) DO NOTHING
     RETURNING id`,
    [userId, eventId, today, adAttemptId],
  );

  if (logRows.length === 0) {
    throw new TicketGrantError('EVENT_ALREADY_OPENED', 409);
  }
  const logId = logRows[0].id;

  // Keep the collection record renderable after canonical event cleanup.
  // This shares the caller's transaction with the earn log and ticket grant.
  await upsertEventArchive(client, eventId);

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
