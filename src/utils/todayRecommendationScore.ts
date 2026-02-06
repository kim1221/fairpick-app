/**
 * 투데이 배너 추천 점수 계산 유틸리티
 *
 * 복합 점수 모델:
 * - Distance (0.25): 가까울수록 높음
 * - Hotness (0.25): 인기도 기반
 * - Quality (0.20): 데이터 품질 기반
 * - Urgency (0.15): 마감 임박도
 * - Preference (0.15): 사용자 취향 매칭
 *
 * 튜닝 파라미터는 src/config/todayBannerTuning.ts에서 관리됩니다.
 */

import { NearbyEventItem } from '../services/eventService';
import { getActiveTuning } from '../config/todayBannerTuning';

// 점수 breakdown
export interface ScoreBreakdown {
  distance: number;
  hotness: number;
  quality: number;
  urgency: number;
  preference: number;
}

// 점수 결과
export interface ScoredEvent {
  event: NearbyEventItem;
  totalScore: number;
  breakdown: ScoreBreakdown;
  reasonTags: string[];
  isEligibleRecommendation: boolean; // 최소 임계값 통과 여부
}

// 사용자 선호도 데이터
export interface UserPreferences {
  recentCategories: string[]; // 최근 본 카테고리 (최대 3개)
}

// Guardrails 적용 결과
export interface GuardrailsResult {
  beforeCount: number;
  afterEndAtFilter: number;
  afterImageFilter: number;
  afterDedupFilter: number;
  finalCount: number;
  fallbackRelaxed: boolean; // 이미지 필터 완화 여부
  excludedByHistory: number;
  excludedByHistoryId?: string;
  ageHours?: number;
}

/**
 * Distance Score (0~1)
 * 0m = 1.0, 3000m = 0.0 선형 감소
 */
function calculateDistanceScore(distanceMeters: number, maxRadius: number = 3000): number {
  if (distanceMeters <= 0) return 1.0;
  if (distanceMeters >= maxRadius) return 0.0;
  return Math.max(0, 1 - distanceMeters / maxRadius);
}

/**
 * Hotness Score (0~1)
 * 후보군 내 최대 popularityScore로 정규화
 */
function calculateHotnessScore(
  popularityScore: number | undefined,
  maxPopularityInCandidates: number
): number {
  if (!popularityScore || maxPopularityInCandidates === 0) return 0;
  return Math.min(1.0, popularityScore / maxPopularityInCandidates);
}

/**
 * Quality Score (0~1)
 * 휴리스틱 기반:
 * - 이미지 URL 존재: +0.4
 * - title/venue/address 등 필드 품질: +0.6
 */
function calculateQualityScore(event: NearbyEventItem): number {
  let score = 0;

  // 이미지 URL 존재 여부 (0.4)
  if (event.thumbnailUrl && event.thumbnailUrl.startsWith('http')) {
    score += 0.4;
  }

  // 필드 품질 (0.6)
  let fieldQuality = 0;

  // title 길이 (0.2)
  if (event.title && event.title.length >= 5) {
    fieldQuality += 0.2;
  } else if (event.title && event.title.length >= 2) {
    fieldQuality += 0.1;
  }

  // venue 존재 (0.15)
  if (event.venue && event.venue.length >= 2) {
    fieldQuality += 0.15;
  }

  // address 존재 (0.15)
  if (event.address && event.address.length >= 5) {
    fieldQuality += 0.15;
  }

  // description/overview 존재 (0.1)
  if ((event.description && event.description.length >= 10) || 
      (event.overview && event.overview.length >= 10)) {
    fieldQuality += 0.1;
  }

  score += Math.min(0.6, fieldQuality);

  return Math.min(1.0, score);
}

/**
 * Urgency Score (0~1)
 * 종료일이 가까울수록 높음
 * D-day 0 (오늘 종료) = 1.0
 * D-day 1 = 0.8
 * D-day 2 = 0.6
 * D-day 3 = 0.4
 * D-day 4 = 0.2
 * D-day 5+ = 0.0
 */
