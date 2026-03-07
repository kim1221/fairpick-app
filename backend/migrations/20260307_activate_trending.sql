-- trending 섹션 활성화
-- display_order = 4 (기존 설정 유지)
-- 로직 변경 없음: trend_score / 위치 반영 / dateSeededShuffle / applySlotCap 모두 유지
UPDATE curation_themes
SET is_active = true
WHERE slug = 'trending';
