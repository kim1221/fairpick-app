/**
 * AI 배너 문구 생성 클라이언트
 * 
 * Node.js Express 백엔드 서버 (/api/ai/generate-banner-copy)를 호출하여
 * GPT-4o-mini (또는 템플릿 fallback)을 통한 배너 문구 생성을 요청합니다.
 */

import type { RecommendationExplanation } from '../utils/recommendationExplanation';
import type { EventTraits } from './eventService';

/**
 * API Base URL
 * Local Dev: http://172.20.10.4:5001 (Node.js Express)
 * Production: 배포된 백엔드 서버 URL
 */
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://172.20.10.4:5001';

/**
 * 배너 문구 생성 파라미터
 */
export interface GenerateCopyParams {
  eventTitle: string;
  eventCategory: string;
  dongLabel: string;
  distanceMeters: number;
  explanation: RecommendationExplanation;
  reasonTags: string[];
  traits?: EventTraits; // GPT 프롬프트 강화용 특성
}

/**
 * Backend API 응답 타입
 */
interface BackendApiResponse {
  success: boolean;
  copy?: string;
  error?: string;
  metadata?: {
    model: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    reasonTags?: string[];
    callToAction?: string;
  };
}

/**
 * AI 배너 문구 생성 결과
 */
export interface AiBannerCopyResult {
  copy: string;
  model: string; // 'gpt-4o-mini' | 'template-fallback'
  metadata?: any;
}

/**
 * AI를 사용하여 배너 문구 생성 (GPT-4o-mini 또는 템플릿 fallback)
 * 
 * @param params 배너 문구 생성 파라미터
 * @returns 생성된 문구 및 모델 정보 (실패 시 null)
 */
export async function generateBannerCopyWithGemini(
  params: GenerateCopyParams
): Promise<AiBannerCopyResult | null> {
  const TIMEOUT_MS = 4000; // 4초 타임아웃 (Gemini는 보통 OpenAI보다 약간 느림)
  
  try {
    // 거리 포맷팅
    const distance = params.distanceMeters < 1000
      ? `${Math.round(params.distanceMeters)}m`
      : `${(params.distanceMeters / 1000).toFixed(1)}km`;
    
    // AbortController를 사용한 타임아웃
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    
    const apiUrl = `${API_BASE_URL}/api/ai/generate-banner-copy`;
    
    console.log('[AIClient] Requesting AI copy generation (GPT-4o-mini or fallback)', {
      apiUrl,
      eventTitle: params.eventTitle,
      category: params.eventCategory,
      dong: params.dongLabel,
      distance,
      confidenceLevel: params.explanation.confidenceLevel,
      reasonTags: params.reasonTags,
      traits: params.traits, // Traits 로그 추가
    });
    
    // Backend API 호출
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventTitle: params.eventTitle,
        eventCategory: params.eventCategory,
        dongLabel: params.dongLabel,
        distance,
        explanation: params.explanation,
        reasonTags: params.reasonTags,
        traits: params.traits, // Traits 전달
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.error('[AIClient] Response not OK:', {
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }
    
    const result: BackendApiResponse = await response.json();
    
    if (result.success && result.copy && result.metadata?.model) {
      console.log('[AIClient] AI generation successful:', {
        copy: result.copy,
        model: result.metadata.model,
        totalTokens: result.metadata?.totalTokens,
        promptTokens: result.metadata?.promptTokens,
        completionTokens: result.metadata?.completionTokens,
      });
      return {
        copy: result.copy,
        model: result.metadata.model,
        metadata: result.metadata,
      };
    }
    
    console.warn('[AIClient] AI generation failed', {
      success: result.success,
      error: result.error,
    });
    return null;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error('[AIClient] Request timeout (4s exceeded)');
    } else {
      console.error('[AIClient] Generation failed:', {
        error,
        errorMessage: error?.message,
        errorName: error?.name,
      });
    }
    return null;
  }
}

