-- budget_pick 섹션 제목/부제목 변경
-- "1만원 이하 / 가성비 좋은 선택" → "부담 없이 가요 / 가볍게 다녀오기 좋은"
UPDATE curation_themes
SET title = '부담 없이 가요', subtitle = '가볍게 다녀오기 좋은'
WHERE slug = 'budget_pick';
