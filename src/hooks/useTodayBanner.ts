import { useState, useEffect } from 'react';
import { Accuracy, getCurrentLocation, GetCurrentLocationPermissionError } from '@apps-in-toss/framework';
import { Storage } from '@apps-in-toss/framework';
import http from '../lib/http';
import eventService from '../services/eventService';
import { scoreTodayRecommendations, ScoreBreakdown, applyGuardrails } from '../utils/todayRecommendationScore';
import { getPreferences, getBannerHistory, saveBannerHistory, clearAiCopyCache } from '../utils/storage';
import { getActiveTuning } from '../config/todayBannerTuning';
import { logTodayBannerImpression } from '../utils/analytics';
import { explainRecommendation, type RecommendationExplanation } from '../utils/recommendationExplanation';
import { generateBannerCopyHybrid } from '../utils/bannerCopyGeneration';

// Banner state types
type BannerState =
  | 'initial'
  | 'cached'
  | 'refreshing'
  | 'refreshed'
  | 'permission_not_determined'
  | 'permission_denied'
  | 'error';

interface BannerContext {
  dong: string;
  lat: number;
  lng: number;
  dongLabel: string;
  generatedAt: string;
  // Recommended event info
  recommendedEventId?: string;
  recommendedEventTitle?: string;
  recommendedEventDistanceMeters?: number;
  // Score-based recommendation info
  recommendedReasonTags?: string[];
  recommendedScore?: number;
  recommendedBreakdown?: ScoreBreakdown;
  // Recommendation explanation (for Gemini)
  recommendationExplanation?: RecommendationExplanation;
  // AI copy generation info
  copySource?: 'gemini' | 'template' | 'cache';
  // 추천 실패 이유 (없으면 추천 성공)
  noRecommendationReason?: 'nearby_empty' | 'guardrails_filtered' | 'low_score';
}

// 배너 스냅샷 (이벤트 상세로 전달용)
export interface BannerSnapshot {
  referrer: 'today_banner';
  recommendedEventId?: string;
  recommendedEventTitle?: string;
  recommendedEventDistanceMeters?: number;
  recommendedScore?: number;
  recommendedBreakdown?: ScoreBreakdown;
  recommendedReasonTags?: string[];
  dongLabel?: string;
  state: BannerState;
  timestamp: string;
}

interface BannerData {
  state: BannerState;
  text: string;
  context?: BannerContext;
}

interface ReverseGeocodeResponse {
  gu: string;
  dong: string;
  label: string;
}

// Cache structure (V1)
interface BannerCacheV1 {
  version: 1;
  date: string; // YYYY-MM-DD
  dong: string;
  text: string;
  context: BannerContext;
  generatedAt: string;
  expiresAt: string;
  // 추천 실패 이유 (디버그용)
  noRecommendationReason?: 'nearby_empty' | 'guardrails_filtered' | 'low_score';
}

const CACHE_KEY = 'fairpick_today_banner_v1';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const CACHE_TTL_MS_NO_RECOMMENDATION = 1 * 60 * 60 * 1000; // 1 hour (shorter for empty recommendations)

// DEV: Force cache invalidation on every mount
const FORCE_CACHE_REFRESH_DEV = true; // Set to true to debug cache issues - ENABLED FOR DEBUGGING

