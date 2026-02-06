\pset pager off
\echo '--- geo-coverage-report.v2.sql (canonical_events geo coverage) ---'

-- 0) canonical_events 존재 확인
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='canonical_events'
  ) THEN
    RAISE EXCEPTION 'public.canonical_events 테이블이 없습니다.';
  END IF;
END $$;

-- 1) 위경도 컬럼 자동 탐지: (lat,lng) 우선, 없으면 (geo_lat,geo_lng) 등 대체
DO $$
DECLARE
  lat_col text;
  lng_col text;
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='canonical_events' AND column_name='lat') THEN 'lat'
    WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='canonical_events' AND column_name='geo_lat') THEN 'geo_lat'
    WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='canonical_events' AND column_name='latitude') THEN 'latitude'
    ELSE NULL
  END INTO lat_col;

  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='canonical_events' AND column_name='lng') THEN 'lng'
    WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='canonical_events' AND column_name='geo_lng') THEN 'geo_lng'
    WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='canonical_events' AND column_name='longitude') THEN 'longitude'
    ELSE NULL
  END INTO lng_col;

  IF lat_col IS NULL OR lng_col IS NULL THEN
    RAISE EXCEPTION 'canonical_events에서 위경도 컬럼을 찾지 못했습니다. (lat/lng, geo_lat/geo_lng, latitude/longitude 중 하나 필요)';
  END IF;

  -- source 컬럼 유무 확인 (없으면 'unknown')
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='canonical_events' AND column_name='source') THEN
    EXECUTE format($q$
      CREATE OR REPLACE TEMP VIEW _ce_geo AS
      SELECT
        source::text AS source,
        end_at::date AS end_at,
        %I::double precision AS lat,
        %I::double precision AS lng
      FROM canonical_events
    $q$, lat_col, lng_col);
  ELSE
    EXECUTE format($q$
      CREATE OR REPLACE TEMP VIEW _ce_geo AS
      SELECT
        'unknown'::text AS source,
        end_at::date AS end_at,
        %I::double precision AS lat,
        %I::double precision AS lng
      FROM canonical_events
    $q$, lat_col, lng_col);
  END IF;

  RAISE NOTICE 'Using geo columns: %, %', lat_col, lng_col;
END $$;

-- 2) 전체/라이브 기준 geo 커버리지
\echo ''
\echo '== canonical_events geo coverage (overall / live) =='
SELECT
  COUNT(*)::int                                  AS total,
  COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL)::int AS with_geo,
  ROUND(100.0 * (COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL)) / NULLIF(COUNT(*),0), 2) AS pct_with_geo,
  COUNT(*) FILTER (WHERE end_at >= CURRENT_DATE)::int AS total_live,
  COUNT(*) FILTER (WHERE end_at >= CURRENT_DATE AND lat IS NOT NULL AND lng IS NOT NULL)::int AS with_geo_live,
  ROUND(
    100.0 * (COUNT(*) FILTER (WHERE end_at >= CURRENT_DATE AND lat IS NOT NULL AND lng IS NOT NULL))
    / NULLIF(COUNT(*) FILTER (WHERE end_at >= CURRENT_DATE),0)
  , 2) AS pct_with_geo_live
FROM _ce_geo;

-- 3) source 별 geo 커버리지 (라이브)
\echo ''
\echo '== source geo coverage (live) =='
SELECT
  source,
  COUNT(*) FILTER (WHERE end_at >= CURRENT_DATE)::int AS total_live,
  COUNT(*) FILTER (WHERE end_at >= CURRENT_DATE AND lat IS NOT NULL AND lng IS NOT NULL)::int AS with_geo_live,
  ROUND(
    100.0 * (COUNT(*) FILTER (WHERE end_at >= CURRENT_DATE AND lat IS NOT NULL AND lng IS NOT NULL))
    / NULLIF(COUNT(*) FILTER (WHERE end_at >= CURRENT_DATE),0)
  , 2) AS pct_with_geo_live
FROM _ce_geo
GROUP BY source
ORDER BY source;

\echo ''
\echo '--- done ---'



