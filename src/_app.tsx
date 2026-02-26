// src/_app.tsx
// TDSProvider는 @apps-in-toss/framework의 registerApp 내부에서 이미 제공됩니다.
// 중복으로 감싸면 "property is not configurable" 에러가 발생합니다.
import React, { PropsWithChildren } from 'react';
import { AppsInToss } from '@apps-in-toss/framework';
import { InitialProps } from '@granite-js/react-native';
import { context } from '../require.context';

function AppContainer({ children }: PropsWithChildren<InitialProps>) {
  return <>{children}</>;
}

export default AppsInToss.registerApp(AppContainer, { context });