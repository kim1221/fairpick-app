-- walkable 섹션 추가 및 활성화
-- 로직: getWalkable() — 1.5km 고정, 폴백 없음, 위치 없으면 섹션 숨김
-- 정렬: distance_km ASC + buzz_score 보조

INSERT INTO curation_themes
  (slug, title, subtitle, display_order, is_active, filter_config, max_items)
VALUES (
  'walkable',
  '걸어서 다녀오기 좋은 곳',
  '지금 내 주변, 걸어갈 수 있는 거리',
  7,
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
