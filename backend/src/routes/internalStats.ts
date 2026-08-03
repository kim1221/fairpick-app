import { Router, type Request, type Response } from 'express';
import { getDailyStats, yesterdayKst } from '../services/dailyStats';

const router = Router();

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 31;

/**
 * 감시 서버(miniapp-watch) 전용 읽기 전용 지표 엔드포인트.
 *
 * 인증이 없으면 우리 지출·유저 규모가 그대로 외부에 노출된다.
 * STATS_TOKEN이 **비어 있을 때도 반드시 401** — "설정 안 됨"을 "인증 불필요"로
 * 흘려보내는 게 이런 엔드포인트가 열리는 전형적인 경로다.
 */
function isAuthorized(req: Request): boolean {
  const expected = process.env.STATS_TOKEN ?? '';
  if (expected === '') return false;
  return req.headers.authorization === `Bearer ${expected}`;
}

/**
 * GET /internal/daily-stats                 → 어제(KST) 단일 객체
 * GET /internal/daily-stats?date=YYYY-MM-DD → 그 날짜 단일 객체
 * GET /internal/daily-stats?days=N (1~31)   → { days: [어제, 그제, ...] } 최신이 먼저
 */
router.get('/daily-stats', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  try {
    const rawDays = req.query.days;
    const days = typeof rawDays === 'string' ? Number.parseInt(rawDays, 10) : NaN;

    // ?days=N — 감시 서버는 메모리가 없어서 "평소 대비 특이사항"을 스스로 못 판단한다.
    // 기준선을 세울 수 있게 최근 며칠을 한 번의 호출로 함께 내준다.
    if (Number.isFinite(days) && days >= 1 && days <= MAX_DAYS) {
      const now = Date.now();
      const dates = Array.from({ length: days }, (_, i) =>
        yesterdayKst(now - i * 24 * 60 * 60 * 1000),
      );
      // 날짜별로 순차 처리한다. 31일치를 한꺼번에 띄우면 pg 풀(max 10)이 말라
      // connectionTimeoutMillis(5s)에 걸린다.
      const result: Awaited<ReturnType<typeof getDailyStats>>[] = [];
      for (const date of dates) {
        result.push(await getDailyStats(date));
      }
      return res.json({ days: result });
    }

    const rawDate = req.query.date;
    const date =
      typeof rawDate === 'string' && DATE_PATTERN.test(rawDate) ? rawDate : yesterdayKst();

    return res.json(await getDailyStats(date));
  } catch (err) {
    console.error('[InternalStats] daily-stats failed:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
