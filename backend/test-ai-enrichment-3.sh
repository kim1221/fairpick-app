#!/bin/bash

echo "========================================="
echo "🧪 AI Enrichment 소량 테스트 (3개)"
echo "========================================="
echo ""

# .env 파일 확인
echo "1️⃣  API 키 확인..."

if ! grep -q "NAVER_CLIENT_ID=" .env || [ "$(grep NAVER_CLIENT_ID= .env | cut -d'=' -f2)" == "" ]; then
    echo "   ⚠️  네이버 API 키 없음"
    echo "   → Tags만 추출됩니다 (네이버 검색 스킵)"
else
    echo "   ✅ 네이버 API 키 설정됨"
fi

if ! grep -q "GEMINI_API_KEY=" .env || [ "$(grep GEMINI_API_KEY= .env | cut -d'=' -f2)" == "" ]; then
    echo "   ❌ GEMINI_API_KEY 필요!"
    echo ""
    echo "   .env 파일에 다음을 추가하세요:"
    echo "   GEMINI_API_KEY=your_gemini_api_key"
    echo "   GEMINI_MODEL=gemini-1.5-flash"
    echo ""
    exit 1
else
    echo "   ✅ Gemini API 키 설정됨"
fi

echo ""
echo "2️⃣  테스트 실행 중..."
echo "   - 이벤트 개수: 3개"
echo "   - 예상 시간: 약 10초"
echo "   - 예상 비용: 무료 (Gemini 무료 티어)"
echo ""

# 3개만 테스트
npm run backfill:ai-enrich -- --limit=3

echo ""
echo "========================================="
echo "✅ 테스트 완료!"
echo "========================================="
echo ""
echo "📊 결과 확인 (SQL):"
echo ""
echo "psql -d fairpick -c \""
echo "SELECT title, derived_tags, opening_hours, price_min, price_max"
echo "FROM canonical_events"
echo "WHERE derived_tags IS NOT NULL"
echo "  AND jsonb_array_length(derived_tags) > 0"
echo "ORDER BY updated_at DESC"
echo "LIMIT 5;"
echo "\""
echo ""
echo "또는 Admin UI: http://localhost:5173"
echo ""


