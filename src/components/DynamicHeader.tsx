import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Txt } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';

interface DynamicHeaderProps {
  title: string;
  subtitle?: string;
}

export function DynamicHeader({ title, subtitle }: DynamicHeaderProps) {
  const adaptive = useAdaptive();

  return (
    <View style={styles.container}>
      <Txt typography="h1" fontWeight="bold" color={adaptive.grey900}>
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

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
    backgroundColor: '#F2F4F6',
  },
  subtitle: {
    marginTop: 8,
  },
});
