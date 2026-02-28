import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAdaptive } from '@toss/tds-react-native/private';

type Adaptive = ReturnType<typeof useAdaptive>;

interface SectionHeaderProps {
  icon: string;
  title: string;
  onViewAll?: () => void;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  icon,
  title,
  onViewAll,
}) => {
  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);

  return (
    <View style={styles.container}>
      <View style={styles.titleContainer}>
        <Text style={styles.icon}>{icon}</Text>
        <Text style={styles.title}>{title}</Text>
      </View>

      {onViewAll && (
        <TouchableOpacity onPress={onViewAll} activeOpacity={0.7}>
          <Text style={styles.viewAllText}>전체보기 &gt;</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const createStyles = (a: Adaptive) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    fontSize: 20,
    marginRight: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: a.grey900,
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: a.blue500,
  },
});
