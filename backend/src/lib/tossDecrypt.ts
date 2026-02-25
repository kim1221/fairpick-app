/**
 * 토스 로그인 개인정보 복호화
 *
 * 암호화 스펙: AES-256-GCM
 * 포맷: base64(IV[12bytes] + Ciphertext + AuthTag[16bytes])
 * 복호화 키와 AAD는 앱인토스 콘솔에서 이메일로 받아요.
 */

import crypto from 'crypto';
import { config } from '../config';

const IV_LENGTH = 12;       // AES-GCM 표준 nonce
const AUTH_TAG_LENGTH = 16; // GCM 인증 태그

/**
 * 암호화된 토스 사용자 정보를 복호화해요.
 * @param encryptedValue - base64 인코딩된 암호문 (IV + Ciphertext + AuthTag)
 * @returns 복호화된 평문 문자열. 키가 설정 안 됐거나 실패하면 null.
 */
export function decryptTossValue(encryptedValue: string | null | undefined): string | null {
  if (!encryptedValue) return null;

  const { decryptKey, decryptAad } = config.toss;
  if (!decryptKey || !decryptAad) {
    if (__DEV__) console.warn('[tossDecrypt] TOSS_DECRYPT_KEY 또는 TOSS_DECRYPT_AAD 미설정');
    return null;
  }

  try {
    const keyBuffer = Buffer.from(decryptKey, 'base64');
    const encryptedBuffer = Buffer.from(encryptedValue, 'base64');

    const iv = encryptedBuffer.subarray(0, IV_LENGTH);
    const authTag = encryptedBuffer.subarray(encryptedBuffer.length - AUTH_TAG_LENGTH);
    const ciphertext = encryptedBuffer.subarray(IV_LENGTH, encryptedBuffer.length - AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
    decipher.setAAD(Buffer.from(decryptAad));
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (err) {
    if (__DEV__) console.error('[tossDecrypt] 복호화 실패:', err);
    return null;
  }
}
