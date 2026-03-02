/**
 * Phase 2-B: Personal Score Audit Utilities
 *
 * 목적: Personal Score 계산 결과가 Spec v1.0과 일치하는지 자동 검증
 *
 * Spec: /docs/PHASE_2B_PERSONAL_SCORE_SPEC.md
 */

import { computePersonalScoreForEvent, PersonalScoreInput, PersonalScoreResult } from './personalScore';
import { loadUserProfile } from './userProfile';
import type { UserProfile as _UserProfile } from './userProfile';
import { normalizeRegionKey, normalizeCategoryKey, getTimeBucketsFromDate, detectKeyMappingIssues } from './normalizationDebug';

// ============================================================
// 타입 정의
// ============================================================

export interface SpecCheck {
  name: string;
  pass: boolean;
  message: string;
  expected?: any;
  actual?: any;
}

export interface AuditResult {
  /** 이벤트 요약 */
  eventSummary: {
    id: string;
    title?: string;
    region?: string | null;
    category?: string | null;
    startAt?: string | Date | null;
    isFree?: boolean | null;
  };

  /** 프로필 요약 */
  profileSummary: {
    views: number;
    actions: number;
    regionsCount: number;
    categoriesCount: number;
    topRegions: string[];
    topCategories: string[];
  };

  /** 계산 결과 (Spec breakdown) */
  computed: PersonalScoreResult;

  /** Spec 준수 검증 결과 */
  specChecks: SpecCheck[];

  /** 키 정규화 검증 */
  keyNormalizationChecks: {
    regionNormalized: string | null;
    categoryNormalized: string | null;
    timeBuckets: {
      isWeekend: boolean | null;
      isDaytime: boolean | null;
      parseSuccess: boolean;
    };
    mappingWarnings: string[];
  };

  /** 경고 목록 */
  warnings: string[];

  /** 전체 통과 여부 */
  allPass: boolean;
}

export interface AuditOptions {
  /** 상세 로그 출력 여부 (기본: false) */
  verbose?: boolean;
}

// ============================================================
// Spec 검증 함수
// ============================================================

/**
 * Region/Category 구간별 고정 점수 검증
 * 
 * Spec:
 * - count=0: 0점
 * - count=1~2: 10점
 * - count=3~4: 20점
 * - count≥5: 35점
 */
function validateBracketScore(
  count: number | undefined,
  actualScore: number,
  fieldName: string
): SpecCheck {
  if (count === undefined || count === 0) {
    return {
      name: `${fieldName}_bracket`,
      pass: actualScore === 0,
      message: `count=0 should yield 0 points`,
      expected: 0,
      actual: actualScore,
    };
  }

  let expectedScore = 0;
  if (count <= 2) {
    expectedScore = 10;
  } else if (count <= 4) {
    expectedScore = 20;
  } else {
    expectedScore = 35;
  }

  return {
    name: `${fieldName}_bracket`,
    pass: actualScore === expectedScore,
    message: `count=${count} should yield ${expectedScore} points (bracket rule)`,
    expected: expectedScore,
    actual: actualScore,
  };
}

/**
 * Free Bias Score 검증
 * 
 * Spec:
 * - total < 5: 0점
 * - is_free=true: free_ratio ≥0.7 → 10점, 0.5~0.69 → 5점, <0.5 → 0점
 * - is_free=false: free_ratio ≤0.3 → 10점, 0.31~0.49 → 5점, >0.49 → 0점
 */
