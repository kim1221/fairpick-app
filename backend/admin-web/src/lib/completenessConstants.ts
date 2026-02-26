/**
 * Completeness 레벨 공통 상수
 *
 * 백엔드 SQL 필터(index.ts)와 프론트 표시(CompletenessBar)가
 * 동일한 임계값을 사용하도록 단일 소스로 관리합니다.
 *
 * ## 점수 산정 기준 (totalWeight ≈ 33.5)
 *   - 공통 필수(weight=3): title, start_at, venue, main_category, image_url → max 15
 *   - 공통 중요(weight=2): end_at, region, address, overview               → max 8
 *   - 공통 중요(weight=1): sub_category, lat/lng, price_info, opening_hours,
 *                          external_links                                   → max 5
 *   - 공통 선택(weight=0.5): price_min, price_max, parking, derived_tags   → max 2
 *   - 공통 선택(weight=1): metadata                                         → max 1
 *   - 카테고리 핵심 2개 필드(weight=1 each): cast/genre, artists/genre 등  → max 2
 *
 * ## 실제 DB 분포 (2270개 이벤트, 2026-02 기준)
 *   min=19, p20=27, p50=27, p85=29, p95=29, max=32.5
 *   empty(<22): 0.1% / poor(22-27): 9.8% / good(27-30): 87.1% / excellent(≥30): 3.0%
 *
 * ## 임계값 의미
 *   - empty : 필수 필드 대부분 누락 (미수집/미처리 단계)
 *   - poor  : 핵심 AI 보강 누락 (lat/lng, overview, opening_hours 등 미입력)
 *   - good  : 공통 AI 보강 완료, 카테고리 특화 메타 일부 있음
 *   - excellent: 카테고리 특화 핵심 필드(cast, artists 등)까지 채워진 최고 품질 (상위 3%)
 */

export type CompletenessLevel = 'empty' | 'poor' | 'good' | 'excellent';

/** 절대 점수 → 레벨 매핑 임계값 */
export const COMPLETENESS_SCORE_THRESHOLDS = {
  /** score < POOR → empty */
  POOR: 22,
  /** score < GOOD → poor */
  GOOD: 27,
  /** score < EXCELLENT → good */
  EXCELLENT: 30,
} as const;

/** 점수로 레벨 판별 (백엔드 dataQuality.ts와 동일 로직) */
export function scoreToLevel(score: number): CompletenessLevel {
  if (score < COMPLETENESS_SCORE_THRESHOLDS.POOR) return 'empty';
  if (score < COMPLETENESS_SCORE_THRESHOLDS.GOOD) return 'poor';
  if (score < COMPLETENESS_SCORE_THRESHOLDS.EXCELLENT) return 'good';
  return 'excellent';
}

/** 레벨별 UI 설정 */
export const COMPLETENESS_LEVEL_CONFIG: Record<
  CompletenessLevel,
  { label: string; emoji: string; color: string; textColor: string; barColor: string }
> = {
  empty: {
    label: '미완료',
    emoji: '🔴',
    color: 'red',
    textColor: 'text-red-700',
    barColor: 'bg-red-500',
  },
  poor: {
    label: '부족',
    emoji: '🟠',
    color: 'orange',
    textColor: 'text-orange-700',
    barColor: 'bg-orange-500',
  },
  good: {
    label: '양호',
    emoji: '🟡',
    color: 'yellow',
    textColor: 'text-yellow-700',
    barColor: 'bg-yellow-500',
  },
  excellent: {
    label: '완벽',
    emoji: '🟢',
    color: 'green',
    textColor: 'text-green-700',
    barColor: 'bg-green-500',
  },
};
