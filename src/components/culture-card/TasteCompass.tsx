import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PersonalizationProfile } from '../../services/cardsService';
import { getPersonalizationCopy } from './homeLogic';

const TEXT = '#171717';
const MUTED = '#656B7B';

export function TasteCompass({ profile }: { profile: PersonalizationProfile }) {
  const copy = getPersonalizationCopy(profile);

  return (
    <View style={styles.section}>
      <View style={styles.topRule} />
      <Text style={styles.sectionIndex}>TASTE / 03</Text>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>EDITOR’S NOTE</Text>
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
    marginTop: 30,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#171717',
  },
  topRule: {
    height: 3,
    backgroundColor: '#171717',
  },
  sectionIndex: {
    marginTop: 7,
    color: '#A52822',
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  content: {
    marginTop: 14,
  },
  eyebrow: {
    color: '#171717',
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 1.6,
  },
  title: {
    marginTop: 6,
    color: TEXT,
    fontSize: 23,
    lineHeight: 30,
    fontWeight: '900',
    letterSpacing: -0.8,
    fontFamily: 'Noto Serif KR',
  },
  description: {
    marginTop: 4,
    color: MUTED,
    fontSize: 12,
    lineHeight: 19,
    fontWeight: '600',
  },
  chips: {
    marginTop: 9,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    borderBottomWidth: 1,
    borderBottomColor: '#A52822',
    paddingHorizontal: 0,
    paddingVertical: 3,
  },
  chipText: {
    color: '#A52822',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
  },
});
