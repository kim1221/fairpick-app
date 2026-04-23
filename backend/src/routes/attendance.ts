/**
 * 출석체크 API
 *
 * POST /api/attendance/checkin
 *   - 하루 1회 자동 출석 + 티켓 1장 지급
 *   - 이번 주 월~일 7일 완주 시 해당 주 광고 적립 티켓의 10% 추가 보너스 (최대 10장)
 *
 * GET /api/attendance/status
 *   - 이번 주 출석 현황, 예상 보너스, 완주 가능 여부 반환
 */

import express, { Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/requireAuth';

const router = express.Router();

const DAILY_TICKET = 1;
const BONUS_RATE = 0.1;
const BONUS_CAP = 10;

/** KST 기준 오늘 날짜 (YYYY-MM-DD) */
function todayKst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * KST 기준 이번 주 월요일 날짜 (YYYY-MM-DD)
 * 일요일(0)→ 6일 전, 월(1)→ 0일 전, ..., 토(6)→ 5일 전
 */
function weekStartKst(): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const dow = kst.getUTCDay(); // 0=일, 1=월 ... 6=토
  const daysBack = dow === 0 ? 6 : dow - 1;
  kst.setUTCDate(kst.getUTCDate() - daysBack);
  return kst.toISOString().slice(0, 10);
}

/** 이번 주 7개 날짜 배열 [월, 화, ..., 일] */
function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

