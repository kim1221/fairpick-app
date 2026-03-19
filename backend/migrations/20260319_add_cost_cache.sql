-- 비용 관제용 캐시 테이블
-- R2 스캔 결과 등 느린 외부 조회를 1시간 캐시
-- 2차에서 고정비(Railway, 도메인) 수동 입력값도 이 테이블에 저장

CREATE TABLE IF NOT EXISTS cost_cache (
  key        TEXT        PRIMARY KEY,
  value      JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  cost_cache IS '비용 관제 캐시 — R2 스캔, 고정비 수동 입력 등';
COMMENT ON COLUMN cost_cache.key IS 'r2_stats | monthly_fixed | cf_stats 등 용도별 키';
