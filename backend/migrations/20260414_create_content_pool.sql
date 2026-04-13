-- ============================================================
-- 매거진 피드 콘텐츠 풀 테이블
-- 목적: 매일 배치로 생성된 TREND/BUNDLE/SPOTLIGHT 카드 저장
-- ============================================================

CREATE TABLE IF NOT EXISTS content_pool (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type    TEXT NOT NULL CHECK (content_type IN ('TREND', 'BUNDLE', 'SPOTLIGHT')),
  framing_type    TEXT NOT NULL,       -- 예: 'price_under_10k', 'ending_soon_bundle'
  title           TEXT NOT NULL,       -- 카드 헤드라인
  body            TEXT,                -- Gemini 소개문 (BUNDLE/SPOTLIGHT만, TREND는 NULL)
  event_ids       UUID[] NOT NULL,     -- 연결된 이벤트 ID 배열
  target_region   TEXT,               -- NULL이면 전국
  priority        INTEGER NOT NULL DEFAULT 0,  -- 높을수록 앞에 노출
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,        -- 보통 generated_at + 1일
  metadata        JSONB NOT NULL DEFAULT '{}'  -- 부가 데이터 (점수, 요일트리거 등)
);

-- 피드 조회용 인덱스 (만료 안 된 것 + 타입별)
CREATE INDEX IF NOT EXISTS idx_cp_expires_type
  ON content_pool (expires_at, content_type);

-- framing_type 기반 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_cp_framing
  ON content_pool (framing_type, generated_at DESC);

-- 지역 기반 필터 인덱스
CREATE INDEX IF NOT EXISTS idx_cp_region
  ON content_pool (target_region, expires_at);
