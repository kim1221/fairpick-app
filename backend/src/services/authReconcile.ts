import type { PoolClient } from 'pg';

/**
 * 익명→로그인 화해(2026-07-23, 첫 환전 로그인 게이트).
 *
 * 익명 세션도 실제 users 행(anonymous_id, toss_user_key IS NULL)을 갖고, 카드 열기·티켓 적립을
 * 그 행에 쌓는다. 첫 환전에서 토스 로그인하면 여기서 익명 데이터를 로그인 계정으로 이전한다.
 */

/**
 * 익명 계정(fromId)의 유저 데이터를 로그인 계정(toId)으로 이전한다.
 * 호출 후 caller가 fromId users 행을 삭제한다(잔여 행은 FK CASCADE로 정리 — 반드시 이전이 먼저).
 *
 * ⚠️ 실돈 인접: 티켓만 누적 합산, 나머지는 각 테이블 unique를 회피해 union(대상 기존 행 보존).
 * 익명은 환전 불가라 fromId.total_exchanged=0 → 합산해도 환전 이력 위조 불가.
 */
export async function migrateAnonymousData(
  client: PoolClient,
  fromId: string,
  toId: string,
): Promise<void> {
  // 티켓 잔액·누적: 합산(일일 카운터는 대상 유지 — 병합은 드문 기기간 케이스라 오늘 한도 오차 허용)
  await client.query(
    `INSERT INTO user_tickets (user_id, ticket_count, total_earned, total_exchanged)
     SELECT $2, ticket_count, total_earned, total_exchanged FROM user_tickets WHERE user_id = $1
     ON CONFLICT (user_id) DO UPDATE SET
       ticket_count    = user_tickets.ticket_count + EXCLUDED.ticket_count,
       total_earned    = user_tickets.total_earned + EXCLUDED.total_earned,
       total_exchanged = user_tickets.total_exchanged + EXCLUDED.total_exchanged,
       updated_at      = NOW()`,
    [fromId, toId],
  );

  // 열어본 카드 키 (user_id, key_type, key_value) — 재노출 방지 유지
  await client.query(
    `UPDATE user_card_opened_keys o SET user_id = $2
     WHERE o.user_id = $1 AND NOT EXISTS (
       SELECT 1 FROM user_card_opened_keys x
       WHERE x.user_id = $2 AND x.key_type = o.key_type AND x.key_value = o.key_value)`,
    [fromId, toId],
  );

  // 컬렉션 진행 — 두 unique(set+slot, set+event) 모두 회피
  await client.query(
    `UPDATE user_collection_progress p SET user_id = $2
     WHERE p.user_id = $1
       AND NOT EXISTS (SELECT 1 FROM user_collection_progress a
                        WHERE a.user_id = $2 AND a.set_id = p.set_id AND a.slot_index = p.slot_index)
       AND NOT EXISTS (SELECT 1 FROM user_collection_progress b
                        WHERE b.user_id = $2 AND b.set_id = p.set_id AND b.event_id = p.event_id)`,
    [fromId, toId],
  );

  // 배지 (user_id, badge_key)
  await client.query(
    `UPDATE user_collection_badges g SET user_id = $2
     WHERE g.user_id = $1 AND NOT EXISTS (
       SELECT 1 FROM user_collection_badges x WHERE x.user_id = $2 AND x.badge_key = g.badge_key)`,
    [fromId, toId],
  );

  // 방문 (user_id, event_id)
  await client.query(
    `UPDATE user_visit_log v SET user_id = $2
     WHERE v.user_id = $1 AND NOT EXISTS (
       SELECT 1 FROM user_visit_log x WHERE x.user_id = $2 AND x.event_id = v.event_id)`,
    [fromId, toId],
  );

  // 저장(좋아요) (user_id, event_id)
  await client.query(
    `UPDATE user_likes l SET user_id = $2
     WHERE l.user_id = $1 AND NOT EXISTS (
       SELECT 1 FROM user_likes x WHERE x.user_id = $2 AND x.event_id = l.event_id)`,
    [fromId, toId],
  );

  // 노출 로그 (user_id, event_id) — 소프트 제외 유지
  await client.query(
    `UPDATE user_card_impressions i SET user_id = $2
     WHERE i.user_id = $1 AND NOT EXISTS (
       SELECT 1 FROM user_card_impressions x WHERE x.user_id = $2 AND x.event_id = i.event_id)`,
    [fromId, toId],
  );

  // 출석 (user_id, attend_date)
  await client.query(
    `UPDATE user_attendance_log a SET user_id = $2
     WHERE a.user_id = $1 AND NOT EXISTS (
       SELECT 1 FROM user_attendance_log x WHERE x.user_id = $2 AND x.attend_date = a.attend_date)`,
    [fromId, toId],
  );

  // 주간 보너스 (user_id, week_start)
  await client.query(
    `UPDATE user_weekly_bonus_log w SET user_id = $2
     WHERE w.user_id = $1 AND NOT EXISTS (
       SELECT 1 FROM user_weekly_bonus_log x WHERE x.user_id = $2 AND x.week_start = w.week_start)`,
    [fromId, toId],
  );

  // user 기준 unique 없음 → 통째 이동
  await client.query(`UPDATE user_ticket_earn_log SET user_id = $2 WHERE user_id = $1`, [fromId, toId]);
  await client.query(`UPDATE user_events SET user_id = $2 WHERE user_id = $1`, [fromId, toId]);
}

