/**
 * Phase 2-B: Personal Score 계산 (Spec v1.0)
 *
 * 목적: 사용자 프로필 기반 개인화 점수 계산 (0~100점)
 *
 * 제약 사항:
 * - 정렬/랭킹 로직에 절대 반영하지 않음
 * - 이벤트 상세 페이지 1곳에만 적용 (MVP)
 * - 개발 모드에서만 로깅
 * - 백엔드 API/DB 변경 없음
 *
 * Spec: /docs/PHASE_2B_PERSONAL_SCORE_SPEC.md
 */

import { loadUserProfile, UserProfile } from './userProfile';

// ============================================================
// 타입 정의
// ============================================================

/**
 * Personal Score 계산을 위한 이벤트 입력
 */
export interface PersonalScoreInput {
  id: string;
  title?: string;
  region?: string | null;
  category?: string | null;
  start_at?: string | Date | null;
  is_free?: boolean | null;
}

/**
 * Personal Score 계산 결과
 */
export interface PersonalScoreResult {
  /** 총점 (0~100) */
  score: number;
  
  /** 점수 breakdown */
  breakdown: {
    region_score: number;      // 0~35
    category_score: number;    // 0~35
    time_score: number;        // 0~20
    free_bias_score: number;   // 0~10
  };
  
  /** 디버깅용 신호 */
  signals: {
    regionCount?: number;
    categoryCount?: number;
    isWeekend?: boolean;
    isDaytime?: boolean;
    freeRatio?: number;
    freeTotal?: number;
  };
  
  /** 상태 메시지 */
  reason?: string;
}

// ============================================================
// 내부 유틸리티
// ============================================================

/**
 * 시간대 판별
 * @param dateInput - ISO8601 문자열 또는 Date 객체
 * @returns { isWeekend, isDaytime } - 파싱 실패 시 null 반환
 */
function getTimeAttributes(dateInput: string | Date | null | undefined): {
  isWeekend: boolean | null;
  isDaytime: boolean | null;
} {
  // dateInput이 없으면 null 반환 (Spec: 파싱 실패 시 timeScore=0)
  if (!dateInput) {
    return {
      isWeekend: null,
      isDaytime: null,
    };
  }

  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  
  // Invalid Date 체크 (Spec: 파싱 실패 시 timeScore=0)
  if (isNaN(date.getTime())) {
    return {
      isWeekend: null,
      isDaytime: null,
    };
  }

  const dayOfWeek = date.getDay(); // 0=일요일, 6=토요일
  const hour = date.getHours();

  return {
    isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
    isDaytime: hour >= 6 && hour < 18,
  };
}

// ============================================================
// Spec 기반 점수 계산 함수
// ============================================================

/**
 * Region Score 계산 (0~35점)
 * 
 * 구간별 점수:
 * - count=0: 0점
 * - count=1~2: 10점
 * - count=3~4: 20점
 * - count≥5: 35점
 */
function calculateRegionScore(
  eventRegion: string | null | undefined,
  profile: UserProfile
): { score: number; count: number } {
  if (!eventRegion || eventRegion === '전국' || eventRegion.trim() === '') {
    return { score: 0, count: 0 };
  }

  const count = profile.preferred_regions[eventRegion] || 0;

  let score = 0;
  if (count === 0) {
    score = 0;
  } else if (count <= 2) {
    score = 10;
  } else if (count <= 4) {
    score = 20;
  } else {
    score = 35;
  }

  return { score, count };
}

/**
 * Category Score 계산 (0~35점)
 * 
 * 구간별 점수: Region과 동일
 */
function calculateCategoryScore(
  eventCategory: string | null | undefined,
  profile: UserProfile
): { score: number; count: number } {
  if (!eventCategory || eventCategory === '전체' || eventCategory.trim() === '') {
    return { score: 0, count: 0 };
  }

  const count = profile.preferred_categories[eventCategory] || 0;

  let score = 0;
  if (count === 0) {
    score = 0;
  } else if (count <= 2) {
    score = 10;
  } else if (count <= 4) {
    score = 20;
  } else {
    score = 35;
  }

  return { score, count };
}

