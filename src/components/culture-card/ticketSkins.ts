import type { ImageSourcePropType } from 'react-native';

/* eslint-disable @typescript-eslint/no-require-imports */
const TICKET_SKINS: readonly ImageSourcePropType[] = [
  require('../../assets/images/ticket-skins/ticket-skin-01.webp'),
  require('../../assets/images/ticket-skins/ticket-skin-03.webp'),
  require('../../assets/images/ticket-skins/ticket-skin-05.webp'),
  require('../../assets/images/ticket-skins/ticket-skin-08.webp'),
  require('../../assets/images/ticket-skins/ticket-skin-09.webp'),
  require('../../assets/images/ticket-skins/ticket-skin-12.webp'),
  require('../../assets/images/ticket-skins/ticket-skin-02.webp'),
  require('../../assets/images/ticket-skins/ticket-skin-04.webp'),
  require('../../assets/images/ticket-skins/ticket-skin-07.webp'),
  require('../../assets/images/ticket-skins/ticket-skin-11.webp'),
  require('../../assets/images/ticket-skins/ticket-skin-06.webp'),
  require('../../assets/images/ticket-skins/ticket-skin-10.webp'),
];
/* eslint-enable @typescript-eslint/no-require-imports */

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

