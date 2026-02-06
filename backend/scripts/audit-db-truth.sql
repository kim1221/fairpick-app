-- ============================================================
-- DB Truth Audit SQL Script
-- ============================================================
-- 목적: popularity_score와 buzz_score 관련 실제 DB 상태 검증
-- 원칙: 마이그레이션 파일 아닌 실제 DB 쿼리 결과만 근거로 판정
-- ============================================================

\echo '╔════════════════════════════════════════╗'
\echo '║  STEP 1: popularity_score 실체 검증   ║'
\echo '╚════════════════════════════════════════╝'
\echo ''

\echo '[1-1] popularity_score 분포 요약'
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE popularity_score IS NULL) AS null_cnt,
  COUNT(*) FILTER (WHERE popularity_score = 0) AS zero_cnt,
  MIN(popularity_score) AS min_score,
  MAX(popularity_score) AS max_score,
  ROUND(AVG(popularity_score)::numeric, 2) AS avg_score
FROM canonical_events
WHERE is_deleted = false;

\echo ''
\echo '[1-2] popularity_score 상위 빈도값 TOP 20'
SELECT popularity_score, COUNT(*) AS cnt
FROM canonical_events
WHERE is_deleted = false
GROUP BY popularity_score
ORDER BY cnt DESC
LIMIT 20;

\echo ''
\echo '[1-3] popularity_score 상한 실사용 여부'
SELECT
  MAX(popularity_score) AS max_score,
  COUNT(*) FILTER (WHERE popularity_score >= 480) AS ge_480_cnt,
  COUNT(*) FILTER (WHERE popularity_score >= 900) AS ge_900_cnt
FROM canonical_events
WHERE is_deleted = false;

\echo ''
\echo '[1-4] 최근 업데이트 시각 분포 (3일간, 상위 30개)'
SELECT
  DATE_TRUNC('hour', updated_at AT TIME ZONE 'Asia/Seoul') AS hour_kst,
  COUNT(*) AS cnt
FROM canonical_events
WHERE updated_at >= NOW() - INTERVAL '3 days'
  AND is_deleted = false
GROUP BY 1
ORDER BY 1 DESC
LIMIT 30;

\echo ''
\echo '╔════════════════════════════════════════╗'
\echo '║  STEP 2: Buzz Score 스키마 실체 감사  ║'
\echo '╚════════════════════════════════════════╝'
\echo ''

\echo '[2-1] 전체 테이블 목록 (public 스키마)'
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

\echo ''
\echo '[2-2] buzz_score 관련 후보 테이블 존재 여부'
SELECT tablename
FROM pg_tables
WHERE schemaname='public'
  AND tablename IN (
    'canonical_events',
    'event_views',
    'event_actions',
    'event_impressions',
    'event_engagement_agg'
  )
ORDER BY tablename;

\echo ''
\echo '[2-3] canonical_events 컬럼 실체 확인'
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name='canonical_events'
ORDER BY ordinal_position;

\echo ''
\echo '[2-4] event_views 테이블 스키마 (존재할 경우)'
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name='event_views'
ORDER BY ordinal_position;

\echo ''
\echo '[2-5] event_views FK 정합성'
SELECT
  ccu.table_name AS referenced_table,
  ccu.column_name AS referenced_column,
  kcu.table_name AS fk_table,
  kcu.column_name AS fk_column,
  tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND kcu.table_name = 'event_views';

\echo ''
\echo '[2-6] event_views 데이터 존재 여부'
SELECT COUNT(*) as row_count
FROM event_views;

\echo ''
\echo '╔════════════════════════════════════════╗'
\echo '║  감사 완료                             ║'
\echo '╚════════════════════════════════════════╝'
\echo ''
\echo '결과를 docs/BUZZ_AND_POPULARITY_AUDIT_DB_TRUTH.md에 복사하세요.'


