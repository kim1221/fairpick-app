// granite.config.ts
import { appsInToss } from '@apps-in-toss/framework/plugins';
import { defineConfig } from '@granite-js/react-native/config';

const DEFAULT_BRAND_ICON_URL = 'https://static.toss.im/appsintoss/5885/52519384-6920-45d1-80a0-b96f362b04bb.png';
const brandIconUrl = process.env.AIT_BRAND_ICON_URL ?? DEFAULT_BRAND_ICON_URL;

export default defineConfig({
  scheme: 'intoss',
  appName: 'fairpick-app',

  plugins: [
    appsInToss({
      brand: {
        displayName: '컬처카드',
        primaryColor: '#3182F6',
        // 앱인토스 brand.icon은 콘솔에 업로드한 이미지 URL이어야 한다.
        // 원본 자산: src/assets/images/branding/culturecard-app-icon.png
        icon: brandIconUrl,
      },
      permissions: [
        { name: 'geolocation', access: 'access' },
      ],
    }),
  ],
});
