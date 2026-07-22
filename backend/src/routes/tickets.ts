/**
 * 티켓 조각 API
 * 광고 시청 → 티켓 1개 적립 → 10개 = 포인트 뽑기(서버 추첨 랜덤 금액) 1회
 *
 * Phase 2 보강:
 * - GET  /config              : 프로모션 코드 등 정책 설정 반환 (requireAuth)
 * - POST /earn                : 구형 지급 경로 종료 (Culture Card open API로 통합)
 * - POST /exchange            : pending 생성 (티켓 미차감, 중복 pending 재사용)
 * - POST /exchange/confirm    : 소유권 검증 → 티켓 차감 → completed (단일 트랜잭션)
 */

import express, { Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/requireAuth';
import {
  DAILY_OPEN_LIMIT,
  DAILY_TICKET_LIMIT,
  drawExchangeAmount,
  EXCHANGE_AMOUNT_TABLE,
} from '../services/ticketGrant';

const router = express.Router();

const TICKETS_PER_EXCHANGE = 10;
/**
 * [정책 확정]
 * DAILY_LIMIT: 오픈 50회 × 티켓 1개 고정 = 50 (KST 자정 기준 리셋)
 * - 광고 fill rate 부족(failedToShow)과 정책 한도 도달은 의미가 다르므로 별도 처리
 * - DAILY_LIMIT_REACHED 응답 시에만 "오늘 티켓을 모두 모았어요" 문구 사용
 * - 광고 없음/오류는 "지금은 광고를 불러올 수 없어요" 문구로 분리
 */
const DAILY_LIMIT = DAILY_TICKET_LIMIT;
// cooldown 없음: 리워드 광고 자체가 자연 속도 제한이며 daily_limit으로 총량 방어
// 이상 징후 발생 시 COOLDOWN_SECONDS = 5~10으로 재도입 가능
const EXCHANGE_EXPIRES_HOURS = 24; // pending 만료 시간

// 클라 정직 표기용 금액 분포 요약(스펙 §2.4·§7 — 평균·범위 중심, 과장 금지). 단일 소스는 추첨 테이블.
const EXCHANGE_AMOUNT_STATS = (() => {
  const amounts = EXCHANGE_AMOUNT_TABLE.map((entry) => entry.amount);
  const totalWeight = EXCHANGE_AMOUNT_TABLE.reduce((sum, entry) => sum + entry.weight, 0);
  const average = EXCHANGE_AMOUNT_TABLE.reduce((sum, entry) => sum + entry.amount * entry.weight, 0) / totalWeight;
  return { min: Math.min(...amounts), max: Math.max(...amounts), average };
})();

const AD_EVENT_TYPES = new Set([
  'requested',
  'show',
  'impression',
  'clicked',
  'userEarnedReward',
  'dismissed',
  'failedToShow',
  'error',
]);

const AD_EVENT_TIMESTAMP_COLUMNS: Record<string, string> = {
  requested: 'requested_at',
  show: 'show_at',
  impression: 'impression_at',
  clicked: 'clicked_at',
  userEarnedReward: 'reward_at',
  dismissed: 'dismissed_at',
  failedToShow: 'failed_to_show_at',
  error: 'error_at',
};

type TicketHistoryRow = {
  type: string;
  label: string;
  amount: number;
  occurred_at: Date;
  paid_amount?: number | null;
};

// KST 오늘 날짜 (DATE 형식)
function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function cleanOptionalString(value: unknown, maxLength = 512): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeClientTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function extractErrorMessage(eventData: Record<string, unknown>): string | null {
  const message = eventData.message ?? eventData.error ?? eventData.reason;
  if (typeof message === 'string') return message.slice(0, 1000);
  return null;
}

// 티켓 레코드 조회 또는 생성
async function getOrCreateTickets(userId: string): Promise<{
  ticket_count: number;
  total_earned: number;
  total_exchanged: number;
}> {
  const { rows } = await pool.query(
    `INSERT INTO user_tickets (user_id, ticket_count, total_earned, total_exchanged)
     VALUES ($1, 0, 0, 0)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
     RETURNING ticket_count, total_earned, total_exchanged`,
    [userId]
  );
  return rows[0];
}

async function queryHistorySource(
  sourceName: string,
  sql: string,
  params: unknown[]
): Promise<TicketHistoryRow[]> {
  try {
    const { rows } = await pool.query<TicketHistoryRow>(sql, params);
    return rows;
  } catch (err) {
    console.warn(`[Tickets] history source skipped: ${sourceName}`, err);
    return [];
  }
}

function compareHistoryDesc(a: TicketHistoryRow, b: TicketHistoryRow): number {
  return new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
}

/**
 * GET /api/tickets/config
 * 클라이언트 정책 설정 반환 (promotionCode 포함)
 * 인증 필요: 프로모션 코드를 미인증 노출하지 않음
 */
router.get('/config', requireAuth, (_req: Request, res: Response) => {
  const promotionCode = process.env.PROMOTION_CODE;
  if (!promotionCode) {
    console.error('[Tickets] PROMOTION_CODE env var not set');
    return res.status(503).json({ error: 'PROMOTION_NOT_CONFIGURED' });
  }
  return res.json({
    promotionCode,
    ticketsPerExchange: TICKETS_PER_EXCHANGE,
    dailyLimit: DAILY_LIMIT,
    dailyOpenLimit: DAILY_OPEN_LIMIT,
    exchangeAmount: EXCHANGE_AMOUNT_STATS,
  });
});

/**
 * GET /api/tickets
 * 현재 티켓 조각 수 조회
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const tickets = await getOrCreateTickets(userId);
  return res.json({
    ticketCount: tickets.ticket_count,
    totalEarned: tickets.total_earned,
    totalExchanged: tickets.total_exchanged,
    ticketsPerExchange: TICKETS_PER_EXCHANGE,
  });
});

/**
 * GET /api/tickets/earn-status/:eventId
 * 오늘 해당 이벤트에서 이미 적립했는지 조회
 */
router.get('/earn-status/:eventId', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { eventId } = req.params;
  const today = todayKst();

  const { rows } = await pool.query(
    `SELECT id FROM user_ticket_earn_log
     WHERE user_id = $1 AND event_id = $2 AND earn_date = $3
     LIMIT 1`,
    [userId, eventId, today]
  );

  return res.json({ earnedToday: rows.length > 0 });
});

