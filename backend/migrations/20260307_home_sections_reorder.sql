-- ============================================================
-- 홈 섹션 재편: 순서 재조정 + 타이틀 수정 + 1만원 이하 섹션 추가
-- exhibition, popup_hot은 admin에서 이미 삭제됨
-- ============================================================

-- 1. today_pick: 사용자 결정 중심으로 부제목 변경
UPDATE curation_themes SET
  display_order = 1,
  subtitle = '지금 가장 가볼 만한 선택'
WHERE slug = 'today_pick';

-- 2. this_weekend: 결정형 섹션으로 상위 배치
UPDATE curation_themes SET
  display_order = 2,
  subtitle = '주말 나들이 추천'
WHERE slug = 'this_weekend';

-- 3. ending_soon: 행동 유도형으로 타이틀/부제목 변경
UPDATE curation_themes SET
  display_order = 3,
  title = '놓치기 전에',
  subtitle = '이번 주 끝나는 이벤트'
WHERE slug = 'ending_soon';

-- 4. trending: 사회적 증거형 유지
UPDATE curation_themes SET
  display_order = 4,
  subtitle = '요즘 가장 주목받는 곳'
WHERE slug = 'trending';

-- 5. free_events: 탐색형 유지
UPDATE curation_themes SET
  display_order = 5,
  subtitle = '부담 없는 무료 이벤트'
WHERE slug = 'free_events';

-- 6. 1만원 이하 (신규)
INSERT INTO curation_themes
  (slug, title, subtitle, display_order, is_active, filter_config, max_items)
VALUES (
  'budget_pick',
  '1만원 이하',
  '가성비 좋은 선택',
  6,
  true,
  '{"conditions":{"max_price":10000},"sort_by":"buzz_score"}',
  10
)
ON CONFLICT (slug) DO UPDATE SET
  display_order = 6,
  title = EXCLUDED.title,
  subtitle = EXCLUDED.subtitle,
  filter_config = EXCLUDED.filter_config,
  is_active = true;

-- 7. new_arrival: 최하단 탐색형
UPDATE curation_themes SET
  display_order = 7
WHERE slug = 'new_arrival';
