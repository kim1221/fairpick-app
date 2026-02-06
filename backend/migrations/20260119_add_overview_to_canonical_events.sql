-- Add overview column to canonical_events
-- This column will store event description/summary extracted from raw payload

ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS overview TEXT;

-- Create index for filtering events with/without overview
CREATE INDEX IF NOT EXISTS idx_canonical_events_overview
ON canonical_events (id)
WHERE overview IS NOT NULL AND overview != '';

-- Add comment
COMMENT ON COLUMN canonical_events.overview IS 'Event description/summary extracted from raw data sources (tour.overview, etc.)';