/**
 * Time Score 계산 (0~20점)
 * 
 * 2축 독립 계산:
 * - 주중/주말 축 (0~10점)
 * - 낮/밤 축 (0~10점)
 */
function calculateTimeScore(
  eventStartAt: string | Date | null | undefined,
  profile: UserProfile
): { score: number; isWeekend: boolean | null; isDaytime: boolean | null } {
  const { isWeekend, isDaytime } = getTimeAttributes(eventStartAt);

  // 파싱 실패 시 0점 반환 (Spec: start_at 파싱 실패 시 timeScore=0)
  if (isWeekend === null || isDaytime === null) {
    return { score: 0, isWeekend: null, isDaytime: null };
  }

  // A축: 주중/주말 (0~10점)
  let weekdayWeekendScore = 0;
  if (isWeekend) {
    // 이벤트가 주말일 때
    if (profile.time_preference.weekend > profile.time_preference.weekday) {
      weekdayWeekendScore = 10;
    } else if (profile.time_preference.weekend === profile.time_preference.weekday) {
      weekdayWeekendScore = 5;
    } else {
      weekdayWeekendScore = 0;
    }
  } else {
    // 이벤트가 주중일 때
    if (profile.time_preference.weekday > profile.time_preference.weekend) {
      weekdayWeekendScore = 10;
    } else if (profile.time_preference.weekday === profile.time_preference.weekend) {
      weekdayWeekendScore = 5;
    } else {
      weekdayWeekendScore = 0;
    }
  }

  // B축: 낮/밤 (0~10점)
  let daytimeNightScore = 0;
  if (isDaytime) {
    // 이벤트가 낮 시간대일 때
    if (profile.time_preference.daytime > profile.time_preference.night) {
      daytimeNightScore = 10;
    } else if (profile.time_preference.daytime === profile.time_preference.night) {
      daytimeNightScore = 5;
    } else {
      daytimeNightScore = 0;
    }
  } else {
    // 이벤트가 밤 시간대일 때
    if (profile.time_preference.night > profile.time_preference.daytime) {
      daytimeNightScore = 10;
    } else if (profile.time_preference.night === profile.time_preference.daytime) {
      daytimeNightScore = 5;
    } else {
      daytimeNightScore = 0;
    }
  }

  const totalScore = weekdayWeekendScore + daytimeNightScore;

  return { score: totalScore, isWeekend, isDaytime };
}

/**
 * Free Bias Score 계산 (0~10점)
 * 
 * 규칙:
 * - total < 5: 0점 (학습 부족)
 * - is_free=true: free_ratio ≥0.7 → 10점, 0.5~0.69 → 5점, <0.5 → 0점
 * - is_free=false: free_ratio ≤0.3 → 10점, 0.31~0.49 → 5점, >0.49 → 0점
 * - is_free=null: 0점
 */
function calculateFreeBiasScore(
  eventIsFree: boolean | null | undefined,
  profile: UserProfile
): { score: number; freeRatio: number; total: number } {
  const total =
    profile.free_bias.free_views +
    profile.free_bias.paid_views +
    profile.free_bias.free_actions +
    profile.free_bias.paid_actions;

  // 학습 데이터 부족
  if (total < 5) {
    return { score: 0, freeRatio: 0, total };
  }

  const freeCount = profile.free_bias.free_views + profile.free_bias.free_actions;
  const freeRatio = freeCount / total;

  // is_free 정보 없음
  if (eventIsFree === null || eventIsFree === undefined) {
    return { score: 0, freeRatio, total };
  }

  let score = 0;

  if (eventIsFree === true) {
    // 이벤트가 무료일 때
    if (freeRatio >= 0.7) {
      score = 10;
    } else if (freeRatio >= 0.5) {
      score = 5;
    } else {
      score = 0;
    }
  } else {
    // 이벤트가 유료일 때
    if (freeRatio <= 0.3) {
      score = 10;
    } else if (freeRatio <= 0.49) {
      score = 5;
    } else {
      score = 0;
    }
  }

  return { score, freeRatio, total };
}

