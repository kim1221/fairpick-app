/**
 * 앱인토스 메신저 API 래퍼
 *
 * 모든 메시지는 콘솔에서 사전 승인된 템플릿만 발송 가능해요.
 * 템플릿 코드는 환경변수(TOSS_TEMPLATE_*)로 관리해요.
 *
 * POST /api-partner/v1/apps-in-toss/messenger/send-message
 * POST /api-partner/v1/apps-in-toss/messenger/send-test-message
 */

import axios from 'axios';
import { config } from '../config';
import { tossHttpAgent } from './tossHttpAgent';

const BASE = config.toss.apiBaseUrl;

type TossResultType = 'SUCCESS' | 'HTTP_TIMEOUT' | 'NETWORK_ERROR' | 'EXECUTION_FAIL' | 'INTERRUPTED' | 'INTERNAL_ERROR' | 'FAIL';

interface MessengerResponse {
  resultType: TossResultType;
  success?: {
    channels?: Array<{
      channel: string;
      sentCount: number;
      successMessages?: unknown[];
      failMessages?: unknown[];
    }>;
  };
  error?: { code: string; message: string };
}

// ─── 실제 메시지 발송 ────────────────────────────────────────────────────────

/**
 * 토스 사용자에게 메시지를 발송해요.
 * 사전에 콘솔에서 승인된 templateSetCode만 사용 가능해요.
 *
 * @param tossUserKey - users.toss_user_key (bigint)
 * @param templateSetCode - 콘솔에서 승인된 템플릿 코드
 * @param context - 템플릿 변수 ({ eventTitle, daysLeft, ... })
 */
export async function sendMessage(
  tossUserKey: number,
  templateSetCode: string,
  context: Record<string, string>
): Promise<void> {
  const { data } = await axios.post<MessengerResponse>(
    `${BASE}/api-partner/v1/apps-in-toss/messenger/send-message`,
    { templateSetCode, context },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Toss-User-Key': String(tossUserKey),
      },
      httpsAgent: tossHttpAgent,
    }
  );

  if (data.resultType !== 'SUCCESS') {
    throw new Error(`[tossMessenger] 발송 실패: ${data.error?.message ?? data.resultType}`);
  }
}

// ─── 테스트 메시지 발송 ──────────────────────────────────────────────────────

/**
 * 테스트 메시지 발송 (심사 전 번들 동작 확인용)
 *
 * @param tossUserKey - users.toss_user_key (bigint)
 * @param templateSetCode - 콘솔에서 승인된 템플릿 코드
 * @param deploymentId - 콘솔 앱 출시 메뉴의 번들 UUID
 * @param context - 템플릿 변수
 */
export async function sendTestMessage(
  tossUserKey: number,
  templateSetCode: string,
  deploymentId: string,
  context: Record<string, string>
): Promise<void> {
  const { data } = await axios.post<MessengerResponse>(
    `${BASE}/api-partner/v1/apps-in-toss/messenger/send-test-message`,
    { templateSetCode, deploymentId, context },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Toss-User-Key': String(tossUserKey),
      },
      httpsAgent: tossHttpAgent,
    }
  );

  if (data.resultType !== 'SUCCESS') {
    throw new Error(`[tossMessenger] 테스트 발송 실패: ${data.error?.message ?? data.resultType}`);
  }
}
