import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAdaptive } from '@toss/tds-react-native/private';

type Adaptive = ReturnType<typeof useAdaptive>;

interface EventBadgeProps {
  type: 'free' | 'hot' | 'ending';
}

export const EventBadge: React.FC<EventBadgeProps> = ({ type }) => {
  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);

  const config = {
    free: { label: '무료', color: adaptive.blue500 },
    hot: { label: 'HOT', color: '#FF4848' },
    ending: { label: '마감임박', color: '#FF9500' },
  };

  const { label, color } = config[type];

  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
};

const createStyles = (_a: Adaptive) => StyleSheet.create({
  badge: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    zIndex: 10,
  },
  label: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
