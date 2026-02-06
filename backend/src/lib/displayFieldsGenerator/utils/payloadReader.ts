/**
 * Phase 3: Payload Reader
 * 
 * canonical_events.sources에서 raw_* 테이블 데이터를 읽어옴
 */

import { pool } from '../../../db';
import { KopisPayload, CulturePayload, TourPayload } from '../types';

export interface RawPayload {
  kopis: KopisPayload[];
  culture: CulturePayload[];
  tour: TourPayload[];
}

/**
 * canonical_events.sources 배열을 순회하며
 * raw_kopis_events, raw_culture_events, raw_tour_events에서 payload를 가져옴
 */
export async function getPayloadFromSources(
  sources: Array<{ source: string; rawTable: string; rawId: string }>
): Promise<RawPayload> {
  const result: RawPayload = {
    kopis: [],
    culture: [],
    tour: [],
  };

  for (const src of sources) {
    const { rawTable, rawId } = src;

    try {
      // raw_* 테이블명에 따라 payload 조회
      if (rawTable === 'raw_kopis_events') {
        const { rows } = await pool.query<{ payload: KopisPayload }>(
          `SELECT payload FROM raw_kopis_events WHERE id = $1`,
          [rawId]
        );
        if (rows.length > 0 && rows[0].payload) {
          result.kopis.push(rows[0].payload);
        }
      } else if (rawTable === 'raw_culture_events') {
        const { rows } = await pool.query<{ payload: CulturePayload }>(
          `SELECT payload FROM raw_culture_events WHERE id = $1`,
          [rawId]
        );
        if (rows.length > 0 && rows[0].payload) {
          result.culture.push(rows[0].payload);
        }
      } else if (rawTable === 'raw_tour_events') {
        const { rows } = await pool.query<{ payload: TourPayload }>(
          `SELECT payload FROM raw_tour_events WHERE id = $1`,
          [rawId]
        );
        if (rows.length > 0 && rows[0].payload) {
          result.tour.push(rows[0].payload);
        }
      }
    } catch (error) {
      console.error(`[Payload Reader] Failed to fetch ${rawTable}:${rawId}:`, error);
    }
  }

  return result;
}

/**
 * 여러 payload에서 첫 번째로 찾은 값 반환
 */
export function getFirstValue<T>(
  payloads: Array<Record<string, any>>,
  key: string
): T | null {
  for (const payload of payloads) {
    if (payload && payload[key]) {
      return payload[key] as T;
    }
  }
  return null;
}

/**
 * 런타임 파싱: "1시간 30분", "100분" → 숫자(분)
 */
export function parseRuntime(text: string | null | undefined): number | null {
  if (!text) return null;

  // "1시간 30분" → 90 (먼저 체크해야 함!)
  const hoursMatch = text.match(/(\d+)\s*시간/);
  const minutesInHourFormat = text.match(/(\d+)\s*시간.*?(\d+)\s*분/);
  
  if (minutesInHourFormat) {
    // "1시간 30분" 형식
    const hours = parseInt(minutesInHourFormat[1], 10);
    const mins = parseInt(minutesInHourFormat[2], 10);
    return hours * 60 + mins;
  } else if (hoursMatch) {
    // "1시간" 형식 (분 없음)
    const hours = parseInt(hoursMatch[1], 10);
    return hours * 60;
  }

  // "100분" → 100
  const minutesMatch = text.match(/(\d+)\s*분/);
  if (minutesMatch) {
    return parseInt(minutesMatch[1], 10);
  }

  return null;
}

