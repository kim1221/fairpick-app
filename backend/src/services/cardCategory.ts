/**
 * 카드 카테고리 정규화 — 단일 소스.
 * 컬렉션 슬롯 매칭이 앱이 보여주는 카테고리와 어긋나면 "조건에 맞는데 안 채워지는" 버그가 되므로
 * JS판과 SQL판을 여기서만 정의하고 양쪽(cards 라우트·컬렉션 매칭)이 공유한다.
 */

export function normalizeCategory(category: string | null): string {
  if (!category) return '기타';
  if (category.includes('전시')) return '전시';
  if (category.includes('공연') || category.includes('뮤지컬') || category.includes('연극') || category.includes('콘서트')) return '공연';
  if (category.includes('팝업')) return '팝업';
  if (category.includes('축제') || category.includes('페스티벌')) return '축제';
  return '기타';
}

export function normalizedCategorySql(column: string): string {
  return `CASE
    WHEN ${column} IS NULL THEN '기타'
    WHEN ${column} LIKE '%전시%' THEN '전시'
    WHEN ${column} LIKE '%공연%'
      OR ${column} LIKE '%뮤지컬%'
      OR ${column} LIKE '%연극%'
      OR ${column} LIKE '%콘서트%' THEN '공연'
    WHEN ${column} LIKE '%팝업%' THEN '팝업'
    WHEN ${column} LIKE '%축제%'
      OR ${column} LIKE '%페스티벌%' THEN '축제'
    ELSE '기타'
  END`;
}
