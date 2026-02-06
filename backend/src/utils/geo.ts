/**
 * 지리 계산 유틸리티
 */

import axios from 'axios';
import { config } from '../config';

/**
 * Bounding Box 계산 (대략적인 위/경도 범위)
 * 거리 기반 1차 필터링용 (정확한 거리는 Haversine으로 계산)
 * 
 * @param lat 위도
 * @param lng 경도
 * @param radiusMeters 반경 (미터)
 * @returns { latMin, latMax, lngMin, lngMax }
 */
export function calculateBoundingBox(lat: number, lng: number, radiusMeters: number) {
  // 지구 반지름 (미터)
  const EARTH_RADIUS = 6371000;

  // 위도 1도당 거리 (약 111km)
  const latDelta = (radiusMeters / EARTH_RADIUS) * (180 / Math.PI);

  // 경도 1도당 거리 (위도에 따라 달라짐)
  const lngDelta = (radiusMeters / (EARTH_RADIUS * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);

  return {
    latMin: lat - latDelta,
    latMax: lat + latDelta,
    lngMin: lng - lngDelta,
    lngMax: lng + lngDelta,
  };
}

/**
 * Haversine 거리 계산 SQL 표현식
 * @returns SQL 표현식 문자열 (distanceMeters 별칭 사용)
 */
export function getHaversineDistanceSQL(userLatParam: string, userLngParam: string): string {
  // 6371000m = 지구 반지름
  return `
    (6371000 * 2 * ASIN(
      SQRT(
        POW(SIN((RADIANS(lat) - RADIANS(${userLatParam})) / 2), 2) +
        COS(RADIANS(${userLatParam})) * COS(RADIANS(lat)) *
        POW(SIN((RADIANS(lng) - RADIANS(${userLngParam})) / 2), 2)
      )
    ))
  `;
}

/**
 * Reverse Geocoding - 위/경도 → 주소 변환
 *
 * Kakao Local API를 사용하여 좌표를 주소로 변환
 *
 * @param lat 위도
 * @param lng 경도
 * @returns 주소 문자열 (예: "서울특별시 성동구 성수동2가")
 * @throws Kakao API 호출 실패 시 에러
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    if (!config.kakaoRestApiKey) {
      console.error('[reverseGeocode] KAKAO_REST_API_KEY is not set');
      throw new Error('Kakao API key is not configured');
    }

    // Kakao Local REST API coord2address
    const response = await axios.get('https://dapi.kakao.com/v2/local/geo/coord2address.json', {
      params: { x: lng, y: lat },
      headers: {
        Authorization: `KakaoAK ${config.kakaoRestApiKey}`,
      },
      timeout: 5000, // 5초 타임아웃
    });

    if (response.data.documents && response.data.documents.length > 0) {
      const address = response.data.documents[0].address;

      // 전체 주소 반환 (예: "서울특별시 성동구 성수동2가")
      const fullAddress = [
        address?.region_1depth_name, // 시/도 (예: 서울특별시)
        address?.region_2depth_name, // 구 (예: 성동구)
        address?.region_3depth_name, // 동 (예: 성수동2가)
      ]
        .filter(Boolean)
        .join(' ');

      return fullAddress || '';
    }

    // 주소를 찾지 못한 경우
    console.warn('[reverseGeocode] No address found for coordinates:', { lat, lng });
    return '';
  } catch (error: any) {
    console.error('[reverseGeocode] Error:', error.message || error);
    // 에러 발생 시 빈 문자열 반환 (전국 조회로 폴백)
    return '';
  }
}


