#!/bin/bash

echo "========================================="
echo "🧪 AI Enrichment 테스트"
echo "========================================="
echo ""

# API 키 확인
echo "1️⃣ API 키 확인..."
if grep -q "NAVER_CLIENT_ID=" .env && [ "$(grep NAVER_CLIENT_ID= .env | cut -d'=' -f2)" != "" ]; then
    echo "   ✅ 네이버 API 키 설정됨"
else
    echo "   ⚠️  네이버 API 키 없음 (Tags만 추출 가능)"
fi

if grep -q "OPENAI_API_KEY=" .env && [ "$(grep OPENAI_API_KEY= .env | cut -d'=' -f2)" != "" ]; then
    echo "   ✅ OpenAI API 키 설정됨"
else
    echo "   ❌ OpenAI API 키 필요!"
    exit 1
fi

echo ""
echo "2️⃣ 테스트 실행 중 (10개 이벤트)..."
echo "   예상 시간: 약 30초"
echo "   예상 비용: 약 $0.01 (약 13원)"
echo ""

npm run backfill:ai-enrich:test

echo ""
echo "========================================="
echo "✅ 테스트 완료!"
echo "========================================="
echo ""
echo "📊 결과 확인:"
echo "   1. Admin UI: http://localhost:5173"
echo "   2. SQL:"
echo ""
echo "      SELECT title, derived_tags, opening_hours, price_min, price_max"
echo "      FROM canonical_events"
echo "      WHERE derived_tags IS NOT NULL"
echo "      LIMIT 5;"
echo ""
