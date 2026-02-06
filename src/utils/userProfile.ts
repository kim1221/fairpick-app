/**
 * 로컬 개인화 프로필 유틸리티 (Phase 2-A MVP)
 *
 * 목적: 사용자 행동 기반 로컬 프로필 누적 (정렬 반영 금지)
 *
 * Storage: @apps-in-toss/framework Storage API 사용
 *
 * 프로필 누적 규칙:
 * - view: region +1, category +1, time_bucket +1, free/paid_views +1
 * - action:
 *   * like: +3
 *   * share: +5
 *   * ticket_click: +7
 *   * 모두 stats.actions +1, free/paid_actions +1
 *
 * 안전장치:
 * - 상위 30개만 유지 (무한 성장 방지)
 * - region/category 없으면 스킵 (unknown 키 금지)
 * - Storage 실패 시 앱 크래시 방지
 */

import { Storage } from '@apps-in-toss/framework';

// ============================================================
// 타입 정의
// ============================================================

/**
 * 사용자 프로필 데이터 구조
 */
export interface UserProfile {
  version: 1;
  updatedAt: string; // ISO8601
  stats: {
    views: number;
    actions: number;
  };
  preferred_regions: Record<string, number>;
  preferred_categories: Record<string, number>;
  time_preference: {
    weekday: number;
    weekend: number;
    daytime: number;
    night: number;
  };
  free_bias: {
    free_views: number;
    paid_views: number;
    free_actions: number;
    paid_actions: number;
  };
}

/**
 * View 업데이트 페이로드
 */
export interface ViewPayload {
  eventId: string;
  region?: string;
  mainCategory?: string;
  startAt?: string; // ISO8601
  isFree?: boolean;
}

/**
 * Action 업데이트 페이로드
 */
export interface ActionPayload {
  eventId: string;
  actionType: 'like' | 'share' | 'ticket_click';
  region?: string;
  mainCategory?: string;
  startAt?: string; // ISO8601
  isFree?: boolean;
}

// ============================================================
// 상수
// ============================================================

const STORAGE_KEY = '@fairpick/user_profile:v1';
const MAX_MAP_SIZE = 30;

const ACTION_WEIGHTS = {
  like: 3,
  share: 5,
  ticket_click: 7,
} as const;

// ============================================================
// 내부 유틸리티
// ============================================================

/**
 * 빈 프로필 생성
 */
function createEmptyProfile(): UserProfile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    stats: {
      views: 0,
      actions: 0,
    },
    preferred_regions: {},
    preferred_categories: {},
    time_preference: {
      weekday: 0,
      weekend: 0,
      daytime: 0,
      night: 0,
    },
    free_bias: {
      free_views: 0,
      paid_views: 0,
      free_actions: 0,
      paid_actions: 0,
    },
  };
}

/**
 * 맵 크기 제한 (상위 30개만 유지)
 */
function trimMap(map: Record<string, number>): Record<string, number> {
  const entries = Object.entries(map);

  if (entries.length <= MAX_MAP_SIZE) {
    return map;
  }

  // 값 기준 내림차순 정렬 후 상위 30개만 유지
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  const trimmed = sorted.slice(0, MAX_MAP_SIZE);

  const result: Record<string, number> = {};
  for (const [key, value] of trimmed) {
    result[key] = value;
  }

  console.log(`[UserProfile] Trimmed map from ${entries.length} to ${MAX_MAP_SIZE}`);
  return result;
}

/**
 * 시간대 판별 (weekday/weekend, daytime/night)
 */
function getTimeBucket(dateStr: string | undefined): {
  dayType: 'weekday' | 'weekend';
  timeType: 'daytime' | 'night';
} {
  const date = dateStr ? new Date(dateStr) : new Date();
  const dayOfWeek = date.getDay(); // 0=일요일, 6=토요일
  const hour = date.getHours();

  const dayType = (dayOfWeek === 0 || dayOfWeek === 6) ? 'weekend' : 'weekday';
  const timeType = (hour >= 6 && hour < 18) ? 'daytime' : 'night';

  return { dayType, timeType };
}

