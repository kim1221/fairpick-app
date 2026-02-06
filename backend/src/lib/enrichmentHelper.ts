/**
 * AI Enrichment 적용 헬퍼
 * 
 * 신뢰도 기반 자동 적용 vs 제안 생성
 */

import { pool } from '../db';
import { shouldAutoApply, DEFAULT_POLICY, EnrichmentPolicy } from '../lib/enrichmentPolicy';
import { createSuggestion } from '../lib/confidenceCalculator';

export interface EnrichmentDecision {
  action: 'auto' | 'suggestion' | 'skip';
  reason: string;
  confidence: number;
}

/**
 * 필드 적용 여부 결정
 */
export function decideFieldAction(
  fieldName: string,
  value: any,
  confidence: number,
  context: {
    hasExisting: boolean;
    manuallyEdited: boolean;
    policy?: EnrichmentPolicy;
  }
): EnrichmentDecision {
  const policy = context.policy || DEFAULT_POLICY;
  
  // 1. 수동 편집된 필드는 항상 스킵
  if (context.manuallyEdited) {
    return {
      action: 'skip',
      reason: 'manually_edited',
      confidence,
    };
  }
  
  // 2. 기존 값이 있으면 스킵
  if (context.hasExisting) {
    return {
      action: 'skip',
      reason: 'already_exists',
      confidence,
    };
  }
  
  // 3. 정책 기반 결정
  const action = shouldAutoApply(fieldName, confidence, policy);
  
  if (action === 'auto') {
    return {
      action: 'auto',
      reason: `confidence_${confidence}_above_${policy.autoApplyThreshold}`,
      confidence,
    };
  } else if (action === 'suggestion') {
    return {
      action: 'suggestion',
      reason: `confidence_${confidence}_requires_review`,
      confidence,
    };
  }
  
  return {
    action: 'skip',
    reason: `confidence_${confidence}_too_low`,
    confidence,
  };
}

/**
 * ai_suggestions에 제안 추가
 */
export async function addSuggestion(
  eventId: string,
  fieldName: string,
  value: any,
  confidence: number,
  source: string,
  sourceDetail: string
): Promise<void> {
  const suggestion = createSuggestion(
    value,
    'AI',
    sourceDetail,
    fieldName,
    { hasContextualData: true }
  );
  
  // 신뢰도 오버라이드 (실제 계산된 값 사용)
  suggestion.confidence = confidence;
  
  await pool.query(`
    UPDATE canonical_events
    SET ai_suggestions = COALESCE(ai_suggestions, '{}'::jsonb) || jsonb_build_object($1, $2::jsonb),
        updated_at = NOW()
    WHERE id = $3
  `, [fieldName, JSON.stringify(suggestion), eventId]);
  
  console.log(`[Enrich] 💡 Suggestion added: ${fieldName} (confidence: ${confidence}%)`);
}

/**
 * 필드 자동 적용 (DB 업데이트)
 */
export function prepareAutoUpdate(
  fieldName: string,
  value: any,
  confidence: number,
  updateFields: string[],
  updateValues: any[],
  paramIndex: { current: number }
): void {
  const timestamp = new Date().toISOString();
  
  // 필드 업데이트
  if (fieldName === 'derived_tags' || fieldName === 'opening_hours') {
    updateFields.push(`${fieldName} = $${paramIndex.current++}`);
    updateValues.push(JSON.stringify(value));
  } else if (fieldName.startsWith('metadata.display.')) {
    // metadata 필드는 jsonb_set 사용
    const path = fieldName.split('.').slice(1); // ['display', 'performance']
    updateFields.push(`metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{${path.join(',')}}',
      $${paramIndex.current++}::jsonb,
      true
    )`);
    updateValues.push(JSON.stringify(value));
  } else {
    updateFields.push(`${fieldName} = $${paramIndex.current++}`);
    updateValues.push(value);
  }
  
  // field_sources 업데이트
  updateFields.push(`field_sources = COALESCE(field_sources, '{}'::jsonb) || jsonb_build_object(
    '${fieldName}', jsonb_build_object(
      'source', 'AI',
      'sourceDetail', 'Gemini extracted (auto-applied)',
      'confidence', ${confidence},
      'updatedAt', '${timestamp}'
    )
  )`);
  
  console.log(`[Enrich] ✅ Auto-applied: ${fieldName} (confidence: ${confidence}%)`);
}

/**
 * 통계 추적
 */
export interface EnrichmentActionStats {
  autoApplied: number;
  suggestionsGenerated: number;
  skipped: number;
  byField: Record<string, {
    auto: number;
    suggestion: number;
    skip: number;
  }>;
}

export function createActionStats(): EnrichmentActionStats {
  return {
    autoApplied: 0,
    suggestionsGenerated: 0,
    skipped: 0,
    byField: {},
  };
}

export function updateActionStats(
  stats: EnrichmentActionStats,
  fieldName: string,
  action: 'auto' | 'suggestion' | 'skip'
): void {
  if (!stats.byField[fieldName]) {
    stats.byField[fieldName] = { auto: 0, suggestion: 0, skip: 0 };
  }
  
  stats.byField[fieldName][action]++;
  
  if (action === 'auto') {
    stats.autoApplied++;
  } else if (action === 'suggestion') {
    stats.suggestionsGenerated++;
  } else {
    stats.skipped++;
  }
}

