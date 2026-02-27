/**
 * 찜한 이벤트 종료 D-3 알림 발송 Job
 *
 * 매일 09:00 KST에 실행돼요.
 * 오늘로부터 DAYS_BEFORE_END일 후 종료되는 이벤트를 찜한 유저에게 알림을 보내요.
 *
 * Mock 모드: TOSS_TEMPLATE_END_SOON 미설정 시 실제 발송 없이 콘솔 로그만 출력해요.
 * 실제 발송: 콘솔에서 템플릿 승인 후 TOSS_TEMPLATE_END_SOON 값 설정 시 활성화돼요.
 */

import { pool } from '../db';
import { sendMessage } from '../lib/tossMessenger';
import crypto from 'crypto';

const DAYS_BEFORE_END = 3;

interface NotificationTarget {
  toss_user_key: number;
  event_title: string;
  event_id: string;
}

export async function sendEndSoonNotifications(): Promise<void> {
  const templateCode = process.env.TOSS_TEMPLATE_END_SOON;
  const isMock = !templateCode;

  if (isMock) {
    console.log('[sendEndSoon] MOCK 모드 (TOSS_TEMPLATE_END_SOON 미설정) — 실제 발송 안 함');
  }

  // 오늘 이미 성공적으로 발송했으면 중복 실행 방지
  const alreadyRan = await pool.query(`
    SELECT id FROM collection_logs
    WHERE type = 'end_soon_notifications'
      AND status = 'success'
      AND started_at::date = CURRENT_DATE
    LIMIT 1
  `);
  if (alreadyRan.rowCount! > 0) {
    console.log('[sendEndSoon] 오늘 이미 발송 완료 — 중복 실행 방지');
    return;
  }

  const logId = crypto.randomUUID();
  const startTime = new Date();
  await pool.query(
    `INSERT INTO collection_logs (id, source, type, status, started_at, items_count, success_count, failed_count)
     VALUES ($1, 'system', 'end_soon_notifications', 'running', $2, 0, 0, 0)`,
    [logId, startTime]
  ).catch((err) => console.error('[sendEndSoon] collection_logs 기록 실패:', err.message));

  // D-3에 종료되는 이벤트를 찜한 로그인 유저 조회
  const { rows } = await pool.query<NotificationTarget>(
    `SELECT u.toss_user_key, e.title AS event_title, e.id AS event_id
     FROM user_likes ul
     JOIN users u ON u.id = ul.user_id
     JOIN canonical_events e ON e.id = ul.event_id
     WHERE e.end_at::date = (CURRENT_DATE + ($1::int * INTERVAL '1 day'))::date
       AND u.toss_user_key IS NOT NULL`,
    [DAYS_BEFORE_END]
  );

  if (rows.length === 0) {
    console.log('[sendEndSoon] 발송 대상 없음');
    return;
  }

  console.log(`[sendEndSoon] 발송 대상: ${rows.length}건`);

  let successCount = 0;
  let failCount = 0;

  for (const target of rows) {
    if (isMock) {
      console.log(
        `[sendEndSoon][MOCK] userKey=${target.toss_user_key} event="${target.event_title}" (D-${DAYS_BEFORE_END})`
      );
      successCount++;
      continue;
    }

    try {
      await sendMessage(target.toss_user_key, templateCode, {
        eventTitle: target.event_title,
        eventId: target.event_id,
        daysLeft: String(DAYS_BEFORE_END),
      });
      successCount++;
    } catch (err: any) {
      console.error(`[sendEndSoon] 발송 실패 userKey=${target.toss_user_key}:`, err.message);
      failCount++;
    }
  }

  console.log(`[sendEndSoon] 완료 — 성공: ${successCount}, 실패: ${failCount}`);

  await pool.query(
    `UPDATE collection_logs
     SET status = 'success', completed_at = NOW(), items_count = $1, success_count = $2, failed_count = $3
     WHERE id = $4`,
    [rows.length, successCount, failCount, logId]
  ).catch(() => {});
}
