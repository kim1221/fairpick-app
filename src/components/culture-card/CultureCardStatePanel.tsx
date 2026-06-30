import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAdaptive } from '@toss/tds-react-native/private';

type Adaptive = ReturnType<typeof useAdaptive>;

interface CultureCardStatePanelProps {
  label: string;
  title: string;
  description: string;
  actionLabel?: string;
  tone?: 'neutral' | 'danger' | 'success' | 'blue';
  onAction?: () => void;
}

function createStyles(a: Adaptive) {
  return StyleSheet.create({
    wrap: {
      marginHorizontal: 22,
      marginTop: 18,
      backgroundColor: '#1D1D22',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: '#2C2C33',
      padding: 22,
      alignItems: 'center',
      gap: 12,
    },
    label: {
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      fontSize: 11,
      fontWeight: '800',
      overflow: 'hidden',
    },
    iconBox: {
      width: 76,
      height: 76,
      borderRadius: 22,
      backgroundColor: a.grey100,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconText: {
      fontSize: 30,
      fontWeight: '900',
      color: a.grey500,
    },
    title: {
      color: '#F2EEE5',
      fontSize: 19,
      fontWeight: '800',
      textAlign: 'center',
    },
    description: {
      color: '#9A968E',
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '500',
      textAlign: 'center',
    },
    button: {
      marginTop: 4,
      width: '100%',
      height: 50,
      borderRadius: 14,
      backgroundColor: '#3182F6',
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryButton: {
      backgroundColor: '#26262C',
      borderWidth: 1,
      borderColor: '#34343C',
    },
    buttonText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '800',
    },
    secondaryButtonText: {
      color: '#F2EEE5',
    },
  });
}

const toneColors = {
  neutral: { backgroundColor: '#F2F4F6', color: '#8B95A1', mark: '-' },
  danger: { backgroundColor: '#FDECEE', color: '#F04452', mark: '!' },
  success: { backgroundColor: 'rgba(184,146,74,0.16)', color: '#B8924A', mark: '+' },
  blue: { backgroundColor: '#EAF2FE', color: '#3182F6', mark: 'T' },
} as const;

export function CultureCardStatePanel({
  label,
  title,
  description,
  actionLabel,
  tone = 'neutral',
  onAction,
}: CultureCardStatePanelProps) {
  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);
  const colors = toneColors[tone];
  const isPrimary = tone === 'danger' || tone === 'blue' || tone === 'success';

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { backgroundColor: colors.backgroundColor, color: colors.color }]}>
        {label}
      </Text>
      <View style={[styles.iconBox, { backgroundColor: colors.backgroundColor }]}>
        <Text style={[styles.iconText, { color: colors.color }]}>{colors.mark}</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {actionLabel && onAction ? (
        <Pressable
          style={[styles.button, !isPrimary && styles.secondaryButton]}
          onPress={onAction}
        >
          <Text style={[styles.buttonText, !isPrimary && styles.secondaryButtonText]}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
