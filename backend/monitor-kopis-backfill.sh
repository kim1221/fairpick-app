#!/bin/bash

LOG_FILE="/tmp/kopis-relates-full.log"

echo "🔍 KOPIS 예매처 링크 Backfill 모니터링"
echo "========================================"
echo ""

# 프로세스 확인
if ps -p 42657 > /dev/null 2>&1; then
    echo "✅ 작업 진행 중 (PID: 42657)"
else
    echo "⚠️  작업 완료 또는 종료됨"
fi

echo ""

# 진행 상황 확인
if [ -f "$LOG_FILE" ]; then
    # 현재 진행 중인 이벤트 번호 추출
    CURRENT=$(grep -oP '\[\d+/4122\]' "$LOG_FILE" | tail -1 | grep -oP '\d+')
    
    if [ -n "$CURRENT" ]; then
        PERCENT=$(echo "scale=1; $CURRENT * 100 / 4122" | bc)
        echo "📊 진행 상황: $CURRENT / 4,122 ($PERCENT%)"
    fi
    
    # 성공/실패 통계
    echo ""
    echo "📈 통계:"
    echo "   성공: $(grep -c "💾 업데이트 완료" "$LOG_FILE")개"
    echo "   예매처 없음: $(grep -c "예매처 없음" "$LOG_FILE")개"
    echo "   실패: $(grep -c "❌ 에러:" "$LOG_FILE")개"
    
    # 최근 10개 이벤트
    echo ""
    echo "📝 최근 처리된 이벤트 (최근 5개):"
    grep -oP '\[\d+/4122\] .+?\.\.\.' "$LOG_FILE" | tail -5
    
    echo ""
    echo "💡 전체 로그: tail -f $LOG_FILE"
else
    echo "⚠️  로그 파일이 없습니다: $LOG_FILE"
fi


