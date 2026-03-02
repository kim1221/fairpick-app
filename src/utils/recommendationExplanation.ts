/**
 * 추천 이유 설명 유틸리티
 * 복합 점수 breakdown을 사용자 친화적인 설명으로 변환
 */

import type { ScoreBreakdown } from './todayRecommendationScore';
import type { NearbyEventItem } from '../services/eventService';

/**
 * 추천 설명 구조
 */
export interface RecommendationExplanation {
  // 핵심 이유 (1-2문장)
  primaryReason: string;
  
  // 세부 설명
  details: {
    distance?: string;    // "500m (도보 7분)"
    popularity?: string;  // "최근 관심 급상승"
    urgency?: string;     // "오늘 마감"
    quality?: string;     // "상세 정보 풍부"
    preference?: string;  // "전시 좋아하시죠?"
  };
  
  // Gemini 프롬프트용 insights
  insights: string[];
  
  // 신뢰도 레벨 (Gemini 사용 여부 판단)
  confidenceLevel: 'high' | 'medium' | 'low';
}

/**
 * 추천 이유 설명 생성
 */
export function explainRecommendation(
  event: NearbyEventItem,
  breakdown: ScoreBreakdown,
  _reasonTags: string[]
): RecommendationExplanation {
  const details: RecommendationExplanation['details'] = {};
  const insights: string[] = [];
  
  // 거리 설명
  if (breakdown.distance > 0.8) {
    const meters = Math.round(event.distanceMeters);
    const walkMinutes = Math.ceil(meters / 80); // 80m/분 = 평균 도보 속도
    details.distance = `${meters}m (도보 ${walkMinutes}분)`;
    insights.push('매우 가까움');
  } else if (breakdown.distance > 0.5) {
    details.distance = `${Math.round(event.distanceMeters / 100) * 100}m`;
    insights.push('가까움');
  }
  
  // 인기도 설명
  if (breakdown.hotness > 0.7) {
    details.popularity = '최근 관심 급상승';
    insights.push('인기 많음');
  } else if (breakdown.hotness > 0.5) {
    details.popularity = '인기 있는 이벤트';
    insights.push('인기');
  }
  
  // 마감 임박도
  if (breakdown.urgency > 0.8) {
    details.urgency = '오늘 마감';
    insights.push('오늘 마지막');
  } else if (breakdown.urgency > 0.6) {
    details.urgency = '곧 마감';
    insights.push('마감 임박');
  } else if (breakdown.urgency > 0.4) {
    details.urgency = '이번 주말까지';
    insights.push('주말까지');
  }
  
  // 품질
  if (breakdown.quality > 0.7) {
    details.quality = '상세 정보 풍부';
    insights.push('정보 충실');
  }
  
  // 취향 매칭
  if (breakdown.preference > 0.6) {
    const category = event.category || event.mainCategory || '이벤트';
    details.preference = `${category} 선호`;
    insights.push('취향 저격');
  }
  
  // 핵심 이유 생성 (가장 높은 점수 2개)
  const topFactors = [
    { name: 'distance', score: breakdown.distance, text: '가깝고' },
    { name: 'hotness', score: breakdown.hotness, text: '인기 많고' },
    { name: 'urgency', score: breakdown.urgency, text: '마감 임박' },
    { name: 'preference', score: breakdown.preference, text: '취향 저격' },
    { name: 'quality', score: breakdown.quality, text: '정보 풍부' },
  ]
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .filter(f => f.score > 0.3); // 최소 임계값
  
  const primaryReason = topFactors.length > 0
    ? topFactors.map(f => f.text).join(', ')
    : '주변 추천 이벤트';
  
  // 신뢰도 레벨 (총점 기반)
  const weights = { distance: 0.25, hotness: 0.25, quality: 0.20, urgency: 0.15, preference: 0.15 };
  const totalScore = 
    breakdown.distance * weights.distance +
    breakdown.hotness * weights.hotness +
    breakdown.quality * weights.quality +
    breakdown.urgency * weights.urgency +
    breakdown.preference * weights.preference;
  
  const confidenceLevel: RecommendationExplanation['confidenceLevel'] = 
    totalScore > 0.7 ? 'high' : totalScore > 0.5 ? 'medium' : 'low';
  
  return {
    primaryReason,
    details,
    insights,
    confidenceLevel,
  };
}

/**
 * 점수를 정성적 평가로 변환
 */
export function getScoringInsights(
  breakdown: ScoreBreakdown,
  reasonTags: string[]
): string[] {
  const insights: string[] = [];
  
  if (breakdown.distance > 0.7) insights.push('도보 거리');
  if (breakdown.hotness > 0.6) insights.push('높은 관심도');
  if (breakdown.urgency > 0.6) insights.push('시급성');
  if (breakdown.quality > 0.7) insights.push('충실한 정보');
  if (breakdown.preference > 0.6) insights.push('개인화 매칭');
  
  // reasonTags 추가
  reasonTags.forEach(tag => {
    if (!insights.includes(tag)) {
      insights.push(tag);
    }
  });
  
  return insights;
}


