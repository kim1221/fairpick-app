/**
 * UUID v5 (SHA-1 namespace) — Node.js crypto 내장 구현
 *
 * uuid 패키지가 v10부터 ESM-only로 변경되어 CommonJS 환경에서
 * require() 오류가 발생합니다. RFC 4122 표준에 따라 직접 구현합니다.
 * 기존 uuid 패키지의 v5()와 동일한 결과를 생성합니다.
 */

import crypto from 'crypto';

export function uuidv5(name: string, namespace: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const nameBytes = Buffer.from(name, 'utf-8');

  const hash = crypto.createHash('sha1');
  hash.update(nsBytes);
  hash.update(nameBytes);
  const bytes = hash.digest();

  // Version 5 (SHA-1)
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  // Variant DCE 1.1
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
