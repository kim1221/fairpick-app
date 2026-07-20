-- 지역 신선 풀 기반 동적 오픈 캡(스펙 2026-07-19 §2.2, S2).
-- 그날 첫 /v2/today 계산 시 캡을 확정 저장하고, 같은 날에는 상향만 허용한다
-- (뽑는 중 캡 하락 방지 + 이동 시 자연 상승).
ALTER TABLE user_tickets
  ADD COLUMN IF NOT EXISTS daily_open_cap INTEGER,
  ADD COLUMN IF NOT EXISTS daily_open_cap_date DATE;
