-- user_visit_log.user_id만 TEXT로 생성돼 있었다(user_ticket_earn_log·user_likes는 UUID).
-- 세 테이블을 같은 $1 파라미터로 UNION하는 taste 쿼리(cards /v2/today·/v2/open)에서
-- $1이 UUID로 추론된 뒤 user_visit_log 분기가 "operator does not exist: text = uuid"로 실패
-- → 홈 카드 로딩 전면 장애. 시블링 테이블과 타입을 맞춘다.
-- 적용 전 확인: 기존 데이터 전부 UUID 형식(비UUID 0행).
ALTER TABLE user_visit_log
  ALTER COLUMN user_id TYPE UUID USING user_id::uuid;
