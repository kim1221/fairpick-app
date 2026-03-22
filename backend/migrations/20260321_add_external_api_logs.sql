-- 외부 API 호출 로그 테이블
-- Kakao Local API, Naver Search API, Cloudflare R2 Class A/B 오퍼레이션을 추적합니다.
-- 모두 현재 무료 구간 이내이나, 스케일 시 과금 발생 가능한 항목들입니다.

CREATE TABLE IF NOT EXISTS external_api_logs (
  id          BIGSERIAL PRIMARY KEY,
  provider    TEXT NOT NULL,   -- 'kakao', 'naver', 'r2'
  api_type    TEXT NOT NULL,   -- 'geocode' | 'blog'|'web'|'place'|'cafe'|'buzz' | 'put'|'delete'|'list'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_api_logs_provider_created ON external_api_logs (provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_api_logs_created ON external_api_logs (created_at DESC);
