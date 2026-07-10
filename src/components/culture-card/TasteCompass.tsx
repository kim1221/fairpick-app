import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PersonalizationProfile } from '../../services/cardsService';
import { getPersonalizationCopy } from './homeLogic';
import { TAG_TOKENS } from './tagKit';

const SURFACE = '#151A27';
const LINE = 'rgba(117,139,186,0.28)';
const TEXT = TAG_TOKENS.headText;
const MUTED = TAG_TOKENS.navSub;
const GOLD = '#CBA15E';

export function TasteCompass({ profile }: { profile: PersonalizationProfile }) {
  const copy = getPersonalizationCopy(profile);

  return (
    <View style={styles.section}>
      <View style={styles.compass}>
        <View style={styles.compassInner} />
        <Text style={styles.compassMark}>N</Text>
        <Text style={styles.compassStar}>✦</Text>
      </View>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>TASTE COMPASS</Text>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.description}>{copy.description}</Text>
        {profile.topCategories.length > 0 ? (
          <View style={styles.chips}>
            {profile.topCategories.map((item) => (
              <View key={item.category} style={styles.chip}>
                <Text style={styles.chipText}>{item.category}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: 22,
    marginTop: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: SURFACE,
    paddingHorizontal: 16,
    paddingVertical: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  compass: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1.5,
    borderColor: 'rgba(203,161,94,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
  },
  compassInner: {
    position: 'absolute',
    top: 5,
    left: 5,
    right: 5,
    bottom: 5,
    borderRadius: 25,
    borderWidth: 0.7,
    borderColor: 'rgba(203,161,94,0.34)',
  },
  compassMark: {
    position: 'absolute',
    top: 4,
    color: GOLD,
    fontSize: 8,
    fontWeight: '900',
  },
  compassStar: {
    color: GOLD,
    fontSize: 24,
    fontWeight: '900',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: GOLD,
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 1.6,
  },
  title: {
    marginTop: 4,
    color: TEXT,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '900',
  },
  description: {
    marginTop: 4,
    color: MUTED,
    fontSize: 11.5,
    lineHeight: 17,
    fontWeight: '600',
  },
  chips: {
    marginTop: 9,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(203,161,94,0.28)',
    backgroundColor: 'rgba(203,161,94,0.09)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipText: {
    color: '#DDB877',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
  },
});
