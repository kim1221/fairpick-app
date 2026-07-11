import type { ImageSourcePropType } from 'react-native';

/* eslint-disable @typescript-eslint/no-require-imports */
const TICKET_SKINS: readonly ImageSourcePropType[] = [
  require('../../assets/images/ticket-skins/ticket-skin-01.jpg'),
  require('../../assets/images/ticket-skins/ticket-skin-03.jpg'),
  require('../../assets/images/ticket-skins/ticket-skin-05.jpg'),
  require('../../assets/images/ticket-skins/ticket-skin-08.jpg'),
  require('../../assets/images/ticket-skins/ticket-skin-09.jpg'),
  require('../../assets/images/ticket-skins/ticket-skin-12.jpg'),
  require('../../assets/images/ticket-skins/ticket-skin-02.jpg'),
  require('../../assets/images/ticket-skins/ticket-skin-04.jpg'),
  require('../../assets/images/ticket-skins/ticket-skin-07.jpg'),
  require('../../assets/images/ticket-skins/ticket-skin-11.jpg'),
  require('../../assets/images/ticket-skins/ticket-skin-06.jpg'),
  require('../../assets/images/ticket-skins/ticket-skin-10.jpg'),
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
