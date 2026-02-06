-- ============================================================
-- Common Fields Audit SQL Script
-- ============================================================
-- 목적: canonical_events 테이블의 실제 존재 컬럼만 대상으로 커버리지 감사
-- 실행: psql -h localhost -p 5432 -U user -d fairpick -f scripts/audit-common-fields.sql
-- ============================================================

\echo ''
\echo '═══════════════════════════════════════════════════════════'
\echo '📊 Common Fields Audit Report'
\echo '═══════════════════════════════════════════════════════════'
\echo ''

-- ============================================================
-- 1. Total / Active Count
-- ============================================================
\echo '1️⃣ Total / Active Count'
\echo '───────────────────────────────────────────────────────────'

SELECT
  COUNT(*) as total_count,
  COUNT(*) FILTER (WHERE is_deleted = false) as active_count,
  COUNT(*) FILTER (WHERE is_deleted = true) as deleted_count,
  ROUND(100.0 * COUNT(*) FILTER (WHERE is_deleted = false) / COUNT(*), 2) as active_percentage
FROM canonical_events;

\echo ''

-- ============================================================
-- 2. Field Coverage (Active 기준)
-- ============================================================
\echo '2️⃣ Field Coverage (Active Events Only)'
\echo '───────────────────────────────────────────────────────────'

WITH active_total AS (
  SELECT COUNT(*) as total FROM canonical_events WHERE is_deleted = false
)
SELECT
  'id' as field_name,
  COUNT(*) FILTER (WHERE id IS NOT NULL) as non_null_count,
  COUNT(*) FILTER (WHERE id IS NULL) as null_or_blank_count,
  ROUND(100.0 * COUNT(*) FILTER (WHERE id IS NOT NULL) / (SELECT total FROM active_total), 2) as coverage_pct
FROM canonical_events WHERE is_deleted = false
UNION ALL
SELECT
  'title',
  COUNT(*) FILTER (WHERE title IS NOT NULL AND title != ''),
  COUNT(*) FILTER (WHERE title IS NULL OR title = ''),
  ROUND(100.0 * COUNT(*) FILTER (WHERE title IS NOT NULL AND title != '') / (SELECT total FROM active_total), 2)
FROM canonical_events WHERE is_deleted = false
UNION ALL
SELECT
  'start_at',
  COUNT(*) FILTER (WHERE start_at IS NOT NULL),
  COUNT(*) FILTER (WHERE start_at IS NULL),
  ROUND(100.0 * COUNT(*) FILTER (WHERE start_at IS NOT NULL) / (SELECT total FROM active_total), 2)
FROM canonical_events WHERE is_deleted = false
UNION ALL
SELECT
  'end_at',
  COUNT(*) FILTER (WHERE end_at IS NOT NULL),
  COUNT(*) FILTER (WHERE end_at IS NULL),
  ROUND(100.0 * COUNT(*) FILTER (WHERE end_at IS NOT NULL) / (SELECT total FROM active_total), 2)
FROM canonical_events WHERE is_deleted = false
UNION ALL
SELECT
  'venue',
  COUNT(*) FILTER (WHERE venue IS NOT NULL AND venue != ''),
  COUNT(*) FILTER (WHERE venue IS NULL OR venue = ''),
  ROUND(100.0 * COUNT(*) FILTER (WHERE venue IS NOT NULL AND venue != '') / (SELECT total FROM active_total), 2)
FROM canonical_events WHERE is_deleted = false
UNION ALL
SELECT
  'region',
  COUNT(*) FILTER (WHERE region IS NOT NULL AND region != ''),
  COUNT(*) FILTER (WHERE region IS NULL OR region = ''),
  ROUND(100.0 * COUNT(*) FILTER (WHERE region IS NOT NULL AND region != '') / (SELECT total FROM active_total), 2)
FROM canonical_events WHERE is_deleted = false
UNION ALL
SELECT
  'main_category',
  COUNT(*) FILTER (WHERE main_category IS NOT NULL AND main_category != ''),
  COUNT(*) FILTER (WHERE main_category IS NULL OR main_category = ''),
  ROUND(100.0 * COUNT(*) FILTER (WHERE main_category IS NOT NULL AND main_category != '') / (SELECT total FROM active_total), 2)
FROM canonical_events WHERE is_deleted = false
UNION ALL
SELECT
  'sub_category',
  COUNT(*) FILTER (WHERE sub_category IS NOT NULL AND sub_category != ''),
  COUNT(*) FILTER (WHERE sub_category IS NULL OR sub_category = ''),
  ROUND(100.0 * COUNT(*) FILTER (WHERE sub_category IS NOT NULL AND sub_category != '') / (SELECT total FROM active_total), 2)