function validateFreeBiasScore(
  result: PersonalScoreResult,
  isFree: boolean | null | undefined
): SpecCheck {
  const actualScore = result.breakdown.free_bias_score;
  const freeTotal = result.signals.freeTotal || 0;
  const freeRatio = result.signals.freeRatio || 0;

  // total < 5: 0점
  if (freeTotal < 5) {
    return {
      name: 'free_bias_learning_insufficient',
      pass: actualScore === 0,
      message: `total=${freeTotal} < 5 should yield 0 points`,
      expected: 0,
      actual: actualScore,
    };
  }

  // is_free 정보 없음: 0점
  if (isFree === null || isFree === undefined) {
    return {
      name: 'free_bias_missing_info',
      pass: actualScore === 0,
      message: 'is_free=null should yield 0 points',
      expected: 0,
      actual: actualScore,
    };
  }

  let expectedScore = 0;

  if (isFree === true) {
    // 무료 이벤트
    if (freeRatio >= 0.7) {
      expectedScore = 10;
    } else if (freeRatio >= 0.5) {
      expectedScore = 5;
    } else {
      expectedScore = 0;
    }
  } else {
    // 유료 이벤트
    if (freeRatio <= 0.3) {
      expectedScore = 10;
    } else if (freeRatio <= 0.49) {
      expectedScore = 5;
    } else {
      expectedScore = 0;
    }
  }

  return {
    name: 'free_bias_score_rule',
    pass: actualScore === expectedScore,
    message: `is_free=${isFree}, ratio=${freeRatio.toFixed(2)}, total=${freeTotal} should yield ${expectedScore} points`,
    expected: expectedScore,
    actual: actualScore,
  };
}

/**
 * Time Score 검증
 * 
 * Spec:
 * - start_at 파싱 실패 시 timeScore=0 + warning
 * - 2축 독립 계산 (주중/주말 0~10 + 낮/밤 0~10)
 */
function validateTimeScore(
  result: PersonalScoreResult,
  startAt: string | Date | null | undefined
): SpecCheck {
  const actualScore = result.breakdown.time_score;
  const timeCheck = getTimeBucketsFromDate(startAt);

  // 파싱 실패 시 0점 기대
  if (!timeCheck.parseSuccess) {
    return {
      name: 'time_score_parse_failed',
      pass: actualScore === 0,
      message: `start_at parse failed (${timeCheck.error || 'unknown'}), should yield 0 points`,
      expected: 0,
      actual: actualScore,
    };
  }

  // 점수 범위 검증 (0~20)
  return {
    name: 'time_score_range',
    pass: actualScore >= 0 && actualScore <= 20,
    message: 'time_score must be in range 0~20',
    expected: '0~20',
    actual: actualScore,
  };
}

// ============================================================
// Public API
// ============================================================

/**
 * 단일 이벤트에 대한 Personal Score 계산 및 Spec 검증
 *
 * @param event - 이벤트 데이터
 * @param opts - Audit 옵션
 * @returns AuditResult (계산 결과 + 검증 결과)
 */
