-- =====================================================
-- Buzz Score 검증 스크립트
-- =====================================================
-- 목적: buzz_score 배치 실행 후 결과 검증
-- 실행: psql -d fairpick -f scripts/verify-buzz-score.sql
-- =====================================================

\echo '=============================================='
\echo 'Buzz Score 분포 요약'
\echo '=============================================='

-- 전체 buzz_score 분포
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE buzz_score IS NULL) AS null_cnt,
  COUNT(*) FILTER (WHERE buzz_score = 0) AS zero_cnt,
  MIN(buzz_score) AS min_score,
  MAX(buzz_score) AS max_score,
  ROUND(AVG(buzz_score)::numeric, 2) AS avg_score,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY buzz_score)::numeric, 2) AS median_score
FROM canonical_events
WHERE is_deleted = false;

\echo ''
\echo '=============================================='
\echo '상위 20개 이벤트 (buzz_score 기준)'
\echo '=============================================='

-- 상위 20개 이벤트
SELECT
  id,
  LEFT(title, 50) AS title,
  buzz_score,
  popularity_score,
  view_count,
  buzz_updated_at
FROM canonical_events
WHERE is_deleted = false
ORDER BY buzz_score DESC
LIMIT 20;

\echo ''
\echo '=============================================='
\echo 'Buzz Score vs Popularity Score 비교'
\echo '=============================================='

-- buzz_score와 popularity_score 상관관계
SELECT
  CASE
    WHEN buzz_score = 0 THEN 'Zero (0)'
    WHEN buzz_score < 100 THEN 'Low (1-99)'
    WHEN buzz_score < 300 THEN 'Medium (100-299)'
    WHEN buzz_score < 600 THEN 'High (300-599)'
    ELSE 'Very High (600+)'
  END AS buzz_score_range,
  COUNT(*) AS event_count,
  ROUND(AVG(popularity_score)::numeric, 2) AS avg_popularity_score,
  ROUND(AVG(view_count)::numeric, 2) AS avg_view_count
FROM canonical_events
WHERE is_deleted = false
GROUP BY buzz_score_range
ORDER BY
  CASE buzz_score_range
    WHEN 'Zero (0)' THEN 1
    WHEN 'Low (1-99)' THEN 2
    WHEN 'Medium (100-299)' THEN 3
    WHEN 'High (300-599)' THEN 4
    WHEN 'Very High (600+)' THEN 5
  END;

\echo ''
\echo '=============================================='
\echo '최근 업데이트 이벤트 (buzz_updated_at 기준)'
\echo '=============================================='

-- 최근 업데이트된 이벤트 10개
SELECT
  id,
  LEFT(title, 40) AS title,
  buzz_score,
  buzz_updated_at,
  buzz_components->>'views_7d' AS views_7d,
  buzz_components->>'likes_7d' AS likes_7d,
  buzz_components->>'shares_7d' AS shares_7d
FROM canonical_events
WHERE is_deleted = false
  AND buzz_updated_at IS NOT NULL
ORDER BY buzz_updated_at DESC
LIMIT 10;

\echo ''
\echo '=============================================='
\echo 'Buzz Components 샘플 (상위 5개)'
\echo '=============================================='

-- buzz_components JSONB 샘플 (상위 5개)
SELECT
  LEFT(title, 40) AS title,
  buzz_score,
  jsonb_pretty(buzz_components) AS components
FROM canonical_events
WHERE is_deleted = false
  AND buzz_components IS NOT NULL
ORDER BY buzz_score DESC
LIMIT 5;

\echo ''
\echo '=============================================='
\echo '검증 완료'
\echo '=============================================='
