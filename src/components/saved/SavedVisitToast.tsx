import React from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

const INK = '#16161A';
const BRONZE = '#B8924A';
const PAPER = '#F5F1E8';

export type SavedVisitToastMessage = {
  title: string;
  description?: string;
};

interface SavedVisitToastProps {
  message: SavedVisitToastMessage | null;
  opacity: Animated.Value;
}

export function SavedVisitToast({ message, opacity }: SavedVisitToastProps) {
  if (!message) return null;

  return (
    <Animated.View pointerEvents="none" style={[styles.toast, { opacity }]}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>T</Text>
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title}>{message.title}</Text>
        {message.description ? <Text style={styles.description}>{message.description}</Text> : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 104,
    zIndex: 20,
    minHeight: 58,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(22,22,26,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(184,146,74,0.36)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.26,
    shadowRadius: 18,
    elevation: 10,
  },
  badge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: BRONZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: INK,
    fontSize: 16,
    fontWeight: '900',
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: PAPER,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  description: {
    marginTop: 2,
    color: '#C9C0AF',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
});
