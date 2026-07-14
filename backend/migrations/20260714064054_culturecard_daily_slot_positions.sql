-- 카테고리가 아니라 화면의 세 슬롯을 직접 고정한다.
-- 특정 카테고리만 남은 경우에도 동일 카테고리 카드 3장을 각각 보존할 수 있다.
BEGIN;

ALTER TABLE user_daily_card_slots
  ADD COLUMN IF NOT EXISTS slot_index SMALLINT;

-- 이 마이그레이션과 API 배포 사이에 행이 생기더라도 최대 세 장을 안전하게 이관한다.
WITH ranked AS (
  SELECT user_id, category,
         (ROW_NUMBER() OVER (
           PARTITION BY user_id
           ORDER BY assigned_on DESC,
                    CASE category
                      WHEN '전시' THEN 0
                      WHEN '공연' THEN 1
                      WHEN '팝업' THEN 2
                      WHEN '축제' THEN 3
                      ELSE 4
                    END,
                    event_id
         ) - 1)::smallint AS next_slot_index
  FROM user_daily_card_slots
), updated AS (
  UPDATE user_daily_card_slots slot
  SET slot_index = ranked.next_slot_index
  FROM ranked
  WHERE slot.user_id = ranked.user_id
    AND slot.category = ranked.category
    AND ranked.next_slot_index < 3
  RETURNING slot.user_id, slot.category
)
DELETE FROM user_daily_card_slots slot
WHERE slot.slot_index IS NULL;

ALTER TABLE user_daily_card_slots
  DROP CONSTRAINT IF EXISTS user_daily_card_slots_pkey;

ALTER TABLE user_daily_card_slots
  ALTER COLUMN slot_index SET NOT NULL,
  ADD CONSTRAINT user_daily_card_slots_slot_index_check
    CHECK (slot_index BETWEEN 0 AND 2),
  ADD CONSTRAINT user_daily_card_slots_pkey
    PRIMARY KEY (user_id, slot_index);

COMMENT ON TABLE user_daily_card_slots IS
  'Current three sealed Culture Card slots; bounded to at most three rows per user.';

COMMIT;
