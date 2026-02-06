# AI 제안 시스템 구현 가이드

## 📋 개요

AI가 자동으로 필드를 채우지 않고, **제안만** 하고 관리자가 선택적으로 적용할 수 있는 시스템

---

## 🎯 목표

1. ✅ **데이터 품질 보장**: AI가 잘못된 정보를 자동으로 채우지 않음
2. ✅ **효율성**: AI 제안으로 수동 입력 시간 단축 (50% 이상)
3. ✅ **투명성**: 각 필드의 데이터 출처와 신뢰도를 명확히 표시

---

## 📦 Phase 1: 기반 작업 (완료!)

### ✅ 1. Migration 파일
- `migrations/20260131_add_ai_suggestions.sql`
- `ai_suggestions` 컬럼: AI 제안 데이터 (승인 전)
- `field_sources` 컬럼: 필드별 데이터 출처 (승인 후)

### ✅ 2. 신뢰도 계산 유틸리티
- `src/lib/confidenceCalculator.ts`
- 출처별 기본 신뢰도: PUBLIC_API(95%), NAVER_API(80%), AI(65%), MANUAL(100%)
- 필드별 검증 규칙: 공연 시간, 가격, 배열 길이 등
- 자동 경고 생성: 비정상 값 감지

### ✅ 3. 데이터 구조

#### ai_suggestions (제안 상태):
```json
{
  "cast": {
    "value": ["김호영", "이재환"],
    "confidence": 95,
    "source": "PUBLIC_API",
    "source_detail": "KOPIS prfcast",
    "extracted_at": "2026-01-31T10:30:00Z"
  },
  "duration_minutes": {
    "value": 35,
    "confidence": 60,
    "source": "AI",
    "source_detail": "Gemini extraction",
    "warning": "공연 시간이 너무 짧습니다 (35분). 확인이 필요합니다.",
    "extracted_at": "2026-01-31T10:30:00Z"
  }
}
```

#### field_sources (적용 후):
```json
{
  "cast": {
    "source": "PUBLIC_API",
    "confidence": 95,
    "applied_at": "2026-01-31T10:35:00Z"
  },
  "overview": {
    "source": "MANUAL",
    "confidence": 100,
    "applied_at": "2026-01-31T10:36:00Z",
    "original_suggestion": "AI"
  }
}
```

---

## 🔄 Phase 2: Backend 로직 (다음 단계)

### 1. AI Enrichment 응답 수정
- `/admin/events/:id/enrich` endpoint
- 기존: `enriched` 객체로 바로 반환 → 적용
- 변경: `ai_suggestions` 객체로 반환 → 제안만

### 2. 제안 적용 Endpoint 추가
```typescript
POST /admin/events/:id/apply-suggestion
{
  "field": "cast",
  "action": "apply" | "edit" | "dismiss"
}
```

### 3. 출처 자동 기록
- PUBLIC_API (KOPIS, Culture): 수집 시 자동 기록
- AI: enrichment 실행 시 자동 기록
- MANUAL: 관리자 직접 수정 시 자동 기록

---

## 🎨 Phase 3: Admin UI (그 다음 단계)

### 1. AI 제안 UI 컴포넌트
```tsx
<AISuggestionBox
  field="cast"
  suggestion={aiSuggestions.cast}
  onApply={() => applySuggestion('cast')}
  onEdit={() => editSuggestion('cast')}
  onDismiss={() => dismissSuggestion('cast')}
/>
```

### 2. 신뢰도 배지
- 🟢 High (85-100%): 공공API, 거의 확실
- 🟡 Medium (70-84%): Naver API, 검토 권장
- 🟠 Low (40-69%): AI 추론, 검증 필수
- 🔴 Very Low (0-39%): 매우 불확실, 무시 권장

### 3. 출처 표시
- 필드 아래에 작은 배지로 표시
- 🟢 공공API / 🟡 AI / 🟣 수동입력

---

## 📊 신뢰도 레벨별 처리 방침

| 레벨 | 점수 | 색상 | 처리 방침 |
|------|------|------|----------|
| High | 85-100% | 🟢 녹색 | 그대로 적용 OK, 빠른 검토만 |
| Medium | 70-84% | 🟡 노랑 | 검토 권장, 한 번 확인 후 적용 |
| Low | 40-69% | 🟠 주황 | 검증 필수, 반드시 확인 |
| Very Low | 0-39% | 🔴 빨강 | 무시 권장, 수동 입력 |

---

## 🚀 다음 할 일

### Phase 2 시작:
1. Migration 실행
   ```bash
   cd backend
   npm run migrate
   ```

2. Backend 로직 수정
   - `src/index.ts` - `/admin/events/:id/enrich` 수정
   - 신뢰도 계산 로직 적용
   - `ai_suggestions` 응답 추가

3. 새 Endpoint 추가
   - `/admin/events/:id/apply-suggestion` 생성

### 테스트:
```bash
# 1. Migration 실행
psql $DATABASE_URL -f migrations/20260131_add_ai_suggestions.sql

# 2. Backend 재시작
npm run dev

# 3. AI enrichment 테스트
curl -X POST http://localhost:5001/admin/events/{id}/enrich \
  -H "x-admin-key: fairpick-admin-secret-2024" \
  -H "Content-Type: application/json"
```

---

## 📝 다음 문서

Phase 2 완료 후:
- `AI_SUGGESTIONS_API.md`: API 상세 문서
- `AI_SUGGESTIONS_UI.md`: Admin UI 구현 가이드

Phase 3 완료 후:
- `AI_SUGGESTIONS_GUIDE.md`: 사용자 가이드

