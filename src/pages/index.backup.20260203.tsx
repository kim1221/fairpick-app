import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import eventService from '../services/eventService';
import { EventCardData } from '../data/events';
import { getActiveTuning } from '../config/todayBannerTuning';
import { logTodayBannerClick } from '../utils/analytics';

// Components
import { BottomTabBar } from '../components/BottomTabBar';
import { AICurationBanner } from '../components/AICurationBanner';
import { SectionHeader } from '../components/SectionHeader';
import { RankingCard } from '../components/RankingCard';


export const Route = createRoute('/', {
  component: TodayPage,
});

function TodayPage() {
  const navigation = Route.useNavigation();
  const [hotEvents, setHotEvents] = useState<EventCardData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    try {
      const hot = await eventService.getHotEvents(1, 10);
      setHotEvents(hot.items);
    } catch (error) {
      console.error('[Today] Failed to load events:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleBannerPress = (bannerSnapshot: {
    recommendedEventId?: string;
    recommendedEventTitle?: string;
    recommendedEventDistanceMeters?: number;
    recommendedReasonTags?: string[];
    recommendedScore?: number;
    recommendedBreakdown?: any;
    state: string;
    dongLabel?: string;
    noRecommendationReason?: string;
  }) => {
    console.log('🔵🔵🔵 [Today] Banner clicked - snapshot:', {
      hasRecommendation: !!bannerSnapshot.recommendedEventId,
      recommendedEventId: bannerSnapshot.recommendedEventId,
      recommendedEventTitle: bannerSnapshot.recommendedEventTitle,
      recommendedEventDistanceMeters: bannerSnapshot.recommendedEventDistanceMeters,
      recommendedScore: bannerSnapshot.recommendedScore,
      recommendedReasonTags: bannerSnapshot.recommendedReasonTags,
      noRecommendationReason: bannerSnapshot.noRecommendationReason,
      state: bannerSnapshot.state,
      dongLabel: bannerSnapshot.dongLabel,
      timestamp: new Date().toISOString(),
    });

    // If banner is still loading/refreshing and no recommendation yet, do nothing
    if ((bannerSnapshot.state === 'initial' || bannerSnapshot.state === 'refreshing') && !bannerSnapshot.recommendedEventId) {
      console.log('🟡 [Today] Banner still loading/refreshing, ignoring click');

      // Fire analytics event for ignored click
      try {
        const tuningConfig = getActiveTuning();
        logTodayBannerClick({
          hasRecommendation: !!bannerSnapshot.recommendedEventId,
          noRecommendationReason: bannerSnapshot.noRecommendationReason as 'nearby_empty' | 'guardrails_filtered' | 'low_score' | undefined,
          recommendedEventId: bannerSnapshot.recommendedEventId,
          score: bannerSnapshot.recommendedScore,
          reasonTags: bannerSnapshot.recommendedReasonTags,
          dongLabel: bannerSnapshot.dongLabel,
          radius: tuningConfig.nearbyFetch.radius,
          size: tuningConfig.nearbyFetch.size,
          tuningProfile: __DEV__ ? 'DEV' : 'PROD',
          timestamp: new Date().toISOString(),
          destination: 'ignored_loading',
        });
      } catch (analyticsError) {
        console.warn('[Today] Analytics click (ignored) failed (non-critical):', analyticsError);
      }

      return;
    }

    // Fire click analytics event
    try {
      const tuningConfig = getActiveTuning();
      const destination = bannerSnapshot.recommendedEventId ? 'event_detail' : 'nearby';

      logTodayBannerClick({
        hasRecommendation: !!bannerSnapshot.recommendedEventId,
        noRecommendationReason: bannerSnapshot.noRecommendationReason as 'nearby_empty' | 'guardrails_filtered' | 'low_score' | undefined,
        recommendedEventId: bannerSnapshot.recommendedEventId,
        score: bannerSnapshot.recommendedScore,
        reasonTags: bannerSnapshot.recommendedReasonTags,
        dongLabel: bannerSnapshot.dongLabel,
        radius: tuningConfig.nearbyFetch.radius,
        size: tuningConfig.nearbyFetch.size,
        tuningProfile: __DEV__ ? 'DEV' : 'PROD',
        timestamp: new Date().toISOString(),
        destination,
      });
    } catch (analyticsError) {
      console.warn('[Today] Analytics click failed (non-critical):', analyticsError);
    }

    if (bannerSnapshot.recommendedEventId) {
      // Navigate to recommended event detail with snapshot
      console.log('🔵✅ [Today] Navigating to event detail:', bannerSnapshot.recommendedEventId);

      // Prepare navigation params with snapshot
      // DEV: Full breakdown, Production: Minimal fields
      const navParams: any = {
        id: bannerSnapshot.recommendedEventId,
        referrer: 'today_banner',
      };

      if (__DEV__) {
        // DEV: Include full breakdown
        navParams.bannerSnapshot = {
          recommendedEventId: bannerSnapshot.recommendedEventId,
          recommendedEventTitle: bannerSnapshot.recommendedEventTitle,
          recommendedEventDistanceMeters: bannerSnapshot.recommendedEventDistanceMeters,
          recommendedScore: bannerSnapshot.recommendedScore,
          recommendedReasonTags: bannerSnapshot.recommendedReasonTags,
          recommendedBreakdown: bannerSnapshot.recommendedBreakdown,
          dongLabel: bannerSnapshot.dongLabel,
          state: bannerSnapshot.state,
          timestamp: new Date().toISOString(),
        };
      } else {
        // Production: Minimal fields only
        navParams.bannerSnapshot = {
          recommendedEventId: bannerSnapshot.recommendedEventId,
          recommendedScore: bannerSnapshot.recommendedScore ? Number(bannerSnapshot.recommendedScore.toFixed(2)) : undefined,
          recommendedReasonTags: bannerSnapshot.recommendedReasonTags,
        };
      }

      navigation.navigate('/events/:id', navParams);
    } else {
      // Fallback: Navigate to nearby events page
      console.log('🔵🔀 [Today] No recommendation, navigating to /nearby as fallback');
      if (bannerSnapshot.noRecommendationReason) {
        console.log('🔵 [Today] No recommendation reason:', bannerSnapshot.noRecommendationReason);
      }
      navigation.navigate('/nearby');
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* 헤더 */}
        <View style={styles.header}>
          <Text style={styles.title}>페어픽</Text>
          <Text style={styles.subtitle}>오늘의 재미를 찾아볼까요?</Text>
        </View>

        {/* AI 큐레이션 배너 */}
        <View style={styles.bannerContainer}>
          <AICurationBanner onBannerPress={handleBannerPress} />
        </View>

        {/* HOT 섹션 */}
        <View style={styles.section}>
          <SectionHeader
            icon="🔥"
            title="HOT"
            onViewAll={() => navigation.navigate('/hot')}
          />
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#3182F6" />
            </View>
          ) : (
            <View style={styles.eventList}>
              {hotEvents.slice(0, 5).map((event, index) => (
                <RankingCard
                  key={`${event.id}-${index}`}
                  rank={index + 1}
                  event={event}
                  onPress={() => navigation.navigate('/events/:id', { id: event.id })}
                />
              ))}
            </View>
          )}
        </View>

        {/* 하단 여백 */}
        <View style={{ height: 100 }} />
      </ScrollView>

      <BottomTabBar currentTab="home" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F4F6',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#191F28',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7684',
    fontWeight: '500',
  },
  bannerContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  section: {
    marginTop: 8,
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  eventList: {
    paddingHorizontal: 20,
  },
});
