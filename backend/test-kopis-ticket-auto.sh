#!/bin/bash

echo "========================================="
echo "🎫 KOPIS 티켓 링크 자동 생성 테스트"
echo "========================================="
echo ""

echo "1️⃣  테스트 이벤트 초기화..."
psql -d fairpick -c "
  DELETE FROM canonical_events WHERE title LIKE '%테스트용공연%';
  DELETE FROM raw_kopis_events WHERE title LIKE '%테스트용공연%';
" > /dev/null 2>&1

echo "   ✅ 초기화 완료"
echo ""

echo "2️⃣  가짜 KOPIS 이벤트 삽입..."
psql -d fairpick << 'EOF'
INSERT INTO raw_kopis_events (
  id, source, source_event_id, source_url, payload,
  title, start_at, end_at, venue, region, main_category, sub_category, image_url
) VALUES (
  uuid_generate_v4(),
  'kopis',
  'PF999999',
  'https://www.kopis.or.kr/por/db/pblprfr/pblprfrView.do?menuId=MNU_00028&mt20Id=PF999999',
  '{"mt20id": "PF999999", "prfnm": "테스트용공연", "genrenm": "뮤지컬"}'::jsonb,
  '테스트용공연',
  '2026-03-01',
  '2026-03-31',
  '테스트극장',
  '서울',
  '공연',
  '뮤지컬',
  'https://via.placeholder.com/400x600'
);
EOF

echo "   ✅ 가짜 이벤트 삽입 완료"
echo ""

echo "3️⃣  Deduplication 실행..."
npm run dedupe:canonical > /tmp/dedupe_output.log 2>&1
if [ $? -eq 0 ]; then
  echo "   ✅ Deduplication 완료"
else
  echo "   ❌ Deduplication 실패"
  cat /tmp/dedupe_output.log | tail -50
  exit 1
fi

echo ""
echo "4️⃣  티켓 링크 확인..."
RESULT=$(psql -d fairpick -t -c "
  SELECT 
    title, 
    external_links->>'ticket' as ticket_link,
    external_links->>'official' as official_link
  FROM canonical_events 
  WHERE title LIKE '%테스트용공연%'
  LIMIT 1;
")

if [ -z "$RESULT" ]; then
  echo "   ❌ canonical_events에 이벤트가 생성되지 않았습니다."
  exit 1
fi

echo "$RESULT"
echo ""

# 티켓 링크가 있는지 확인 (상세 페이지 URL)
if echo "$RESULT" | grep -q "https://www.kopis.or.kr/por/db/pblprfr/pblprfrView.do?menuId=MNU_00028&mt20Id=PF999999"; then
  echo "   ✅ 티켓 링크 자동 생성 성공!"
else
  echo "   ❌ 티켓 링크가 생성되지 않았습니다."
  exit 1
fi

echo ""
echo "5️⃣  정리..."
psql -d fairpick -c "
  DELETE FROM canonical_events WHERE title LIKE '%테스트용공연%';
  DELETE FROM raw_kopis_events WHERE title LIKE '%테스트용공연%';
" > /dev/null 2>&1

echo "   ✅ 테스트 데이터 삭제 완료"
echo ""
echo "========================================="
echo "✅ 모든 테스트 통과!"
echo "========================================="

