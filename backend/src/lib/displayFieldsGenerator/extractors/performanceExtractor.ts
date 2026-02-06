/**
 * Phase 3: Performance Extractor
 * 
 * 공연 이벤트의 display fields 추출
 * 
 * 데이터 소스 우선순위:
 * 1. 🔵 공공 API (KOPIS payload)
 * 2. 🟡 기존 데이터 (sub_category)
 * 3. 🟢 기본값
 * 4. 🟠 AI 분석 (향후 구현)
 */

import { PerformanceDisplay, EventForDisplay } from '../types';
import { getPayloadFromSources, getFirstValue, parseRuntime } from '../utils/payloadReader';

export async function extractPerformanceDisplay(
  event: EventForDisplay
): Promise<PerformanceDisplay> {
  // 1. Payload 읽기
  const payloads = await getPayloadFromSources(event.sources);

  // 2. 출연진 (KOPIS prfcast)
  const prfcast = getFirstValue<string>(payloads.kopis, 'prfcast');
  const cast = prfcast
    ? prfcast.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  // 3. 장르 (KOPIS genrenm)
  const genrenm = getFirstValue<string>(payloads.kopis, 'genrenm');
  const genre = genrenm
    ? genrenm.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  // 4. 공연 시간 (KOPIS prfruntime)
  const prfruntime = getFirstValue<string>(payloads.kopis, 'prfruntime');
  const duration_minutes = parseRuntime(prfruntime);

  // 5. 인터미션 (향후 AI 분석, 기본값: false)
  const intermission = false;

  // 6. 연령 제한 (KOPIS prfage)
  const prfage = getFirstValue<string>(payloads.kopis, 'prfage');
  const age_limit = prfage || '전체관람가';

  // 7. 공연 시간대 (KOPIS dtguidance)
  const dtguidance = getFirstValue<string>(payloads.kopis, 'dtguidance');
  const showtimes = parseShowtimes(dtguidance);

  // 8. 런타임 설명 (향후 AI 분석)
  const runtime = prfruntime || null;

  // 9. 제작진 (향후 AI 분석)
  const crew = {
    director: null,
    writer: null,
    composer: null,
  };

  // 10. 할인 정보 (향후 AI 분석)
  const discounts: string[] = [];

  // 11. 입장 마감 시간 (향후 AI 분석)
  const last_admission = null;

  return {
    cast,
    genre,
    duration_minutes,
    intermission,
    age_limit,
    showtimes,
    runtime,
    crew,
    discounts,
    last_admission,
  };
}

/**
 * KOPIS dtguidance 파싱
 * 
 * 예시:
 * - "화~금 19:30, 토 14:00, 19:00, 일 15:00"
 * - "매주 토요일 14:00, 18:00"
 * 
 * → 간단히 구조화 시도, 실패 시 notes에 원본 저장
 */
function parseShowtimes(dtguidance: string | null): {
  weekday?: string[];
  weekend?: string[];
  holiday?: string[];
  notes?: string;
} {
  if (!dtguidance) {
    return {};
  }

  // 간단한 패턴 파싱 (주중/주말 구분은 매우 어려움)
  // 일단 시간만 추출해서 배열로 반환
  const timePattern = /(\d{1,2}:\d{2})/g;
  const times = dtguidance.match(timePattern);

  if (times && times.length > 0) {
    // 간단히 평일/주말 구분 없이 일단 weekday로 저장
    return {
      weekday: times,
      notes: dtguidance, // 원본도 함께 저장
    };
  }

  // 파싱 실패 시 notes만 저장
  return {
    notes: dtguidance,
  };
}

