-- ============================================================
-- unified filter_config 마이그레이션
-- type 기반 → conditions/preset 기반 구조로 통합
-- ============================================================

-- 단순 조건 섹션 (5개): conditions + sort_by 구조로 전환
UPDATE curation_themes SET filter_config = '{"conditions":{"is_featured":true},"sort_by":"featured_order","order":"ASC"}'::jsonb WHERE slug = 'today_pick';
UPDATE curation_themes SET filter_config = '{"conditions":{"categories":["전시"]},"sort_by":"buzz_score","order":"DESC"}'::jsonb WHERE slug = 'exhibition';
UPDATE curation_themes SET filter_config = '{"conditions":{"is_free":true},"sort_by":"view_count","order":"DESC"}'::jsonb WHERE slug = 'free_events';
UPDATE curation_themes SET filter_config = '{"conditions":{"categories":["팝업"]},"sort_by":"buzz_score","order":"DESC"}'::jsonb WHERE slug = 'popup_hot';
UPDATE curation_themes SET filter_config = '{"conditions":{},"sort_by":"created_at","order":"DESC"}'::jsonb WHERE slug = 'new_arrival';

-- 계산 로직 필요 섹션 (3개): preset 플래그 유지
UPDATE curation_themes SET filter_config = '{"preset":"ending_soon","days_to_end":7}'::jsonb WHERE slug = 'ending_soon';
UPDATE curation_themes SET filter_config = '{"preset":"trending"}'::jsonb WHERE slug = 'trending';
UPDATE curation_themes SET filter_config = '{"preset":"weekend"}'::jsonb WHERE slug = 'this_weekend';
