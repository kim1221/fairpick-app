// src/_app.tsx
import React, { PropsWithChildren } from 'react';
import { AppsInToss } from '@apps-in-toss/framework';
import { InitialProps } from '@granite-js/react-native';
import { context } from '../require.context';
import { TDSProvider } from '@toss/tds-react-native';
// (선택) 안전한 노치/홈인디케이터 처리를 원하면 SafeAreaProvider도 같이 사용
// import { SafeAreaProvider } from 'react-native-safe-area-context';

function AppContainer({ children }: PropsWithChildren<InitialProps>) {
  return (
    <TDSProvider>
      {/* <SafeAreaProvider> */}
        {children}
      {/* </SafeAreaProvider> */}
    </TDSProvider>
  );
}

export default AppsInToss.registerApp(AppContainer, { context });