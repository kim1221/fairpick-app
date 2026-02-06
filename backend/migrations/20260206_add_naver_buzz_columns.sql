-- ============================================================
-- 네이버 기반 Buzz Score 컬럼 추가
-- ============================================================
-- 기존 buzz_score는 사용자 행동 기반 (이미 존재)
-- 이 마이그레이션은 네이버 언급 수 기반 컬럼을 추가
-- 나중에 두 값을 통합하여 final_buzz_score 계산
-- ============================================================

-- 1. 네이버 언급 수 저장
ALTER TABLE canonical_events 
ADD COLUMN IF NOT EXISTS naver_mentions INTEGER DEFAULT 0;

-- 2. 네이버 기반 buzz score (0~100 정규화)
ALTER TABLE canonical_events 
ADD COLUMN IF NOT EXISTS naver_buzz_score FLOAT DEFAULT 0;

-- 3. 네이버 buzz 마지막 업데이트 시간
ALTER TABLE canonical_events 
ADD COLUMN IF NOT EXISTS naver_updated_at TIMESTAMP;

-- 4. 업데이트 우선순위 (0=매일, 1=3일, 2=주1)
ALTER TABLE canonical_events 
ADD COLUMN IF NOT EXISTS update_priority INTEGER DEFAULT 2;

-- 5. 인덱스 추가 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_naver_buzz_score 
ON canonical_events(naver_buzz_score DESC) 
WHERE naver_buzz_score > 0;

CREATE INDEX IF NOT EXISTS idx_update_priority 
ON canonical_events(update_priority, naver_updated_at);

-- 6. 주석 추가
COMMENT ON COLUMN canonical_events.naver_mentions IS '네이버 블로그 언급 수 (추천 알고리즘용)';
COMMENT ON COLUMN canonical_events.naver_buzz_score IS '네이버 기반 인기도 점수 (0~100, percentile)';
COMMENT ON COLUMN canonical_events.naver_updated_at IS '네이버 buzz 마지막 업데이트 시간';
COMMENT ON COLUMN canonical_events.update_priority IS '업데이트 주기 (0=매일, 1=3일, 2=주1회)';

