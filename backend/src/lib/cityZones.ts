/**
 * 도시권 정의 및 매핑
 *
 * 지금 떠오르는(getTrending) 섹션에서 도시권 기반 필터링에 사용
 */

/**
 * 도시권 매핑
 * - key: 도시권 이름
 * - value: 해당 도시권에 포함되는 지역 배열
 */
export const CITY_ZONES: Record<string, string[]> = {
  '수도권': ['서울', '인천', '경기'],
  '부울경': ['부산', '울산', '경남'],
  '대경권': ['대구', '경북'],
  '호남권': ['광주', '전남', '전북'],
  '충청권': ['대전', '세종', '충남', '충북'],
  '강원권': ['강원'],
  '제주권': ['제주'],
};

/**
 * 주소에서 도시권 판별
 *
 * @param address - 주소 문자열 (예: "서울 성동구 성수동...")
 * @returns 도시권에 포함되는 지역 배열 (예: ['서울', '인천', '경기'])
 *          매핑 안 되면 빈 배열 반환 (전국으로 처리)
 *
 * @example
 * getCityZone("서울특별시 성동구 성수동 1가")
 * // Returns: ['서울', '인천', '경기']
 *
 * getCityZone("부산광역시 해운대구")
 * // Returns: ['부산', '울산', '경남']
 *
 * getCityZone("Unknown Address")
 * // Returns: []
 */
export function getCityZone(address: string): string[] {
  if (!address) return [];

  // 주소에서 도시권 찾기
  for (const [zoneName, regions] of Object.entries(CITY_ZONES)) {
    if (regions.some(region => address.includes(region))) {
      return regions;
    }
  }

  // 매핑 안 되면 빈 배열 (전국으로 처리)
  return [];
}

/**
 * 도시권 필터 SQL WHERE 절 생성
 *
 * address + region 컬럼을 모두 체크:
 * - address가 NULL인 이벤트(277개)는 region 컬럼으로 커버
 * - 두 컬럼 모두 없으면 해당 이벤트 제외 (도시권 외 이벤트)
 *
 * @param regions - 도시권 지역 배열 (예: ['서울', '인천', '경기'])
 * @returns SQL WHERE 절 문자열
 *
 * @example
 * buildCityZoneFilter(['서울', '인천', '경기'])
 * // Returns: "AND (address LIKE '%서울%' OR ... OR region LIKE '%서울%' OR ...)"
 */
export function buildCityZoneFilter(regions: string[]): string {
  if (regions.length === 0) {
    return ''; // 빈 배열이면 필터 없음 (전국 조회)
  }

  const addressConditions = regions.map(region => `address LIKE '%${region}%'`).join(' OR ');
  const regionConditions = regions.map(region => `region LIKE '%${region}%'`).join(' OR ');
  return `AND (${addressConditions} OR ${regionConditions})`;
}