FROM canonical_events WHERE is_deleted = false
UNION ALL
SELECT
  'image_url',
  COUNT(*) FILTER (WHERE image_url IS NOT NULL AND image_url != ''),
  COUNT(*) FILTER (WHERE image_url IS NULL OR image_url = ''),
  ROUND(100.0 * COUNT(*) FILTER (WHERE image_url IS NOT NULL AND image_url != '') / (SELECT total FROM active_total), 2)
FROM canonical_events WHERE is_deleted = false
UNION ALL
SELECT
  'overview',
  COUNT(*) FILTER (WHERE overview IS NOT NULL AND overview != ''),
  COUNT(*) FILTER (WHERE overview IS NULL OR overview = ''),
  ROUND(100.0 * COUNT(*) FILTER (WHERE overview IS NOT NULL AND overview != '') / (SELECT total FROM active_total), 2)
FROM canonical_events WHERE is_deleted = false
UNION ALL
SELECT
  'address',
  COUNT(*) FILTER (WHERE address IS NOT NULL AND address != ''),
  COUNT(*) FILTER (WHERE address IS NULL OR address = ''),
  ROUND(100.0 * COUNT(*) FILTER (WHERE address IS NOT NULL AND address != '') / (SELECT total FROM active_total), 2)
FROM canonical_events WHERE is_deleted = false
UNION ALL
SELECT
  'lat',
  COUNT(*) FILTER (WHERE lat IS NOT NULL),
  COUNT(*) FILTER (WHERE lat IS NULL),
  ROUND(100.0 * COUNT(*) FILTER (WHERE lat IS NOT NULL) / (SELECT total FROM active_total), 2)
FROM canonical_events WHERE is_deleted = false
UNION ALL
SELECT
  'lng',
  COUNT(*) FILTER (WHERE lng IS NOT NULL),
  COUNT(*) FILTER (WHERE lng IS NULL),
  ROUND(100.0 * COUNT(*) FILTER (WHERE lng IS NOT NULL) / (SELECT total FROM active_total), 2)
FROM canonical_events WHERE is_deleted = false
UNION ALL
SELECT
  'is_free',
  COUNT(*) FILTER (WHERE is_free IS NOT NULL),
  COUNT(*) FILTER (WHERE is_free IS NULL),
  ROUND(100.0 * COUNT(*) FILTER (WHERE is_free IS NOT NULL) / (SELECT total FROM active_total), 2)
FROM canonical_events WHERE is_deleted = false
UNION ALL
SELECT
  'price_info',
  COUNT(*) FILTER (WHERE price_info IS NOT NULL AND price_info != ''),
  COUNT(*) FILTER (WHERE price_info IS NULL OR price_info = ''),
  ROUND(100.0 * COUNT(*) FILTER (WHERE price_info IS NOT NULL AND price_info != '') / (SELECT total FROM active_total), 2)
FROM canonical_events WHERE is_deleted = false
UNION ALL
SELECT
  'display_title',
  COUNT(*) FILTER (WHERE display_title IS NOT NULL AND display_title != ''),
  COUNT(*) FILTER (WHERE display_title IS NULL OR display_title = ''),
  ROUND(100.0 * COUNT(*) FILTER (WHERE display_title IS NOT NULL AND display_title != '') / (SELECT total FROM active_total), 2)
FROM canonical_events WHERE is_deleted = false
UNION ALL
SELECT
  'content_key',
  COUNT(*) FILTER (WHERE content_key IS NOT NULL AND content_key != ''),
  COUNT(*) FILTER (WHERE content_key IS NULL OR content_key = ''),
  ROUND(100.0 * COUNT(*) FILTER (WHERE content_key IS NOT NULL AND content_key != '') / (SELECT total FROM active_total), 2)
FROM canonical_events WHERE is_deleted = false
UNION ALL
SELECT
  'is_ending_soon',
  COUNT(*) FILTER (WHERE is_ending_soon IS NOT NULL),
  COUNT(*) FILTER (WHERE is_ending_soon IS NULL),
  ROUND(100.0 * COUNT(*) FILTER (WHERE is_ending_soon IS NOT NULL) / (SELECT total FROM active_total), 2)
FROM canonical_events WHERE is_deleted = false
UNION ALL
SELECT
  'popularity_score',
  COUNT(*) FILTER (WHERE popularity_score IS NOT NULL),
  COUNT(*) FILTER (WHERE popularity_score IS NULL),
  ROUND(100.0 * COUNT(*) FILTER (WHERE popularity_score IS NOT NULL) / (SELECT total FROM active_total), 2)