// ============================================================
// Storage 입출력
// ============================================================

/**
 * 프로필 로드
 */
export async function loadUserProfile(): Promise<UserProfile> {
  try {
    console.log('[UserProfile] Loading profile...');

    const raw = await Storage.getItem(STORAGE_KEY);

    if (!raw) {
      console.log('[UserProfile] No profile found, creating empty');
      return createEmptyProfile();
    }

    const parsed = JSON.parse(raw);

    // 구조 검증
    if (parsed.version === 1 && parsed.stats && parsed.preferred_regions) {
      console.log('[UserProfile] Profile loaded successfully', {
        views: parsed.stats.views,
        actions: parsed.stats.actions,
        regionsCount: Object.keys(parsed.preferred_regions).length,
        categoriesCount: Object.keys(parsed.preferred_categories).length,
      });
      return parsed as UserProfile;
    }

    // 알 수 없는 구조 → 리셋
    console.warn('[UserProfile] Unknown structure, resetting', { parsed });
    return createEmptyProfile();
  } catch (error) {
    console.error('[UserProfile] Failed to load profile, returning empty', {
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return createEmptyProfile();
  }
}

/**
 * 프로필 저장
 */
export async function saveUserProfile(profile: UserProfile): Promise<void> {
  try {
    const jsonStr = JSON.stringify(profile);
    await Storage.setItem(STORAGE_KEY, jsonStr);

    console.log('[UserProfile] Profile saved successfully', {
      views: profile.stats.views,
      actions: profile.stats.actions,
      regions: Object.keys(profile.preferred_regions).length,
      categories: Object.keys(profile.preferred_categories).length,
    });
  } catch (error) {
    // 저장 실패 시 앱 크래시 방지
    console.warn('[UserProfile] Failed to save profile (non-critical)', {
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 프로필 초기화 (디버깅용)
 */
export async function resetUserProfile(): Promise<void> {
  try {
    const empty = createEmptyProfile();
    await saveUserProfile(empty);
    console.log('[UserProfile] Profile reset successfully');
  } catch (error) {
    console.error('[UserProfile] Failed to reset profile', { error });
  }
}

// ============================================================
// 프로필 업데이트
// ============================================================

/**
 * View 발생 시 프로필 업데이트
 */
export async function updateProfileOnView(payload: ViewPayload): Promise<UserProfile> {
  try {
    const profile = await loadUserProfile();

    // stats 업데이트
    profile.stats.views += 1;

    // region 업데이트 (있을 경우만)
    if (payload.region && payload.region !== '전국' && payload.region.trim() !== '') {
      const currentCount = profile.preferred_regions[payload.region] || 0;
      profile.preferred_regions[payload.region] = currentCount + 1;
    }

    // category 업데이트 (있을 경우만)
    if (payload.mainCategory && payload.mainCategory !== '전체' && payload.mainCategory.trim() !== '') {
      const currentCount = profile.preferred_categories[payload.mainCategory] || 0;
      profile.preferred_categories[payload.mainCategory] = currentCount + 1;
    }

    // 시간대 업데이트
    const { dayType, timeType } = getTimeBucket(payload.startAt);
    profile.time_preference[dayType] += 1;
    profile.time_preference[timeType] += 1;

    // 무료/유료 bias 업데이트
    if (payload.isFree === true) {
      profile.free_bias.free_views += 1;
    } else if (payload.isFree === false) {
      profile.free_bias.paid_views += 1;
    }

    // 맵 크기 제한
    profile.preferred_regions = trimMap(profile.preferred_regions);
    profile.preferred_categories = trimMap(profile.preferred_categories);

    // updatedAt 갱신
    profile.updatedAt = new Date().toISOString();

    await saveUserProfile(profile);

    console.log('[UserProfile] Profile updated on view', {
      eventId: payload.eventId,
      region: payload.region,
      category: payload.mainCategory,
      isFree: payload.isFree,
      totalViews: profile.stats.views,
    });

    return profile;
  } catch (error) {
    console.error('[UserProfile] Failed to update profile on view', {
      error,
      eventId: payload.eventId,
    });

    // 실패 시에도 현재 프로필 반환 (앱 크래시 방지)
    return await loadUserProfile();
  }
}

/**
 * Action 발생 시 프로필 업데이트
 */
export async function updateProfileOnAction(payload: ActionPayload): Promise<UserProfile> {
  try {
    const profile = await loadUserProfile();

    const weight = ACTION_WEIGHTS[payload.actionType];

    // stats 업데이트
    profile.stats.actions += 1;

    // region 업데이트 (가중치 적용)
    if (payload.region && payload.region !== '전국' && payload.region.trim() !== '') {
      const currentCount = profile.preferred_regions[payload.region] || 0;
      profile.preferred_regions[payload.region] = currentCount + weight;
    }

    // category 업데이트 (가중치 적용)
    if (payload.mainCategory && payload.mainCategory !== '전체' && payload.mainCategory.trim() !== '') {
      const currentCount = profile.preferred_categories[payload.mainCategory] || 0;
      profile.preferred_categories[payload.mainCategory] = currentCount + weight;
    }

    // 시간대 업데이트 (가중치 적용)
    const { dayType, timeType } = getTimeBucket(payload.startAt);
    profile.time_preference[dayType] += weight;
    profile.time_preference[timeType] += weight;

    // 무료/유료 bias 업데이트
    if (payload.isFree === true) {
      profile.free_bias.free_actions += 1;
    } else if (payload.isFree === false) {
      profile.free_bias.paid_actions += 1;
    }

    // 맵 크기 제한
    profile.preferred_regions = trimMap(profile.preferred_regions);
    profile.preferred_categories = trimMap(profile.preferred_categories);

    // updatedAt 갱신
    profile.updatedAt = new Date().toISOString();

    await saveUserProfile(profile);

    console.log('[UserProfile] Profile updated on action', {
      eventId: payload.eventId,
      actionType: payload.actionType,
      weight,
      region: payload.region,
      category: payload.mainCategory,
      isFree: payload.isFree,
      totalActions: profile.stats.actions,
    });

    return profile;
  } catch (error) {
    console.error('[UserProfile] Failed to update profile on action', {
      error,
      eventId: payload.eventId,
      actionType: payload.actionType,
    });

    // 실패 시에도 현재 프로필 반환 (앱 크래시 방지)
    return await loadUserProfile();
  }
}

// ============================================================
// 프로필 요약
// ============================================================

/**
 * 사용자 프로필 요약 문자열 생성 (디버깅용)
 */
export function getUserProfileSummary(profile: UserProfile): string {
  const topRegions = Object.entries(profile.preferred_regions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([region, count]) => `${region}(${count})`)
    .join(', ');

  const topCategories = Object.entries(profile.preferred_categories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, count]) => `${category}(${count})`)
    .join(', ');

  const freeBiasRatio = profile.free_bias.free_views + profile.free_bias.paid_views > 0
    ? (profile.free_bias.free_views / (profile.free_bias.free_views + profile.free_bias.paid_views) * 100).toFixed(0)
    : 'N/A';

  return `
📊 사용자 프로필 요약
━━━━━━━━━━━━━━━━━━━━━
📈 통계
  - 조회수: ${profile.stats.views}
  - 액션수: ${profile.stats.actions}

📍 선호 지역 (Top 3)
  ${topRegions || '데이터 없음'}

🎭 선호 카테고리 (Top 3)
  ${topCategories || '데이터 없음'}

⏰ 시간대 선호
  - 주중/주말: ${profile.time_preference.weekday}/${profile.time_preference.weekend}
  - 낮/밤: ${profile.time_preference.daytime}/${profile.time_preference.night}

💰 무료 선호도
  - 무료 조회: ${profile.free_bias.free_views}
  - 유료 조회: ${profile.free_bias.paid_views}
  - 무료 비율: ${freeBiasRatio}%

🕒 마지막 업데이트
  ${new Date(profile.updatedAt).toLocaleString('ko-KR')}
━━━━━━━━━━━━━━━━━━━━━
  `.trim();
}
