import React from 'react';
import { ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Card, WeeklyDiscovery } from '../../services/cardsService';

function StoryImage({ card, compact = false }: { card: Card; compact?: boolean }) {
  const content = (
    <>
      <View style={styles.imageShade} />
      <View style={styles.storyCopy}>
        <Text style={styles.storyCategory}>{card.category}</Text>
        <Text style={[styles.storyTitle, compact ? styles.storyTitleCompact : null]} numberOfLines={compact ? 3 : 4}>
          {card.title}
        </Text>
        <Text style={styles.storyMeta} numberOfLines={1}>
          {[card.region, card.venue].filter(Boolean).join(' · ') || '상세 정보 보기'}
        </Text>
      </View>
    </>
  );

  if (!card.imageUrl) {
    return <View style={[styles.storyImage, styles.imageFallback]}>{content}</View>;
  }
  return (
    <ImageBackground source={{ uri: card.imageUrl }} style={styles.storyImage} resizeMode="cover">
      {content}
    </ImageBackground>
  );
}

export function WeeklyDiscoveryCollection({
  discovery,
  onPressCard,
}: {
  discovery: WeeklyDiscovery;
  onPressCard: (eventId: string) => void;
}) {
  const items = discovery.items.slice(0, 4);
  const featured = items[0];
  const secondary = items.slice(1, 3);

  return (
    <View style={styles.section}>
      <View style={styles.issueRule} />
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>OPENED THIS WEEK</Text>
          <Text style={styles.title}>이번 주에 연 카드</Text>
        </View>
        <Text style={styles.issueNo}>ARCHIVE{`\n`}{String(discovery.openedCount).padStart(2, '0')}</Text>
      </View>
      <Text style={styles.description}>
        광고로 공개한 문화만 실립니다. 표지를 누르면 전체 정보를 다시 볼 수 있어요.
      </Text>

      {featured ? (
        <View style={styles.spread}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${featured.title} 다시 보기`}
            onPress={() => onPressCard(featured.eventId)}
            style={({ pressed }) => [styles.featured, pressed ? styles.pressed : null]}
          >
            <StoryImage card={featured} />
          </Pressable>
          <View style={styles.secondaryColumn}>
            {secondary.map((card) => (
              <Pressable
                key={card.eventId}
                accessibilityRole="button"
                accessibilityLabel={`${card.title} 다시 보기`}
                onPress={() => onPressCard(card.eventId)}
                style={({ pressed }) => [styles.secondary, pressed ? styles.pressed : null]}
              >
                <StoryImage card={card} compact />
              </Pressable>
            ))}
            {secondary.length < 2 ? (
              <View style={styles.archiveNote}>
                <Text style={styles.archiveNoteMark}>+</Text>
                <Text style={styles.archiveNoteText}>카드를 열수록{`\n`}이번 주 지면이 채워져요</Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : (
        <View style={styles.emptySpread}>
          <Text style={styles.emptyIndex}>01</Text>
          <View style={styles.emptyCopy}>
            <Text style={styles.emptyTitle}>첫 번째 기사를 기다리고 있어요</Text>
            <Text style={styles.emptyDescription}>위에서 카드를 열면 실제 이미지와 행사가 이곳에 실려요.</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: 22,
    marginTop: 34,
  },
  issueRule: {
    height: 3,
    backgroundColor: '#171717',
  },
  header: {
    paddingTop: 9,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  eyebrow: {
    color: '#A52822',
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  title: {
    marginTop: 4,
    color: '#171717',
    fontSize: 25,
    lineHeight: 32,
    fontWeight: '900',
    letterSpacing: -0.9,
    fontFamily: 'Noto Serif KR',
  },
  issueNo: {
    color: '#171717',
    fontSize: 9,
    lineHeight: 12,
    textAlign: 'right',
    fontWeight: '900',
    letterSpacing: 1,
  },
  description: {
    marginTop: 8,
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#171717',
    color: '#6F6B65',
    fontSize: 11.5,
    lineHeight: 17,
    fontWeight: '600',
  },
  spread: {
    marginTop: 10,
    height: 350,
    flexDirection: 'row',
    gap: 8,
  },
  featured: {
    flex: 1.42,
    borderWidth: 1,
    borderColor: '#171717',
    overflow: 'hidden',
  },
  secondaryColumn: {
    flex: 1,
    gap: 8,
  },
  secondary: {
    flex: 1,
    minHeight: 0,
    borderWidth: 1,
    borderColor: '#171717',
    overflow: 'hidden',
  },
  storyImage: {
    flex: 1,
    backgroundColor: '#6B665F',
    justifyContent: 'flex-end',
  },
  imageFallback: {
    backgroundColor: '#70211F',
  },
  imageShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  storyCopy: {
    padding: 12,
  },
  storyCategory: {
    color: '#F1C761',
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  storyTitle: {
    marginTop: 4,
    color: '#FFFFFF',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '900',
    letterSpacing: -0.8,
    fontFamily: 'Noto Serif KR',
  },
  storyTitleCompact: {
    fontSize: 14,
    lineHeight: 19,
    letterSpacing: -0.4,
  },
  storyMeta: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.78)',
    fontSize: 8.5,
    lineHeight: 12,
    fontWeight: '700',
  },
  archiveNote: {
    flex: 1,
    minHeight: 0,
    borderWidth: 1,
    borderColor: '#171717',
    backgroundColor: '#EFE9D8',
    padding: 12,
    justifyContent: 'space-between',
  },
  archiveNoteMark: {
    color: '#A52822',
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '500',
  },
  archiveNoteText: {
    color: '#171717',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
  },
  emptySpread: {
    marginTop: 10,
    minHeight: 150,
    borderWidth: 1,
    borderColor: '#171717',
    backgroundColor: '#EFE9D8',
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  emptyIndex: {
    width: 64,
    paddingTop: 16,
    backgroundColor: '#A52822',
    color: '#F5EDDA',
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '900',
  },
  emptyCopy: {
    flex: 1,
    padding: 17,
    justifyContent: 'center',
  },
  emptyTitle: {
    color: '#171717',
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '900',
    fontFamily: 'Noto Serif KR',
  },
  emptyDescription: {
    marginTop: 6,
    color: '#6F6B65',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.78,
  },
});