function calculateUrgencyScore(endAt: string | undefined, now: Date): number {
  if (!endAt) return 0;

  try {
    const endDate = new Date(endAt);
    const diffMs = endDate.getTime() - now.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return 0; // 이미 종료됨
    if (diffDays === 0) return 1.0; // 오늘 종료
    if (diffDays === 1) return 0.8;
    if (diffDays === 2) return 0.6;
    if (diffDays === 3) return 0.4;
    if (diffDays === 4) return 0.2;
    return 0.0; // 5일 이상
  } catch (error) {
    console.warn('[ScoreUtil] Invalid endAt date:', endAt, error);
    return 0;
  }
}

/**
 * Preference Score (0~1)
 * 최근 본 카테고리와 매칭
 */
function calculatePreferenceScore(
  mainCategory: string | undefined,
  userPreferences: UserPreferences
): number {
  if (!mainCategory || userPreferences.recentCategories.length === 0) {
    return 0;
  }

  // 최근 본 카테고리 중 하나와 일치하면 1.0
  // 최근 순서에 따라 가중치 차등 (1st: 1.0, 2nd: 0.8, 3rd: 0.6)
  const index = userPreferences.recentCategories.findIndex(
    (cat) => cat === mainCategory
  );

  if (index === -1) return 0;
  if (index === 0) return 1.0;
  if (index === 1) return 0.8;
  if (index === 2) return 0.6;
  return 0;
}

/**
 * 추천 이유 태그 생성 (우선순위 기반, 최대 2개)
 * 
 * 우선순위:
 * 1. 마감 임박 (urgency) - 시급성이 가장 중요
 * 2. 취향 저격 (preference) - 개인화 가치가 높음
 * 3. 지금 인기 (hotness) - 사회적 증거
 * 4. 가까워요 (distance) - 접근성
 * 5. 정보 풍부 (quality) - 기본 품질
 * 
 * 각 점수 요소가 임계값을 넘으면 태그 후보로 추가하되,
 * 우선순위 기반으로 최대 2개만 선택합니다.
 */
function generateReasonTags(breakdown: ScoreBreakdown): string[] {
  const config = getActiveTuning();
  const thresholds = config.reasonTagThresholds;
  
  // 태그 후보 (우선순위 순서로 정렬)
  const candidates: Array<{ tag: string; priority: number; score: number }> = [];

  // 1. 마감 임박 (최우선)
  if (breakdown.urgency >= thresholds.urgencySoon) {
    candidates.push({ tag: '마감 임박', priority: 1, score: breakdown.urgency });
  }

  // 2. 취향 저격
  if (breakdown.preference >= thresholds.preferenceMatch) {
    candidates.push({ tag: '취향 저격', priority: 2, score: breakdown.preference });
  }

  // 3. 지금 인기
  if (breakdown.hotness >= thresholds.hotnessHot) {
    candidates.push({ tag: '지금 인기', priority: 3, score: breakdown.hotness });
  }

  // 4. 가까워요
  if (breakdown.distance >= thresholds.distanceNear) {
    candidates.push({ tag: '가까워요', priority: 4, score: breakdown.distance });
  }

  // 5. 정보 풍부
  if (breakdown.quality >= thresholds.qualityRich) {
    candidates.push({ tag: '정보 풍부', priority: 5, score: breakdown.quality });
  }

  // 우선순위 기반 정렬 (priority 오름차순, score 내림차순)
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return b.score - a.score;
  });

  // 최대 2개만 선택
  const selectedTags = candidates.slice(0, 2).map(c => c.tag);

  // 태그가 없으면 기본 태그
  if (selectedTags.length === 0) {
    return ['추천'];
  }

  if (__DEV__) {
    console.log('[TodayBanner][ReasonTags] Generated:', {
      breakdown: {
        urgency: breakdown.urgency.toFixed(2),
        preference: breakdown.preference.toFixed(2),
        hotness: breakdown.hotness.toFixed(2),
        distance: breakdown.distance.toFixed(2),
        quality: breakdown.quality.toFixed(2),
      },
      candidates: candidates.map(c => `${c.tag}(${c.score.toFixed(2)})`),
      selected: selectedTags,
    });
  }

  return selectedTags;
}

/**
 * Guardrails 적용: 부적절한 후보 제외
 * @param candidates 원본 후보군
 * @param now 현재 시각
 * @param lastRecommendedEventId 24시간 내 추천된 이벤트 ID (dedup용)
 * @param lastRecommendedAt 마지막 추천 시각
 * @returns {filtered: 필터링된 후보군, result: 적용 결과}
 */
