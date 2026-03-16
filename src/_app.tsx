// src/_app.tsx
// TDSProvider는 @apps-in-toss/framework의 registerApp 내부에서 이미 제공됩니다.
// 중복으로 감싸면 "property is not configurable" 에러가 발생합니다.
import React, { PropsWithChildren, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { AppsInToss } from '@apps-in-toss/framework';
import { InitialProps } from '@granite-js/react-native';
import { context } from '../require.context';

function AppContainer({ children }: PropsWithChildren<InitialProps>) {
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prev = appState.current;
      appState.current = nextState;

      if (prev !== 'active' && nextState === 'active') {
        // foreground 복귀 시 아무것도 하지 않음.
        // 다음 사용자 액션에서 getOrCreateSessionId()가 30분 초과 여부를 판단함.
        // (lastActivity를 여기서 갱신하면 timeout 계산이 틀어짐)
      }
    });

    return () => subscription.remove();
  }, []);

  return <>{children}</>;
}

export default AppsInToss.registerApp(AppContainer, { context });