export async function auditPersonalScoreOnEvent(
  event: PersonalScoreInput,
  opts?: AuditOptions
): Promise<AuditResult> {
  void opts?.verbose;
  const warnings: string[] = [];
  const specChecks: SpecCheck[] = [];

  try {
    // 1. 프로필 로드
    const profile = await loadUserProfile();

    // 프로필 요약
    const topRegions = Object.entries(profile.preferred_regions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);

    const topCategories = Object.entries(profile.preferred_categories)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);

    const profileSummary = {
      views: profile.stats.views,
      actions: profile.stats.actions,
      regionsCount: Object.keys(profile.preferred_regions).length,
      categoriesCount: Object.keys(profile.preferred_categories).length,
      topRegions,
      topCategories,
    };

    // 2. Personal Score 계산 (기존 로직 사용)
    const computed = await computePersonalScoreForEvent(event);

    // 3. 키 정규화 검증
    const regionNormalized = normalizeRegionKey(event.region);
    const categoryNormalized = normalizeCategoryKey(event.category);
    const timeBuckets = getTimeBucketsFromDate(event.start_at);
    const mappingWarnings = detectKeyMappingIssues(event);

    warnings.push(...mappingWarnings);

    // 4. Spec 검증

    // 4-1. Total Score 범위 (0~100)
    specChecks.push({
      name: 'total_score_range',
      pass: computed.score >= 0 && computed.score <= 100,
      message: 'Total score must be in range 0~100',
      expected: '0~100',
      actual: computed.score,
    });

    // 4-2. Region Score 구간별 점수
    specChecks.push(
      validateBracketScore(
        computed.signals.regionCount,
        computed.breakdown.region_score,
        'region'
      )
    );

    // 4-3. Category Score 구간별 점수
    specChecks.push(
      validateBracketScore(
        computed.signals.categoryCount,
        computed.breakdown.category_score,
        'category'
      )
    );

    // 4-4. Time Score 검증
    specChecks.push(validateTimeScore(computed, event.start_at));

    // 4-5. Free Bias Score 검증
    specChecks.push(validateFreeBiasScore(computed, event.is_free));

    // 4-6. Breakdown 합계 검증
    const breakdownSum =
      computed.breakdown.region_score +
      computed.breakdown.category_score +
      computed.breakdown.time_score +
      computed.breakdown.free_bias_score;

    specChecks.push({
      name: 'breakdown_sum_matches_total',
      pass: Math.abs(breakdownSum - computed.score) < 0.01, // 부동소수점 오차 허용
      message: 'Breakdown sum must match total score',
      expected: computed.score,
      actual: breakdownSum,
    });

    // 5. 경고 추가 (start_at 파싱 실패)
    if (!timeBuckets.parseSuccess) {
      warnings.push(`start_at parse failed: ${timeBuckets.error || 'unknown'} → time_score=0 expected`);
    }

    // 6. 전체 통과 여부
    const allPass = specChecks.every((check) => check.pass);

    return {
      eventSummary: {
        id: event.id,
        title: event.title,
        region: event.region,
        category: event.category,
        startAt: event.start_at,
        isFree: event.is_free,
      },
      profileSummary,
      computed,
      specChecks,
      keyNormalizationChecks: {
        regionNormalized,
        categoryNormalized,
        timeBuckets: {
          isWeekend: timeBuckets.isWeekend,
          isDaytime: timeBuckets.isDaytime,
          parseSuccess: timeBuckets.parseSuccess,
        },
        mappingWarnings,
      },
      warnings,
      allPass,
    };
  } catch (error) {
    // Audit 실패 시에도 결과 반환
    console.error('[PersonalScoreAudit] Audit failed', { error });

    return {
      eventSummary: {
        id: event.id,
        title: event.title,
        region: event.region,
        category: event.category,
        startAt: event.start_at,
        isFree: event.is_free,
      },
      profileSummary: {
        views: 0,
        actions: 0,
        regionsCount: 0,
        categoriesCount: 0,
        topRegions: [],
        topCategories: [],
      },
      computed: {
        score: 0,
        breakdown: {
          region_score: 0,
          category_score: 0,
          time_score: 0,
          free_bias_score: 0,
        },
        signals: {},
        reason: 'audit_error',
      },
      specChecks: [
        {
          name: 'audit_execution',
          pass: false,
          message: `Audit execution failed: ${error instanceof Error ? error.message : 'unknown'}`,
        },
      ],
      keyNormalizationChecks: {
        regionNormalized: null,
        categoryNormalized: null,
        timeBuckets: {
          isWeekend: null,
          isDaytime: null,
          parseSuccess: false,
        },
        mappingWarnings: [],
      },
      warnings: [`Audit execution failed: ${error instanceof Error ? error.message : 'unknown'}`],
      allPass: false,
    };
  }
}

/**
 * Audit 결과를 콘솔 박스 형태로 포맷
 */