FROM canonical_events WHERE is_deleted = false
ORDER BY field_name;

\echo ''

-- ============================================================
-- 3. Data Integrity Checks
-- ============================================================
\echo '3️⃣ Data Integrity Checks'
\echo '───────────────────────────────────────────────────────────'

-- 3-1. start_at > end_at
\echo '▸ start_at > end_at (Anomaly Count)'
SELECT COUNT(*) as anomaly_count
FROM canonical_events
WHERE is_deleted = false
  AND start_at IS NOT NULL
  AND end_at IS NOT NULL
  AND start_at > end_at;

-- 3-2. lat/lng Range Anomalies
\echo ''
\echo '▸ lat/lng Range Anomalies'
SELECT
  COUNT(*) FILTER (WHERE lat < -90 OR lat > 90) as lat_out_of_range,
  COUNT(*) FILTER (WHERE lng < -180 OR lng > 180) as lng_out_of_range,
  COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NULL) as lat_only,
  COUNT(*) FILTER (WHERE lat IS NULL AND lng IS NOT NULL) as lng_only
FROM canonical_events
WHERE is_deleted = false;

-- 3-3. is_free / price_info Mismatch
\echo ''
\echo '▸ is_free / price_info Mismatch'
SELECT
  COUNT(*) FILTER (WHERE is_free = true AND price_info IS NOT NULL AND price_info != '' AND price_info !~* '무료') as free_but_has_price,
  COUNT(*) FILTER (WHERE is_free = false AND (price_info IS NULL OR price_info = '' OR price_info ~* '무료')) as paid_but_no_price
FROM canonical_events
WHERE is_deleted = false;

\echo ''

-- ============================================================
-- 4. Distribution & Samples
-- ============================================================
\echo '4️⃣ Distribution & Samples'
\echo '───────────────────────────────────────────────────────────'

-- 4-1. main_category Distribution
\echo '▸ main_category Distribution (Active)'
SELECT
  COALESCE(main_category, '<NULL>') as category,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 2) as percentage
FROM canonical_events
WHERE is_deleted = false
GROUP BY main_category
ORDER BY count DESC;

\echo ''

-- 4-2. sub_category Top 20
\echo '▸ sub_category Top 20 (Active)'
SELECT
  COALESCE(sub_category, '<NULL>') as sub_category,
  COUNT(*) as count
FROM canonical_events
WHERE is_deleted = false
GROUP BY sub_category
ORDER BY count DESC
LIMIT 20;

\echo ''

-- 4-3. region Top 20
\echo '▸ region Top 20 (Active)'
SELECT
  COALESCE(region, '<NULL>') as region,
  COUNT(*) as count
FROM canonical_events
WHERE is_deleted = false
GROUP BY region
ORDER BY count DESC
LIMIT 20;

\echo ''

-- 4-4. overview NULL Sample (Recent 10)
\echo '▸ overview NULL Sample (Recent 10)'
SELECT
  id,
  LEFT(title, 50) as title_sample,
  updated_at
FROM canonical_events
WHERE is_deleted = false
  AND (overview IS NULL OR overview = '')
ORDER BY updated_at DESC
LIMIT 10;

\echo ''

-- 4-5. address NULL Sample (Recent 10)
\echo '▸ address NULL Sample (Recent 10)'
SELECT
  id,
  LEFT(title, 50) as title_sample,
  region,
  venue
FROM canonical_events
WHERE is_deleted = false
  AND (address IS NULL OR address = '')
ORDER BY updated_at DESC
LIMIT 10;

\echo ''

-- 4-6. image_url NULL Sample (Recent 10)
\echo '▸ image_url NULL Sample (Recent 10)'
SELECT
  id,
  LEFT(title, 50) as title_sample,
  source_priority_winner
FROM canonical_events
WHERE is_deleted = false
  AND (image_url IS NULL OR image_url = '')
ORDER BY updated_at DESC
LIMIT 10;

\echo ''

-- 4-7. start_at > end_at Sample (Integrity Issue)
\echo '▸ start_at > end_at Sample (Anomaly)'
SELECT
  id,
  LEFT(title, 50) as title_sample,
  start_at,
  end_at
FROM canonical_events
WHERE is_deleted = false
  AND start_at IS NOT NULL
  AND end_at IS NOT NULL
  AND start_at > end_at
ORDER BY updated_at DESC
LIMIT 10;

\echo ''
\echo '═══════════════════════════════════════════════════════════'
\echo '✅ Audit Complete'
\echo '═══════════════════════════════════════════════════════════'
\echo ''

