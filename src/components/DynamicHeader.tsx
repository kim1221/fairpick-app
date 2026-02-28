import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Txt } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';

type Adaptive = ReturnType<typeof useAdaptive>;

interface DynamicHeaderProps {
  title: string;
  subtitle?: string;
}

export function DynamicHeader({ title, subtitle }: DynamicHeaderProps) {
  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);

  return (
    <View style={styles.container}>
      <Txt typography="t2" fontWeight="bold" color={adaptive.grey900}>
        {title}
      </Txt>
      {subtitle && (
        <Txt typography="t5" color={adaptive.grey600} style={styles.subtitle}>
          {subtitle}
        </Txt>
      )}
    </View>
  );
}

const createStyles = (a: Adaptive) => StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
    backgroundColor: a.grey100,
  },
  subtitle: {
    marginTop: 8,
  },
});
