import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@granite-js/react-native';
import { Icon } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';

interface BottomTabBarProps {
  currentTab: 'home' | 'explore' | 'mypage';
}

const TAB_ICONS = {
  home: 'icon-home-mono',
  explore: 'icon-search-bold-mono',
  mypage: 'icon-user-mono',
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

export const BottomTabBar: React.FC<BottomTabBarProps> = ({ currentTab }) => {
  const navigation = useNavigation();
  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);

  const tabs = [
    { key: 'home' as const, label: '추천', route: '/' as const },
    { key: 'explore' as const, label: '발견', route: '/explore' as const },
    { key: 'mypage' as const, label: 'MY', route: '/mypage' as const },
  ];

  const handleTabPress = (tab: typeof tabs[number]) => {
    if (tab.key === currentTab) return; // 현재 탭 재클릭 → 무시
    navigation.navigate(tab.route);
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
