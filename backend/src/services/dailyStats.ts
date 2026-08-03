import { pool } from '../db';

/**
 * 하루치 운영 지표 — 감시 서버(miniapp-watch)의 일일 리포트용 읽기 전용 집계.
 *
 * 감시 서버에 우리 DB 자격증명을 주면 그 서버 하나가 뚫릴 때 앱 DB 전체가 열린다.
 * 그래서 키를 넘기는 대신 "집계 결과만" 계산해서 넘긴다.
 * 이 모듈은 SELECT만 한다 — 어떤 경로로도 쓰기를 하지 않는다.
 */
export type DailyStats = {
  /** KST 기준 'YYYY-MM-DD'. */
  date: string;
  /** 그날 실제로 유저에게 나간 돈(교환 완료 합계, 원). */
  spentWon: number;
  users: { new: number; active: number };
  /** 앱 고유 행동 지표. 컬처 카드는 카드/광고/컬렉션. */
  actions: Record<string, number>;
  exchanges: { count: number; won: number; failed: number };
};

/** ms 타임스탬프를 KST 기준 'YYYY-MM-DD'로. */
export function kstDateOf(ms: number): string {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 어제(KST) — 감시 서버 기본 조회 구간. */
export function yesterdayKst(now: number = Date.now()): string {
  return kstDateOf(now - 24 * 60 * 60 * 1000);
}

function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * KST 하루치 지표를 집계한다.
 *
 * 경계는 [00:00:00+09:00, 다음날 00:00:00+09:00) 반개구간으로 잡는다.
 * (`23:59:59.999`로 닫으면 그 사이 마이크로초 행을 놓친다.)
 * earn_date·attend_date는 이미 KST DATE라 그대로 비교한다.
 */
export async function getDailyStats(kstDate: string): Promise<DailyStats> {
  const start = `${kstDate}T00:00:00+09:00`;
  const end = `${kstDateOf(Date.parse(`${kstDate}T00:00:00+09:00`) + 24 * 60 * 60 * 1000)}T00:00:00+09:00`;

  const [exchangeRes, newUserRes, activityRes, adRes, badgeRes] = await Promise.all([
    // 교환 — 나간 돈은 confirmed_at(실제 지급 시각) 기준, 실패는 created_at(시도 시각) 기준.
    // 만료 스윕은 다음 /exchange 호출 때 게으르게 일어나므로, 아직 'pending'으로
    // 남아 있지만 만료 시각이 지난 행도 실패로 센다(안 그러면 실패가 과소 집계된다).
    pool.query(
      `SELECT
         COUNT(*) FILTER (
           WHERE status = 'completed'
             AND confirmed_at >= $1::timestamptz AND confirmed_at < $2::timestamptz
         )::int AS completed_count,
         COALESCE(SUM(amount) FILTER (
           WHERE status = 'completed'
             AND confirmed_at >= $1::timestamptz AND confirmed_at < $2::timestamptz
         ), 0)::int AS won,
         COUNT(*) FILTER (
           WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
             AND (status = 'expired' OR (status = 'pending' AND expires_at <= NOW()))
         )::int AS failed_count
       FROM user_ticket_exchanges
       WHERE (confirmed_at >= $1::timestamptz AND confirmed_at < $2::timestamptz)
          OR (created_at >= $1::timestamptz AND created_at < $2::timestamptz)`,
      [start, end],
    ),

    // 신규 유저 — 익명 세션도 users 행을 만들므로 익명 유입까지 잡힌다.
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM users
       WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz`,
      [start, end],
    ),

    // 활성 유저 + 카드 열기.
    // 덮어쓰기 테이블(user_daily_card_slots·user_card_impressions)은 과거 날짜를 못 재현하므로
    // append-only 로그만 쓴다: 카드 열기 / 광고 시도 / 출석.
    pool.query(
      `WITH opens AS (
         SELECT user_id FROM user_ticket_earn_log WHERE earn_date = $3::date
       ), ads AS (
         SELECT user_id FROM ad_reward_attempts
         WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
       ), attend AS (
         SELECT user_id FROM user_attendance_log WHERE attend_date = $3::date
       )
       SELECT
         (SELECT COUNT(*)::int FROM opens) AS cards_opened,
         (SELECT COUNT(*)::int FROM (
            SELECT user_id FROM opens
            UNION SELECT user_id FROM ads
            UNION SELECT user_id FROM attend
          ) AS u) AS active_users`,
      [start, end, kstDate],
    ),

    // 광고 — 보상 완료는 수익 원천, 실패(failedToShow/error)는 "광고가 안 떠서
    // 유저가 갇힌" 사고를 하루 단위로 조기에 드러낸다.
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE event_type = 'userEarnedReward')::int AS rewarded,
         COUNT(*) FILTER (WHERE event_type IN ('failedToShow', 'error'))::int AS failures
       FROM ad_reward_attempt_events
       WHERE event_type IN ('userEarnedReward', 'failedToShow', 'error')
         AND created_at >= $1::timestamptz AND created_at < $2::timestamptz`,
      [start, end],
    ),

    // 컬렉션 세트 완성 배지 — 리텐션 루프가 살아 있는지 보는 지표(실돈 아님).
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM user_collection_badges
       WHERE awarded_at >= $1::timestamptz AND awarded_at < $2::timestamptz`,
      [start, end],
    ),
  ]);

  const exchange = exchangeRes.rows[0] ?? {};
  const activity = activityRes.rows[0] ?? {};
  const ads = adRes.rows[0] ?? {};

  const completedCount = toInt(exchange.completed_count);
  const won = toInt(exchange.won);

  return {
    date: kstDate,
    spentWon: won,
    users: {
      new: toInt(newUserRes.rows[0]?.count),
      active: toInt(activity.active_users),
    },
    actions: {
      cardsOpened: toInt(activity.cards_opened),
      adsRewarded: toInt(ads.rewarded),
      adFailures: toInt(ads.failures),
      collectionBadges: toInt(badgeRes.rows[0]?.count),
    },
    exchanges: {
      count: completedCount,
      won,
      failed: toInt(exchange.failed_count),
    },
  };
}
