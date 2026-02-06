#!/bin/bash
# API 계측 검증 스크립트

BASE_URL="${BASE_URL:-http://localhost:4000}"
LOG_FILE="/tmp/fairpick_api_test_$(date +%Y%m%d_%H%M%S).log"

echo "========================================" | tee -a "$LOG_FILE"
echo "API 계측 검증 테스트" | tee -a "$LOG_FILE"
echo "시작 시각: $(date)" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# 1. GET /events (일반 목록)
echo "=== [1/7] GET /events (page=1, size=20) ===" | tee -a "$LOG_FILE"
curl -s "${BASE_URL}/events?page=1&size=20" | jq '.pageInfo' | tee -a "$LOG_FILE"
sleep 1

# 2. GET /events (검색: 택시)
echo "" | tee -a "$LOG_FILE"
echo "=== [2/7] GET /events (q=택시) ===" | tee -a "$LOG_FILE"
curl -s "${BASE_URL}/events?q=%ED%83%9D%EC%8B%9C&page=1&size=20" | jq '.pageInfo' | tee -a "$LOG_FILE"
sleep 1

# 3. GET /events (필터: 부산+공연)
echo "" | tee -a "$LOG_FILE"
echo "=== [3/7] GET /events (region=부산, category=공연) ===" | tee -a "$LOG_FILE"
curl -s "${BASE_URL}/events?region=%EB%B6%80%EC%82%B0&category=%EA%B3%B5%EC%97%B0&page=1&size=20" | jq '.pageInfo' | tee -a "$LOG_FILE"
sleep 1

# 4. GET /events/hot
echo "" | tee -a "$LOG_FILE"
echo "=== [4/7] GET /events/hot ===" | tee -a "$LOG_FILE"
curl -s "${BASE_URL}/events/hot?page=1&size=10" | jq '.pageInfo' | tee -a "$LOG_FILE"
sleep 1

# 5. GET /events/free
echo "" | tee -a "$LOG_FILE"
echo "=== [5/7] GET /events/free ===" | tee -a "$LOG_FILE"
curl -s "${BASE_URL}/events/free?page=1&size=10" | jq '.pageInfo' | tee -a "$LOG_FILE"
sleep 1

# 6. GET /events/ending
echo "" | tee -a "$LOG_FILE"
echo "=== [6/7] GET /events/ending ===" | tee -a "$LOG_FILE"
curl -s "${BASE_URL}/events/ending?page=1&size=10" | jq '.pageInfo' | tee -a "$LOG_FILE"
sleep 1

# 7. GET /events/:id (실제 존재하는 ID로 테스트해야 함)
echo "" | tee -a "$LOG_FILE"
echo "=== [7/7] GET /events/:id (첫 번째 이벤트 ID 사용) ===" | tee -a "$LOG_FILE"
FIRST_ID=$(curl -s "${BASE_URL}/events?page=1&size=1" | jq -r '.items[0].id')
if [ -n "$FIRST_ID" ] && [ "$FIRST_ID" != "null" ]; then
  echo "조회할 이벤트 ID: $FIRST_ID" | tee -a "$LOG_FILE"
  curl -s "${BASE_URL}/events/${FIRST_ID}" | jq '{id, title: .displayTitle, category: .mainCategory}' | tee -a "$LOG_FILE"
else
  echo "이벤트 ID를 가져올 수 없음 (DB가 비어있을 수 있음)" | tee -a "$LOG_FILE"
fi

echo "" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "테스트 완료 시각: $(date)" | tee -a "$LOG_FILE"
echo "로그 파일: $LOG_FILE" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "서버 로그에서 계측 데이터를 확인하세요:" | tee -a "$LOG_FILE"
echo "  grep \"\\[INSTRUMENT\\]\\[API\\]\" <서버 로그 파일>" | tee -a "$LOG_FILE"


