#!/bin/bash
# 이미지 업로드 API 테스트 스크립트

ADMIN_KEY="fairpick-admin-2024"
API_URL="http://localhost:5001/admin/uploads/image"

# 테스트 이미지 다운로드 (샘플)
if [ ! -f "test-image.jpg" ]; then
  echo "📥 테스트 이미지 다운로드 중..."
  curl -o test-image.jpg https://via.placeholder.com/800x600.jpg
fi

echo ""
echo "🚀 이미지 업로드 테스트 시작..."
echo ""

curl -X POST "$API_URL" \
  -H "x-admin-key: $ADMIN_KEY" \
  -F "image=@test-image.jpg" \
  -v

echo ""
echo ""
echo "✅ 테스트 완료!"


