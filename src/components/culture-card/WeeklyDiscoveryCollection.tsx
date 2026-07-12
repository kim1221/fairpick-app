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
  const moreStories = discovery.items.slice(3, 7);
  const endingSoon = discovery.items.filter((card) => card.dday != null && card.dday >= 0 && card.dday <= 7).slice(0, 3);

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

      {moreStories.length > 0 ? (
        <View style={styles.moreGrid}>
          {moreStories.map((card, index) => (
            <Pressable
              key={`more-${card.eventId}`}
              accessibilityRole="button"
              onPress={() => onPressCard(card.eventId)}
              style={({ pressed }) => [styles.moreStory, pressed ? styles.pressed : null]}
            >
              <StoryImage card={card} compact />
              <Text style={styles.moreIndex}>0{index + 4}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {endingSoon.length > 0 ? (
        <View style={styles.endingSection}>
          <View style={styles.endingHeader}>
            <Text style={styles.endingTitle}>ENDING SOON</Text>
            <Text style={styles.endingCaption}>놓치기 전에 다시 확인하세요</Text>
          </View>
          {endingSoon.map((card) => (
            <Pressable
              key={`ending-${card.eventId}`}
              accessibilityRole="button"
              onPress={() => onPressCard(card.eventId)}
              style={styles.endingRow}
            >
              <Text style={styles.endingDday}>{card.dday === 0 ? 'TODAY' : `D-${card.dday}`}</Text>
              <Text style={styles.endingName} numberOfLines={1}>{card.title}</Text>
              <Text style={styles.endingArrow}>→</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: 22,
    marginTop: 34,
  },
  issueRule: {
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#A52822',
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
    paddingBottom: 4,
    color: '#6F6B65',
    fontSize: 11.5,
    lineHeight: 17,
    fontWeight: '600',
  },
  spread: {
    marginTop: 14,
    height: 350,
    flexDirection: 'row',
    gap: 8,
  },
  featured: {
    flex: 1.42,
    borderRadius: 18,
    overflow: 'hidden',
  },
  secondaryColumn: {
    flex: 1,
    gap: 8,
  },
  secondary: {
    flex: 1,
    minHeight: 0,
    borderRadius: 16,
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
    borderRadius: 16,
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
    borderRadius: 18,
    overflow: 'hidden',
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
  moreGrid: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  moreStory: {
    width: '48.7%',
    height: 138,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  moreIndex: {
    position: 'absolute',
    top: 7,
    right: 8,
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
  },
  endingSection: {
    marginTop: 26,
    padding: 15,
    borderRadius: 18,
    backgroundColor: '#EFE9D8',
  },
  endingHeader: {
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C7C0B4',
  },
  endingTitle: {
    color: '#A52822',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  endingCaption: {
    color: '#6F6B65',
    fontSize: 9.5,
    fontWeight: '700',
  },
  endingRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#BDB7AD',
  },
  endingDday: {
    width: 54,
    color: '#A52822',
    fontSize: 10,
    fontWeight: '900',
  },
  endingName: {
    flex: 1,
    color: '#171717',
    fontSize: 12.5,
    fontWeight: '800',
  },
  endingArrow: {
    color: '#171717',
    fontSize: 15,
  },
  pressed: {
    opacity: 0.78,
  },
});
