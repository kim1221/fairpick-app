#!/bin/bash

# Phase 2 테스트 스크립트

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║         Phase 2: Testing Recommendations API             ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

BASE_URL="http://localhost:4000"

# 색상 코드
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Test 1: Health Check${NC}"
curl -s "$BASE_URL/health" | jq .
echo ""

echo -e "${YELLOW}Test 2: Filters API${NC}"
curl -s "$BASE_URL/recommendations/filters" | jq '.filters | keys'
echo ""

echo -e "${YELLOW}Test 3: 커플 데이트 추천 (저녁)${NC}"
curl -s "$BASE_URL/recommendations?companions=커플&time=evening&limit=5" | \
  jq '.items[] | {title: .title, mainCategory, venue, companions: .matching.companions}'
echo ""

echo -e "${YELLOW}Test 4: 가족 나들이 추천${NC}"
curl -s "$BASE_URL/recommendations?companions=가족&region=서울&limit=5" | \
  jq '.items[] | {title: .title, region, companions: .matching.companions}'
echo ""

echo -e "${YELLOW}Test 5: 실내 활동 (비 오는 날)${NC}"
curl -s "$BASE_URL/recommendations?indoor=true&limit=5" | \
  jq '.items[] | {title: .title, indoor: .matching.indoor}'
echo ""

echo -e "${YELLOW}Test 6: 예산 제한 (20,000원 이하)${NC}"
curl -s "$BASE_URL/recommendations?budget=20000&limit=5" | \
  jq '.items[] | {title: .title, priceMax}'
echo ""

echo -e "${YELLOW}Test 7: Preset - 저녁 데이트 코스${NC}"
curl -s "$BASE_URL/recommendations/presets/date-evening?limit=3" | \
  jq '{preset: .preset.description, count: .count, items: .items[].title}'
echo ""

echo -e "${YELLOW}Test 8: Preset - 비 오는 날${NC}"
curl -s "$BASE_URL/recommendations/presets/rainy-day?limit=3" | \
  jq '{preset: .preset.description, count: .count, items: .items[].title}'
echo ""

echo -e "${GREEN}✅ All tests completed!${NC}"

