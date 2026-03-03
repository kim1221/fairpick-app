-- ============================================================
-- curation_themes: Rule-based 큐레이션 테마 시스템
-- ============================================================
--
-- 목적:
--   홈 화면의 큐레이션 섹션을 DB에서 동적으로 관리.
--   각 테마는 필터 조건(JSON)으로 이벤트를 조회하고,
--   추후 pgvector 리랭킹 활성화 시 use_vector_rerank 플래그로
--   코사인 유사도 기반 재정렬을 on/off 할 수 있음.
--
-- 연계:
--   - canonical_events.embedding (20260226_add_vector_search)
--   - user_events (20260226_add_users)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. curation_themes 테이블
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS curation_themes (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,

  -- 식별자 & 표시 정보
  slug              TEXT NOT NULL UNIQUE,           -- 코드용 고유 키 (예: "ending_soon", "popup_hot")
  title             TEXT NOT NULL,                  -- 앱 표시용 제목 (예: "마감임박")
  subtitle          TEXT,                           -- 부제목 (예: "오늘 안에 가야 할 곳")
  icon_name         TEXT,                           -- TDS icon 이름 (예: "icon-fire-mono")

  -- 정렬 & 활성화
  display_order     INTEGER NOT NULL DEFAULT 0,     -- 홈 섹션 순서 (낮을수록 위)
  is_active         BOOLEAN NOT NULL DEFAULT true,  -- 비활성화 시 홈에서 숨김

  -- 필터 조건 (SQL WHERE 절 대신 JSON으로 표현)
  filter_config     JSONB NOT NULL DEFAULT '{}',
  -- 예시:
  -- {"type":"ending_soon","days":7}
  -- {"type":"category","categories":["팝업"],"sort":"buzz_score"}
  -- {"type":"free","sort":"view_count"}
  -- {"type":"region","region":"서울","sort":"buzz_score"}

  -- 노출 제어
  max_items         INTEGER NOT NULL DEFAULT 10,    -- 섹션 최대 노출 개수

  -- pgvector 리랭킹 옵션
  use_vector_rerank BOOLEAN NOT NULL DEFAULT false, -- true면 유저 임베딩 기반 코사인 재정렬
  rerank_weight     FLOAT NOT NULL DEFAULT 0.3,     -- 리랭킹 점수 반영 가중치 (0.0~1.0)

  -- 메타
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_curation_themes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_curation_themes_updated_at
  BEFORE UPDATE ON curation_themes
  FOR EACH ROW EXECUTE FUNCTION update_curation_themes_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 2. user_curation_feedback: 테마별 유저 피드백 (좋아요/숨기기)
--    추후 리랭킹 학습 신호로 활용
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_curation_feedback (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id      TEXT NOT NULL,
  theme_slug   TEXT NOT NULL REFERENCES curation_themes(slug) ON DELETE CASCADE,
  event_id     TEXT NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('like', 'hide', 'click')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_curation_feedback_user
  ON user_curation_feedback(user_id, theme_slug);

-- ─────────────────────────────────────────────────────────────
-- 3. 기본 데이터: 현재 홈 화면 8개 섹션 마이그레이션
--    기존 recommender.ts의 하드코딩 섹션을 DB로 옮김
-- ─────────────────────────────────────────────────────────────
INSERT INTO curation_themes
  (slug, title, subtitle, icon_name, display_order, is_active, filter_config, max_items)
VALUES
  -- 1. 투데이픽 (에디터가 직접 고른 오늘의 이벤트)
  (
    'today_pick',
    '오늘의 픽',
    '에디터가 엄선한 이벤트',
    'icon-star-mono',
    1,
    true,
    '{"type":"featured","sort":"featured_order"}',
    10
  ),
  -- 2. 마감임박
  (
    'ending_soon',
    '마감임박',
    '오늘 안에 가야 할 곳',
    'icon-fire-mono',
    2,
    true,
    '{"type":"ending_soon","days":7,"sort":"end_at_asc"}',
    10
  ),
  -- 3. 지금 뜨는 (buzz_score 기반)
  (
    'trending',
    '지금 뜨는',
    '지금 가장 핫한 이벤트',
    'icon-chart-bar-mono',
    3,
    true,
    '{"type":"trending","sort":"buzz_score"}',
    10
  ),
  -- 4. 전시 큐레이션
  (
    'exhibition',
    '전시 큐레이션',
    '감각적인 전시 모음',
    'icon-photo-mono',
    4,
    true,
    '{"type":"category","categories":["전시"],"sort":"buzz_score"}',
    10
  ),
  -- 5. 이번 주말 뭐하지
  (
    'this_weekend',
    '이번 주말 뭐하지',
    '주말을 위한 추천',
    'icon-calendar-mono',
    5,
    true,
    '{"type":"weekend","sort":"buzz_score"}',
    10
  ),
  -- 6. 무료 이벤트
  (
    'free_events',
    '무료로 즐겨요',
    '돈 안 드는 특별한 경험',
    'icon-gift-mono',
    6,
    true,
    '{"type":"free","sort":"view_count"}',
    10
  ),
  -- 7. 팝업스토어
  (
    'popup_hot',
    '팝업스토어',
    '지금 주목할 팝업',
    'icon-store-mono',
    7,
    true,
    '{"type":"category","categories":["팝업"],"sort":"buzz_score"}',
    10
  ),
  -- 8. 새로 올라왔어요 (최신순)
  (
    'new_arrival',
    '새로 올라왔어요',
    '방금 등록된 이벤트',
    'icon-sparkle-mono',
    8,
    true,
    '{"type":"latest","sort":"created_at_desc"}',
    10
  )
ON CONFLICT (slug) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 4. 인덱스
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_curation_themes_active_order
  ON curation_themes(display_order)
  WHERE is_active = true;