export function applyGuardrails(
  candidates: NearbyEventItem[],
  now: Date,
  lastRecommendedEventId?: string,
  lastRecommendedAt?: string
): { filtered: NearbyEventItem[]; result: GuardrailsResult } {
  const result: GuardrailsResult = {
    beforeCount: candidates.length,
    afterEndAtFilter: 0,
    afterImageFilter: 0,
    afterDedupFilter: 0,
    finalCount: 0,
    fallbackRelaxed: false,
    excludedByHistory: 0,
  };

  if (candidates.length === 0) {
    return { filtered: [], result };
  }

  // [2-A] 종료된 이벤트 제외
  let filtered = candidates.filter((event) => {
    if (!event.endAt) {
      // endAt 없으면 제외하지 않음 (판단 불가)
      return true;
    }

    try {
      const endDate = new Date(event.endAt);
      if (isNaN(endDate.getTime())) {
        // Invalid Date - 제외하지 않지만 Dev 로그
        if (__DEV__) {
          console.warn('[Guardrails] Invalid endAt date:', {
            id: event.id,
            title: event.title.substring(0, 30),
            endAt: event.endAt,
          });
        }
        return true;
      }

      return endDate >= now; // 종료일이 현재보다 같거나 미래면 OK
    } catch (error) {
      console.warn('[Guardrails] Failed to parse endAt:', event.endAt, error);
      return true; // 파싱 실패 시 제외하지 않음
    }
  });

  result.afterEndAtFilter = filtered.length;

  // [2-B] 이미지 없는 이벤트 필터 (fallback 포함)
  const withImage = filtered.filter((event) => {
    return event.thumbnailUrl && event.thumbnailUrl.startsWith('http');
  });

  if (withImage.length === 0 && filtered.length > 0) {
    // 이미지 필터 후 후보가 0이면 완화 (원래 후보군 유지)
    result.fallbackRelaxed = true;
    result.afterImageFilter = filtered.length;
    // filtered 그대로 유지 (quality에서 패널티 줌)
  } else {
    // 이미지 필터 적용
    filtered = withImage;
    result.afterImageFilter = filtered.length;
  }

  // [2-D] 24시간 내 추천된 이벤트 제외
  if (lastRecommendedEventId && lastRecommendedAt) {
    const lastDate = new Date(lastRecommendedAt);
    const ageHours = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60);

    if (ageHours < 24) {
      const beforeDedup = filtered.length;
      filtered = filtered.filter((event) => event.id !== lastRecommendedEventId);
      const excluded = beforeDedup - filtered.length;

      if (excluded > 0) {
        result.excludedByHistory = excluded;
        result.excludedByHistoryId = lastRecommendedEventId;
        result.ageHours = ageHours;
      }
    }
  }

  result.afterDedupFilter = filtered.length;
  result.finalCount = filtered.length;

  // Dev 로그
  if (__DEV__) {
    console.log('[TodayBanner][Guardrails]', {
      before: result.beforeCount,
      afterEndAtFilter: result.afterEndAtFilter,
      afterImageFilter: result.afterImageFilter,
      afterDedupFilter: result.afterDedupFilter,
      finalCount: result.finalCount,
      fallbackRelaxed: result.fallbackRelaxed,
      excludedByHistory: result.excludedByHistory,
      lastId: result.excludedByHistoryId,
      ageHours: result.ageHours?.toFixed(1),
    });
  }

  return { filtered, result };
}

/**
 * 후보군 점수 계산 및 정렬
 * @param candidates 후보 이벤트 목록 (Guardrails 적용 후)
 * @param userPreferences 사용자 선호도
 * @param now 현재 시각
 * @param imageFilterRelaxed 이미지 필터가 완화되었는지 (quality 패널티용)
 * @returns 점수순으로 정렬된 ScoredEvent 배열
 */
