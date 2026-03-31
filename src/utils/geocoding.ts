/**
 * 백엔드 API를 통한 역지오코딩
 * 위도/경도 → 행정동 주소 변환
 */

import { API_BASE_URL } from '../config/api';

export interface ReverseGeocodeResult {
  success: boolean;
  address?: string; // 행정동 (예: "성수2가1동")
  fullAddress?: string; // 전체 주소
  gu?: string; // 구 (예: "송파구")
  sido?: string; // 시도 (예: "서울특별시", "경기도")
  error?: string;
}

// ─── 역지오코딩 캐시 (결과 캐시 + in-flight 중복 방지) ───────────────────────
// 키 정밀도: toFixed(2) = 1.1km 버킷 (행정동 크기와 유사)
// TTL: 5분 / 성공 응답만 캐시 / 실패는 캐시 안 함
interface GeocodeCache {
  result: ReverseGeocodeResult;
  expiresAt: number;
}
const _geocodeCache = new Map<string, GeocodeCache>();
const _geocodeInFlight = new Map<string, Promise<ReverseGeocodeResult>>();
const GEOCODE_CACHE_TTL_MS = 5 * 60 * 1000; // 5분

function getGeocodeCacheKey(lat: number, lng: number): string {
  // 1.1km 버킷: 같은 동(洞) 안에서 동일 키
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}
// ─────────────────────────────────────────────────────────────────────────────

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
  const key = getGeocodeCacheKey(lat, lng);
  const now = Date.now();

  // 1. 결과 캐시 히트
  const cached = _geocodeCache.get(key);
  if (cached && now < cached.expiresAt) {
    return cached.result;
  }

  // 2. in-flight 중복 방지: 같은 키 요청이 진행 중이면 같은 Promise 공유
  const inFlight = _geocodeInFlight.get(key);
  if (inFlight) {
    return inFlight;
  }

  // 3. 신규 요청: API 호출 후 캐시 저장
  const fetchPromise = (async (): Promise<ReverseGeocodeResult> => {
    try {
      // 백엔드 /geo/reverse API 호출
      const response = await fetch(
        `${API_BASE_URL}/geo/reverse?lat=${lat}&lng=${lng}`
      );

      if (!response.ok) {
        throw new Error(`Backend API error: ${response.status}`);
      }

      const data = await response.json() as any;

      // 백엔드 응답: { gu, dong, label, sido }
      // label = "송파구 삼전동", sido = "서울특별시" 형태
      if (data.label && data.label !== '위치 정보 없음') {
        const result: ReverseGeocodeResult = {
          success: true,
          address: data.dong || data.label, // dong이 있으면 dong, 없으면 label 사용
          fullAddress: data.label,
          gu: data.gu || '',
          sido: data.sido || '',
        };
        // 성공만 캐시 (실패/일시 오류는 재시도 보장)
        _geocodeCache.set(key, { result, expiresAt: Date.now() + GEOCODE_CACHE_TTL_MS });
        return result;
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
    } finally {
      _geocodeInFlight.delete(key);
    }
  })();

  _geocodeInFlight.set(key, fetchPromise);
  return fetchPromise;
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
