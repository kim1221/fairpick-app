-- Phase 1: AI 제안 시스템 및 데이터 출처 추적
-- 목적: AI가 자동으로 채우지 않고, 제안만 하고 관리자가 선택할 수 있도록

-- 1. AI 제안 데이터 저장 (관리자가 승인 전)
ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS ai_suggestions JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN canonical_events.ai_suggestions IS 'AI가 제안한 필드 값 (관리자 승인 전, 신뢰도 점수 포함)';

-- 2. 필드별 데이터 출처 추적 (승인 후)
ALTER TABLE canonical_events
ADD COLUMN IF NOT EXISTS field_sources JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN canonical_events.field_sources IS '각 필드의 데이터 출처 (PUBLIC_API, NAVER_API, AI, MANUAL, CALCULATED)';

-- 인덱스 생성 (JSONB 검색 최적화)
CREATE INDEX IF NOT EXISTS idx_canonical_events_ai_suggestions_gin ON canonical_events USING GIN (ai_suggestions);
CREATE INDEX IF NOT EXISTS idx_canonical_events_field_sources_gin ON canonical_events USING GIN (field_sources);

-- 예시 데이터 구조 (참고용 주석)
/*
ai_suggestions 예시:
{
  "cast": {
    "value": ["김호영", "이재환", "신재범"],
    "confidence": 95,
    "source": "PUBLIC_API",
    "source_detail": "KOPIS prfcast field",
    "extracted_at": "2026-01-31T10:30:00Z"
  },
  "duration_minutes": {
    "value": 35,
    "confidence": 60,
    "source": "AI",
    "source_detail": "Gemini extraction from overview",
    "warning": "공연 시간이 너무 짧습니다 (35분). 확인이 필요합니다.",
    "extracted_at": "2026-01-31T10:30:00Z"
  },
  "overview": {
    "value": "브로드웨이의 감동이 살아있는...",
    "confidence": 70,
    "source": "AI",
    "source_detail": "Gemini generated from Naver search results",
    "extracted_at": "2026-01-31T10:30:00Z"
  }
}

field_sources 예시 (관리자가 승인한 후):
{
  "cast": {
    "source": "PUBLIC_API",
    "source_detail": "KOPIS prfcast",
    "confidence": 95,
    "applied_at": "2026-01-31T10:35:00Z",
    "applied_by": "admin"
  },
  "overview": {
    "source": "MANUAL",
    "source_detail": "Admin edited AI suggestion",
    "confidence": 100,
    "applied_at": "2026-01-31T10:36:00Z",
    "applied_by": "admin",
    "original_suggestion": "AI"
  }
}
*/

