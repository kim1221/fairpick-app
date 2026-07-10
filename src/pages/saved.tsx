import { createRoute } from '@granite-js/react-native';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Loader } from '@toss/tds-react-native';
import { TAG_TOKENS } from '../components/culture-card/tagKit';

/**
 * 저장 탭은 문화 여권의 "가고 싶어요" 세그로 흡수됐어요.
 * 기존 /saved 진입(딥링크·잔여 네비게이션)은 여권으로 안전하게 넘겨요.
 * 라우트 자체는 남겨 두어 링크가 깨지지 않게 해요.
 */
export const Route = createRoute('/saved', {
  component: SavedRedirectPage,
});

const BG = TAG_TOKENS.bg;

function SavedRedirectPage() {
  const navigation = Route.useNavigation();

  useEffect(() => {
    // 마운트 즉시 여권(가고 싶어요)으로 이동해요.
    navigation.navigate('/passport' as never);
  }, [navigation]);

  return (
    <View style={styles.container}>
      <Loader />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default SavedRedirectPage;
