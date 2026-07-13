import React from 'react';
import { Image, ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Card, WeeklyDiscovery } from '../../services/cardsService';
import { getCardNextAction, rankWeeklyActionCards } from './homeLogic';

function HeroActionCard({ card, onPress }: { card: Card; onPress: () => void }) {
  const action = getCardNextAction(card);
  const content = (
    <>
      <View style={styles.heroShade} />
      <View style={styles.heroTop}>
        <View style={styles.actionBadge}>
          <Text style={styles.actionBadgeText}>{action.label}</Text>
        </View>
        <Text style={styles.heroCategory}>{card.category}</Text>
      </View>
      <View style={styles.heroCopy}>
        <Text style={styles.heroDescription}>{action.description}</Text>
        <Text style={styles.heroTitle} numberOfLines={2}>{card.title}</Text>
        <Text style={styles.heroMeta} numberOfLines={1}>
          {[card.region, card.venue].filter(Boolean).join(' · ') || '상세 정보에서 장소를 확인해 보세요'}
        </Text>
        <View style={styles.heroCta}>
          <Text style={styles.heroCtaText}>{action.cta}</Text>
          <Text style={styles.heroCtaArrow}>→</Text>
        </View>
      </View>
    </>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.title}, ${action.cta}`}
      onPress={onPress}
      style={({ pressed }) => [styles.hero, pressed ? styles.pressed : null]}
    >
      {card.imageUrl ? (
        <ImageBackground source={{ uri: card.imageUrl }} style={styles.heroImage} resizeMode="cover">
          {content}
        </ImageBackground>
      ) : (
        <View style={[styles.heroImage, styles.heroFallback]}>{content}</View>
      )}
    </Pressable>
  );
}

function FollowUpCard({ card, onPress }: { card: Card; onPress: () => void }) {
  const action = getCardNextAction(card);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.title}, ${action.cta}`}
      onPress={onPress}
      style={({ pressed }) => [styles.followUp, pressed ? styles.pressed : null]}
    >
      {card.imageUrl ? (
        <Image source={{ uri: card.imageUrl }} style={styles.followUpImage} resizeMode="cover" />
      ) : (
        <View style={[styles.followUpImage, styles.followUpFallback]} />
      )}
      <View style={styles.followUpCopy}>
        <Text style={styles.followUpLabel}>{action.label}</Text>
        <Text style={styles.followUpTitle} numberOfLines={2}>{card.title}</Text>
        <Text style={styles.followUpDescription} numberOfLines={1}>{action.description}</Text>
      </View>
      <Text style={styles.followUpArrow}>→</Text>
    </Pressable>
  );
}

export function WeeklyDiscoveryCollection({
  discovery,
  onPressCard,
  onOpenCollection,
}: {
  discovery: WeeklyDiscovery;
  onPressCard: (eventId: string) => void;
  onOpenCollection: () => void;
}) {
  const actions = rankWeeklyActionCards(discovery.items);
  const featured = actions[0];
  const followUps = actions.slice(1);

  if (!featured) return null;

  return (
    <View style={styles.section}>
      <View style={styles.accent} />
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>NEXT FROM YOUR CARDS</Text>
          <Text style={styles.title}>열어본 문화, 이제 어디로 갈까요?</Text>
        </View>
        <Text style={styles.openedCount}>{discovery.openedCount} OPENED</Text>
      </View>
      <Text style={styles.description}>
        최근 공개한 카드 중 지금 움직이기 좋은 순서로 골랐어요.
      </Text>

      <HeroActionCard card={featured} onPress={() => onPressCard(featured.eventId)} />

      {followUps.length > 0 ? (
        <View style={styles.followUpList}>
          {followUps.map((card) => (
            <FollowUpCard key={card.eventId} card={card} onPress={() => onPressCard(card.eventId)} />
          ))}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="공개한 문화 전체 보기"
        onPress={onOpenCollection}
        style={({ pressed }) => [styles.collectionCta, pressed ? styles.pressed : null]}
      >
        <View>
          <Text style={styles.collectionCtaLabel}>이번 주 {discovery.openedCount}개 공개</Text>
          <Text style={styles.collectionCtaText}>전체 기록은 컬렉션에서 보기</Text>
        </View>
        <Text style={styles.collectionCtaArrow}>→</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: 22,
    marginTop: 34,
    paddingBottom: 6,
  },
  accent: {
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#A52822',
  },
  header: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    color: '#A52822',
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 1.45,
  },
  title: {
    marginTop: 5,
    color: '#171717',
    fontSize: 23,
    lineHeight: 30,
    fontWeight: '900',
    letterSpacing: -0.9,
    fontFamily: 'Noto Serif KR',
  },
  openedCount: {
    marginTop: 1,
    color: '#817B73',
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  description: {
    marginTop: 8,
    color: '#716D66',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  hero: {
    height: 300,
    marginTop: 16,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#423F39',
    shadowColor: '#171717',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 3,
  },
  heroImage: {
    flex: 1,
    justifyContent: 'space-between',
  },
  heroFallback: {
    backgroundColor: '#474139',
  },
  heroShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.36)',
  },
  heroTop: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionBadge: {
    borderRadius: 999,
    backgroundColor: '#A52822',
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  actionBadgeText: {
    color: '#FFFFFF',
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '900',
  },
  heroCategory: {
    color: '#F2D281',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
  },
  heroCopy: {
    padding: 17,
  },
  heroDescription: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '700',
  },
  heroTitle: {
    marginTop: 5,
    color: '#FFFFFF',
    fontSize: 25,
    lineHeight: 32,
    fontWeight: '900',
    letterSpacing: -0.9,
    fontFamily: 'Noto Serif KR',
  },
  heroMeta: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.76)',
    fontSize: 10.5,
    lineHeight: 15,
    fontWeight: '600',
  },
  heroCta: {
    alignSelf: 'flex-start',
    marginTop: 13,
    minHeight: 36,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  heroCtaText: {
    color: '#171717',
    fontSize: 11.5,
    fontWeight: '900',
  },
  heroCtaArrow: {
    color: '#A52822',
    fontSize: 15,
    fontWeight: '800',
  },
  followUpList: {
    marginTop: 12,
    gap: 10,
  },
  followUp: {
    minHeight: 96,
    borderRadius: 18,
    backgroundColor: '#EFE9D8',
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  followUpImage: {
    width: 80,
    height: 80,
    borderRadius: 14,
    backgroundColor: '#B7AFA2',
  },
  followUpFallback: {
    backgroundColor: '#6C5C51',
  },
  followUpCopy: {
    flex: 1,
    minWidth: 0,
  },
  followUpLabel: {
    color: '#A52822',
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: '900',
  },
  followUpTitle: {
    marginTop: 3,
    color: '#171717',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
    fontFamily: 'Noto Serif KR',
  },
  followUpDescription: {
    marginTop: 3,
    color: '#716D66',
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: '600',
  },
  followUpArrow: {
    marginRight: 4,
    color: '#A52822',
    fontSize: 19,
    fontWeight: '700',
  },
  collectionCta: {
    marginTop: 12,
    minHeight: 68,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#DED7CB',
    backgroundColor: '#FBF9F4',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  collectionCtaLabel: {
    color: '#A52822',
    fontSize: 8.5,
    lineHeight: 12,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  collectionCtaText: {
    marginTop: 3,
    color: '#171717',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  collectionCtaArrow: {
    color: '#A52822',
    fontSize: 20,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.78,
  },
});
