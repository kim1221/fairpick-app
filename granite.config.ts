// granite.config.ts
import { appsInToss } from '@apps-in-toss/framework/plugins';
import { defineConfig } from '@granite-js/react-native/config';

export default defineConfig({
  scheme: 'intoss',
  appName: 'fairpick-app',

  plugins: [
    appsInToss({
      brand: {
        displayName: '페어픽',
        primaryColor: '#3182F6',
        icon: 'https://firebasestorage.googleapis.com/v0/b/fairpick-128f1.firebasestorage.app/o/fairpick-icon.png?alt=media&token=6b04cd89-766e-4877-9b8d-06b88a6113ce',
      },
      permissions: [],
    }),
  ],
});
