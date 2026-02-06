-- Migration: Add featured columns to canonical_events
-- Created: 2025-12-23
-- Description: Phase 1 - Add is_featured and featured_score columns for recommendation system

-- ============================================================
-- UP Migration
-- ============================================================

BEGIN;

-- 1. Add is_featured column
-- Purpose: Mark events as featured (auto-recommendation in Phase 1, manual override in Phase 3)
ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;

-- 2. Add featured_score column
-- Purpose: Internal scoring for "지금 주목할 만한 일정" recommendation
-- Not exposed to UI
ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS featured_score INTEGER NOT NULL DEFAULT 0;

-- 3. Add comment for documentation
COMMENT ON COLUMN canonical_events.is_featured IS 'Phase 1: Auto-recommendation flag. Phase 3: Admin manual override.';
COMMENT ON COLUMN canonical_events.featured_score IS 'Internal recommendation score (not exposed to UI). Higher = more featured.';

-- 4. Create indexes for query performance
-- Index for featured events queries (commonly filtered by is_featured=true)
CREATE INDEX IF NOT EXISTS idx_canonical_events_is_featured
ON canonical_events(is_featured)
WHERE is_featured = true;

-- Composite index for featured events with score ordering
CREATE INDEX IF NOT EXISTS idx_canonical_events_featured_score
ON canonical_events(is_featured, featured_score DESC)
WHERE is_featured = true;

-- 5. Update existing rows (all set to default values)
-- This is implicit due to DEFAULT values, but explicitly shown for clarity
-- UPDATE canonical_events
-- SET is_featured = false, featured_score = 0
-- WHERE is_featured IS NULL OR featured_score IS NULL;

COMMIT;

-- ============================================================
-- Verification Queries
-- ============================================================

-- Check if columns were added successfully
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'canonical_events'
--   AND column_name IN ('is_featured', 'featured_score');

-- Check indexes
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'canonical_events'
--   AND indexname LIKE '%featured%';

-- Count featured events (should be 0 initially)
-- SELECT COUNT(*) AS featured_count
-- FROM canonical_events
-- WHERE is_featured = true;

-- ============================================================
-- DOWN Migration (Rollback)
-- ============================================================

-- To rollback this migration, run:
-- BEGIN;
-- DROP INDEX IF EXISTS idx_canonical_events_featured_score;
-- DROP INDEX IF EXISTS idx_canonical_events_is_featured;
-- ALTER TABLE canonical_events DROP COLUMN IF EXISTS featured_score;
-- ALTER TABLE canonical_events DROP COLUMN IF EXISTS is_featured;
-- COMMIT;
