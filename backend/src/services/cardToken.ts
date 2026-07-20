import crypto from 'crypto';
import { config } from '../config';

export type CardSlotType = 'category' | 'mystery';

export type LockedCardTokenPayload = {
  userId: string;
  eventId: string;
  assignedOn: string;
  walkMinutes: number | null;
  reasonTags: string[];
  /** "?" 미스터리 슬롯 여부(스펙 §3.2). 과거 발급 토큰에는 없다 — 없으면 'category'로 해석한다. */
  slotType?: CardSlotType;
};

const VERSION = 'v1';

function key(): Buffer {
  return crypto.createHash('sha256').update(process.env.CARD_TOKEN_SECRET || config.jwtSecret).digest();
}

export function sealLockedCard(payload: LockedCardTokenPayload): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), encrypted.toString('base64url'), tag.toString('base64url')].join('.');
}

export function openLockedCard(token: string): LockedCardTokenPayload | null {
  try {
    const [version, ivPart, encryptedPart, tagPart] = token.split('.');
    if (version !== VERSION || !ivPart || !encryptedPart || !tagPart) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(decrypted) as Partial<LockedCardTokenPayload>;
    if (
      typeof payload.userId !== 'string'
      || typeof payload.eventId !== 'string'
      || typeof payload.assignedOn !== 'string'
      || !Array.isArray(payload.reasonTags)
      // slotType은 선택 필드(하위호환) — 존재한다면 알려진 값이어야 한다.
      || (payload.slotType != null && payload.slotType !== 'category' && payload.slotType !== 'mystery')
    ) return null;
    return payload as LockedCardTokenPayload;
  } catch {
    return null;
  }
}