// ============================================================
// Public API
// ============================================================

/**
 * 단일 이벤트에 대한 Personal Score 계산
 *
 * @param event - 이벤트 데이터
 * @returns PersonalScoreResult (0~100점 + breakdown)
 */
export async function computePersonalScoreForEvent(
  event: PersonalScoreInput
): Promise<PersonalScoreResult> {
  try {
    const profile = await loadUserProfile();

    // 프로필이 비어있는지 확인
    const hasData =
      profile.stats.views > 0 ||
      profile.stats.actions > 0 ||
      Object.keys(profile.preferred_regions).length > 0 ||
      Object.keys(profile.preferred_categories).length > 0;

    if (!hasData) {
      console.log('[PersonalScore] Profile is empty - returning score 0');
      return {
        score: 0,
        breakdown: {
          region_score: 0,
          category_score: 0,
          time_score: 0,
          free_bias_score: 0,
        },
        signals: {},
        reason: 'profile_empty',
      };
    }

    // 각 항목 점수 계산
    const regionResult = calculateRegionScore(event.region, profile);
    const categoryResult = calculateCategoryScore(event.category, profile);
    const timeResult = calculateTimeScore(event.start_at, profile);
    const freeBiasResult = calculateFreeBiasScore(event.is_free, profile);

    // 총점 계산 (clamp 0~100)
    const totalScore = Math.max(
      0,
      Math.min(
        100,
        regionResult.score +
          categoryResult.score +
          timeResult.score +
          freeBiasResult.score
      )
    );

    return {
      score: totalScore,
      breakdown: {
        region_score: regionResult.score,
        category_score: categoryResult.score,
        time_score: timeResult.score,
        free_bias_score: freeBiasResult.score,
      },
      signals: {
        regionCount: regionResult.count,
        categoryCount: categoryResult.count,
        isWeekend: timeResult.isWeekend ?? undefined,
        isDaytime: timeResult.isDaytime ?? undefined,
        freeRatio: freeBiasResult.freeRatio,
        freeTotal: freeBiasResult.total,
      },
      reason: 'success',
    };
  } catch (error) {
    console.error('[PersonalScore] Failed to compute score', {
      error,
      eventId: event.id,
    });

    // 에러 시 0점 반환
    return {
      score: 0,
      breakdown: {
        region_score: 0,
        category_score: 0,
        time_score: 0,
        free_bias_score: 0,
      },
      signals: {},
      reason: 'error',
    };
  }
}

/**
 * Personal Score 결과를 사람이 읽기 쉬운 문자열로 변환 (디버깅용)
 */
export function formatPersonalScoreDebug(result: PersonalScoreResult): string {
  const { score, breakdown, signals, reason } = result;

  if (reason === 'profile_empty') {
    return '[PersonalScore] Profile empty → score=0';
  }

  if (reason === 'error') {
    return '[PersonalScore] Error → score=0';
  }

  const lines: string[] = [
    `[PersonalScore] Total: ${score}/100`,
    `  ├─ Region:   ${breakdown.region_score}/35 (count=${signals.regionCount || 0})`,
    `  ├─ Category: ${breakdown.category_score}/35 (count=${signals.categoryCount || 0})`,
    `  ├─ Time:     ${breakdown.time_score}/20 (weekend=${signals.isWeekend}, daytime=${signals.isDaytime})`,
    `  └─ Free:     ${breakdown.free_bias_score}/10 (ratio=${signals.freeRatio?.toFixed(2) || 'N/A'}, total=${signals.freeTotal || 0})`,
  ];

  return lines.join('\n');
}
