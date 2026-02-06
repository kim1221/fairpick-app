/**
 * AI Enrichment 정책 설정
 * 
 * 신뢰도 기반 자동화 및 필드별 중요도 설정
 */

export interface EnrichmentPolicy {
  // 신뢰도 임계값
  autoApplyThreshold: number;      // 이 값 이상이면 자동 적용
  suggestionThreshold: number;     // 이 값 이상이면 제안 생성 (0으로 설정하면 모든 AI 데이터 표시)
  
  // 필드별 중요도 (critical = 항상 제안, normal = 신뢰도 기반, low = 신뢰도 기반 자동/제안)
  fieldPriority: Record<string, 'critical' | 'normal' | 'low'>;
}

/**
 * 기본 정책: 균형잡힌 자동화
 */
export const DEFAULT_POLICY: EnrichmentPolicy = {
  autoApplyThreshold: 80,   // 80% 이상 신뢰도면 자동 적용
  suggestionThreshold: 0,   // 0% 이상이면 제안 생성 (모든 AI 데이터 표시)
  
  fieldPriority: {
    // 🔴 Critical: 항상 제안 방식 (정확도가 중요)
    'price_min': 'critical',
    'price_max': 'critical',
    'venue': 'critical',
    'address': 'critical',
    'start_at': 'critical',
    'end_at': 'critical',
    
    // 🟡 Normal: 신뢰도 기반 (80% 이상이면 자동)
    'overview': 'normal',
    'external_links': 'normal',
    'opening_hours': 'normal',
    'metadata.display.performance': 'normal',
    'metadata.display.exhibition': 'normal',
    
    // 🟢 Low: 항상 자동 적용 (덜 중요)
    'derived_tags': 'low',
    'metadata.internal': 'low',
  },
};

/**
 * 공격적 자동화 정책 (서비스 초기)
 */
export const AGGRESSIVE_POLICY: EnrichmentPolicy = {
  autoApplyThreshold: 70,   // 70% 이상이면 자동
  suggestionThreshold: 50,
  
  fieldPriority: {
    // Critical: 가격과 주소만
    'price_min': 'critical',
    'price_max': 'critical',
    'address': 'critical',
    
    // Normal: 대부분 필드
    'venue': 'normal',
    'start_at': 'normal',
    'end_at': 'normal',
    'overview': 'normal',
    'external_links': 'normal',
    'opening_hours': 'normal',
    'metadata.display.performance': 'normal',
    'metadata.display.exhibition': 'normal',
    
    // Low: 태그와 내부 필드
    'derived_tags': 'low',
    'metadata.internal': 'low',
  },
};

/**
 * 보수적 정책 (품질 중시)
 */
export const CONSERVATIVE_POLICY: EnrichmentPolicy = {
  autoApplyThreshold: 90,   // 90% 이상만 자동
  suggestionThreshold: 70,
  
  fieldPriority: {
    // Critical: 거의 모든 중요 필드
    'price_min': 'critical',
    'price_max': 'critical',
    'venue': 'critical',
    'address': 'critical',
    'start_at': 'critical',
    'end_at': 'critical',
    'overview': 'critical',
    'external_links': 'critical',
    'opening_hours': 'critical',
    'metadata.display.performance': 'critical',
    'metadata.display.exhibition': 'critical',
    
    // Low: 태그와 내부 필드만 자동
    'derived_tags': 'low',
    'metadata.internal': 'low',
  },
};

/**
 * 필드 자동 적용 여부 결정
 */
export function shouldAutoApply(
  fieldName: string,
  confidence: number,
  policy: EnrichmentPolicy = DEFAULT_POLICY
): 'auto' | 'suggestion' | 'skip' {
  const priority = policy.fieldPriority[fieldName] || 'normal';
  
  // Critical 필드: 항상 제안 (신뢰도 무관)
  if (priority === 'critical') {
    return 'suggestion';  // 신뢰도와 관계없이 무조건 제안
  }
  
  // Low 필드: 신뢰도 임계값 이상이면 자동, 미만이면 제안
  if (priority === 'low') {
    if (confidence >= policy.autoApplyThreshold) {
      return 'auto';
    }
    return 'suggestion';  // 낮은 신뢰도도 제안으로 표시
  }
  
  // Normal 필드: 신뢰도 기반
  if (confidence >= policy.autoApplyThreshold) {
    return 'auto';
  }
  
  // 신뢰도가 낮아도 제안으로 표시 (skip 하지 않음)
  return 'suggestion';
}

/**
 * 정책 선택 헬퍼
 */
export function getPolicy(mode: 'default' | 'aggressive' | 'conservative'): EnrichmentPolicy {
  switch (mode) {
    case 'aggressive':
      return AGGRESSIVE_POLICY;
    case 'conservative':
      return CONSERVATIVE_POLICY;
    default:
      return DEFAULT_POLICY;
  }
}

