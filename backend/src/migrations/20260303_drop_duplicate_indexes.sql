-- 중복 인덱스 제거
-- 아래 5개는 이미 존재하는 인덱스와 정의가 완전히 동일한 중복 인덱스임
--
-- idx_canonical_events_location  → idx_lat_lng 과 동일 (0회 사용)
-- idx_canonical_events_is_free   → idx_is_free 와 동일
-- idx_canonical_events_is_ending_soon → idx_is_ending_soon 과 동일
-- idx_canonical_events_popularity_score → idx_popularity_score 와 동일
-- idx_canonical_events_is_featured → idx_canonical_events_featured 와 동일

DROP INDEX CONCURRENTLY IF EXISTS idx_canonical_events_location;
DROP INDEX CONCURRENTLY IF EXISTS idx_canonical_events_is_free;
DROP INDEX CONCURRENTLY IF EXISTS idx_canonical_events_is_ending_soon;
DROP INDEX CONCURRENTLY IF EXISTS idx_canonical_events_popularity_score;
DROP INDEX CONCURRENTLY IF EXISTS idx_canonical_events_is_featured;
