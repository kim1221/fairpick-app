/**
 * 비용 관제 타입 정의
 *
 * costType 의미:
 * - 'aggregated'  : 내부 usage 로그/DB 기반 집계값 (provider 청구서 기준 아님)
 * - 'estimated'   : 사용량 × 단가 추정 (실제 청구액과 차이 있을 수 있음)
 * - 'manual'      : 수동 입력 (2차 구현)
 * - 'usage-only'  : 사용량만 추적, 과금 없음
 */

export type CostCategory = 'ai' | 'infrastructure' | 'database' | 'storage' | 'api' | 'other';

export type CostType = 'aggregated' | 'estimated' | 'manual' | 'usage-only';

export interface CostMetric {
  label: string;      // '요청 수', '입력 토큰', '저장 용량'
  value: number;
  unit: string;       // '건', 'tokens', 'GB', '개'
  formatted: string;  // '1,234건', '2.3 GB'
}

export interface CostItem {
  id: string;
  category: CostCategory;
  provider: string;           // 'Google Gemini', 'OpenAI', 'Cloudflare R2'
  name: string;               // 카드 제목
  costType: CostType;
  amount: number | null;      // usage-only는 null
  currency: 'USD' | 'KRW';
  costDriver: string;         // 왜 발생: '이벤트 보강 배치 (매일 04:15)'
  relatedFeature: string;     // 관련 기능 키
  shortExplanation: string;   // 운영자용 1줄 설명
  sourceOfTruth: string;      // 계산 근거
  pricingRef: string | null;  // 단가 참고
  noAmountReason?: string;    // usage-only일 때 금액이 없는 이유
  usageMetrics: CostMetric[];
  models?: string[];          // AI 항목 — 사용 모델 목록
  // DB 항목 전용
  tables?: { name: string; bytes: number; sizeFormatted: string; rowEstimate: number }[];
  // API 항목 전용
  jobName?: string;
  lastRunAt?: string | null;
}

export interface AiDailyTrend {
  date: string;   // 'YYYY-MM-DD'
  costUsd: number;
  requests: number;
}

export interface AiCostResponse {
  period: string;
  items: CostItem[];
  dailyTrend: AiDailyTrend[];
  embeddingToday: {
    count: number;
    freeLimit: number;
  };
  summary: {
    totalUsd: number;
    totalExactUsd: number;
    totalEstimatedUsd: number;
    usageOnlyCount: number;
    costTypeNote: string;
  };
}

export interface DbCostResponse {
  items: CostItem[];
}

export interface StorageCostResponse {
  items: CostItem[];
  cachedAt: string | null;
  fromCache: boolean;
}

export interface ApiUsageResponse {
  period: string;
  items: CostItem[];
}

export type AiPeriod = 'today' | 'this_month' | 'last_month';

export interface ManualCostItem {
  key: string;
  name: string;
  amount_usd: number;
  period: string;
  note: string | null;
  updated_at: string;
}

export interface ManualCostResponse {
  items: ManualCostItem[];
}
