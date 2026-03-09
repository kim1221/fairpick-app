/**
 * KOPIS (공연예술통합전산망) API 클라이언트
 * 
 * 사용 API:
 * - 박스오피스 순위: 공연 인기도 측정
 * 
 * 문서: http://www.kopis.or.kr/por/cs/openapi/openApiInfo.do
 */

import axios from 'axios';
import xml2js from 'xml2js';

/**
 * KOPIS API 인증 정보 조회
 */
function getKopisCredentials() {
  return {
    serviceKey: process.env.KOPIS_API_KEY || '',
  };
}

const BASE_URL = 'http://www.kopis.or.kr/openApi/restful';

interface KopisBoxOfficeItem {
  mt20id: string;      // 공연 ID
  prfnm: string;       // 공연명
  prfpdfrom: string;   // 공연 시작일
  prfpdto: string;     // 공연 종료일
  fcltynm: string;     // 공연시설명
  poster: string;      // 포스터 이미지
  genrenm: string;     // 장르명
  prfstate: string;    // 공연상태
  area: string;        // 지역
  rnum: number;        // 순위
}

interface KopisBoxOfficeResponse {
  boxofs: {
    boxof: KopisBoxOfficeItem[];
  };
}

/**
 * KOPIS 박스오피스 순위 조회
 * 
 * @param date 조회 날짜 (YYYYMMDD)
 * @param genre 장르 코드 (AAAA: 전체, GGGA: 연극, CCCA: 클래식, CCCC: 무용 등)
 * @returns 박스오피스 순위 목록
 */
export async function getKopisBoxOfficeList(
  date: string = new Date().toISOString().slice(0, 10).replace(/-/g, ''),
  genre: string = 'AAAA'
): Promise<KopisBoxOfficeItem[]> {
  const { serviceKey } = getKopisCredentials();

  if (!serviceKey) {
    console.warn('[KopisAPI] KOPIS_API_KEY not set. Returning empty result.');
    return [];
  }

  try {
    const response = await axios.get(`${BASE_URL}/boxoffice`, {
      params: {
        service: serviceKey,
        ststype: 'day',    // day: 일간, week: 주간, month: 월간
        date: date,
        catecode: genre,
      },
      timeout: 10000,
    });

    // XML → JSON 변환
    const parser = new xml2js.Parser({ explicitArray: false });
    const result: KopisBoxOfficeResponse = await parser.parseStringPromise(response.data);

    if (!result.boxofs?.boxof) {
      return [];
    }

    // boxof가 단일 객체인 경우 배열로 변환
    const items = Array.isArray(result.boxofs.boxof)
      ? result.boxofs.boxof
      : [result.boxofs.boxof];

    return items;
  } catch (error: any) {
    console.error('[KopisAPI] Box office error:', {
      date,
      genre,
      error: error.message,
      status: error.response?.status,
    });
    return [];
  }
}

/**
 * KOPIS ID로 박스오피스 순위 조회 및 점수 계산
 * 
 * @param kopisId KOPIS 공연 ID (mt20id)
 * @returns Hot Score (0-100)
 */
export async function getKopisBoxOfficeScore(kopisId: string): Promise<number> {
  if (!kopisId) return 0;

  try {
    // 최근 7일간 박스오피스 조회 (평균 순위 계산)
    const today = new Date();
    const scores: number[] = [];

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');

      const boxOfficeList = await getKopisBoxOfficeList(dateStr);
      const rank = boxOfficeList.findIndex(item => item.mt20id === kopisId) + 1;

      if (rank > 0) {
        // 순위 → 점수 변환 (1위: 100점, 10위: 50점, 50위: 10점)
        const score = calculateRankScore(rank);
        scores.push(score);
      }

      // API 호출 간격 (Rate Limit 방지)
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // 평균 점수 계산
    if (scores.length === 0) return 0;
    const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;

    console.log('[KopisAPI] Box office score calculated:', {
      kopisId,
      days: scores.length,
      avgScore: Math.round(avgScore),
    });

    return Math.round(avgScore);
  } catch (error: any) {
    console.error('[KopisAPI] getKopisBoxOfficeScore error:', {
      kopisId,
      error: error.message,
    });
    return 0;
  }
}

/**
 * 박스오피스 순위 → 점수 변환 (0-100)
 * 
 * @param rank 박스오피스 순위 (1-based)
 * @returns 점수 (0-100)
 */
function calculateRankScore(rank: number): number {
  if (rank <= 0) return 0;
  if (rank === 1) return 100;
  if (rank <= 3) return 90;
  if (rank <= 5) return 80;
  if (rank <= 10) return 70;
  if (rank <= 20) return 50;
  if (rank <= 30) return 30;
  if (rank <= 50) return 10;
  return 5;
}

/**
 * KOPIS ID로 공연 상세 정보 조회
 * 
 * @param kopisId KOPIS 공연 ID (mt20id)
 * @returns 공연 상세 정보
 */
export async function getKopisPerformanceDetail(kopisId: string): Promise<any> {
  const { serviceKey } = getKopisCredentials();

  if (!serviceKey) {
    console.warn('[KopisAPI] KOPIS_API_KEY not set.');
    return null;
  }

  try {
    const response = await axios.get(`${BASE_URL}/prf/${kopisId}`, {
      params: {
        service: serviceKey,
      },
      timeout: 10000,
    });

    const parser = new xml2js.Parser({ explicitArray: false });
    const result = await parser.parseStringPromise(response.data);

    return result.dbs?.db || null;
  } catch (error: any) {
    console.error('[KopisAPI] Performance detail error:', {
      kopisId,
      error: error.message,
      status: error.response?.status,
    });
    return null;
  }
}

