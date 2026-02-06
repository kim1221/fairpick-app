/**
 * 백엔드 API를 통한 역지오코딩
 * 위도/경도 → 행정동 주소 변환
 */

import { API_BASE_URL } from '../config/api';

export interface ReverseGeocodeResult {
  success: boolean;
  address?: string; // 행정동 (예: "성수2가1동")
  fullAddress?: string; // 전체 주소
  error?: string;
}

/**
 * 좌표를 행정동 주소로 변환 (백엔드 API 사용)
 * @param lat 위도
 * @param lng 경도
 * @returns 행정동 주소 (예: "성수2가1동")
 */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<ReverseGeocodeResult> {
  try {
    // 백엔드 /geo/reverse API 호출
    const response = await fetch(
      `${API_BASE_URL}/geo/reverse?lat=${lat}&lng=${lng}`
    );

    if (!response.ok) {
      throw new Error(`Backend API error: ${response.status}`);
    }

    const data = await response.json();

    // 백엔드 응답: { gu, dong, label }
    // label = "송파구 삼전동" 형태
    if (data.label && data.label !== '위치 정보 없음') {
      return {
        success: true,
        address: data.dong || data.label, // dong이 있으면 dong, 없으면 label 사용
        fullAddress: data.label,
      };
    } else {
      return {
        success: false,
        error: '주소를 찾을 수 없습니다.',
      };
    }
  } catch (error) {
    console.error('[Geocoding] Reverse geocode failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '알 수 없는 오류',
    };
  }
}

/**
 * 행정동 이름 포맷팅
 * @param dongName 행정동 이름
 * @returns 포맷된 행정동 이름
 */
export function formatDongName(dongName: string): string {
  if (!dongName) return '위치 정보 없음';
  
  // "성수2가1동" → "성수2가1동" (그대로 사용)
  return dongName;
}

