-- =====================================================
-- Hot Score 시스템 확장 마이그레이션
-- 작성일: 2026-02-07
-- 목적: buzz_score를 hot_score_total로 재활용 + Admin 수동 지정 플래그
-- =====================================================

-- 1. canonical_events 테이블에 is_featured 컬럼 추가
ALTER TABLE canonical_events 
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false;

-- 2. is_featured 인덱스 추가 (추천 쿼리 최적화)
CREATE INDEX IF NOT EXISTS idx_canonical_events_featured 
ON canonical_events(is_featured) 
WHERE is_featured = true;

-- 3. buzz_score 인덱스 추가 (hot_score_total로 사용)
CREATE INDEX IF NOT EXISTS idx_canonical_events_buzz_score 
ON canonical_events(buzz_score DESC NULLS LAST);

-- 4. buzz_components JSONB GIN 인덱스 (컴포넌트 검색용)
CREATE INDEX IF NOT EXISTS idx_canonical_events_buzz_components 
ON canonical_events USING GIN(buzz_components);

-- 5. 컬럼 코멘트
COMMENT ON COLUMN canonical_events.is_featured 
IS 'Admin이 수동으로 "핫함" 지정한 이벤트 (팝업 등)';

COMMENT ON COLUMN canonical_events.buzz_score 
IS 'Hot Score Total: 사용자 행동 + KOPIS + Consensus + Structural 종합 점수 (0-1000)';

COMMENT ON COLUMN canonical_events.buzz_components 
IS 'Hot Score 컴포넌트 상세 (JSONB): kopis, consensus, structural, internal, formula 등';

-- =====================================================
-- 마이그레이션 완료
-- =====================================================

