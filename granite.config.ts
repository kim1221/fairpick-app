// granite.config.ts
import { appsInToss } from '@apps-in-toss/framework/plugins';
import { defineConfig } from '@granite-js/react-native/config';

export default defineConfig({
  scheme: 'intoss',
  appName: 'fairpick-app',

  plugins: [
    appsInToss({
      brand: {
        displayName: '컬처카드',
        primaryColor: '#3182F6',
        icon: '',
      },
      permissions: [
        { name: 'geolocation', access: 'access' },
      ],
    }),
  ],
});
