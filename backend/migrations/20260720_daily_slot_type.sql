-- "?" 미스터리 슬롯(스펙 2026-07-19 §3.2·§3.3): 오늘의 3슬롯 중 1개를 mystery로 표시한다.
-- category 컬럼은 mystery 슬롯에서도 카드의 실제 카테고리를 저장한다(핀 검증·커버리지 재사용).
-- ⚠️ 코드 배포 전에 적용 필수 — recordCardAssignments가 slot_type 컬럼에 쓴다.
ALTER TABLE user_daily_card_slots
  ADD COLUMN IF NOT EXISTS slot_type TEXT NOT NULL DEFAULT 'category';

ALTER TABLE user_daily_card_slots
  DROP CONSTRAINT IF EXISTS user_daily_card_slots_slot_type_check;

ALTER TABLE user_daily_card_slots
  ADD CONSTRAINT user_daily_card_slots_slot_type_check
    CHECK (slot_type IN ('category', 'mystery'));

COMMENT ON COLUMN user_daily_card_slots.slot_type IS
  'category = 일반 카테고리 슬롯, mystery = "?" 슬롯(응답에서 카테고리·티저 은닉).';
