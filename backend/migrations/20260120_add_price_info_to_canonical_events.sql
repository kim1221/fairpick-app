-- Migration: Add price_info column to canonical_events
-- Date: 2026-01-20
-- Purpose: Store detailed price information text for users

BEGIN;

-- Add price_info column
ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS price_info TEXT;

-- Create index for searching by price_info
CREATE INDEX IF NOT EXISTS idx_canonical_events_price_info
ON canonical_events (price_info)
WHERE price_info IS NOT NULL;

-- Add comment
COMMENT ON COLUMN canonical_events.price_info IS '가격 상세 텍스트 (예: "전석 30,000원", "무료(사전예약)")';

COMMIT;

-- Verify
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'canonical_events'
  AND column_name = 'price_info';

-- Rollback (if needed)
-- BEGIN;
-- DROP INDEX IF EXISTS idx_canonical_events_price_info;
-- ALTER TABLE canonical_events DROP COLUMN IF EXISTS price_info;
-- COMMIT;


