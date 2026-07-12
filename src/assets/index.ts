// RN 정적 에셋은 require()로 등록한다(metro 번들러 규약).
/* eslint-disable @typescript-eslint/no-require-imports */
export const eventPlaceholder = require('./images/event-placeholder.png');
export const manilaTagTexture = require('./textures/manila-tag-texture.jpg');
export const culturecardAppIcon = require('./images/branding/culturecard-app-icon.png');
export const ticketSkins = [
  require('./images/ticket-skins/ticket-skin-01.jpg'),
  require('./images/ticket-skins/ticket-skin-03.jpg'),
  require('./images/ticket-skins/ticket-skin-05.jpg'),
  require('./images/ticket-skins/ticket-skin-08.jpg'),
  require('./images/ticket-skins/ticket-skin-09.jpg'),
  require('./images/ticket-skins/ticket-skin-12.jpg'),
  require('./images/ticket-skins/ticket-skin-02.jpg'),
  require('./images/ticket-skins/ticket-skin-04.jpg'),
  require('./images/ticket-skins/ticket-skin-07.jpg'),
  require('./images/ticket-skins/ticket-skin-11.jpg'),
  require('./images/ticket-skins/ticket-skin-06.jpg'),
  require('./images/ticket-skins/ticket-skin-10.jpg'),
] as const;
/* eslint-enable @typescript-eslint/no-require-imports */
