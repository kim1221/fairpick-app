-- 검색 쿼리 로그 테이블
-- 사용자의 실제 검색어를 수집해 향후 자동완성 랭킹 데이터로 활용
CREATE TABLE IF NOT EXISTS search_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  query       TEXT NOT NULL,
  result_count INTEGER,
  search_mode TEXT,                  -- 'text' | 'vector'
  metadata    JSONB DEFAULT '{}',    -- 필터 정보 (category, region, quickFilter 등)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 자동완성 인기 쿼리 집계를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_search_logs_query ON search_logs (query);
CREATE INDEX IF NOT EXISTS idx_search_logs_created_at ON search_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_logs_user_id ON search_logs (user_id);
