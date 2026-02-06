/**
 * Today 배너 추천 시스템 튜닝 설정
 *
 * 이 파일은 코드 배포 없이 추천 파라미터를 조정할 수 있도록 분리되었습니다.
 * 향후 원격 JSON/AB 테스트로 확장 가능합니다.
 *
 * 개발 모드에서는 이 파일을 직접 수정하여 즉시 반영할 수 있습니다.
 */

export interface TodayBannerTuningConfig {
  // Nearby fetch 설정
  nearbyFetch: {
    radius: number;  // 검색 반경 (미터)
    size: number;    // 후보군 크기
  };

  // 가중치 (합=1.0)
  weights: {
    distance: number;
    hotness: number;
    quality: number;
    urgency: number;
    preference: number;
  };

  // 최소 추천 임계값 (이 값보다 낮으면 추천하지 않음)
  minRecommendationScore: number;

  // 이유 태그 생성 임계값
  reasonTagThresholds: {
    distanceNear: number;    // "가까워요" 태그
    hotnessHot: number;      // "지금 인기" 태그
    urgencySoon: number;     // "마감 임박" 태그
    preferenceMatch: number; // "취향 저격" 태그
    qualityRich: number;     // "정보 풍부" 태그
  };

  // Guardrails 설정
  guardrails: {
    excludeEnded: boolean;                  // 종료된 이벤트 제외
    preferHasImage: boolean;                // 이미지 있는 이벤트 우선
    imageFilterRelaxFallback: boolean;      // 이미지 필터 후 후보가 0이면 완화
    farDistancePenaltyThreshold: number;    // 거리 점수 임계값 (이보다 낮으면 패널티)
    farDistancePenaltyMultiplier: number;   // 거리 패널티 배율
    dedupWindowHours: number;               // 중복 추천 방지 시간 (시간)
  };
}

// 기본 튜닝 설정
export const TODAY_BANNER_TUNING: TodayBannerTuningConfig = {
  // Nearby fetch 설정
  // - radius: 3km 반경 내 이벤트 검색
  // - size: 30개 후보군 (기존 10개에서 증가)
  //   - 더 많은 후보를 가져와 guardrails/scoring 후에도 선택지 확보
  nearbyFetch: {
    radius: 3000,  // 3km
    size: 30,      // 30개 (DEV/PROD 공통, 성능 우려 시 20으로 조정 가능)
  },

  // 가중치 설정
  // - distance: 거리가 가장 중요 (25%)
  // - hotness: 인기도도 중요 (25%)
  // - quality: 데이터 품질 (20%)
  // - urgency: 마감 임박도 (15%)
  // - preference: 사용자 취향 (15%)
  weights: {
    distance: 0.25,
    hotness: 0.25,
    quality: 0.20,
    urgency: 0.15,
    preference: 0.15,
  },

  // 최소 추천 임계값
  // - 0.1로 낮춤 (테스트용: 거의 모든 이벤트 추천)
  // - 너무 높으면 추천이 잘 안 나오고, 너무 낮으면 품질이 떨어짐
  // - 프로덕션에서는 0.35로 올릴 것
  minRecommendationScore: 0.1,

  // 이유 태그 임계값
  // - 각 점수 요소가 이 값을 넘으면 해당 태그를 표시
  // - V2: 임계값을 상향 조정하여 태그 부여를 더 엄격하게
  // - 최대 2개 태그 제한과 조합하여 더 의미있는 차별화
  reasonTagThresholds: {
    distanceNear: 0.80,   // 거리 점수 0.80 이상 (약 600m 이내) → "가까워요"
    hotnessHot: 0.75,     // 인기 점수 0.75 이상 (상위 25%) → "지금 인기"
    urgencySoon: 0.6,     // 긴급 점수 0.6 이상 (D-2 이내) → "마감 임박"
    preferenceMatch: 0.6, // 선호 점수 0.6 이상 → "취향 저격"
    qualityRich: 0.80,    // 품질 점수 0.80 이상 → "정보 풍부"
  },

  // Guardrails 설정
  guardrails: {
    // 종료된 이벤트는 항상 제외
    excludeEnded: true,

    // 이미지가 있는 이벤트를 우선
    preferHasImage: true,

    // 이미지 필터 후 후보가 0이면 완화 (이미지 없어도 포함)
    // false로 설정하면 이미지 없는 이벤트는 절대 추천하지 않음
    imageFilterRelaxFallback: true,

    // 거리 점수 0.1 미만 (약 2700m 이상)이면 패널티
    farDistancePenaltyThreshold: 0.1,

    // 먼 이벤트 패널티: 총점에 0.7 곱함 (30% 감점)
    farDistancePenaltyMultiplier: 0.7,

    // 24시간 이내 추천된 이벤트는 다시 추천하지 않음
    dedupWindowHours: 24,
  },
};

// DEV 전용: 테스트용 튜닝 설정
// 개발 중 이 값을 활성화하면 더 관대한 추천을 테스트할 수 있습니다.
export const TODAY_BANNER_TUNING_DEV: TodayBannerTuningConfig | null = __DEV__ ? null : null;
// 예시:
// export const TODAY_BANNER_TUNING_DEV: TodayBannerTuningConfig | null = __DEV__ ? {
//   ...TODAY_BANNER_TUNING,
//   minRecommendationScore: 0.2, // 임계값 낮춤
//   guardrails: {
//     ...TODAY_BANNER_TUNING.guardrails,
//     imageFilterRelaxFallback: true, // 이미지 필터 완화
//   },
// } : null;

/**
 * 현재 활성 튜닝 설정 가져오기
 * DEV 모드에서 TODAY_BANNER_TUNING_DEV가 있으면 우선 사용
 */
export function getActiveTuning(): TodayBannerTuningConfig {
  if (__DEV__ && TODAY_BANNER_TUNING_DEV) {
    console.log('[TodayBanner][Config] Using DEV tuning config');
    return TODAY_BANNER_TUNING_DEV;
  }
  return TODAY_BANNER_TUNING;
}
