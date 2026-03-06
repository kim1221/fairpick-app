import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Loader } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import { useTodayBanner } from '../hooks/useTodayBanner';
import { getBannerDebugEnabled, toggleBannerDebug } from '../utils/storage';
import { getActiveTuning } from '../config/todayBannerTuning';

type Adaptive = ReturnType<typeof useAdaptive>;

interface AICurationBannerProps {
  onBannerPress: (bannerSnapshot: {
    recommendedEventId?: string;
    recommendedEventTitle?: string;
    recommendedEventDistanceMeters?: number;
    recommendedReasonTags?: string[];
    recommendedScore?: number;
    recommendedBreakdown?: any;
    recommendationExplanation?: any;
    copySource?: 'ai' | 'gemini' | 'template' | 'cache';
    state: string;
    dongLabel?: string;
    noRecommendationReason?: string;
  }) => void;
}

export function AICurationBanner({ onBannerPress }: AICurationBannerProps) {
  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);
  const { bannerData, loading, requestPermission } = useTodayBanner();

  // Debug toggle state (DEV only)
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  const tapTimerRef = useRef<number | null>(null);

  // Load debug enabled state from storage
  useEffect(() => {
    if (__DEV__) {
      getBannerDebugEnabled().then(setDebugEnabled);
    }
  }, []);

  // Handle debug toggle (5 taps detection)
  const handleDebugTap = () => {
    if (!__DEV__) return;

    const newTapCount = tapCount + 1;
    setTapCount(newTapCount);

    // Clear existing timer
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
    }

    // Check if 5 taps within 2 seconds
    if (newTapCount >= 5) {
      handleDebugToggle();
      setTapCount(0);
      return;
    }

    // Reset tap count after 2 seconds
    tapTimerRef.current = setTimeout(() => {
      setTapCount(0);
    }, 2000);
  };

  const handleDebugToggle = async () => {
    if (!__DEV__) return;

    const newValue = await toggleBannerDebug();
    setDebugEnabled(newValue);
    console.log('[AICurationBanner] Debug mode toggled:', newValue);

    // Visual feedback
    Alert.alert('Debug Mode', newValue ? 'Debug mode enabled' : 'Debug mode disabled');
  };

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    };
  }, []);

  // 권한 미요청 상태
  if (bannerData.state === 'permission_not_determined') {
    return (
      <View style={styles.banner}>
        <View style={styles.content}>
          <Text style={styles.text}>
            📍 위치를 허용하면 주변 추천이 정확해져요
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={requestPermission}
            activeOpacity={0.7}
          >
            <Text style={styles.buttonText}>위치 허용</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // 권한 거부 상태
  if (bannerData.state === 'permission_denied') {
    return (
      <View style={[styles.banner, styles.bannerWarning]}>
        <View style={styles.content}>
          <Text style={styles.text}>
            ⚠️ 위치 권한이 꺼져 있어요
          </Text>
          <Text style={styles.subtext}>
            지역 기반 추천이 제한됩니다
          </Text>
        </View>
      </View>
    );
  }

  // 에러 상태
  if (bannerData.state === 'error') {
    return (
      <View style={[styles.banner, styles.bannerError]}>
        <View style={styles.content}>
          <Text style={styles.text}>
            {bannerData.text || '주변 이벤트를 불러오는 데 문제가 발생했어요'}
          </Text>
        </View>
      </View>
    );
  }

  // 메인 배너 (cached/refreshing/refreshed)
  const handlePress = () => {
    console.log('[AICurationBanner] onPress fired', {
      hasRecommendation: !!bannerData.context?.recommendedEventId,
      recommendedEventId: bannerData.context?.recommendedEventId,
      state: bannerData.state,
      loading,
    });

    // Debug gesture: 5-tap detection (DEV only)
    if (__DEV__) {
      handleDebugTap();
    }

    // Ignore press if loading or refreshing without recommendation
    if (loading || (bannerData.state === 'refreshing' && !bannerData.context?.recommendedEventId)) {
      console.log('[AICurationBanner] Press ignored - loading or refreshing without recommendation', {
        loading,
        state: bannerData.state,
        hasRecommendation: !!bannerData.context?.recommendedEventId,
      });
      return;
    }

    const snapshot = {
      recommendedEventId: bannerData.context?.recommendedEventId,
      recommendedEventTitle: bannerData.context?.recommendedEventTitle,
      recommendedEventDistanceMeters: bannerData.context?.recommendedEventDistanceMeters,
      recommendedReasonTags: bannerData.context?.recommendedReasonTags,
      recommendedScore: bannerData.context?.recommendedScore,
      recommendedBreakdown: bannerData.context?.recommendedBreakdown,
      recommendationExplanation: bannerData.context?.recommendationExplanation,
      copySource: bannerData.context?.copySource,
      state: bannerData.state,
      dongLabel: bannerData.context?.dongLabel,
      noRecommendationReason: bannerData.context?.noRecommendationReason,
    };
    onBannerPress(snapshot);
  };

  // Show debug info only if debug mode is enabled (DEV only)
  const showDebugInfo = __DEV__ && debugEnabled && bannerData.context;

  // Get tuning config for debug info
  const tuningConfig = __DEV__ ? getActiveTuning() : null;

  return (
    <TouchableOpacity
      style={styles.banner}
      onPress={handlePress}
      activeOpacity={0.7}
      disabled={loading}
    >
      <View style={styles.content}>
        <View style={styles.textContainer}>
          <Text style={styles.text}>{bannerData.text}</Text>
          {bannerData.context?.dongLabel && (
            <Text style={styles.location}>📍 {bannerData.context.dongLabel}</Text>
          )}
          {showDebugInfo && bannerData.context && (
            <View style={styles.debugContainer}>
              {/* AI Copy Source */}
              {bannerData.context.copySource && (
                <Text style={styles.debugInfo}>
                  🤖 Copy: {bannerData.context.copySource}
                  {bannerData.context.copySource === 'gemini' || bannerData.context.copySource === 'cache'
                    ? ' (Gemini 1.5 Flash)'
                    : ' (Template)'}
                </Text>
              )}

              {/* Recommendation Confidence */}
              {bannerData.context.recommendationExplanation && (
                <Text style={styles.debugInfo}>
                  Confidence: {bannerData.context.recommendationExplanation.confidenceLevel}
                </Text>
              )}

              {/* Recommendation info */}
              {bannerData.context.recommendedReasonTags && bannerData.context.recommendedReasonTags.length > 0 && (
                <Text style={styles.debugInfo}>
                  사유: {bannerData.context.recommendedReasonTags.join(' · ')}
                  {bannerData.context.recommendedScore !== undefined &&
                    ` (${bannerData.context.recommendedScore.toFixed(2)})`}
                </Text>
              )}

              {/* No recommendation reason */}
              {bannerData.context.noRecommendationReason && (
                <Text style={styles.debugWarning}>
                  ⚠️ No Rec: {bannerData.context.noRecommendationReason}
                </Text>
              )}

              {/* Min score threshold (for low_score cases) */}
              {bannerData.context.noRecommendationReason === 'low_score' &&
                bannerData.context.recommendedScore !== undefined &&
                tuningConfig && (
                <Text style={styles.debugInfo}>
                  Min: {tuningConfig.minRecommendationScore.toFixed(2)} / Top: {bannerData.context.recommendedScore.toFixed(2)}
                </Text>
              )}

              {/* Debug toggle hint */}
              <Text style={styles.debugHint}>
                (5탭 또는 2초 홀드로 토글)
              </Text>
            </View>
          )}
        </View>
        {loading && (
          <Loader size="small" type="primary" style={styles.loader} />
        )}
        {!loading && (
          <Text style={styles.chevron}>›</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const createStyles = (a: Adaptive) => StyleSheet.create({
  banner: {
    backgroundColor: a.background,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  bannerWarning: {
    backgroundColor: '#FFF9E6',
    borderWidth: 1,
    borderColor: '#FFD233',
  },
  bannerError: {
    backgroundColor: '#FFF0F0',
    borderWidth: 1,
    borderColor: '#FFB3B3',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  textContainer: {
    flex: 1,
  },
  text: {
    fontSize: 15,
    fontWeight: '600',
    color: a.grey900,
    lineHeight: 22,
    marginBottom: 4,
  },
  subtext: {
    fontSize: 13,
    color: a.grey600,
    marginTop: 4,
  },
  location: {
    fontSize: 12,
    color: a.blue500,
    fontWeight: '600',
    marginTop: 2,
  },
  debugContainer: {
    marginTop: 4,
  },
  debugInfo: {
    fontSize: 11,
    color: a.grey500,
    marginTop: 2,
    fontStyle: 'italic',
  },
  debugWarning: {
    fontSize: 10,
    color: '#FF6B00',
    marginTop: 2,
    fontFamily: 'Courier',
    fontWeight: '600',
  },
  debugHint: {
    fontSize: 9,
    color: a.grey400,
    marginTop: 2,
    fontStyle: 'italic',
  },
  button: {
    backgroundColor: a.blue500,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 12,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  loader: {
    marginLeft: 12,
  },
  chevron: {
    fontSize: 24,
    color: a.grey400,
    marginLeft: 8,
  },
});
