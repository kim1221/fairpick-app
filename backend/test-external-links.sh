#!/bin/bash

echo "========================================="
echo "🔗 예매/티켓/예약 링크 추출 테스트"
echo "========================================="
echo ""

# 1. 환경 변수 확인
echo "1️⃣  API 키 확인..."
if [ -z "$NAVER_CLIENT_ID" ] || [ -z "$GEMINI_API_KEY" ]; then
  echo "   ⚠️  환경 변수를 로드합니다..."
  source .env 2>/dev/null || true
fi

if [ -n "$NAVER_CLIENT_ID" ]; then
  echo "   ✅ 네이버 API 키 설정됨"
else
  echo "   ❌ 네이버 API 키 없음"
fi

if [ -n "$GEMINI_API_KEY" ]; then
  echo "   ✅ Gemini API 키 설정됨"
else
  echo "   ❌ Gemini API 키 없음"
fi

echo ""
echo "2️⃣  테스트 데이터 초기화..."
psql -d fairpick -c "
  UPDATE canonical_events 
  SET external_links = NULL, 
      derived_tags = NULL, 
      opening_hours = NULL,
      price_min = NULL,
      price_max = NULL
  WHERE 
    title LIKE '%VIP매직쇼%'
    OR title LIKE '%스노우%롯데월드몰%'
    OR title LIKE '%전시%'
    OR title LIKE '%콘서트%'
    OR title LIKE '%축제%';
" 2>&1 | grep -E "UPDATE|ERROR" || echo "   ✅ 초기화 완료"

echo ""
echo "3️⃣  테스트 실행..."
echo "   예상 시간: 약 30초"
echo ""

ts-node -r dotenv/config test-external-links.ts

echo ""
echo "✅ 테스트 완료!"
