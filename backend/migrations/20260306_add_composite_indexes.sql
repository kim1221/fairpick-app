-- ============================================================
-- 복합 인덱스 추가: 추천 API 쿼리 성능 개선
--
-- 대상: canonical_events 테이블
-- 목적: WHERE is_deleted = false AND end_at >= ... 조합 필터
--       → 매 추천 API 요청마다 풀 테이블 스캔 방지
-- ============================================================

-- 1. 핵심 복합 인덱스: 활성 이벤트 필터 (Partial Index)
--    WHERE is_deleted = false AND end_at >= CURRENT_DATE 패턴에 최적화
--    /api/home/sections, /api/recommendations/* 전체에 적용
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_canonical_events_active
  ON canonical_events (end_at DESC)
  WHERE is_deleted = false;

-- 2. 카테고리 필터 복합 인덱스
--    WHERE is_deleted = false AND end_at >= ... AND main_category = ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_canonical_events_active_category
  ON canonical_events (main_category, end_at DESC)
  WHERE is_deleted = false;

-- 3. 지역 필터 복합 인덱스
--    WHERE is_deleted = false AND end_at >= ... AND region = ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_canonical_events_active_region
  ON canonical_events (region, end_at DESC)
  WHERE is_deleted = false;

-- 4. buzz_score 정렬 인덱스 (추천 정렬에 사용)
--    ORDER BY buzz_score DESC 패턴
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_canonical_events_active_buzz
  ON canonical_events (buzz_score DESC)
  WHERE is_deleted = false;

-- 5. AI 보강 미처리 이벤트 필터 (aiEnrichmentBackfill 전용)
--    WHERE ai_enriched_at IS NULL AND status IN ('scheduled', 'ongoing')
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_canonical_events_unenriched
  ON canonical_events (created_at DESC)
  WHERE is_deleted = false AND ai_enriched_at IS NULL;

-- 6. 임베딩 미생성 이벤트 필터 (embedNewEvents 전용)
--    WHERE embedding IS NULL AND is_deleted = false
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_canonical_events_no_embedding
  ON canonical_events (created_at DESC)
  WHERE is_deleted = false AND embedding IS NULL;
