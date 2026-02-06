/**
 * 배너 문구 생성 유틸리티
 * 템플릿 기반 문구 + Gemini AI 문구를 상황에 따라 하이브리드로 사용
 */

import { generateBannerCopyWithGemini } from '../services/edgeGemini';
import { getGeminiCachedCopy, saveGeminiCachedCopy } from './storage';
import type { RecommendationExplanation } from './recommendationExplanation';
import type { EventTraits } from '../services/eventService';

/**
 * 배너 문구 생성 파라미터
 */
export interface BannerCopyParams {
  eventId: string;
  eventTitle: string;
  eventCategory: string;
  dongLabel: string;
  distanceMeters: number;
  explanation: RecommendationExplanation;
  reasonTags: string[];
  traits?: EventTraits; // GPT 프롬프트 강화용 특성
}

/**
 * 배너 문구 생성 결과
 */
export interface BannerCopyResult {
  copy: string;
  source: 'ai' | 'template' | 'cache';
  model?: string; // 'gpt-4o-mini' | 'template-fallback'
  metadata?: any;
}

/**
 * Gemini 사용 여부 판단
 * 
 * ⚠️ 테스트 모드: 무조건 Gemini 사용 (totalScore > 0.0)
 * 
 * 원래 조건 (프로덕션 복원 시 사용):
 * 1. High confidence (총점 > 0.7)
 * 2. 복합적 이유 (reasonTags 2개 이상)
 * 3. 특별한 케이스 (urgency + preference, 또는 urgency + hotness)
 * 4. 캐시 없음
 */
export function shouldUseGemini(
  explanation: RecommendationExplanation,
  reasonTags: string[]
): boolean {
  // ✅ Gemini 2.5 Flash 활성화 (instruction 기반 프롬프트)
  return true;
  
  // ==================== 원래 로직 (주석 처리) ====================
  // // Low confidence는 템플릿 사용
  // if (explanation.confidenceLevel === 'low') {
  //   return false;
  // }
  // 
  // // High confidence + 복합적 이유
  // if (explanation.confidenceLevel === 'high' && reasonTags.length >= 2) {
  //   return true;
  // }
  // 
  // // 특별한 조합 (마감 임박 + 취향 저격 등)
  // const hasUrgency = reasonTags.includes('마감 임박');
  // const hasPreference = reasonTags.includes('취향 저격');
  // const hasHotness = reasonTags.includes('지금 인기');
  // 
  // if (hasUrgency && (hasPreference || hasHotness)) {
  //   return true;
  // }
  // 
  // return false;
  // ===============================================================
}

/**
 * 하이브리드 배너 문구 생성
 * 템플릿 또는 Gemini를 사용하여 배너 문구 생성
 */
export async function generateBannerCopyHybrid(
  params: BannerCopyParams
): Promise<BannerCopyResult> {
  
  // 1. Gemini 필요 여부 판단
  const useGemini = shouldUseGemini(params.explanation, params.reasonTags);
  
  if (!useGemini) {
    // 템플릿 사용
    const copy = generateTemplateCopy(params);
    console.log('[BannerCopy] Using template copy:', {
      source: 'template',
      copy,
      confidenceLevel: params.explanation.confidenceLevel,
      reasonTagsCount: params.reasonTags.length,
    });
    return { copy, source: 'template' };
  }
  
  // 2. 캐시 확인
  const cachedResult = await getGeminiCachedCopy(params.eventId, params.reasonTags, params.traits);
  if (cachedResult) {
    console.log('[BannerCopy] Using cached AI copy:', {
      source: 'cache',
      copy: cachedResult.generatedCopy,
      model: cachedResult.model,
    });
    return { copy: cachedResult.generatedCopy, source: 'cache', model: cachedResult.model };
  }
  
  // 3. AI 호출 (GPT-4o-mini 또는 템플릿 fallback)
  console.log('[BannerCopy][AI] Calling AI generation (cache miss/bypass):', {
    eventTitle: params.eventTitle,
    category: params.eventCategory,
    confidenceLevel: params.explanation.confidenceLevel,
    reasonTags: params.reasonTags,
    traits: params.traits, // Traits 로그 추가
  });
  const aiResult = await generateBannerCopyWithGemini(params);
  
  if (aiResult) {
    // 캐시 저장
    await saveGeminiCachedCopy(params.eventId, params.reasonTags, aiResult.copy, aiResult.model, params.traits);
    console.log('[BannerCopy] AI copy generated and cached:', {
      source: 'ai',
      copy: aiResult.copy,
      model: aiResult.model,
    });
    return { 
      copy: aiResult.copy, 
      source: 'ai',
      model: aiResult.model,
      metadata: aiResult.metadata,
    };
  }
  
  // 4. Fallback: 템플릿 사용
  console.warn('[BannerCopy] AI failed, falling back to template');
  const copy = generateTemplateCopy(params);
  return { copy, source: 'template' };
}

/**
 * 템플릿 기반 문구 생성
 */
function generateTemplateCopy(params: BannerCopyParams): string {
  const { dongLabel, eventTitle, distanceMeters, reasonTags } = params;
  
  // 거리 포맷팅
  const distanceText = distanceMeters < 1000
    ? `${Math.round(distanceMeters / 10) * 10}m`
    : `${(distanceMeters / 1000).toFixed(1)}km`;
  
  // 이벤트 제목 축약
  const shortTitle = eventTitle.length > 20 
    ? eventTitle.substring(0, 20) + '...' 
    : eventTitle;
  
  // reasonTags 기반 우선순위 문구 생성
  if (reasonTags.includes('마감 임박')) {
    return `오늘이 마지막! ${distanceText} 거리 '${shortTitle}' 놓치지 마세요`;
  }
  
  if (reasonTags.includes('취향 저격')) {
    const category = params.eventCategory || '이벤트';
    return `${category} 좋아하시죠? ${distanceText} 거리에 '${shortTitle}' 있어요`;
  }
  
  if (reasonTags.includes('지금 인기')) {
    return `지금 여기서 제일 핫한 '${shortTitle}', ${distanceText} 거리예요!`;
  }
  
  if (reasonTags.includes('가까워요')) {
    return `${dongLabel} 바로 옆 ${distanceText}에 '${shortTitle}' 있어요`;
  }
  
  // 기본 템플릿
  return `${dongLabel} 근처 ${distanceText}에 '${shortTitle}' 있어요. 지금 들러볼까요?`;
}

