-- budget_pick 섹션 활성화
-- display_order = 5 (free_events 앞)
-- 로직: getBudgetPick() — 권역 우선 → 전국 폴백, 1만원 이하 (price_min IS NULL 제외)
UPDATE curation_themes
SET is_active = true, display_order = 5
WHERE slug = 'budget_pick';