export function scoreTodayRecommendations(
  candidates: NearbyEventItem[],
  userPreferences: UserPreferences,
  now: Date = new Date(),
  imageFilterRelaxed: boolean = false
): ScoredEvent[] {
  if (candidates.length === 0) {
    return [];
  }

  const config = getActiveTuning();
  const WEIGHTS = config.weights;
  const minRecommendationScore = config.minRecommendationScore;

  // 후보군 내 최대 popularityScore 계산
  const maxPopularity = Math.max(
    ...candidates.map((c) => c.popularityScore ?? 0)
  );

  // 각 후보에 대해 점수 계산
  const scored: ScoredEvent[] = candidates.map((event) => {
    const breakdown: ScoreBreakdown = {
      distance: calculateDistanceScore(event.distanceMeters),
      hotness: calculateHotnessScore(event.popularityScore, maxPopularity),
      quality: calculateQualityScore(event),
      urgency: calculateUrgencyScore(event.endAt, now),
      preference: calculatePreferenceScore(event.mainCategory, userPreferences),
    };

    // [2-B] 이미지 필터 완화 시 이미지 없는 이벤트에 quality 패널티
    if (imageFilterRelaxed && (!event.thumbnailUrl || !event.thumbnailUrl.startsWith('http'))) {
      breakdown.quality = Math.max(0, breakdown.quality - 0.3);
    }

    // 가중 합계
    let totalScore =
      breakdown.distance * WEIGHTS.distance +
      breakdown.hotness * WEIGHTS.hotness +
      breakdown.quality * WEIGHTS.quality +
      breakdown.urgency * WEIGHTS.urgency +
      breakdown.preference * WEIGHTS.preference;

    // [2-C] 너무 먼 이벤트 억제
    const penaltyThreshold = config.guardrails.farDistancePenaltyThreshold;
    const penaltyMultiplier = config.guardrails.farDistancePenaltyMultiplier;

    if (breakdown.distance < penaltyThreshold) {
      totalScore *= penaltyMultiplier;
      if (__DEV__) {
        console.log('[TodayBanner][DistancePenalty] Applied to:', {
          id: event.id,
          title: event.title.substring(0, 30),
          distanceMeters: Math.round(event.distanceMeters),
          distanceScore: breakdown.distance.toFixed(2),
          totalScoreBefore: (totalScore / penaltyMultiplier).toFixed(3),
          totalScoreAfter: totalScore.toFixed(3),
        });
      }
    }

    const reasonTags = generateReasonTags(breakdown);

    // 최소 임계값 체크
    const isEligibleRecommendation = totalScore >= minRecommendationScore;

    return {
      event,
      totalScore,
      breakdown,
      reasonTags,
      isEligibleRecommendation,
    };
  });

  // 총점 내림차순 정렬
  scored.sort((a, b) => b.totalScore - a.totalScore);

  // DEV: 상위 3개 로그
  if (__DEV__ && scored.length > 0) {
    const top3 = scored.slice(0, 3).map((s) => ({
      id: s.event.id,
      title: s.event.title.substring(0, 30),
      distanceMeters: Math.round(s.event.distanceMeters),
      totalScore: s.totalScore.toFixed(3),
      isEligible: s.isEligibleRecommendation,
      breakdown: {
        distance: s.breakdown.distance.toFixed(2),
        hotness: s.breakdown.hotness.toFixed(2),
        quality: s.breakdown.quality.toFixed(2),
        urgency: s.breakdown.urgency.toFixed(2),
        preference: s.breakdown.preference.toFixed(2),
      },
      reasonTags: s.reasonTags,
    }));

    console.log('[TodayBanner][ScoreTop3]', JSON.stringify(top3, null, 2));

    // 1위가 임계값 미달이면 경고
    const topCandidate = scored[0]!; // scored.length > 0이므로 undefined가 아님
    if (!topCandidate.isEligibleRecommendation) {
      console.warn('[TodayBanner][NoWinner] Top candidate below minRecommendationScore:', {
        minRecommendationScore,
        topScore: topCandidate.totalScore.toFixed(3),
        topEvent: {
          id: topCandidate.event.id,
          title: topCandidate.event.title.substring(0, 30),
          distanceMeters: Math.round(topCandidate.event.distanceMeters),
        },
        breakdown: {
          distance: topCandidate.breakdown.distance.toFixed(2),
          hotness: topCandidate.breakdown.hotness.toFixed(2),
          quality: topCandidate.breakdown.quality.toFixed(2),
          urgency: topCandidate.breakdown.urgency.toFixed(2),
          preference: topCandidate.breakdown.preference.toFixed(2),
        },
        reasonTags: topCandidate.reasonTags,
      });
    }
  }

  return scored;
}