/**
 * POST /api/tickets/ad-attempt-events
 * SDK 광고 이벤트를 attempt 단위로 수집한다.
 * 이 로그는 정산 가능한 impression과 실제 ticket grant를 대조하기 위한 관측용이며,
 * 실패해도 클라이언트 보상 흐름을 막지 않는다.
 */
router.post('/ad-attempt-events', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const {
    attemptId,
    eventType,
    eventId,
    adGroupId,
    placement,
    eventData,
    clientCreatedAt,
    metadata,
  } = req.body as {
    attemptId?: unknown;
    eventType?: unknown;
    eventId?: unknown;
    adGroupId?: unknown;
    placement?: unknown;
    eventData?: unknown;
    clientCreatedAt?: unknown;
    metadata?: unknown;
  };

  const normalizedAttemptId = cleanOptionalString(attemptId, 128);
  const normalizedEventType = cleanOptionalString(eventType, 32);
  const normalizedAdGroupId = cleanOptionalString(adGroupId, 128);

  if (!normalizedAttemptId || !normalizedEventType || !AD_EVENT_TYPES.has(normalizedEventType) || !normalizedAdGroupId) {
    return res.status(400).json({ error: 'INVALID_AD_EVENT_PAYLOAD' });
  }

  const normalizedEventId = cleanOptionalString(eventId, 128);
  const normalizedPlacement = cleanOptionalString(placement, 64) ?? 'unknown';
  const normalizedEventData = normalizeJsonObject(eventData);
  const normalizedMetadata = normalizeJsonObject(metadata);
  const normalizedClientCreatedAt = normalizeClientTimestamp(clientCreatedAt);
  const timestampColumn = AD_EVENT_TIMESTAMP_COLUMNS[normalizedEventType];
  const rewardData: Record<string, unknown> = normalizedEventType === 'userEarnedReward' ? normalizedEventData : {};
  const rewardUnitType = cleanOptionalString(rewardData.unitType, 64);
  const rewardUnitAmount = typeof rewardData.unitAmount === 'number' && Number.isFinite(rewardData.unitAmount)
    ? Math.trunc(rewardData.unitAmount)
    : null;
  const errorMessage = normalizedEventType === 'error' ? extractErrorMessage(normalizedEventData) : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const upsertResult = await client.query(
      `INSERT INTO ad_reward_attempts (
         attempt_id,
         user_id,
         event_id,
         ad_group_id,
         placement,
         client_started_at,
         ${timestampColumn},
         reward_unit_type,
         reward_unit_amount,
         error_message,
         last_event_type,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()), NOW(), $7, $8, $9, $10, $11::jsonb)
       ON CONFLICT (attempt_id) DO UPDATE SET
         event_id           = COALESCE(ad_reward_attempts.event_id, EXCLUDED.event_id),
         ad_group_id        = EXCLUDED.ad_group_id,
         placement          = COALESCE(NULLIF(EXCLUDED.placement, 'unknown'), ad_reward_attempts.placement),
         client_started_at  = COALESCE(ad_reward_attempts.client_started_at, EXCLUDED.client_started_at),
         ${timestampColumn} = COALESCE(ad_reward_attempts.${timestampColumn}, EXCLUDED.${timestampColumn}),
         reward_unit_type   = COALESCE(EXCLUDED.reward_unit_type, ad_reward_attempts.reward_unit_type),
         reward_unit_amount = COALESCE(EXCLUDED.reward_unit_amount, ad_reward_attempts.reward_unit_amount),
         error_message      = COALESCE(EXCLUDED.error_message, ad_reward_attempts.error_message),
         last_event_type    = EXCLUDED.last_event_type,
         metadata           = ad_reward_attempts.metadata || EXCLUDED.metadata,
         updated_at         = NOW()
       WHERE ad_reward_attempts.user_id = EXCLUDED.user_id
       RETURNING attempt_id`,
      [
        normalizedAttemptId,
        userId,
        normalizedEventId,
        normalizedAdGroupId,
        normalizedPlacement,
        normalizedClientCreatedAt,
        rewardUnitType,
        rewardUnitAmount,
        errorMessage,
        normalizedEventType,
        JSON.stringify(normalizedMetadata),
      ]
    );

    if (upsertResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'AD_ATTEMPT_OWNED_BY_DIFFERENT_USER' });
    }

    await client.query(
      `INSERT INTO ad_reward_attempt_events (
         attempt_id,
         user_id,
         event_type,
         event_data,
         client_created_at
       )
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)`,
      [
        normalizedAttemptId,
        userId,
        normalizedEventType,
        JSON.stringify(normalizedEventData),
        normalizedClientCreatedAt,
      ]
    );

    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Tickets] ad attempt event log failed:', err);
    return res.status(500).json({ error: 'AD_EVENT_LOG_FAILED' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/tickets/earn
 *
 * eventId만으로 지급을 요청하던 구형 경로는 카드 토큰·광고 보상
 * 검증을 우회할 수 있어 종료했다. 지급은 POST /api/cards/v2/open에서만
 * 카드 공개와 하나의 트랜잭션으로 처리한다.
 */
router.post('/earn', requireAuth, (_req: Request, res: Response) => {
  return res.status(410).json({
    error: 'LEGACY_TICKET_EARN_RETIRED',
    replacement: '/api/cards/v2/open',
  });
});

/**
 * POST /api/tickets/exchange
 * 교환 시도 생성 (티켓 미차감)
 * - 티켓 보유량 사전 확인
 * - 미만료 pending이 있으면 기존 exchangeId 재사용
 */
router.post('/exchange', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const promotionCode = process.env.PROMOTION_CODE;
  if (!promotionCode) {
    return res.status(503).json({ error: 'PROMOTION_NOT_CONFIGURED' });
  }

  // 티켓 보유량 확인
  const { rows: ticketRows } = await pool.query(
    `SELECT ticket_count FROM user_tickets WHERE user_id = $1`,
    [userId]
  );
  if (!ticketRows.length || ticketRows[0].ticket_count < TICKETS_PER_EXCHANGE) {
    return res.status(400).json({ error: 'NOT_ENOUGH_TICKETS' });
  }

  // 시간상 만료된 pending을 먼저 expired로 정리
  // → unique index(user_id WHERE status='pending')의 충돌 원인 사전 제거
  await pool.query(
    `UPDATE user_ticket_exchanges
     SET status = 'expired'
     WHERE user_id = $1 AND status = 'pending' AND expires_at <= NOW()`,
    [userId]
  );

  // 지급액은 서버가 추첨한다(금액 서버권위, 스펙 §2.4).
  // pending에 저장된 amount를 클라가 grantPromotionReward에 그대로 전달한다.
  const drawnAmount = drawExchangeAmount();

  // 원자적 INSERT + ON CONFLICT — 동시 요청 시 DB 레벨에서 pending 중복 생성 차단
  const { rows: inserted } = await pool.query(
    `INSERT INTO user_ticket_exchanges (user_id, promotion_code, amount, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' hours')::INTERVAL)
     ON CONFLICT (user_id) WHERE status = 'pending' DO NOTHING
     RETURNING id, amount`,
    [userId, promotionCode, drawnAmount, String(EXCHANGE_EXPIRES_HOURS)]
  );

  if (inserted.length > 0) {
    console.log(`[Tickets] 🆕 exchange pending: user=${userId} exchangeId=${inserted[0].id} amount=${inserted[0].amount}`);
    return res.json({ exchangeId: inserted[0].id, amount: inserted[0].amount });
  }

  // INSERT 충돌 → 유효한 pending 재사용 (동시 요청의 정상 경로, 이미 추첨된 금액 유지)
  const { rows: existing } = await pool.query(
    `SELECT id, amount FROM user_ticket_exchanges
     WHERE user_id = $1 AND status = 'pending' AND expires_at > NOW()
     LIMIT 1`,
    [userId]
  );
  if (existing.length > 0) {
    console.log(`[Tickets] 🔄 exchange reuse: user=${userId} exchangeId=${existing[0].id} amount=${existing[0].amount}`);
    return res.json({ exchangeId: existing[0].id, amount: existing[0].amount });
  }

  // cleanup 후 INSERT가 충돌 없이 성공해야 하므로 이론상 도달 불가
  console.error(`[Tickets] exchange unexpected state after cleanup: user=${userId}`);
  return res.status(500).json({ error: 'INTERNAL_ERROR' });
});

/**
 * POST /api/tickets/exchange/confirm
 * 교환 확정: 소유권 검증 → 티켓 차감 → completed 업데이트 (단일 트랜잭션)
 * - 이미 completed인 경우 멱등 성공 응답 반환
 */
router.post('/exchange/confirm', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { exchangeId, grantResultKey } = req.body as { exchangeId: string; grantResultKey?: string };

  if (!exchangeId) {
    return res.status(400).json({ error: 'MISSING_EXCHANGE_ID' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // exchange 레코드 잠금 (동시 confirm 직렬화)
    const { rows: exchangeRows } = await client.query(
      `SELECT id, user_id, status, expires_at, amount
       FROM user_ticket_exchanges
       WHERE id = $1
       FOR UPDATE`,
      [exchangeId]
    );

    if (!exchangeRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'EXCHANGE_NOT_FOUND' });
    }

    const ex = exchangeRows[0];

    // 소유권 검증
    if (ex.user_id !== userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    // 멱등 처리: 이미 completed면 성공 응답 그대로 반환
    if (ex.status === 'completed') {
      await client.query('ROLLBACK');
      const { rows: tc } = await client.query(
        `SELECT ticket_count, total_exchanged FROM user_tickets WHERE user_id = $1`,
        [userId]
      );
      console.log(`[Tickets] ✅ exchange already completed (idempotent): user=${userId} exchangeId=${exchangeId}`);
      return res.json({
        success: true,
        ticketCount: tc[0]?.ticket_count ?? 0,
        amount: ex.amount,
        totalExchanged: tc[0]?.total_exchanged ?? 0,
      });
    }

    // 만료 체크
    if (ex.status === 'expired' || new Date(ex.expires_at) <= new Date()) {
      await client.query(
        `UPDATE user_ticket_exchanges SET status = 'expired' WHERE id = $1`,
        [exchangeId]
      );
      await client.query('COMMIT');
      return res.status(409).json({ error: 'EXCHANGE_EXPIRED' });
    }

    // 1. 티켓 차감 (차감 성공 여부 확인 필수)
    const { rowCount: deductedRows } = await client.query(
      `UPDATE user_tickets
       SET ticket_count     = ticket_count - $1,
           total_exchanged  = total_exchanged + 1,
           updated_at       = NOW()
       WHERE user_id = $2 AND ticket_count >= $1`,
      [TICKETS_PER_EXCHANGE, userId]
    );

    // 차감 실패 → 전체 롤백
    if (!deductedRows || deductedRows === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'NOT_ENOUGH_TICKETS' });
    }

    // 2. 차감 성공 확인 후 exchange completed 업데이트
    await client.query(
      `UPDATE user_ticket_exchanges
       SET status           = 'completed',
           confirmed_at     = NOW(),
           grant_result_key = $1
       WHERE id = $2`,
      [grantResultKey ?? null, exchangeId]
    );

    // 최종 티켓 수 조회 (total_exchanged = 이번이 몇 번째 뽑기인지 — 영수증 DRAW Nº)
    const { rows: finalTicket } = await client.query(
      `SELECT ticket_count, total_exchanged FROM user_tickets WHERE user_id = $1`,
      [userId]
    );

    await client.query('COMMIT');

    console.log(`[Tickets] 💰 exchange confirmed: user=${userId} exchangeId=${exchangeId} amount=${ex.amount}`);
    return res.json({
      success: true,
      ticketCount: finalTicket[0]?.ticket_count ?? 0,
      amount: ex.amount,
      totalExchanged: finalTicket[0]?.total_exchanged ?? 0,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Tickets] exchange confirm error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/tickets/history
 * 티켓 적립/사용 내역 (최근 3개월)
 * - 광고 시청, 출석 체크, 주간 보너스, 포인트 교환 통합
 */
router.get('/history', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const tickets = await getOrCreateTickets(userId);

  const historyGroups = await Promise.all([
    queryHistorySource(
      'ad',
      `SELECT 'ad' AS type, '광고 시청' AS label, earned AS amount, created_at AS occurred_at
       FROM user_ticket_earn_log
       WHERE user_id = $1 AND earn_date >= CURRENT_DATE - INTERVAL '3 months'`,
      [userId]
    ),
    queryHistorySource(
      'attendance',
      `SELECT 'attendance' AS type, '출석 체크' AS label, 1 AS amount, created_at AS occurred_at
       FROM user_attendance_log
       WHERE user_id = $1 AND attend_date >= CURRENT_DATE - INTERVAL '3 months'`,
      [userId]
    ),
    queryHistorySource(
      'weekly_bonus',
      `SELECT 'bonus' AS type, '주간 보너스' AS label, bonus_tickets AS amount, granted_at AS occurred_at
       FROM user_weekly_bonus_log
       WHERE user_id = $1 AND bonus_tickets > 0 AND granted_at >= NOW() - INTERVAL '3 months'`,
      [userId]
    ),
    queryHistorySource(
      'visit',
      `SELECT 'visit' AS type, '다녀왔어요 도장' AS label, bonus_tickets AS amount, visited_at AS occurred_at
       FROM user_visit_log
       WHERE user_id = $1 AND bonus_tickets > 0 AND visited_at >= NOW() - INTERVAL '3 months'`,
      [userId]
    ),
    queryHistorySource(
      'exchange',
      `SELECT 'exchange' AS type, '포인트 뽑기' AS label, $2::integer AS amount, confirmed_at AS occurred_at,
              amount AS paid_amount
       FROM user_ticket_exchanges
       WHERE user_id = $1 AND status = 'completed' AND confirmed_at >= NOW() - INTERVAL '3 months'`,
      [userId, -TICKETS_PER_EXCHANGE]
    ),
  ]);
  const history = historyGroups.flat().sort(compareHistoryDesc);

  return res.json({
    ticketCount: tickets.ticket_count,
    totalExchanged: tickets.total_exchanged,
    history: history.map((row) => ({
      type: row.type,
      label: row.label,
      amount: row.amount,
      occurredAt: row.occurred_at,
      // 교환 행에만 존재 — 실지급 원화(연출·통계용, 비권위 표기)
      ...(row.paid_amount != null ? { paidAmount: Number(row.paid_amount) } : {}),
    })),
  });
});

export default router;