export function useTodayBanner() {
  const [bannerData, setBannerData] = useState<BannerData>({
    state: 'initial',
    text: '',
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    initializeBanner();
  }, []);

  const initializeBanner = async () => {
    console.log('[TodayBanner][DEBUG] initializeBanner started');

    // DEV: Force cache invalidation if enabled
    if (__DEV__ && FORCE_CACHE_REFRESH_DEV) {
      console.log('[TodayBanner][DEBUG] FORCE_CACHE_REFRESH_DEV enabled, clearing all caches');
      // Clear TodayBanner cache
      await Storage.removeItem(CACHE_KEY);
      // Clear AI copy cache as well
      await clearAiCopyCache();
      console.log('[TodayBanner][DEBUG] All caches cleared (banner + AI copy)');
    }

    // 1. Check permission first
    try {
      const permission = await getCurrentLocation.getPermission();

      if (permission === 'denied') {
        setBannerData({
          state: 'permission_denied',
          text: '위치 권한이 꺼져 있어요',
        });
        return;
      }

      if (permission === 'notDetermined') {
        setBannerData({
          state: 'permission_not_determined',
          text: '위치를 허용하면 주변 추천이 정확해져요',
        });
        return;
      }
    } catch (error) {
      console.warn('[TodayBanner][DEBUG] Permission check failed:', error);
      // Continue to cache loading if permission check fails
    }

    // 2. Load cached banner
    const cached = await loadCachedBanner();
    if (cached) {
      setBannerData({
        state: 'cached',
        text: cached.text,
        context: cached.context,
      });

      // Check if cache has no recommendation - refresh more aggressively
      const hasRecommendation = !!cached.context?.recommendedEventId;

      // Auto-refresh in background if needed
      const needsRefresh = isCacheStale(cached, !hasRecommendation);

      if (needsRefresh) {
        console.log('[TodayBanner][DEBUG] Cache is stale, refreshing... (hasRecommendation:', hasRecommendation, ')');
        refreshBanner();
      } else if (!hasRecommendation) {
        console.log('[TodayBanner][DEBUG] Cache has no recommendation but not stale yet, will retry on next mount');
      }
    } else {
      // No cache, fetch fresh
      console.log('[TodayBanner][DEBUG] No cache found, fetching fresh...');
      refreshBanner();
    }
  };

  const loadCachedBanner = async (): Promise<BannerCacheV1 | null> => {
    try {
      const cached = await Storage.getItem(CACHE_KEY);
      if (!cached) {
        console.log('[TodayBanner][DEBUG] No cache found');
        return null;
      }

      const data: BannerCacheV1 = JSON.parse(cached);

      console.log('[TodayBanner][DEBUG] Cache loaded:', {
        version: data.version,
        date: data.date,
        dong: data.dong,
        hasRecommendation: !!data.context?.recommendedEventId,
        recommendedEventId: data.context?.recommendedEventId,
        expiresAt: data.expiresAt,
      });

      // Validate cache structure
      if (data.version !== 1 || !data.date || !data.dong || !data.text) {
        console.warn('[TodayBanner][DEBUG] Invalid cache structure, discarding:', {
          version: data.version,
          hasDate: !!data.date,
          hasDong: !!data.dong,
          hasText: !!data.text,
        });
        return null;
      }

      return data;
    } catch (error) {
      console.error('[TodayBanner][DEBUG] Failed to load cache:', error);
      return null;
    }
  };

  const isCacheStale = (cache: BannerCacheV1, noRecommendation: boolean = false): boolean => {
    const now = new Date();
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD

    // Check if date changed
    if (cache.date !== today) {
      console.log('[TodayBanner][DEBUG] Cache stale: date changed');
      return true;
    }

    // Check if expired
    const expiresAt = new Date(cache.expiresAt);
    if (now >= expiresAt) {
      console.log('[TodayBanner][DEBUG] Cache stale: expired');
      return true;
    }

    // If no recommendation, check shorter TTL
    if (noRecommendation) {
      const generatedAt = new Date(cache.generatedAt);
      const ageMs = now.getTime() - generatedAt.getTime();
      if (ageMs >= CACHE_TTL_MS_NO_RECOMMENDATION) {
        console.log('[TodayBanner][DEBUG] Cache stale: no recommendation and exceeded 1h TTL');
        return true;
      }
    }

    return false;
  };

  const refreshBanner = async () => {
    const now = new Date(); // Declare now at the top of the function

    try {
      setLoading(true);
      setBannerData((prev) => ({ ...prev, state: 'refreshing' }));

      console.log('[TodayBanner][DEBUG] refreshBanner started');

      // 1. Check permission
      const permission = await getCurrentLocation.getPermission();
      console.log('[TodayBanner][DEBUG] permission:', permission);

      if (permission === 'denied') {
        console.log('[TodayBanner][DEBUG] Permission denied, showing denied banner');
        setBannerData({
          state: 'permission_denied',
          text: '위치 권한이 꺼져 있어요',
        });
        setLoading(false);
        return;
      }

      if (permission === 'notDetermined') {
        console.log('[TodayBanner][DEBUG] Permission notDetermined, showing CTA banner');
        setBannerData({
          state: 'permission_not_determined',
          text: '위치를 허용하면 주변 추천이 정확해져요',
        });
        setLoading(false);
        return;
      }

      // 2. Get current location
      const location = await getCurrentLocation({ accuracy: Accuracy.Balanced });
      const { latitude, longitude } = location.coords;

      console.log('[TodayBanner][DEBUG] getCurrentLocation result:', {
        lat: latitude,
        lng: longitude,
        latType: typeof latitude,
        lngType: typeof longitude,
        latIsNaN: isNaN(latitude),
        lngIsNaN: isNaN(longitude),
      });

      // 3. Reverse geocode
      const response = await http.get<ReverseGeocodeResponse>('/geo/reverse', {
        params: { lat: latitude, lng: longitude },
      });

      const { dong, label } = response.data;
      console.log('[TodayBanner][DEBUG] /geo/reverse result:', { dong, label });

      // 4. Fetch nearby events using /events/nearby API
      // Get tuning config for fetch params
      const tuningConfig = getActiveTuning();
      const fetchRadius = tuningConfig.nearbyFetch.radius;
      const fetchSize = tuningConfig.nearbyFetch.size;

      console.log('🟢🟢🟢 [TodayBanner] Starting nearby event fetch 🟢🟢🟢');
      console.log('[TodayBanner] Using tuning config:', {
        radius: fetchRadius,
        size: fetchSize,
        tuningProfile: __DEV__ ? 'DEV' : 'PROD',
      });
      console.log('[TodayBanner] Nearby items length:', 0, '(before fetch)');
      console.log('[TodayBanner] Recommended:', null, '(before fetch)');

      let recommendedEvent: {
        id: string;
        title: string;
        distanceMeters: number;
        reasonTags: string[];
        score: number;
        breakdown: ScoreBreakdown;
        category?: string;
        mainCategory?: string;
        fullEvent: any; // 원본 이벤트 객체 (explanation 생성용)
        traits?: any; // 이벤트 특성 (AI 캐시용)
      } | undefined;

      let noRecommendationReason: 'nearby_empty' | 'guardrails_filtered' | 'low_score' | undefined;

      try {
        const nearbyParams = {
          lat: latitude,
          lng: longitude,
          radius: fetchRadius,
          page: 1,
          size: fetchSize,
        };
        console.log('🟢 [TodayBanner] Calling eventService.getNearbyEvents() with:', nearbyParams);
        console.log('🟢 [TodayBanner] This MUST call /events/nearby endpoint');
        console.log('[EventService][getNearbyEvents] Request params:', nearbyParams);

        const nearbyResult = await eventService.getNearbyEvents(nearbyParams);

        console.log('🟢 [TodayBanner] getNearbyEvents() returned - items length:', nearbyResult?.items?.length ?? 0);
        console.log('[TodayBanner] Nearby items length:', nearbyResult?.items?.length ?? 0);
        console.log('[EventService][getNearbyEvents] itemsLength:', nearbyResult?.items?.length ?? 0);

        if (nearbyResult && nearbyResult.items && nearbyResult.items.length > 0) {
          // [Enhanced Diagnostics] Log top 3 raw candidates (before guardrails)
          if (__DEV__) {
            const top3Raw = nearbyResult.items.slice(0, 3).map(e => ({
              id: e.id,
              title: e.title?.substring(0, 30),
              distanceMeters: e.distanceMeters,
              hasImage: e.traits?.hasImage || false, // ✅ Use traits.hasImage only
              thumbnailUrl: e.thumbnailUrl?.substring(0, 50),
              traitsHasImage: e.traits?.hasImage,
              endAt: e.endAt,
              category: e.category,
            }));
            console.log('🟢🔍 [TodayBanner][Diagnostics] Top 3 raw candidates (before guardrails):', top3Raw);
          }

          // 사용자 선호도 가져오기
          const userPrefs = await getPreferences();
          console.log('🟢 [TodayBanner] User preferences loaded:', {
            recentCategories: userPrefs.recentCategories,
          });

          // 24시간 히스토리 가져오기 (dedup용)
          const history = await getBannerHistory();
          console.log('🟢 [TodayBanner] Banner history loaded:', {
            lastRecommendedEventId: history?.lastRecommendedEventId,
            lastRecommendedAt: history?.lastRecommendedAt,
          });

          // Guardrails 적용
          const { filtered: guardrailedCandidates, result: guardrailsResult } = applyGuardrails(
            nearbyResult.items,
            now,
            history?.lastRecommendedEventId,
            history?.lastRecommendedAt
          );

          // [1-C] 후보군 0일 때 원인 로그 강화
          if (guardrailedCandidates.length === 0) {
            noRecommendationReason = 'guardrails_filtered';
            if (__DEV__) {
              console.warn('[TodayBanner][EmptyCandidates] All candidates filtered out by guardrails', {
                originalCount: nearbyResult.items.length,
                guardrailsResult,
                noRecommendationReason,
                lat: latitude,
                lng: longitude,
                radius: fetchRadius,
                size: fetchSize,
              });
            }
            // recommendedEvent는 undefined로 유지 (fallback 문구 사용)
          } else {
            // [Enhanced Diagnostics] Log top 3 candidates after guardrails
            if (__DEV__) {
              const top3Guardrailed = guardrailedCandidates.slice(0, 3).map(e => ({
                id: e.id,
                title: e.title?.substring(0, 30),
                distanceMeters: e.distanceMeters,
                hasImage: e.traits?.hasImage || false, // ✅ Use traits.hasImage only
                thumbnailUrl: e.thumbnailUrl?.substring(0, 50),
                traitsHasImage: e.traits?.hasImage,
                endAt: e.endAt,
                category: e.category,
              }));
              console.log('🟢🔍 [TodayBanner][Diagnostics] Top 3 after guardrails:', top3Guardrailed);
            }
            // 복합 점수 모델로 후보군 평가
            const scoredCandidates = scoreTodayRecommendations(
              guardrailedCandidates,
              userPrefs,
              now,
              guardrailsResult.fallbackRelaxed
            );

            // [Enhanced Diagnostics] Log top 3 scored candidates
            if (__DEV__ && scoredCandidates.length > 0) {
              const top3Scored = scoredCandidates.slice(0, 3).map(c => ({
                id: c.event.id,
                title: c.event.title?.substring(0, 30),
                score: c.totalScore.toFixed(3),
                isEligible: c.isEligibleRecommendation,
                breakdown: {
                  distance: c.breakdown.distance.toFixed(2),
                  hotness: c.breakdown.hotness.toFixed(2),
                  quality: c.breakdown.quality.toFixed(2),
                  urgency: c.breakdown.urgency.toFixed(2),
                  preference: c.breakdown.preference.toFixed(2),
                },
                distanceMeters: c.event.distanceMeters,
                hasImage: c.event.traits?.hasImage || false, // ✅ Use traits.hasImage only
                thumbnailUrl: c.event.thumbnailUrl?.substring(0, 50),
                traitsHasImage: c.event.traits?.hasImage,
                endAt: c.event.endAt,
              }));
              console.log('🟢🔍 [TodayBanner][Diagnostics] Top 3 scored candidates:', top3Scored);
            }

            if (scoredCandidates.length > 0) {
              // 최고 점수 이벤트 선택
              const topCandidate = scoredCandidates[0]!; // Length > 0이므로 undefined가 아님

              // [NEW] isEligibleRecommendation 체크 (최소 임계값 통과 여부)
              if (!topCandidate.isEligibleRecommendation) {
                noRecommendationReason = 'low_score';
                if (__DEV__) {
                  // Enhanced log with top 3 details
                  const top3Details = scoredCandidates.slice(0, 3).map(c => ({
                    id: c.event.id,
                    title: c.event.title?.substring(0, 30),
                    score: c.totalScore.toFixed(3),
                    breakdown: {
                      distance: c.breakdown.distance.toFixed(2),
                      hotness: c.breakdown.hotness.toFixed(2),
                      quality: c.breakdown.quality.toFixed(2),
                      urgency: c.breakdown.urgency.toFixed(2),
                      preference: c.breakdown.preference.toFixed(2),
                    },
                    distanceMeters: c.event.distanceMeters,
                    hasImage: c.event.traits?.hasImage || false, // ✅ Use traits.hasImage only
                    thumbnailUrl: c.event.thumbnailUrl?.substring(0, 50),
                    traitsHasImage: c.event.traits?.hasImage,
                    endAt: c.event.endAt,
                  }));

                  console.warn('[TodayBanner][NoWinner] Top candidate below minRecommendationScore', {
                    candidates: scoredCandidates.length,
                    topScore: topCandidate.totalScore.toFixed(3),
                    minThreshold: tuningConfig.minRecommendationScore,
                    isEligible: topCandidate.isEligibleRecommendation,
                    noRecommendationReason,
                    top3Candidates: top3Details,
                    reason: 'Score below minimum recommendation threshold',
                  });
                }
                // recommendedEvent는 undefined로 유지 (fallback 문구 사용)
              } else if (topCandidate.totalScore === 0) {
                // [1-C] 모든 점수가 0인 경우 체크 (보조 체크)
                noRecommendationReason = 'low_score';
                if (__DEV__) {
                  console.warn('[TodayBanner][NoWinner] All scores are zero', {
                    candidates: scoredCandidates.length,
                    topScore: topCandidate.totalScore,
                    noRecommendationReason,
                    reason: 'All score components are zero or candidates have invalid data',
                  });
                }
                // recommendedEvent는 undefined로 유지 (fallback 문구 사용)
              } else if (!topCandidate.event.id || !topCandidate.event.title || topCandidate.event.distanceMeters === undefined) {
                console.error('🔴 [TodayBanner] ERROR: Top candidate has missing fields:', {
                  hasId: !!topCandidate.event.id,
                  hasTitle: !!topCandidate.event.title,
                  hasDistanceMeters: topCandidate.event.distanceMeters !== undefined,
                  event: topCandidate.event,
            });
              } else {
              recommendedEvent = {
                id: topCandidate.event.id,
                title: topCandidate.event.title,
                distanceMeters: topCandidate.event.distanceMeters,
                reasonTags: topCandidate.reasonTags,
                score: topCandidate.totalScore,
                breakdown: topCandidate.breakdown,
                category: topCandidate.event.category,
                mainCategory: topCandidate.event.mainCategory,
                fullEvent: topCandidate.event, // 원본 이벤트 객체 저장
                traits: topCandidate.event.traits, // ⭐ Traits 추가
              };

              console.log('🟢✅ [TodayBanner] Recommended event SELECTED (score-based):', {
              id: recommendedEvent.id,
              title: recommendedEvent.title,
              distance: Math.round(recommendedEvent.distanceMeters) + 'm',
                score: recommendedEvent.score.toFixed(3),
                reasonTags: recommendedEvent.reasonTags,
                traits: recommendedEvent.traits, // ⭐ Traits 로그 추가
                breakdown: {
                  distance: recommendedEvent.breakdown.distance.toFixed(2),
                  hotness: recommendedEvent.breakdown.hotness.toFixed(2),
                  quality: recommendedEvent.breakdown.quality.toFixed(2),
                  urgency: recommendedEvent.breakdown.urgency.toFixed(2),
                  preference: recommendedEvent.breakdown.preference.toFixed(2),
                },
              });
              console.log('[TodayBanner] Recommended:', {
                id: topCandidate.event.id,
                title: topCandidate.event.title,
                distanceMeters: topCandidate.event.distanceMeters,
              });
            }
            } else {
              // [1-C] 점수 계산 후 후보가 없는 경우
              if (__DEV__) {
                console.warn('[TodayBanner][NoWinner] No valid scored candidates', {
                  candidates: scoredCandidates.length,
                  reason: 'Scoring returned empty array',
                });
              }
            }
          }
        } else {
          // [1-C] /events/nearby 응답이 비어있는 경우
          noRecommendationReason = 'nearby_empty';
          if (__DEV__) {
            console.warn('[TodayBanner][EmptyCandidates] nearby itemsLength=0', {
              lat: latitude,
              lng: longitude,
              radius: fetchRadius,
              size: fetchSize,
              noRecommendationReason,
              reason: 'Backend returned no events or data issue',
            });
          }
          console.log('🟡 [TodayBanner] No nearby events found within', fetchRadius, 'meters');
          console.log('[TodayBanner] Nearby items length:', 0);
          console.log('[TodayBanner] Recommended:', null);
        }
      } catch (error: any) {
        console.error('🔴🔴🔴 [TodayBanner] CRITICAL ERROR fetching nearby events:', {
          errorMessage: error?.message,
          errorCode: error?.code,
          errorName: error?.name,
          errorType: error?.constructor?.name,
          responseStatus: error?.response?.status,
          responseData: error?.response?.data,
          stack: error?.stack?.split('\n').slice(0, 3),
        });
        // Continue without recommendation
      }

      // 5. Generate recommendation explanation and banner text
      console.log('🟢 [TodayBanner] Creating context and generating banner text');

      let explanation: RecommendationExplanation | undefined;
      let bannerText: string;
      let copySource: 'ai' | 'template' | 'cache' | 'gemini' | undefined;
      let aiModel: string | undefined;

      if (recommendedEvent) {
        // 추천 설명 생성
        explanation = explainRecommendation(
          recommendedEvent.fullEvent,
          recommendedEvent.breakdown,
          recommendedEvent.reasonTags
        );

        console.log('🟢 [TodayBanner] Recommendation explanation generated:', {
          confidenceLevel: explanation.confidenceLevel,
          primaryReason: explanation.primaryReason,
          insightsCount: explanation.insights.length,
        });

        // 하이브리드 문구 생성 (Gemini + 템플릿)
        try {
          console.log('[TodayBanner][DEBUG] recommendedEvent.traits before GPT call:', recommendedEvent.traits);
          
          const copyResult = await generateBannerCopyHybrid({
            eventId: recommendedEvent.id,
            eventTitle: recommendedEvent.title,
            eventCategory: recommendedEvent.category || 
                          recommendedEvent.mainCategory || 
                          '이벤트',
            dongLabel: label,
            distanceMeters: recommendedEvent.distanceMeters,
            explanation,
            reasonTags: recommendedEvent.reasonTags,
            traits: recommendedEvent.traits, // Traits 전달
          });

          bannerText = copyResult.copy;
          copySource = copyResult.source;
          aiModel = copyResult.model;

          console.log('🟢 [TodayBanner] Banner copy generated:', {
            source: copySource,
            text: bannerText,
            model: aiModel,
          });
        } catch (copyError) {
          console.error('[TodayBanner] Failed to generate hybrid copy, falling back to template:', copyError);
          bannerText = generateBannerText(
            label,
            {
              title: recommendedEvent.title,
              distanceMeters: recommendedEvent.distanceMeters,
              reasonTags: recommendedEvent.reasonTags,
            }
          );
          copySource = 'template';
        }
      } else {
        // No recommendation: use fallback template
        bannerText = generateBannerText(label, undefined);
        copySource = 'template';
      }

      const context: BannerContext = {
        dong,
        lat: latitude,
        lng: longitude,
        dongLabel: label,
        generatedAt: now.toISOString(),
        recommendedEventId: recommendedEvent?.id,
        recommendedEventTitle: recommendedEvent?.title,
        recommendedEventDistanceMeters: recommendedEvent?.distanceMeters,
        recommendedReasonTags: recommendedEvent?.reasonTags,
        recommendedScore: recommendedEvent?.score,
        recommendedBreakdown: recommendedEvent?.breakdown,
        recommendationExplanation: explanation,
        copySource,
        noRecommendationReason,
      };

      console.log('🟢 [TodayBanner] Context created:', {
        hasRecommendation: !!recommendedEvent,
        recommendedEventId: context.recommendedEventId,
        recommendedEventTitle: context.recommendedEventTitle,
        recommendedEventDistanceMeters: context.recommendedEventDistanceMeters,
        recommendedReasonTags: context.recommendedReasonTags,
        recommendedScore: context.recommendedScore,
        dongLabel: context.dongLabel,
      });

      console.log('🟢 [TodayBanner] Context created:', {
        hasRecommendation: !!recommendedEvent,
        recommendedEventId: context.recommendedEventId,
        recommendedEventTitle: context.recommendedEventTitle,
        recommendedEventDistanceMeters: context.recommendedEventDistanceMeters,
        recommendedReasonTags: context.recommendedReasonTags,
        recommendedScore: context.recommendedScore,
        copySource: context.copySource,
        dongLabel: context.dongLabel,
      });

      // 5.5. Fire impression analytics event
      try {
        logTodayBannerImpression({
          hasRecommendation: !!recommendedEvent,
          noRecommendationReason,
          recommendedEventId: recommendedEvent?.id,
          score: recommendedEvent?.score,
          reasonTags: recommendedEvent?.reasonTags,
          dongLabel: label,
          radius: fetchRadius,
          size: fetchSize,
          tuningProfile: __DEV__ ? 'DEV' : 'PROD',
          timestamp: now.toISOString(),
          copySource,
          aiModel, // 'gpt-4o-mini' | 'template-fallback' | undefined
          explanationConfidence: explanation?.confidenceLevel,
        });
      } catch (analyticsError) {
        // Analytics should never break the flow
        console.warn('[TodayBanner] Analytics impression failed (non-critical):', analyticsError);
      }

      // 6. Save to cache
      // Use shorter TTL if no recommendation
      const ttl = recommendedEvent ? CACHE_TTL_MS : CACHE_TTL_MS_NO_RECOMMENDATION;

      const cacheData: BannerCacheV1 = {
        version: 1,
        date: now.toISOString().split('T')[0]!, // ISO string always has 'T', so [0] is never undefined
        dong,
        text: bannerText,
        context,
        generatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttl).toISOString(),
        noRecommendationReason,
      };

      console.log('🟢💾 [TodayBanner] Saving to cache:', {
        cacheKey: CACHE_KEY,
        hasRecommendation: !!cacheData.context.recommendedEventId,
        recommendedEventId: cacheData.context.recommendedEventId,
        noRecommendationReason: cacheData.noRecommendationReason,
        ttlHours: ttl / (60 * 60 * 1000),
        bannerText: cacheData.text,
      });

      await Storage.setItem(CACHE_KEY, JSON.stringify(cacheData));

      console.log('🟢✅ [TodayBanner] Cache saved successfully');

      // 추천이 확정된 경우 history 저장 (24시간 dedup용)
      if (recommendedEvent?.id) {
        try {
          await saveBannerHistory(recommendedEvent.id);
          console.log('🟢✅ [TodayBanner] History saved:', {
            eventId: recommendedEvent.id,
          });
        } catch (historyError) {
          console.warn('[TodayBanner] Failed to save history (non-critical):', historyError);
        }
      }

      setBannerData({
        state: 'refreshed',
        text: cacheData.text,
        context,
      });

      console.log('🟢🎉 [TodayBanner] Refresh completed successfully:', {
        dong,
        dongLabel: label,
        hasRecommendation: !!recommendedEvent,
        recommendedEventId: recommendedEvent?.id,
        recommendedEventTitle: recommendedEvent?.title,
        bannerState: 'refreshed',
      });

    } catch (error: any) {
      console.error('[TodayBanner][DEBUG] Refresh failed with error:', {
        errorMessage: error?.message,
        errorCode: error?.code,
        errorName: error?.name,
        errorType: error?.constructor?.name,
        isPermissionError: error instanceof GetCurrentLocationPermissionError,
        responseStatus: error?.response?.status,
        responseData: error?.response?.data,
        stack: error?.stack,
      });

      if (error instanceof GetCurrentLocationPermissionError) {
        setBannerData({
          state: 'permission_denied',
          text: '위치 권한이 꺼져 있어요',
        });
      } else {
        setBannerData({
          state: 'error',
          text: '주변 이벤트를 불러오는 데 문제가 발생했어요',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const requestPermission = async () => {
    try {
      const newPermission = await getCurrentLocation.openPermissionDialog();

      if (newPermission === 'allowed') {
        // Permission granted, refresh banner
        refreshBanner();
      } else {
        setBannerData({
          state: 'permission_denied',
          text: '위치 권한이 꺼져 있어요',
        });
      }
    } catch (error) {
      console.error('[TodayBanner] Permission request failed:', error);
      setBannerData({
        state: 'error',
        text: '권한 요청에 실패했어요',
      });
    }
  };

  const generateBannerText = (
    dongLabel: string,
    recommendedEvent?: { title: string; distanceMeters: number; reasonTags: string[] }
  ): string => {
    // If we have a recommended event, generate event-specific text
    if (recommendedEvent) {
      const distanceText = formatDistance(recommendedEvent.distanceMeters);
      const eventTitle = recommendedEvent.title.length > 20
        ? recommendedEvent.title.substring(0, 20) + '...'
        : recommendedEvent.title;

      const reasonTags = recommendedEvent.reasonTags || [];

      // reasonTags 기반 문구 생성
      if (reasonTags.includes('마감 임박')) {
        // Urgency 우선
        return `오늘이 마지막! ${distanceText} 거리 '${eventTitle}' 놓치지 마세요`;
      }

      if (reasonTags.includes('취향 저격')) {
        // Preference 우선
        const category = reasonTags.find(t => ['축제', '공연', '전시', '행사'].includes(t)) || '이벤트';
        return `${category} 좋아하시죠? ${distanceText} 거리에 '${eventTitle}' 있어요`;
      }

      if (reasonTags.includes('지금 인기')) {
        // Hotness 우선
        return `지금 여기서 제일 핫한 '${eventTitle}', ${distanceText} 거리예요!`;
      }

      if (reasonTags.includes('가까워요')) {
        // Distance 우선
        return `${dongLabel} 바로 옆 ${distanceText}에 '${eventTitle}' 있어요`;
      }

      // 기본 템플릿 (reasonTags가 없거나 매칭 안 됨)
      const templates = [
        `${dongLabel} 근처 ${distanceText}에 '${eventTitle}' 있어요. 지금 들러볼까요?`,
        `오늘 ${dongLabel}에서 '${eventTitle}' 어떠세요? ${distanceText} 거리예요`,
        `${distanceText} 거리에 '${eventTitle}' 진행 중이에요!`,
      ];

      const dateNum = new Date().getDate();
      return templates[dateNum % templates.length]!; // 배열 길이로 모듈로 연산하므로 undefined가 아님
    }

    // Fallback: No recommended event
    // Updated text to make it clear that clicking will navigate to /nearby
    const fallbackTemplates = [
      `${dongLabel} 내 주변 이벤트 보기`,
      `${dongLabel} 근처 이벤트 둘러보기`,
      `내 주변에서 진행 중인 이벤트 찾기`,
    ];

    const dateNum = new Date().getDate();
    return fallbackTemplates[dateNum % fallbackTemplates.length]!; // 배열 길이로 모듈로 연산하므로 undefined가 아님
  };

  const formatDistance = (meters: number): string => {
    if (meters < 1000) {
      return `${Math.round(meters / 10) * 10}m`;
    }
    return `${(meters / 1000).toFixed(1)}km`;
  };

  return {
    bannerData,
    loading,
    requestPermission,
  };
}