export type ReconcileLoginInput = {
  tossUserKey: number;
  name: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  anonymousId: string | null;
};

/**
 * 토스 로그인 시 최종 users.id를 결정한다(단일 트랜잭션 안에서 호출).
 * - PROMOTE: 처음 로그인 → 익명 행에 toss_user_key 부여(데이터 이전 0, 가장 흔한 경로).
 * - MERGE: 이미 로그인 계정 존재(기기간) → 익명 데이터 이전 후 익명 행 삭제.
 * - FRESH: 익명 세션 없이 로그인 → 새 행.
 */
export async function reconcileLogin(
  client: PoolClient,
  input: ReconcileLoginInput,
): Promise<string> {
  const { tossUserKey, name, accessToken, refreshToken, expiresAt, anonymousId } = input;

  const anonRow = anonymousId
    ? (
        await client.query<{ id: string }>(
          `SELECT id FROM users WHERE anonymous_id = $1 AND toss_user_key IS NULL`,
          [anonymousId],
        )
      ).rows[0]
    : undefined;
  const tossRow = (
    await client.query<{ id: string }>(`SELECT id FROM users WHERE toss_user_key = $1`, [tossUserKey])
  ).rows[0];

  if (tossRow) {
    const toId = tossRow.id;
    if (anonRow && anonRow.id !== toId) {
      await migrateAnonymousData(client, anonRow.id, toId);
      await client.query(`DELETE FROM users WHERE id = $1`, [anonRow.id]);
    }
    await client.query(
      `UPDATE users
         SET name = COALESCE($2, name),
             toss_access_token = $3, toss_refresh_token = $4, token_expires_at = $5
       WHERE id = $1`,
      [toId, name, accessToken, refreshToken, expiresAt],
    );
    return toId;
  }

  if (anonRow) {
    await client.query(
      `UPDATE users
         SET toss_user_key = $2, name = COALESCE($3, name),
             toss_access_token = $4, toss_refresh_token = $5, token_expires_at = $6
       WHERE id = $1`,
      [anonRow.id, tossUserKey, name, accessToken, refreshToken, expiresAt],
    );
    return anonRow.id;
  }

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO users (toss_user_key, name, toss_access_token, toss_refresh_token, token_expires_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tossUserKey, name, accessToken, refreshToken, expiresAt],
  );
  return rows[0].id;
}