export function formatAuditReport(audit: AuditResult): string {
  const lines: string[] = [];

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('🔍 Phase 2-B Personal Score Audit Report');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Event Summary
  lines.push('');
  lines.push('📦 Event Summary:');
  lines.push(`  ID: ${audit.eventSummary.id}`);
  lines.push(`  Title: ${audit.eventSummary.title?.substring(0, 50) || 'N/A'}`);
  lines.push(`  Region: ${audit.eventSummary.region || 'N/A'}`);
  lines.push(`  Category: ${audit.eventSummary.category || 'N/A'}`);
  lines.push(`  Start: ${audit.eventSummary.startAt || 'N/A'}`);
  lines.push(`  Free: ${audit.eventSummary.isFree !== undefined ? audit.eventSummary.isFree : 'N/A'}`);

  // Profile Summary
  lines.push('');
  lines.push('👤 Profile Summary:');
  lines.push(`  Views: ${audit.profileSummary.views}, Actions: ${audit.profileSummary.actions}`);
  lines.push(`  Regions: ${audit.profileSummary.regionsCount} (Top: ${audit.profileSummary.topRegions.join(', ') || 'none'})`);
  lines.push(`  Categories: ${audit.profileSummary.categoriesCount} (Top: ${audit.profileSummary.topCategories.join(', ') || 'none'})`);

  // Computed Score
  lines.push('');
  lines.push('💯 Computed Score:');
  lines.push(`  Total: ${audit.computed.score}/100`);
  lines.push(`  ├─ Region:   ${audit.computed.breakdown.region_score}/35 (count=${audit.computed.signals.regionCount || 0})`);
  lines.push(`  ├─ Category: ${audit.computed.breakdown.category_score}/35 (count=${audit.computed.signals.categoryCount || 0})`);
  lines.push(`  ├─ Time:     ${audit.computed.breakdown.time_score}/20 (weekend=${audit.computed.signals.isWeekend}, day=${audit.computed.signals.isDaytime})`);
  lines.push(`  └─ Free:     ${audit.computed.breakdown.free_bias_score}/10 (ratio=${audit.computed.signals.freeRatio?.toFixed(2) || 'N/A'}, total=${audit.computed.signals.freeTotal || 0})`);

  // Spec Checks
  lines.push('');
  lines.push('✅ Spec Checks:');
  const passedChecks = audit.specChecks.filter((c) => c.pass);
  const failedChecks = audit.specChecks.filter((c) => !c.pass);

  if (failedChecks.length > 0) {
    lines.push(`  ❌ FAILED (${failedChecks.length}/${audit.specChecks.length})`);
    failedChecks.forEach((check) => {
      lines.push(`     • ${check.name}: ${check.message}`);
      lines.push(`       Expected: ${JSON.stringify(check.expected)}, Actual: ${JSON.stringify(check.actual)}`);
    });
  } else {
    lines.push(`  ✅ ALL PASSED (${passedChecks.length}/${audit.specChecks.length})`);
  }

  // Key Normalization
  lines.push('');
  lines.push('🔑 Key Normalization:');
  lines.push(`  Region: '${audit.eventSummary.region}' → ${audit.keyNormalizationChecks.regionNormalized || 'null'}`);
  lines.push(`  Category: '${audit.eventSummary.category}' → ${audit.keyNormalizationChecks.categoryNormalized || 'null'}`);
  lines.push(`  Time Parse: ${audit.keyNormalizationChecks.timeBuckets.parseSuccess ? '✅' : '❌'}`);

  // Warnings
  if (audit.warnings.length > 0) {
    lines.push('');
    lines.push('⚠️  Warnings:');
    audit.warnings.forEach((warning) => {
      lines.push(`  • ${warning}`);
    });
  }

  // Next Action
  lines.push('');
  if (audit.allPass) {
    lines.push('🎉 Result: PASS - No action required');
  } else {
    lines.push('❌ Result: FAIL - Review spec checks above');
    lines.push('');
    lines.push('📚 Next Action:');
    lines.push('  1. Check /docs/PHASE_2B_PERSONAL_SCORE_SPEC.md for spec details');
    lines.push('  2. Review failed checks and expected vs actual values');
    lines.push('  3. See /docs/PHASE_2B_AUDIT_PLAYBOOK.md for common scenarios');
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}


