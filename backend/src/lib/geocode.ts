/**
 * Best-effort Geocoding Service
 *
 * 전략:
 * 1. Kakao address API (주소 기반, 가장 정확) → confidence: A
 * 2. Kakao keyword API (venue + address 조합) → confidence: B
 * 3. Nominatim (fallback) → confidence: C
 * 4. All failed → confidence: D
 */

import axios from 'axios';
import { config } from '../config';

interface GeocodeBestEffortInput {
  address?: string | null;
  venue?: string | null;
}

interface GeocodeBestEffortResult {
  lat: number | null;
  lng: number | null;
  region: string | null;
  source: 'kakao_address' | 'kakao_keyword' | 'nominatim' | 'failed';
  confidence: 'A' | 'B' | 'C' | 'D';
  reason: string | null;
}

/**
 * Best-effort 지오코딩: address와 venue를 모두 활용하여 최선의 좌표 추출
 */
export async function geocodeBestEffort(
  input: GeocodeBestEffortInput
): Promise<GeocodeBestEffortResult> {
  const { address, venue } = input;
  const attempts: string[] = [];

  // 0. 주소/venue 둘 다 없으면 실패
  if (!address && !venue) {
    return {
      lat: null,
      lng: null,
      region: null,
      source: 'failed',
      confidence: 'D',
      reason: 'no_address_or_venue',
    };
  }

  // 1. Kakao address API 시도 (address가 있으면)
  if (address && address.trim().length > 0) {
    try {
      console.log('[Geocode] Kakao API Key:', config.kakaoRestApiKey ? `${config.kakaoRestApiKey.substring(0,10)}...` : '❌ NOT SET');
      console.log('[Geocode] Trying Kakao address API:', address);
      
      const addressResult = await axios.get(
        'https://dapi.kakao.com/v2/local/search/address.json',
        {
          headers: { Authorization: `KakaoAK ${config.kakaoRestApiKey}` },
          params: { query: address },
          timeout: 3000,
        }
      );

      console.log('[Geocode] Kakao address response:', {
        status: addressResult.status,
        count: addressResult.data.documents?.length || 0,
      });

      if (addressResult.data.documents && addressResult.data.documents.length > 0) {
        const doc = addressResult.data.documents[0];
        const region = extractRegion(address);

        console.log('[Geocode] Kakao address success:', {
          address,
          count: addressResult.data.documents.length,
        });

        return {
          lat: parseFloat(doc.y),
          lng: parseFloat(doc.x),
          region,
          source: 'kakao_address',
          confidence: 'A',
          reason: null,
        };
      }

      attempts.push(`kakao_address(${addressResult.data.documents?.length || 0})`);
    } catch (error: any) {
      console.error('[Geocode] Kakao address error:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      attempts.push('kakao_address(error)');
    }
  }

  // 2. Kakao keyword API 시도 (venue가 있으면)
  if (venue && venue.trim().length > 0) {
    // 2-1. venue 단독 검색
    // 2-2. venue + address 조합 검색
    const queries = [
      venue,
      address ? `${venue} ${address}` : null,
    ].filter((q): q is string => q !== null && q.trim().length > 0);

    for (const query of queries) {
      try {
        const keywordResult = await axios.get(
          'https://dapi.kakao.com/v2/local/search/keyword.json',
          {
            headers: { Authorization: `KakaoAK ${config.kakaoRestApiKey}` },
            params: { query, size: 5 },
            timeout: 3000,
          }
        );

        if (keywordResult.data.documents && keywordResult.data.documents.length > 0) {
          const doc = keywordResult.data.documents[0];
          const region = extractRegion(address || doc.address_name || '');

          console.log('[Geocode] Kakao keyword success:', {
            query,
            count: keywordResult.data.documents.length,
            placeName: doc.place_name,
          });

          return {
            lat: parseFloat(doc.y),
            lng: parseFloat(doc.x),
            region,
            source: 'kakao_keyword',
            confidence: 'B',
            reason: null,
          };
        }

        attempts.push(`kakao_keyword:"${query}"(${keywordResult.data.documents?.length || 0})`);
      } catch (error: any) {
        console.error('[Geocode] Kakao keyword error:', query, error.message);
        attempts.push(`kakao_keyword:"${query}"(error)`);
      }
    }
  }

  // 3. Nominatim fallback (address가 있으면)
  if (address && address.trim().length > 0) {
    try {
      // Rate limit 준수
      await new Promise(resolve => setTimeout(resolve, 1100));

      const nominatimResult = await axios.get(
        'https://nominatim.openstreetmap.org/search',
        {
          params: {
            q: `${address}, South Korea`,
            format: 'json',
            limit: 1,
          },
          headers: { 'User-Agent': 'Fairpick/1.0' },
          timeout: 5000,
        }
      );

      if (nominatimResult.data && nominatimResult.data.length > 0) {
        const doc = nominatimResult.data[0];
        const region = extractRegion(address);

        console.log('[Geocode] Nominatim success:', { address });

        return {
          lat: parseFloat(doc.lat),
          lng: parseFloat(doc.lon),
          region,
          source: 'nominatim',
          confidence: 'C',
          reason: null,
        };
      }

      attempts.push(`nominatim(${nominatimResult.data?.length || 0})`);
    } catch (error: any) {
      console.error('[Geocode] Nominatim error:', error.message);
      attempts.push('nominatim(error)');
    }
  }

  // 4. 모든 시도 실패
  console.warn('[Geocode] All failed:', { address, venue, attempts });

  return {
    lat: null,
    lng: null,
    region: extractRegion(address || ''),
    source: 'failed',
    confidence: 'D',
    reason: `all_failed: ${attempts.join('; ')}`,
  };
}

/**
 * region 추출 헬퍼 (주소 문자열에서 시/도 단위 추출)
 */
export function extractRegion(address: string): string | null {
  if (!address) return null;

  const match = address.match(
    /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/
  );
  return match ? match[1] : null;
}
