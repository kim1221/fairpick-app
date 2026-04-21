/**
 * 티켓 조각 API
 * 광고 시청 → 티켓 조각 1~3개 랜덤 적립 → 10개 = 1포인트 교환
 */

import express, { Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/requireAuth';

const router = express.Router();

const TICKETS_PER_EXCHANGE = 10;

// 1~3 랜덤 (50% / 35% / 15%)
function randomTickets(): number {
  const r = Math.random();
  if (r < 0.50) return 1;
  if (r < 0.85) return 2;
  return 3;
}

// 티켓 레코드 조회 또는 생성
async function getOrCreateTickets(userId: string): Promise<{ ticket_count: number; total_earned: number; total_exchanged: number }> {
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
 */
router.post('/earn', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const earned = randomTickets();

  const { rows } = await pool.query(
    `INSERT INTO user_tickets (user_id, ticket_count, total_earned)
     VALUES ($1, $2, $2)
     ON CONFLICT (user_id) DO UPDATE
       SET ticket_count = user_tickets.ticket_count + $2,
           total_earned = user_tickets.total_earned + $2,
           updated_at = NOW()
     RETURNING ticket_count, total_earned`,
    [userId, earned]
  );

  console.log(`[Tickets] 🎟 earn: user=${userId} earned=${earned} total=${rows[0].ticket_count}`);

  return res.json({
    earned,
    ticketCount: rows[0].ticket_count,
    totalEarned: rows[0].total_earned,
    canExchange: rows[0].ticket_count >= TICKETS_PER_EXCHANGE,
  });
});

/**
 * POST /api/tickets/exchange
 * 티켓 10개 차감 (포인트 지급은 프론트에서 grantPromotionReward 호출)
 */
router.post('/exchange', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const { rows } = await pool.query(
    `UPDATE user_tickets
     SET ticket_count = ticket_count - $1,
         total_exchanged = total_exchanged + 1,
         updated_at = NOW()
     WHERE user_id = $2
       AND ticket_count >= $1
     RETURNING ticket_count, total_exchanged`,
    [TICKETS_PER_EXCHANGE, userId]
  );

  if (rows.length === 0) {
    return res.status(400).json({ error: 'NOT_ENOUGH_TICKETS' });
  }

  console.log(`[Tickets] 💰 exchange: user=${userId} remaining=${rows[0].ticket_count}`);

  return res.json({
    success: true,
    ticketCount: rows[0].ticket_count,
    totalExchanged: rows[0].total_exchanged,
  });
});

export default router;
