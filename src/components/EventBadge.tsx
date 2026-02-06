import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface EventBadgeProps {
  type: 'free' | 'hot' | 'ending';
}

export const EventBadge: React.FC<EventBadgeProps> = ({ type }) => {
  const config = {
    free: { icon: '💸', label: '무료', color: '#3182F6' },
    hot: { icon: '🔥', label: 'HOT', color: '#FF4848' },
    ending: { icon: '⏳', label: '마감임박', color: '#FF9500' },
  };
  
  const { icon, label, color } = config[type];
  
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    zIndex: 10,
  },
  icon: {
    fontSize: 12,
    marginRight: 4,
  },
  label: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
