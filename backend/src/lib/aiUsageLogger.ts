/**
 * aiUsageLogger.ts
 *
 * AI API(Gemini / OpenAI) 사용량 추적 유틸리티.
 * generateContent / embedContent / chat.completions 호출 후 usage 정보를 DB에 저장합니다.
 *
 * 설계 원칙:
 * - fire-and-forget: 로깅 실패가 메인 플로우에 영향을 주지 않음
 * - DB 인서트를 setImmediate로 지연하여 응답 지연 최소화
 * - 비용은 내부 usage 로그 기반 추정값 (provider 청구서 기준 아님)
 */

import { pool } from '../db';

// ─────────────────────────────────────────────────────────────
// 비용 계산 (2026년 3월 기준 단가, USD)
// Gemini: https://ai.google.dev/pricing
// OpenAI: https://openai.com/pricing
// ─────────────────────────────────────────────────────────────

interface ModelPricing {
  inputPer1M: number;   // USD per 1M input tokens
  outputPer1M: number;  // USD per 1M output tokens
}

// GeminiPricing은 하위 호환을 위해 유지
type GeminiPricing = ModelPricing;

const PRICING: Record<string, ModelPricing> = {
  // ── Gemini ──────────────────────────────────────────────────
  // Gemini 2.5 Flash (최신) — 실제 Google Cloud Billing 역산 기준 (2026-03)
  // Google Cloud SKU: input $0.30/1M · non-thinking output $2.50/1M
  'gemini-2.5-flash':             { inputPer1M: 0.30,   outputPer1M: 2.50 },
  // Gemini 1.5 Pro
  'gemini-1.5-pro':               { inputPer1M: 1.25,   outputPer1M: 5.00 },
  'gemini-1.5-pro-002':           { inputPer1M: 1.25,   outputPer1M: 5.00 },
  // Gemini 1.5 Flash
  'gemini-1.5-flash':             { inputPer1M: 0.075,  outputPer1M: 0.30 },
  'gemini-1.5-flash-002':         { inputPer1M: 0.075,  outputPer1M: 0.30 },
  // Gemini Pro (legacy)
  'gemini-pro':                   { inputPer1M: 0.50,   outputPer1M: 1.50 },
  // Embedding (입출력 구분 없음 — 입력만 계산)
  'gemini-embedding-001':         { inputPer1M: 0.15,   outputPer1M: 0.00 }, // $0.15/1M input (유료 티어 기준, 2026-03)
  'text-embedding-004':           { inputPer1M: 0.15,   outputPer1M: 0.00 }, // $0.15/1M input (유료 티어 기준)
  // ── OpenAI ──────────────────────────────────────────────────
  'gpt-4o-mini':                  { inputPer1M: 0.15,   outputPer1M: 0.60 },
  'gpt-4o':                       { inputPer1M: 2.50,   outputPer1M: 10.00 },
  'gpt-4o-2024-11-20':            { inputPer1M: 2.50,   outputPer1M: 10.00 },
};

const FALLBACK_PRICING: ModelPricing = { inputPer1M: 0.50, outputPer1M: 1.50 };

const GROUNDING_QUERY_COST = 0.035; // $0.035 per Google Search grounding query

export function estimateGeminiCost(
  model: string,
  promptTokens: number,
  responseTokens: number,
  groundingQueries = 0,
): number {
  const pricing = PRICING[model] ?? FALLBACK_PRICING;
  const inputCost    = (promptTokens  / 1_000_000) * pricing.inputPer1M;
  const outputCost   = (responseTokens / 1_000_000) * pricing.outputPer1M;
  const groundingCost = groundingQueries * GROUNDING_QUERY_COST;
  return inputCost + outputCost + groundingCost;
}

// ─────────────────────────────────────────────────────────────
// 사용량 로그 인터페이스
// ─────────────────────────────────────────────────────────────

export type AiUsageType =
  | 'extraction'       // 이벤트 정보 추출 (주 엔리치)
  | 'grounding'        // Gemini Google Search 그라운딩
  | 'embedding'        // 이벤트 문서 벡터 임베딩 (스케줄러)
  | 'vector_search'    // 사용자 검색어 벡터 임베딩 (실시간)
  | 'caption'          // 캡션 파싱
  | 'tags'             // 태그 생성
  | 'seed'             // Hot Suggestion 시드 추출
  | 'normalize'        // 이벤트명 정규화
  | 'curation_copy'    // 큐레이션 카피라이팅 (Gemini) / 배너 카피 (OpenAI)
  | 'hot_rating'       // Hot 이벤트 평가
  | 'other';

export type AiProvider = 'gemini' | 'openai';

export interface AiUsageInput {
  provider?: AiProvider;  // 기본값: 'gemini'
  model: string;
  usageType: AiUsageType;
  promptTokens: number;
  responseTokens: number;
  totalTokens?: number;
  groundingQueries?: number; // Google Search grounding 쿼리 수 ($0.035/건 별도 청구)
  success?: boolean;
  errorCode?: string;
}

// ─────────────────────────────────────────────────────────────
// 핵심 로깅 함수
// ─────────────────────────────────────────────────────────────

/**
 * AI API(Gemini/OpenAI) 사용량을 DB에 fire-and-forget 방식으로 기록합니다.
 * 실패해도 에러를 throw하지 않습니다.
 * 비용은 내부 usage 로그 기반 추정값 (provider 청구서 기준 아님).
 */
export function logAiUsage(input: AiUsageInput): void {
  const {
    provider = 'gemini',
    model,
    usageType,
    promptTokens,
    responseTokens,
    totalTokens,
    groundingQueries = 0,
    success = true,
    errorCode,
  } = input;

  const total = totalTokens ?? promptTokens + responseTokens;
  const estimatedCost = estimateGeminiCost(model, promptTokens, responseTokens, groundingQueries);

  setImmediate(() => {
    pool
      .query(
        `INSERT INTO ai_usage_logs
           (provider, model, usage_type, prompt_tokens, response_tokens, total_tokens, estimated_cost_usd, success, error_code)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          provider,
          model,
          usageType,
          promptTokens,
          responseTokens,
          total,
          estimatedCost,
          success,
          errorCode ?? null,
        ],
      )
      .catch((err: unknown) => {
        // 로깅 실패는 무시 (메인 플로우에 영향 없음)
        console.warn('[AiUsage] DB insert failed:', (err as Error)?.message);
      });
  });
}

/**
 * Gemini response.usageMetadata에서 토큰 수를 추출하여 logAiUsage를 호출합니다.
 * usageMetadata가 없으면 아무것도 하지 않습니다.
 */
export function logGeminiUsage(
  response: { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } | null },
  model: string,
  usageType: AiUsageType,
  options?: { success?: boolean; errorCode?: string; groundingQueries?: number },
): void {
  const meta = response.usageMetadata;
  if (!meta) return;

  logAiUsage({
    model,
    usageType,
    promptTokens:    meta.promptTokenCount    ?? 0,
    responseTokens:  meta.candidatesTokenCount ?? 0,
    totalTokens:     meta.totalTokenCount      ?? undefined,
    groundingQueries: options?.groundingQueries ?? 0,
    success:         options?.success ?? true,
    errorCode:       options?.errorCode,
  });
}