// ─────────────────────────────────────────
// POST /checkin
// ─────────────────────────────────────────
router.post('/checkin', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const today = todayKst();
  const wStart = weekStartKst();
  const dates = weekDates(wStart);      // ['YYYY-MM-DD', ...] 7개

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ① 오늘 출석 INSERT (중복 방지 게이트)
    const insertLog = await client.query(
      `INSERT INTO user_attendance_log (user_id, attend_date)
       VALUES ($1, $2)
       ON CONFLICT (user_id, attend_date) DO NOTHING
       RETURNING id`,
      [userId, today],
    );

    if (insertLog.rowCount === 0) {
      // 이미 오늘 체크인 완료
      await client.query('COMMIT');

      // 현재 잔액만 조회해서 반환
      const { rows } = await client.query(
        `SELECT COALESCE(ticket_count, 0) AS ticket_count
         FROM user_tickets WHERE user_id = $1`,
        [userId],
      );
      return res.json({
        alreadyCheckedIn: true,
        dailyTicketGranted: 0,
        ticketCount: rows[0]?.ticket_count ?? 0,
      });
    }

    // ② 일일 티켓 1장 지급
    const ticketRow = await client.query(
      `INSERT INTO user_tickets (user_id, ticket_count, total_earned, total_exchanged)
       VALUES ($1, $2, $2, 0)
       ON CONFLICT (user_id) DO UPDATE
         SET ticket_count  = user_tickets.ticket_count  + $2,
             total_earned  = user_tickets.total_earned  + $2,
             updated_at    = NOW()
       RETURNING ticket_count`,
      [userId, DAILY_TICKET],
    );
    const ticketCount: number = ticketRow.rows[0].ticket_count;

    // ③ 이번 주 7일 완주 여부 판정 (7개 날짜 명시 비교)
    const completionCheck = await client.query(
      `SELECT COUNT(DISTINCT attend_date)::int AS cnt
       FROM user_attendance_log
       WHERE user_id = $1
         AND attend_date = ANY($2::date[])`,
      [userId, dates],
    );
    const isWeekComplete = completionCheck.rows[0].cnt === 7;

    let weeklyBonus: { bonusTickets: number; adTickets: number; capped: boolean } | undefined;

    if (isWeekComplete) {
      // ④ 주간 보너스 중복 방지 INSERT
      const bonusInsert = await client.query(
        `INSERT INTO user_weekly_bonus_log (user_id, week_start, ad_tickets, bonus_tickets, capped)
         VALUES ($1, $2, 0, 0, false)
         ON CONFLICT (user_id, week_start) DO NOTHING
         RETURNING id`,
        [userId, wStart],
      );

      if (bonusInsert.rowCount! > 0) {
        // ⑤ 해당 주 광고 적립 집계
        const adRow = await client.query(
          `SELECT COALESCE(SUM(earned), 0)::int AS ad_tickets
           FROM user_ticket_earn_log
           WHERE user_id = $1
             AND earn_date = ANY($2::date[])`,
          [userId, dates],
        );
        const adTickets: number = adRow.rows[0].ad_tickets;
        const rawBonus = Math.floor(adTickets * BONUS_RATE);
        const bonusTickets = Math.min(rawBonus, BONUS_CAP);
        const capped = rawBonus > BONUS_CAP;

        // ⑥ 보너스 티켓 지급
        if (bonusTickets > 0) {
          await client.query(
            `UPDATE user_tickets
             SET ticket_count = ticket_count + $1,
                 total_earned = total_earned + $1,
                 updated_at   = NOW()
             WHERE user_id = $2`,
            [bonusTickets, userId],
          );
        }

        // ⑦ 보너스 로그 업데이트
        await client.query(
          `UPDATE user_weekly_bonus_log
           SET ad_tickets = $1, bonus_tickets = $2, capped = $3
           WHERE user_id = $4 AND week_start = $5`,
          [adTickets, bonusTickets, capped, userId, wStart],
        );

        weeklyBonus = { bonusTickets, adTickets, capped };
      }
    }

    await client.query('COMMIT');

    // 보너스 지급 후 최종 잔액
    const finalTicketCount = weeklyBonus?.bonusTickets
      ? ticketCount + weeklyBonus.bonusTickets
      : ticketCount;

    return res.json({
      alreadyCheckedIn: false,
      dailyTicketGranted: DAILY_TICKET,
      ticketCount: finalTicketCount,
      weeklyBonus,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[attendance/checkin]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────
// GET /status
// ─────────────────────────────────────────
router.get('/status', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const today = todayKst();
  const wStart = weekStartKst();
  const dates = weekDates(wStart);

  try {
    // 이번 주 출석 날짜 목록
    const { rows: logRows } = await pool.query(
      `SELECT attend_date::text
       FROM user_attendance_log
       WHERE user_id = $1
         AND attend_date = ANY($2::date[])
       ORDER BY attend_date`,
      [userId, dates],
    );
    const attendedDates: string[] = logRows.map((r: any) => r.attend_date);
    const attendedCount = attendedDates.length;
    const todayCheckedIn = attendedDates.includes(today);

    // 이번 주 광고 적립 집계
    const { rows: adRows } = await pool.query(
      `SELECT COALESCE(SUM(earned), 0)::int AS ad_tickets
       FROM user_ticket_earn_log
       WHERE user_id = $1
         AND earn_date = ANY($2::date[])`,
      [userId, dates],
    );
    const adTickets: number = adRows[0].ad_tickets;
    const expectedBonus = Math.min(Math.floor(adTickets * BONUS_RATE), BONUS_CAP);

    // 이번 주 보너스 이미 지급됐는지
    const { rows: bonusRows } = await pool.query(
      `SELECT bonus_tickets FROM user_weekly_bonus_log
       WHERE user_id = $1 AND week_start = $2`,
      [userId, wStart],
    );
    const weeklyBonusGranted = bonusRows.length > 0;

    // 완주 가능 여부: 오늘 이전에 빠진 날이 없어야 함
    const missedPastDays = dates
      .filter(d => d < today)
      .filter(d => !attendedDates.includes(d));
    const canCompleteWeek = missedPastDays.length === 0;

    const daysRemaining = 7 - attendedCount;

    return res.json({
      todayCheckedIn,
      weekStart: wStart,
      weekDates: dates,
      attendedDates,
      attendedCount,
      adTickets,
      expectedBonus,
      weeklyBonusGranted,
      canCompleteWeek,
      daysRemaining,
    });
  } catch (err) {
    console.error('[attendance/status]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
