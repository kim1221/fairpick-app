/**
 * AI 제안 시스템 - 신뢰도 계산
 * Phase 1: 데이터 출처별 신뢰도 점수 계산
 */

export type DataSource = 'PUBLIC_API' | 'NAVER_API' | 'AI' | 'MANUAL' | 'CALCULATED';

export interface FieldSuggestion {
  value: any;
  confidence: number;
  source: DataSource;
  source_detail: string;
  warning?: string;
  extracted_at: string;
}

export interface FieldSource {
  source: DataSource;
  source_detail: string;
  confidence: number;
  applied_at: string;
  applied_by?: string;
  original_suggestion?: DataSource;
}

/**
 * 출처별 기본 신뢰도
 */
const SOURCE_BASE_CONFIDENCE: Record<DataSource, number> = {
  PUBLIC_API: 95,    // KOPIS, Culture, TourAPI (가장 신뢰도 높음)
  NAVER_API: 85,     // Naver Place, Blog 등 (상향)
  AI: 75,            // Gemini AI 추출 (65 → 75로 상향)
  MANUAL: 100,       // 관리자 수동 입력 (가장 신뢰)
  CALCULATED: 90,    // 내부 로직 계산 (Phase 2 internal fields)
};

/**
 * 신뢰도 레벨
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'very-low';

export function getConfidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 85) return 'high';
  if (confidence >= 70) return 'medium';
  if (confidence >= 40) return 'low';
  return 'very-low';
}

/**
 * 신뢰도 점수 계산
 */
export function calculateConfidence(
  source: DataSource,
  fieldName: string,
  value: any,
  context?: {
    hasMultipleSources?: boolean;
    isPartialMatch?: boolean;
    hasContextualData?: boolean;
  }
): number {
  let confidence = SOURCE_BASE_CONFIDENCE[source];

  // 컨텍스트 기반 조정
  if (context) {
    // 여러 출처에서 일치하는 데이터
    if (context.hasMultipleSources) {
      confidence = Math.min(100, confidence + 10);
    }

    // 부분 매칭만 된 경우
    if (context.isPartialMatch) {
      confidence = Math.max(0, confidence - 15);
    }

    // 관련 컨텍스트 데이터가 있는 경우
    if (context.hasContextualData) {
      confidence = Math.min(100, confidence + 5);
    }
  }

  // 필드별 조정
  confidence = adjustConfidenceByField(fieldName, value, confidence);

  return Math.max(0, Math.min(100, confidence));
}

/**
 * 필드별 신뢰도 조정
 */
function adjustConfidenceByField(fieldName: string, value: any, baseConfidence: number): number {
  let adjusted = baseConfidence;

  // 1. 공연 시간 검증
  if (fieldName === 'duration_minutes' && typeof value === 'number') {
    if (value < 30) {
      // 30분 미만은 매우 의심스러움
      adjusted = Math.max(0, adjusted - 30);
    } else if (value < 60) {
      // 60분 미만은 약간 의심
      adjusted = Math.max(0, adjusted - 15);
    } else if (value > 300) {
      // 5시간 초과도 의심스러움
      adjusted = Math.max(0, adjusted - 20);
    }
  }

  // 2. 가격 검증
  if ((fieldName === 'price_min' || fieldName === 'price_max') && typeof value === 'number') {
    if (value < 0) {
      adjusted = 0; // 음수는 불가능
    } else if (value === 0) {
      // 무료는 확인 필요
      adjusted = Math.max(0, adjusted - 10);
    } else if (value > 500000) {
      // 50만원 초과는 의심스러움
      adjusted = Math.max(0, adjusted - 20);
    }
  }

  // 3. 배열 필드 (출연진, 장르 등)
  if (Array.isArray(value)) {
    if (value.length === 0) {
      adjusted = Math.max(0, adjusted - 20); // 빈 배열은 신뢰도 낮음
    } else if (value.length > 20) {
      adjusted = Math.max(0, adjusted - 15); // 너무 많은 항목도 의심
    }
  }

  // 4. 문자열 필드 (개요 등)
  if (typeof value === 'string') {
    if (value.length < 10) {
      adjusted = Math.max(0, adjusted - 20); // 너무 짧은 텍스트
    } else if (value.length > 2000) {
      adjusted = Math.max(0, adjusted - 10); // 너무 긴 텍스트
    }
  }

  return adjusted;
}

/**
 * 경고 메시지 생성
 */
export function generateWarning(fieldName: string, value: any): string | undefined {
  // 1. 공연 시간 경고
  if (fieldName === 'duration_minutes' && typeof value === 'number') {
    if (value < 30) {
      return `공연 시간이 너무 짧습니다 (${value}분). 확인이 필요합니다.`;
    } else if (value > 300) {
      return `공연 시간이 너무 깁니다 (${value}분). 확인이 필요합니다.`;
    }
  }

  // 2. 가격 경고
  if (fieldName === 'price_min' && typeof value === 'number') {
    if (value < 0) {
      return '가격이 음수입니다. 확인이 필요합니다.';
    } else if (value > 500000) {
      return `가격이 매우 높습니다 (${value.toLocaleString()}원). 확인이 필요합니다.`;
    }
  }

  // 3. 빈 배열 경고
  if (Array.isArray(value) && value.length === 0) {
    return `${fieldName}이(가) 비어있습니다. 확인이 필요합니다.`;
  }

  // 4. 짧은 텍스트 경고
  if (typeof value === 'string' && value.length < 10) {
    return `${fieldName}이(가) 너무 짧습니다. 확인이 필요합니다.`;
  }

  return undefined;
}

/**
 * 제안 생성 헬퍼
 */
export function createSuggestion(
  value: any,
  source: DataSource,
  sourceDetail: string,
  fieldName: string,
  context?: {
    hasMultipleSources?: boolean;
    isPartialMatch?: boolean;
    hasContextualData?: boolean;
  }
): FieldSuggestion {
  const confidence = calculateConfidence(source, fieldName, value, context);
  const warning = generateWarning(fieldName, value);

  return {
    value,
    confidence,
    source,
    source_detail: sourceDetail,
    ...(warning && { warning }),
    extracted_at: new Date().toISOString(),
  };
}

