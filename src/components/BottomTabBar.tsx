import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';

interface BottomTabBarProps {
  currentTab: 'home' | 'explore' | 'nearby' | 'mypage';
}

export const BottomTabBar: React.FC<BottomTabBarProps> = ({ currentTab }) => {
  const tabs = [
    { key: 'home' as const, label: '홈', icon: '🏠' },
    { key: 'explore' as const, label: '탐색', icon: '🔍' },
    { key: 'nearby' as const, label: '내 주변', icon: '📍' },
    { key: 'mypage' as const, label: '내 활동', icon: '👤' },
  ];
  
  const handleTabPress = (tabKey: string) => {
    if (tabKey !== 'home') {
      Alert.alert('서비스 준비 중입니다', '곧 더 좋은 기능으로 찾아뵙겠습니다 🙏');
    }
  };
  
  return (
    <View style={styles.container}>
      {tabs.map((tab) => (
        <TouchableOpacity
          key={tab.key}
          style={styles.tab}
          onPress={() => handleTabPress(tab.key)}
          activeOpacity={0.7}
        >
          <Text style={styles.icon}>{tab.icon}</Text>
          <Text
            style={[
              styles.label,
              tab.key === currentTab && styles.labelActive,
            ]}
          >
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#E5E8EB',
    paddingVertical: 8,
    paddingBottom: 20, // iOS safe area
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  icon: {
    fontSize: 24,
    marginBottom: 4,
  },
  label: {
    fontSize: 11,
    color: '#8B95A1',
    fontWeight: '600',
  },
  labelActive: {
    color: '#3182F6',
  },
});

