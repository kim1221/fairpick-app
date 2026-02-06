# 🎯 Gemini로 AI Enrichment 테스트하기

## ✅ 완료된 작업

1. ✅ 코드를 Gemini 2.0/1.5 Flash로 변경 완료
2. ✅ `@google/generative-ai` 패키지 설치됨
3. ✅ 소량 테스트 스크립트 생성 (3개만)

---

## 🔧 다음 단계: API 키 설정

### 1️⃣ `.env` 파일 열기

VS Code에서:
```
backend/.env 파일 열기
```

### 2️⃣ Gemini API 키 추가

**.env 파일 맨 아래에 추가**:

```bash
# Naver Search API (이미 추가했다면 스킵)
NAVER_CLIENT_ID=your_naver_client_id
NAVER_CLIENT_SECRET=your_naver_client_secret

# Google Gemini API ← 여기를 추가!
GEMINI_API_KEY=여기에_Gemini_키_입력
GEMINI_MODEL=gemini-1.5-flash
```

### 3️⃣ Gemini API 키 발급 방법

1. [Google AI Studio](https://aistudio.google.com/apikey) 접속
2. "Create API Key" 클릭
3. API 키 복사
4. `.env` 파일의 `GEMINI_API_KEY=` 뒤에 붙여넣기

**중요**: 
- ✅ `=` 양쪽에 공백 없이
- ✅ 따옴표 없이
- ✅ 한 줄로

---

## 🧪 테스트 실행

### **소량 테스트 (3개 이벤트)**

```bash
cd backend
./test-ai-enrichment-3.sh
```

**또는 직접**:

```bash
npm run backfill:ai-enrich -- --limit=3
```

### **예상 결과**:

```
[AI] Gemini initialized (model: gemini-1.5-flash)
[Enrich] Processing (1/3): 스노우 잠실 롯데월드몰 팝업
[NaverAPI] Searching event info...
[AI] Extracting info for: 스노우 잠실 롯데월드몰 팝업
[AI] Extraction success: { hasOpeningHours: true, hasPrice: true, tagCount: 4 }
[Enrich] ✅ Updated 5 fields

...

✅ Success: 3
```

---

## 📊 결과 확인

### **SQL로 확인**:

```bash
psql -d fairpick -c "
SELECT title, derived_tags, opening_hours, price_min, price_max
FROM canonical_events
WHERE derived_tags IS NOT NULL
  AND jsonb_array_length(derived_tags) > 0
ORDER BY updated_at DESC
LIMIT 3;
"
```

### **Admin UI로 확인**:

```
http://localhost:5173
→ 이벤트 관리
→ 최근 업데이트된 이벤트 확인
```

---

## 🎯 테스트 체크리스트

**다음을 확인하세요**:

- [ ] `derived_tags`가 적절한가? (예: ["데이트", "힙한", "사진맛집"])
- [ ] `opening_hours`가 정확한가? (예: {"weekday": "10:00-20:00"})
- [ ] `price_min/max`가 맞는가?
- [ ] `reservation_required` 감지가 정확한가?

**만족스럽다면**:
```bash
# 10개로 늘려서 테스트
npm run backfill:ai-enrich -- --limit=10

# 전체 실행 (주의: 시간 오래 걸림)
npm run backfill:ai-enrich
```

**불만족스럽다면**:
- `src/lib/aiExtractor.ts`의 프롬프트 수정
- 또는 모델 변경: `GEMINI_MODEL=gemini-2.0-flash-exp` (실험 버전)

---

## 💰 비용 (Gemini 1.5 Flash)

- **무료 티어**: 하루 1,500개 이벤트 무료!
- **3개 테스트**: $0 (무료)
- **전체 실행**: $0 (무료 한도 내)

---

## 🐛 트러블슈팅

### "GEMINI_API_KEY not set" 에러

**.env 파일 확인**:
```bash
cat backend/.env | grep GEMINI
```

출력이 없거나 빈 값이면:
```bash
GEMINI_API_KEY=실제_키_입력
GEMINI_MODEL=gemini-1.5-flash
```

### "No JSON found in response" 경고

**프롬프트가 너무 복잡할 수 있음**. 
→ `src/lib/aiExtractor.ts` 에서 프롬프트 단순화

### Rate limit 에러

**무료 티어 소진** (하루 1,500개).
→ 내일 다시 시도하거나 유료 전환

---

## ✨ 준비 완료!

1. `.env`에 `GEMINI_API_KEY` 추가
2. `./test-ai-enrichment-3.sh` 실행
3. 결과 확인
4. 만족하면 더 많은 이벤트로 확장

**시작하세요!** 🚀


