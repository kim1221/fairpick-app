# 🚀 AI Discovery 사용 가이드

## ✅ 구현 완료 항목

### 1️⃣ **AI 팝업 발굴** (`ai-popup-discovery.ts`)
- Gemini AI가 Google Search로 서울 팝업 전체 수집
- DB 중복 체크 (canonical_events, admin_hot_suggestions)
- 새로운 팝업만 admin_hot_suggestions에 자동 추가

### 2️⃣ **AI 핫 이벤트 평가** (`ai-hot-rating.ts`)
- 공공 API로 수집된 전시/공연/축제 중 핫한 것 선별
- buzz_components.ai_hotness에 점수 + 이유 저장
- 70점 이상만 featured로 노출

### 3️⃣ **Featured API** (`/api/recommendations/featured`)
- AI가 선별한 핫한 이벤트 반환
- 팝업/전시/공연/축제 카테고리별로 제공

---

## 🔧 수동 실행 방법

### 1. 팝업 발굴 (15개 질문 → ~5분 소요)
```bash
cd /Users/kimsungtae/toss/fairpick-app/backend
npx ts-node --transpile-only src/scripts/ai-popup-discovery.ts
```

**출력 예시:**
```
[PopupDiscovery] 🚀 Starting AI popup discovery...
[PopupDiscovery] Querying: 서울 성수동에서 지금 진행 중이거나 곧 오픈하는 모든 팝업스토어 리스트
[PopupDiscovery] Found 32 popups
[PopupDiscovery] ✅ Saved: 무신사 테라스 팝업 (score: 85)
[PopupDiscovery] ⏭️  Skipped (already in DB): 더현대 서울 MAC 팝업
...
[PopupDiscovery] 📊 Summary:
  Total collected: 124
  ✅ Saved (new): 38
  ⏭️  Skipped (already in DB): 12
  ⏭️  Skipped (already suggested): 74
```

---

### 2. 핫 이벤트 평가 (~30초 소요)
```bash
cd /Users/kimsungtae/toss/fairpick-app/backend
npx ts-node --transpile-only src/scripts/ai-hot-rating.ts
```

**출력 예시:**
```
[HotRating] 🚀 Starting AI hot event rating...
[HotRating] Found 100 events to rate
[HotRating] AI rated 15 events as hot (70+ score)
[HotRating] ✅ 알폰스 무하 전시 → 95 (SNS 화제, 인생샷 명소)
[HotRating] ✅ 위켄드 콘서트 → 88 (유명 아티스트, 티켓 매진 임박)
...
[HotRating] 📊 Summary:
  Total evaluated: 100
  ✅ Hot events (70+): 15
```

---

### 3. Admin 승인 확인
```bash
# 새로 추천된 팝업 확인
node -e "
const { pool } = require('./dist/db');
(async () => {
  const result = await pool.query(\`
    SELECT title, candidate_score, status, created_at
    FROM admin_hot_suggestions
    WHERE source = 'ai_popup'
    ORDER BY created_at DESC
    LIMIT 10
  \`);
  console.log('\n🔥 AI가 발굴한 최신 팝업:\n');
  result.rows.forEach((r, i) => {
    console.log(\`\${i+1}. [\${r.candidate_score}점] \${r.title} (\${r.status})\`);
  });
  process.exit(0);
})();
"
```

---

### 4. Featured API 테스트
```bash
# 로컬에서 테스트
curl http://localhost:3001/api/recommendations/featured | jq '.featured | to_entries[] | {category: .key, count: (.value | length)}'
```

**응답 예시:**
```json
{
  "category": "popups",
  "count": 8
}
{
  "category": "exhibitions",
  "count": 5
}
{
  "category": "performances",
  "count": 3
}
{
  "category": "festivals",
  "count": 2
}
```

---

## ⏰ 자동 실행 스케줄

| 작업 | 실행 시간 | 빈도 | 비용/월 |
|------|-----------|------|---------|
| AI 팝업 발굴 | 08:00 KST | 매일 | $0.459 (₩650) |
| AI 핫 평가 | 09:00 KST | 매주 월요일 | $0.0024 (₩3) |
| **총합** | - | - | **$0.46 (₩650)** |

---

## 🛠️ 문제 해결

### 1. Rate Limit 에러
```
Error: 429 Too Many Requests
```
**해결:** Gemini API는 1,500 RPM 한도. 현재 설정(15회/일)은 안전함.

---

### 2. 중복 팝업 계속 추천됨
```
[PopupDiscovery] ⏭️  Skipped (already in DB): 무신사 팝업
```
**정상 동작:** DB 중복 체크가 작동 중. 새로운 팝업만 저장됨.

---

### 3. AI 평가 결과가 너무 적음
```
[HotRating] ✅ Hot events (70+): 3
```
**정상 동작:** 70점 이상만 선별. 주간 10-15개 정도가 적정.

---

## 📊 Admin 워크플로우

1. **08:00 KST**: AI가 자동으로 팝업 발굴
2. **Admin 로그인**: `http://localhost:5174/hot-suggestions` 접속
3. **승인/거부**: 
   - ✅ 승인: 이벤트 생성 폼으로 이동 (AI 보완 + 이미지 업로드)
   - ❌ 거부: Hot Suggestion 삭제
4. **Featured 노출**: buzz_components.ai_hotness >= 70인 이벤트 자동 노출

---

## 💡 팁

### 질문 추가 (더 많은 팝업 발굴)
`src/scripts/ai-popup-discovery.ts`의 `POPUP_QUERIES` 배열에 추가:

```typescript
const POPUP_QUERIES = [
  // 기존 질문들...
  "부산 해운대 모든 팝업",  // 지역 확장
  "제주도 팝업스토어 전체", // 제주 추가
  "현대카드 콜라보 팝업 모든 것", // 브랜드 추가
];
```

**비용 영향:** 질문 1개당 +$0.03/월 (₩42)

---

### 평가 빈도 늘리기
`src/scheduler.ts`에서 매주 → 매일로 변경:

```typescript
// 기존: 매주 월요일
cron.schedule('0 9 * * 1', async () => { ... });

// 변경: 매일
cron.schedule('0 9 * * *', async () => { ... });
```

**비용 영향:** $0.0024/월 → $0.072/월 (₩100)

---

## 🎯 기대 효과

- **월 30-50개** 신규 팝업 자동 발굴
- **월 10-15개** 핫 전시/공연/축제 선별
- **Admin 부담 70% 감소** (자동 중복 제거 + 검증)
- **사용자 만족도 ↑** (진짜 핫한 이벤트만 추천)

---

## 🔗 관련 파일

- `src/scripts/ai-popup-discovery.ts` - 팝업 발굴 스크립트
- `src/scripts/ai-hot-rating.ts` - 핫 이벤트 평가 스크립트
- `src/scheduler.ts` - 자동 실행 스케줄러
- `src/routes/recommendations.ts` - Featured API
- `AI_DISCOVERY_COST_ESTIMATE.md` - 비용 분석

