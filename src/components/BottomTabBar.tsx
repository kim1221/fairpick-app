import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@granite-js/react-native';

interface BottomTabBarProps {
  currentTab: 'home' | 'explore' | 'mypage';
}

export const BottomTabBar: React.FC<BottomTabBarProps> = ({ currentTab }) => {
  const navigation = useNavigation();

  const tabs = [
    { key: 'home' as const, label: '추천', icon: '✨', route: '/' as const },
    { key: 'explore' as const, label: '발견', icon: '🔍', route: '/explore' as const },
    { key: 'mypage' as const, label: 'MY', icon: '👤', route: '/mypage' as const },
  ];

  const handleTabPress = (tab: typeof tabs[number]) => {
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
            <Text style={[styles.icon, isActive && styles.iconActive]}>
              {tab.icon}
            </Text>
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 5,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  icon: {
    fontSize: 26,
    marginBottom: 2,
    opacity: 0.5,
  },
  iconActive: {
    opacity: 1,
  },
  label: {
    fontSize: 11,
    color: '#8B95A1',
    fontWeight: '500',
  },
  labelActive: {
    color: '#3182F6',
    fontWeight: '700',
  },
});

