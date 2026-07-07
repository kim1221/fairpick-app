-- 카드 노출 로그 — 최근 보여준 카드를 잠시 제외해 "매일 새로운 문화 발견"을 보장
-- (공급 로직 v2: 신선도+다양성 재설계. 기록은 fire-and-forget, 조회는 방어적)
CREATE TABLE IF NOT EXISTS user_card_impressions (
  user_id       UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id      TEXT    NOT NULL,
  last_shown_on DATE    NOT NULL,
  shown_count   INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, event_id)
);

-- 유저별 최근 노출 조회용 (last_shown_on >= today - N)
CREATE INDEX IF NOT EXISTS idx_uci_user_lastshown
  ON user_card_impressions (user_id, last_shown_on DESC);

-- RLS is enabled with no public policies; backend access uses service_role.
ALTER TABLE user_card_impressions ENABLE ROW LEVEL SECURITY;
