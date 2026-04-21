/**
 * 티켓 조각 API
 * 광고 시청 → 티켓 조각 1~3개 랜덤 적립 → 10개 = 1포인트 교환
 *
 * Phase 2 보강:
 * - GET  /config              : 프로모션 코드 등 정책 설정 반환 (requireAuth)
 * - POST /earn                : cooldown + daily_limit 서버 방어 (단일 트랜잭션)
 * - POST /exchange            : pending 생성 (티켓 미차감, 중복 pending 재사용)
 * - POST /exchange/confirm    : 소유권 검증 → 티켓 차감 → completed (단일 트랜잭션)
 */

import express, { Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/requireAuth';

const router = express.Router();

const TICKETS_PER_EXCHANGE = 10;
/**
 * [정책 확정]
 * DAILY_LIMIT: 유저당 하루 최대 적립 조각 수 (KST 자정 기준 리셋)
 * - 광고 fill rate 부족(failedToShow)과 정책 한도 도달은 의미가 다르므로 별도 처리
 * - DAILY_LIMIT_REACHED 응답 시에만 "오늘 티켓을 모두 모았어요" 문구 사용
 * - 광고 없음/오류는 "지금은 광고를 불러올 수 없어요" 문구로 분리
 *
 * DAILY_LIMIT clamp 정책:
 * - remaining=1일 때 randomTickets()=3이면 1조각 지급 (0장보다 나은 UX)
 * - 광고를 끝까지 본 사용자가 0장 받는 경험을 방지
 * - 정책 상한(30개)은 절대 초과하지 않음
 */
const DAILY_LIMIT = 30;
const COOLDOWN_SECONDS = 30;      // 연속 적립 최소 대기 시간
const EXCHANGE_EXPIRES_HOURS = 24; // pending 만료 시간

// 1~3 랜덤 (50% / 35% / 15%)
function randomTickets(): number {
  const r = Math.random();
  if (r < 0.50) return 1;
  if (r < 0.85) return 2;
  return 3;
}

// KST 오늘 날짜 (DATE 형식)
function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
 * POST /api/tickets/earn
 * 광고 시청 완료 후 티켓 조각 획득
 * - cooldown, daily_limit 검사와 갱신을 단일 트랜잭션으로 처리 (동시 요청 우회 방지)
 */
router.post('/earn', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const today = todayKst();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 레코드 없으면 생성, 있으면 그대로
    await client.query(
      `INSERT INTO user_tickets (user_id, ticket_count, total_earned, total_exchanged)
       VALUES ($1, 0, 0, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    // row lock으로 동시 요청 직렬화 (cooldown/daily_limit 검사와 갱신을 단일 트랜잭션 안에서)
    const { rows: lockRows } = await client.query(
      `SELECT ticket_count, last_earned_at, daily_earned, daily_earned_date
       FROM user_tickets WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    const row = lockRows[0];

    // cooldown 검사
    if (row.last_earned_at) {
      const elapsed = (Date.now() - new Date(row.last_earned_at).getTime()) / 1000;
      if (elapsed < COOLDOWN_SECONDS) {
        await client.query('ROLLBACK');
        const cooldownUntil = new Date(new Date(row.last_earned_at).getTime() + COOLDOWN_SECONDS * 1000);
        return res.status(429).json({
          error: 'COOLDOWN',
          cooldownUntil: cooldownUntil.toISOString(),
          dailyEarned: row.daily_earned,
          dailyLimit: DAILY_LIMIT,
        });
      }
    }

    // daily_limit 검사 (KST 날짜 기준 리셋)
    // pg는 DATE 컬럼을 'YYYY-MM-DD' 문자열로 반환
    const isNewDay = !row.daily_earned_date || String(row.daily_earned_date).slice(0, 10) !== today;
    const currentDailyEarned = isNewDay ? 0 : (row.daily_earned ?? 0);
    const remaining = DAILY_LIMIT - currentDailyEarned;

    if (remaining <= 0) {
      await client.query('ROLLBACK');
      return res.status(429).json({
        error: 'DAILY_LIMIT_REACHED',
        dailyLimitReached: true,
        dailyEarned: currentDailyEarned,
        dailyLimit: DAILY_LIMIT,
      });
    }

    // 남은 한도만큼 clamp — 정책 상한(30개)을 절대 초과하지 않음
    const earned = Math.min(randomTickets(), remaining);
    const newDailyEarned = currentDailyEarned + earned; // 항상 <= DAILY_LIMIT

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
      [earned, newDailyEarned, today, userId]
    );

    await client.query('COMMIT');

    console.log(`[Tickets] 🎟 earn: user=${userId} earned=${earned} daily=${newDailyEarned}/${DAILY_LIMIT}`);

    return res.json({
      earned,
      ticketCount: updated[0].ticket_count,
      totalEarned: updated[0].total_earned,
      canExchange: updated[0].ticket_count >= TICKETS_PER_EXCHANGE,
      dailyEarned: newDailyEarned,
      dailyLimit: DAILY_LIMIT,
      cooldownUntil: new Date(Date.now() + COOLDOWN_SECONDS * 1000).toISOString(),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Tickets] earn error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
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

  // 원자적 INSERT + ON CONFLICT — 동시 요청 시 DB 레벨에서 pending 중복 생성 차단
  const { rows: inserted } = await pool.query(
    `INSERT INTO user_ticket_exchanges (user_id, promotion_code, amount, expires_at)
     VALUES ($1, $2, 1, NOW() + ($3 || ' hours')::INTERVAL)
     ON CONFLICT (user_id) WHERE status = 'pending' DO NOTHING
     RETURNING id`,
    [userId, promotionCode, String(EXCHANGE_EXPIRES_HOURS)]
  );

  if (inserted.length > 0) {
    console.log(`[Tickets] 🆕 exchange pending: user=${userId} exchangeId=${inserted[0].id}`);
    return res.json({ exchangeId: inserted[0].id });
  }

  // INSERT 충돌 → 유효한 pending 재사용 (동시 요청의 정상 경로)
  const { rows: existing } = await pool.query(
    `SELECT id FROM user_ticket_exchanges
     WHERE user_id = $1 AND status = 'pending' AND expires_at > NOW()
     LIMIT 1`,
    [userId]
  );
  if (existing.length > 0) {
    console.log(`[Tickets] 🔄 exchange reuse: user=${userId} exchangeId=${existing[0].id}`);
    return res.json({ exchangeId: existing[0].id });
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
      `SELECT id, user_id, status, expires_at
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
        `SELECT ticket_count FROM user_tickets WHERE user_id = $1`,
        [userId]
      );
      console.log(`[Tickets] ✅ exchange already completed (idempotent): user=${userId} exchangeId=${exchangeId}`);
      return res.json({ success: true, ticketCount: tc[0]?.ticket_count ?? 0 });
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

    // 최종 티켓 수 조회
    const { rows: finalTicket } = await client.query(
      `SELECT ticket_count FROM user_tickets WHERE user_id = $1`,
      [userId]
    );

    await client.query('COMMIT');

    console.log(`[Tickets] 💰 exchange confirmed: user=${userId} exchangeId=${exchangeId}`);
    return res.json({ success: true, ticketCount: finalTicket[0]?.ticket_count ?? 0 });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Tickets] exchange confirm error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

export default router;
