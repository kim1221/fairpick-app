-- date_pick 섹션 추가 및 활성화
-- 후보 풀: derived_tags @> '["데이트"]' (2026-03-08 기준 1,160개)
-- 로직: getDatePick() — 권역 우선 → 전국 폴백, buzz_score 중심 정렬
-- 후처리: shownIds dedup + 카테고리 친화도 boost + 3일 클릭 다운랭크

INSERT INTO curation_themes
  (slug, title, subtitle, display_order, is_active, filter_config, max_items)
VALUES (
  'date_pick',
  '둘이 가기 좋은 곳',
  '데이트로 실패 없는 선택',
  6,
  true,
  '{}',
  10
)
ON CONFLICT (slug) DO UPDATE
  SET title         = EXCLUDED.title,
      subtitle      = EXCLUDED.subtitle,
      display_order = EXCLUDED.display_order,
      is_active     = EXCLUDED.is_active,
      max_items     = EXCLUDED.max_items;
