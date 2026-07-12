import type { ImageSourcePropType } from 'react-native';
import { API_BASE_URL } from '../../config/api';

const TICKET_SKIN_FILENAMES = [
  'ticket-skin-01.jpg',
  'ticket-skin-03.jpg',
  'ticket-skin-05.jpg',
  'ticket-skin-08.jpg',
  'ticket-skin-09.jpg',
  'ticket-skin-12.jpg',
  'ticket-skin-02.jpg',
  'ticket-skin-04.jpg',
  'ticket-skin-07.jpg',
  'ticket-skin-11.jpg',
  'ticket-skin-06.jpg',
  'ticket-skin-10.jpg',
] as const;

const TICKET_SKINS: readonly ImageSourcePropType[] = TICKET_SKIN_FILENAMES.map((filename) => ({
  uri: `${API_BASE_URL}/assets/culturecard/ticket-skins/${filename}?v=20260713`,
  cache: 'force-cache',
}));

export function stableTicketHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getTicketSkin(cardToken: string): ImageSourcePropType {
  return TICKET_SKINS[stableTicketHash(cardToken) % TICKET_SKINS.length]!;
}

export function getTicketSerial(cardToken: string): string {
  return String(stableTicketHash(cardToken) % 1_000_000).padStart(6, '0');
}
