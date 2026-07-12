import type { ImageSourcePropType } from 'react-native';
import { ticketSkins } from '../../assets';

export function stableTicketHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getTicketSkin(cardToken: string): ImageSourcePropType {
  return ticketSkins[stableTicketHash(cardToken) % ticketSkins.length]!;
}

export function getTicketSerial(cardToken: string): string {
  return String(stableTicketHash(cardToken) % 1_000_000).padStart(6, '0');
}
