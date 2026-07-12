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
    bottom: 10,
    left: 12,
    right: 12,
    backgroundColor: a.background,
    flexDirection: 'row',
    borderRadius: 22,
    paddingTop: 7,
    paddingBottom: 9,
    paddingHorizontal: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#DDD7CC',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
    gap: 2,
    borderRadius: 16,
  },
  tabActive: {
    backgroundColor: 'rgba(165,40,34,0.08)',
  },
  label: {
    fontSize: 11,
    color: a.grey500,
    fontWeight: '500',
  },
  labelActive: {
    color: '#A52822',
    fontWeight: '700',
  },
});

export const BottomTabBar: React.FC<BottomTabBarProps> = ({ currentTab, onHomeTabPress }) => {
  const navigation = useNavigation();
  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);

  const tabs = [
    { key: 'home' as const, label: '오늘', route: '/' as const },
    { key: 'passport' as const, label: '컬렉션', route: '/passport' as const },
    { key: 'points' as const, label: '리워드', route: '/points' as const },
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
            style={[styles.tab, isActive ? styles.tabActive : null]}
            onPress={() => handleTabPress(tab)}
            activeOpacity={0.7}
          >
            <Icon
              name={TAB_ICONS[tab.key]}
              size={22}
              color={isActive ? '#A52822' : adaptive.grey500}
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
