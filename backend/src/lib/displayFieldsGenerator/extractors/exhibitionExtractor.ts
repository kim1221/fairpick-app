/**
 * Phase 3: Exhibition Extractor
 * 
 * 전시 이벤트의 display fields 추출
 * 
 * 데이터 소스 우선순위:
 * 1. 🔵 공공 API (KOPIS payload)
 * 2. 🟡 기존 데이터 (sub_category, derived_tags)
 * 3. 🟢 기본값
 * 4. 🟠 AI 분석 (향후 구현)
 */

import { ExhibitionDisplay, EventForDisplay } from '../types';
import { getPayloadFromSources, getFirstValue } from '../utils/payloadReader';

export async function extractExhibitionDisplay(
  event: EventForDisplay
): Promise<ExhibitionDisplay> {
  // 1. Payload 읽기
  const payloads = await getPayloadFromSources(event.sources);

  // 2. 작가/아티스트 (KOPIS prfcast)
  const prfcast = getFirstValue<string>(payloads.kopis, 'prfcast');
  const artists = prfcast
    ? prfcast.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  // 3. 장르 (KOPIS genrenm)
  const genrenm = getFirstValue<string>(payloads.kopis, 'genrenm');
  const genre = genrenm
    ? genrenm.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  // 4. 전시 유형 (sub_category 매핑)
  const type = mapSubCategoryToExhibitionType(event.sub_category);

  // 5. 권장 관람 시간 (기본값: 60분)
  const duration_minutes = 60;

  // 6. 편의시설 (향후 AI 분석으로 채울 예정, 지금은 false)
  const facilities = {
    photo_zone: false,
    audio_guide: false,
    goods_shop: false,
    cafe: false,
  };

  // 7. 도슨트 투어 (향후 AI 분석)
  const docent_tour = null;

  // 8. 특별 프로그램 (향후 AI 분석)
  const special_programs: string[] = [];

  // 9. 연령 추천 (KOPIS prfage)
  const prfage = getFirstValue<string>(payloads.kopis, 'prfage');
  const age_recommendation = prfage || null;

  // 10. 촬영 가능 여부 (향후 AI 분석)
  const photography_allowed = null;

  // 11. 입장 마감 시간 (향후 AI 분석)
  const last_admission = null;

  return {
    artists,
    genre,
    type,
    duration_minutes,
    facilities,
    docent_tour,
    special_programs,
    age_recommendation,
    photography_allowed,
    last_admission,
  };
}

/**
 * sub_category → 전시 유형 매핑
 */
function mapSubCategoryToExhibitionType(subCategory: string | null): string {
  if (!subCategory) return '기획전';

  const lower = subCategory.toLowerCase();
  if (lower.includes('특별')) return '특별전';
  if (lower.includes('상설')) return '상설전';
  if (lower.includes('순회')) return '순회전';
  if (lower.includes('기획')) return '기획전';

  return '기획전'; // 기본값
}

