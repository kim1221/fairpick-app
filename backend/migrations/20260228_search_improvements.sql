-- 검색 정확도 및 성능 개선 마이그레이션
-- 1) HNSW 벡터 인덱스: halfvec 캐스팅으로 3072차원 지원 (코사인 거리 기반 의미 검색)
-- 2) pg_trgm: overview/derived_tags ILIKE 검색용 트라이그램 인덱스

-- ─────────────────────────────────────────────────
-- 0. 의존 확장
-- ─────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─────────────────────────────────────────────────
-- 1. 벡터 검색 HNSW 인덱스 (halfvec expression index)
--    pgvector는 vector 타입에 직접 HNSW를 2000차원까지만 지원.
--    halfvec(3072)으로 캐스팅하면 4000차원까지 지원.
-- ─────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_canonical_events_embedding_hnsw
  ON canonical_events
  USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ─────────────────────────────────────────────────
-- 2. overview ILIKE 검색 트라이그램 인덱스
-- ─────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_canonical_events_overview_trgm
  ON canonical_events
  USING gin (overview gin_trgm_ops)
  WHERE overview IS NOT NULL AND is_deleted = false;

-- ─────────────────────────────────────────────────
-- 3. derived_tags ILIKE 검색 트라이그램 인덱스
--    derived_tags는 JSONB 배열 → ::text 변환 후 매칭
-- ─────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_canonical_events_derived_tags_trgm
  ON canonical_events
  USING gin ((derived_tags::text) gin_trgm_ops)
  WHERE derived_tags IS NOT NULL AND is_deleted = false;
