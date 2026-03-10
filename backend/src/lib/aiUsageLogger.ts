/**
 * aiUsageLogger.ts
 *
 * Gemini API 사용량 추적 유틸리티.
 * generateContent / embedContent 호출 후 usageMetadata를 DB에 저장합니다.
 *
 * 설계 원칙:
 * - fire-and-forget: 로깅 실패가 메인 플로우에 영향을 주지 않음
 * - DB 인서트를 setImmediate로 지연하여 응답 지연 최소화
 */

import { pool } from '../db';

// ─────────────────────────────────────────────────────────────
// 비용 계산 (2026년 3월 Gemini 가격 기준, USD)
// https://ai.google.dev/pricing
// ─────────────────────────────────────────────────────────────

interface GeminiPricing {
  inputPer1M: number;   // USD per 1M input tokens
  outputPer1M: number;  // USD per 1M output tokens
}

const PRICING: Record<string, GeminiPricing> = {
  // Gemini 2.5 Flash (최신)
  'gemini-2.5-flash':             { inputPer1M: 0.075,  outputPer1M: 0.30 },
  // Gemini 1.5 Pro
  'gemini-1.5-pro':               { inputPer1M: 1.25,   outputPer1M: 5.00 },
  'gemini-1.5-pro-002':           { inputPer1M: 1.25,   outputPer1M: 5.00 },
  // Gemini 1.5 Flash
  'gemini-1.5-flash':             { inputPer1M: 0.075,  outputPer1M: 0.30 },
  'gemini-1.5-flash-002':         { inputPer1M: 0.075,  outputPer1M: 0.30 },
  // Gemini Pro (legacy)
  'gemini-pro':                   { inputPer1M: 0.50,   outputPer1M: 1.50 },
  // Embedding (입출력 구분 없음 — 입력만 계산)
  'gemini-embedding-001':         { inputPer1M: 0.00,   outputPer1M: 0.00 }, // 무료 (2026-03 기준)
  'text-embedding-004':           { inputPer1M: 0.00,   outputPer1M: 0.00 }, // 무료
};

const FALLBACK_PRICING: GeminiPricing = { inputPer1M: 0.50, outputPer1M: 1.50 };

export function estimateGeminiCost(
  model: string,
  promptTokens: number,
  responseTokens: number,
): number {
  const pricing = PRICING[model] ?? FALLBACK_PRICING;
  const inputCost  = (promptTokens  / 1_000_000) * pricing.inputPer1M;
  const outputCost = (responseTokens / 1_000_000) * pricing.outputPer1M;
  return inputCost + outputCost;
}

// ─────────────────────────────────────────────────────────────
// 사용량 로그 인터페이스
// ─────────────────────────────────────────────────────────────

export type AiUsageType =
  | 'extraction'       // 이벤트 정보 추출 (주 엔리치)
  | 'grounding'        // Gemini Google Search 그라운딩
  | 'embedding'        // 벡터 임베딩
  | 'caption'          // 캡션 파싱
  | 'tags'             // 태그 생성
  | 'seed'             // Hot Suggestion 시드 추출
  | 'normalize'        // 이벤트명 정규화
  | 'curation_copy'    // 큐레이션 카피라이팅
  | 'hot_rating'       // Hot 이벤트 평가
  | 'popup_discovery'  // 팝업 발견
  | 'other';

export interface AiUsageInput {
  model: string;
  usageType: AiUsageType;
  promptTokens: number;
  responseTokens: number;
  totalTokens?: number;
  success?: boolean;
  errorCode?: string;
}

// ─────────────────────────────────────────────────────────────
// 핵심 로깅 함수
// ─────────────────────────────────────────────────────────────

/**
 * Gemini API 사용량을 DB에 fire-and-forget 방식으로 기록합니다.
 * 실패해도 에러를 throw하지 않습니다.
 */
export function logAiUsage(input: AiUsageInput): void {
  const {
    model,
    usageType,
    promptTokens,
    responseTokens,
    totalTokens,
    success = true,
    errorCode,
  } = input;

  const total = totalTokens ?? promptTokens + responseTokens;
  const estimatedCost = estimateGeminiCost(model, promptTokens, responseTokens);

  setImmediate(() => {
    pool
      .query(
        `INSERT INTO ai_usage_logs
           (provider, model, usage_type, prompt_tokens, response_tokens, total_tokens, estimated_cost_usd, success, error_code)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          'gemini',
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
  options?: { success?: boolean; errorCode?: string },
): void {
  const meta = response.usageMetadata;
  if (!meta) return;

  logAiUsage({
    model,
    usageType,
    promptTokens:   meta.promptTokenCount   ?? 0,
    responseTokens: meta.candidatesTokenCount ?? 0,
    totalTokens:    meta.totalTokenCount     ?? undefined,
    success:        options?.success ?? true,
    errorCode:      options?.errorCode,
  });
}
