import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useAdaptive } from '@toss/tds-react-native/private';

type Adaptive = ReturnType<typeof useAdaptive>;

export const PromoBanner: React.FC = () => {
  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);

  const handlePress = () => {
    Alert.alert('준비 중', '프로모션 상세 페이지는 곧 추가될 예정입니다.');
  };

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={handlePress}
      activeOpacity={0.8}
    >
      {/* 좌측 아이콘 */}
      <View style={styles.iconContainer}>
        <Text style={styles.icon}>🎫</Text>
      </View>

      {/* 중앙 텍스트 */}
      <View style={styles.textContainer}>
        <Text style={styles.title}>페어픽 추천 프로모션</Text>
        <Text style={styles.subtitle}>이번 주 특별한 이벤트를 놓치지 마세요</Text>
      </View>

      {/* 우측 화살표 */}
      <Text style={styles.arrow}>&gt;</Text>
    </TouchableOpacity>
  );
};

const createStyles = (a: Adaptive) => StyleSheet.create({
  container: {
    backgroundColor: a.background,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    marginVertical: 20,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  iconContainer: {
    width: 56,
    height: 56,
    backgroundColor: a.grey100,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  icon: {
    fontSize: 28,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: a.grey900,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: a.grey600,
    lineHeight: 18,
  },
  arrow: {
    fontSize: 18,
    color: a.grey400,
  },
});
