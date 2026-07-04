import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface CultureCardStatePanelProps {
  label: string;
  title: string;
  description: string;
  actionLabel?: string;
  tone?: 'neutral' | 'danger' | 'success' | 'blue';
  onAction?: () => void;
}

// 워엄 다크 · 마닐라 토큰(컬처카드 태그 방향)
const MANILA = '#D9C7A0';
const INK = '#2C2A22';
const WARM_TEXT = '#EDE6D6';
const WARM_SUB = '#9A8F77';
const WARM_SURFACE = '#1A140D';
const WARM_LINE = '#4A3F2C';

function createStyles() {
  return StyleSheet.create({
    wrap: {
      marginHorizontal: 22,
      marginTop: 18,
      backgroundColor: WARM_SURFACE,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: WARM_LINE,
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
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconText: {
      fontSize: 30,
      fontWeight: '900',
    },
    title: {
      color: WARM_TEXT,
      fontSize: 19,
      fontWeight: '800',
      textAlign: 'center',
    },
    description: {
      color: WARM_SUB,
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
      backgroundColor: MANILA,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryButton: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: WARM_LINE,
    },
    buttonText: {
      color: INK,
      fontSize: 15,
      fontWeight: '800',
    },
    secondaryButtonText: {
      color: WARM_TEXT,
    },
  });
}

const toneColors = {
  neutral: { backgroundColor: 'rgba(217,199,160,0.14)', color: '#C9B688', mark: '-' },
  danger: { backgroundColor: 'rgba(168,51,31,0.18)', color: '#C9614B', mark: '!' },
  success: { backgroundColor: 'rgba(217,199,160,0.18)', color: MANILA, mark: '+' },
  blue: { backgroundColor: 'rgba(217,199,160,0.18)', color: MANILA, mark: 'T' },
} as const;

export function CultureCardStatePanel({
  label,
  title,
  description,
  actionLabel,
  tone = 'neutral',
  onAction,
}: CultureCardStatePanelProps) {
  const styles = React.useMemo(() => createStyles(), []);
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
