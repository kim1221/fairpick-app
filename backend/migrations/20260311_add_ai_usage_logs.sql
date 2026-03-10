-- AI 사용량 로그 테이블
-- Gemini API 호출마다 토큰 수와 예상 비용을 기록합니다.

CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id            BIGSERIAL PRIMARY KEY,
  provider      TEXT NOT NULL DEFAULT 'gemini',          -- 'gemini'
  model         TEXT NOT NULL,                           -- 'gemini-pro', 'gemini-2.5-flash', 'gemini-embedding-001'
  usage_type    TEXT NOT NULL,                           -- 'extraction', 'grounding', 'embedding', 'caption', 'tags', 'seed', 'normalize', 'curation_copy', 'hot_rating', 'popup_discovery'
  prompt_tokens   INTEGER NOT NULL DEFAULT 0,
  response_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12, 8) NOT NULL DEFAULT 0, -- 소수점 8자리 (마이크로 달러)
  success       BOOLEAN NOT NULL DEFAULT TRUE,
  error_code    TEXT,                                    -- NULL이면 성공
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 집계 쿼리 최적화를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at  ON ai_usage_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_usage_type  ON ai_usage_logs (usage_type);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_model       ON ai_usage_logs (model);
