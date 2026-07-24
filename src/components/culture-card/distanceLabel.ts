/**
 * 카드 거리 표기 — 근거리는 도보 시간, 원거리는 대략 거리(km).
 * "도보 몇 시간"은 비현실적이라 40분(약 3.2km) 넘으면 km로 바꾼다. 백엔드와 동일 규칙.
 */
const WALK_LABEL_MAX_MINUTES = 40;
const WALK_METERS_PER_MINUTE = 80;

export function formatWalkOrDistance(walkMinutes: number | null | undefined): string | null {
  if (walkMinutes == null || walkMinutes <= 0) return null;
  if (walkMinutes <= WALK_LABEL_MAX_MINUTES) return `도보 ${walkMinutes}분`;
  const km = Math.round((walkMinutes * WALK_METERS_PER_MINUTE) / 1000);
  return `약 ${km}km`;
}

/** 태그 행 라벨(도보=WALK, 거리=DIST). distanceLabel 문자열로 판별. */
export function distanceRowLabel(distanceLabel: string | null | undefined): 'WALK' | 'DIST' {
  return distanceLabel && distanceLabel.startsWith('도보') ? 'WALK' : 'DIST';
}
