import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@granite-js/react-native';
import { Icon } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';

interface BottomTabBarProps {
  currentTab: 'home' | 'passport' | 'points' | 'saved' | 'mypage';
  onHomeTabPress?: () => void; // 홈 탭 진입 시 최상단 스크롤 (다른 탭에서 복귀 포함)
}

// CDN 실존 확인(200): icon-home-mono / icon-stamp-mono / icon-diamond-mono
// 여권=도장북 → 잉크 스탬프 글리프, 포인트=돈 → 시안 마름모와 동일한 다이아몬드.
const TAB_ICONS = {
  home: 'icon-home-mono',
  passport: 'icon-stamp-mono',
  points: 'icon-diamond-mono',
} as const;

type Adaptive = ReturnType<typeof useAdaptive>;

const createStyles = (a: Adaptive) => StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 20,
    left: 24,
    right: 24,
    backgroundColor: a.background,
    flexDirection: 'row',
    borderRadius: 24,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 10,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    gap: 2,
  },
  label: {
    fontSize: 11,
    color: a.grey500,
    fontWeight: '500',
  },
  labelActive: {
    color: a.blue500,
    fontWeight: '700',
  },
});

export const BottomTabBar: React.FC<BottomTabBarProps> = ({ currentTab, onHomeTabPress }) => {
  const navigation = useNavigation();
  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);

  const tabs = [
    { key: 'home' as const, label: '홈', route: '/' as const },
    { key: 'passport' as const, label: '여권', route: '/passport' as const },
    { key: 'points' as const, label: '포인트', route: '/points' as const },
  ];

  const handleTabPress = (tab: typeof tabs[number]) => {
    // 홈 탭: 어디서 진입하든 최상단으로 (다른 탭 복귀 + 현재 탭 재클릭 모두)
    if (tab.key === 'home') onHomeTabPress?.();
    if (tab.key === currentTab) return;
    navigation.navigate(tab.route as never);
  };

  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const isActive = tab.key === currentTab;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tab}
            onPress={() => handleTabPress(tab)}
            activeOpacity={0.7}
          >
            <Icon
              name={TAB_ICONS[tab.key]}
              size={22}
              color={isActive ? adaptive.blue500 : adaptive.grey500}
            />
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};
