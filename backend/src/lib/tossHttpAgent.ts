/**
 * 앱인토스 파트너 API 공용 mTLS Agent
 *
 * tossAuth.ts / tossMessenger.ts 등 모든 파트너 API 호출에서 공유해요.
 * 서버 시작 시 한 번만 생성돼요.
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

function buildMtlsAgent(): https.Agent | undefined {
  const { certPath, keyPath } = config.toss;
  if (!certPath || !keyPath) {
    if (__DEV__) console.warn('[tossHttpAgent] mTLS 인증서 미설정 — TOSS_CERT_PATH / TOSS_KEY_PATH 확인');
    return undefined;
  }

  // 상대 경로면 backend/ 루트 기준으로 resolve해요
  const backendRoot = path.resolve(__dirname, '../../');
  const resolvedCert = path.isAbsolute(certPath) ? certPath : path.join(backendRoot, certPath);
  const resolvedKey = path.isAbsolute(keyPath) ? keyPath : path.join(backendRoot, keyPath);

  return new https.Agent({
    cert: fs.readFileSync(resolvedCert),
    key: fs.readFileSync(resolvedKey),
  });
}

export const tossHttpAgent = buildMtlsAgent();
