# Phase 3: AI 제안 시스템 - 구현 완료 ✅

## 📋 개요

AI가 추출한 정보를 **자동으로 적용하지 않고**, **제안(Suggestion)**으로 제시하여 관리자가 선택적으로 적용할 수 있는 시스템입니다.

---

## 🎯 핵심 기능

### 1. AI 제안 생성
- `/admin/events/:id/enrich` 엔드포인트 호출 시, AI 분석 결과를 `ai_suggestions` JSONB 필드에 저장
- 각 제안에는 다음 정보 포함:
  - `value`: 실제 제안 값
  - `confidence`: 신뢰도 점수 (0-100%)
  - `source`: 데이터 출처 (PUBLIC_API, NAVER_API, AI, MANUAL, CALCULATED)
  - `source_detail`: 출처 상세 설명
  - `warning`: 경고 메시지 (있는 경우)
  - `extracted_at`: 추출 시각

### 2. 제안 적용 (Apply)
- `/admin/events/:id/apply-suggestion` 엔드포인트
- 선택한 제안을 실제 필드에 적용
- `field_sources`에 출처 정보 저장
- `ai_suggestions`에서 해당 제안 제거
- `manually_edited_fields`에서 해당 필드 제거 (AI 제안 적용이므로)

### 3. 제안 무시 (Dismiss)
- `/admin/events/:id/dismiss-suggestion` 엔드포인트
- 선택한 제안을 `ai_suggestions`에서 제거
- 실제 필드에는 영향 없음

### 4. 신뢰도 시스템
- **출처별 기본 신뢰도**:
  - 🟢 공공API: 95%
  - 🔵 네이버API: 80%
  - 🟡 AI: 65%
  - 🟣 수동입력: 100%
  - ⚫ 계산됨: 90%

- **필드별 검증 및 조정**:
  - 공연 시간 30분 미만: -15% ~ -30%
  - 가격 50만원 초과: -20%
  - 빈 배열: -20%
  - 너무 짧은 텍스트: -20%

- **신뢰도 레벨**:
  - 🟢 High (85%+)
  - 🟡 Medium (70-84%)
  - 🟠 Low (40-69%)
  - 🔴 Very Low (<40%)

---

## 🛠️ 구현된 파일

### Backend

#### 1. Migration
- `backend/migrations/20260131_add_ai_suggestions.sql`
  - `ai_suggestions` JSONB 컬럼 추가
  - `field_sources` JSONB 컬럼 추가
  - GIN 인덱스 생성

#### 2. 신뢰도 계산
- `backend/src/lib/confidenceCalculator.ts`
  - 출처별 신뢰도 계산
  - 필드별 검증 및 조정
  - 경고 메시지 생성
  - `createSuggestion()` 헬퍼 함수

#### 3. 제안 생성
- `backend/src/lib/suggestionBuilder.ts`
  - AI 추출 결과를 제안 객체로 변환
  - Place, Naver API 결과도 제안으로 변환
  - `buildSuggestionsFromAI()`
  - `buildSuggestionsFromPlace()`
  - `buildSuggestionsFromExisting()`

#### 4. API 엔드포인트
- `backend/src/index.ts`
  - `POST /admin/events/:id/enrich` (수정)
    - 기존: `enriched` 객체 반환
    - 변경: `suggestions` 객체 반환, DB에 저장
  - `POST /admin/events/:id/apply-suggestion` (신규)
    - 제안을 실제 필드에 적용
    - `field_sources` 업데이트
  - `POST /admin/events/:id/dismiss-suggestion` (신규)
    - 제안 무시 (삭제)

### Frontend (Admin UI)

#### 1. 타입 정의
- `backend/admin-web/src/types/index.ts`
  - `DataSource` 타입
  - `FieldSuggestion` 인터페이스
  - `EventSuggestions` 인터페이스
  - `Event` 인터페이스에 `ai_suggestions`, `field_sources` 추가

#### 2. API 서비스
- `backend/admin-web/src/services/api.ts`
  - `enrichEvent()` 수정: `suggestions` 필드 추가
  - `applySuggestion()` 추가
  - `dismissSuggestion()` 추가

#### 3. UI 컴포넌트
- `backend/admin-web/src/pages/EventsPage.tsx`
  - `handleAIEnrich()` 수정: `suggestions` 처리
  - `handleApplySuggestion()` 추가
  - `handleDismissSuggestion()` 추가
  - **AI 제안 섹션 추가**:
    - 제안 목록 표시
    - 신뢰도 배지 (🟢🟡🟠🔴)
    - 출처 배지 (공공API, 네이버API, AI)
    - 값 미리보기
    - 경고 메시지 표시
    - "✅ 적용" / "❌ 무시" 버튼

---

## 📊 테스트 결과

### Backend 테스트
```bash
npm run test:phase2
```

**결과**:
- ✅ 13개 AI 제안 생성
- ✅ DB에 저장 확인
- ✅ 신뢰도 통계:
  - 평균 신뢰도: 67.5%
  - 🟢 High: 0개
  - 🟡 Medium: 10개
  - 🟠 Low: 4개
  - 🔴 Very Low: 0개

### Admin UI 테스트
1. 이벤트 상세 페이지 열기
2. "🤖 빈 필드만 AI 보완" 버튼 클릭
3. AI 제안 섹션 표시 확인
4. 제안 적용/무시 기능 동작 확인

---

## 🎨 UI 스크린샷 (예상)

### AI 제안 섹션
```
┌─────────────────────────────────────────────────────────────┐
│ 🤖 AI 제안 (13개)                                              │
├─────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────────┐   │
│ │ 개요                🟡 70%  🟡 AI                       │   │
│ │ Gemini extraction from 57 search results             │   │
│ │ ┌─────────────────────────────────────────────────┐  │   │
│ │ │ 와이제이 클래식이 선사하는 2026년 정기연주회...     │   │
│ │ └─────────────────────────────────────────────────┘  │   │
│ │ [✅ 적용]  [❌ 무시]                                   │   │
│ └───────────────────────────────────────────────────────┘   │
│                                                              │
│ ┌───────────────────────────────────────────────────────┐   │
│ │ 공연 시간 (duration_minutes)  🟠 50%  🟡 AI            │   │
│ │ Gemini extracted duration                            │   │
│ │ ⚠️ 공연 시간이 너무 짧습니다 (35분). 확인이 필요합니다.  │   │
│ │ ┌─────────────────────────────────────────────────┐  │   │
│ │ │ 35                                                │   │
│ │ └─────────────────────────────────────────────────┘  │   │
│ │ [✅ 적용]  [❌ 무시]                                   │   │
│ └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔄 워크플로우

### 1. AI 제안 생성
```
Admin → "AI 보완" 클릭
  → Backend: AI 분석
  → Backend: ai_suggestions에 저장
  → Frontend: "AI 제안" 섹션 표시
```

### 2. 제안 적용
```
Admin → 제안 카드에서 "✅ 적용" 클릭
  → Backend: apply-suggestion API 호출
  → Backend: 실제 필드에 값 적용
  → Backend: field_sources 업데이트
  → Backend: ai_suggestions에서 제거
  → Frontend: UI 갱신
```

### 3. 제안 무시
```
Admin → 제안 카드에서 "❌ 무시" 클릭
  → Backend: dismiss-suggestion API 호출
  → Backend: ai_suggestions에서 제거
  → Frontend: UI에서 해당 제안 제거
```

---

## 📈 향후 개선 사항

### 1. 일괄 적용/무시
- "모두 적용" 버튼 추가
- "모두 무시" 버튼 추가
- "신뢰도 80% 이상만 적용" 버튼 추가

### 2. 제안 편집
- 적용 전에 값 수정 가능하도록
- 인라인 편집 UI

### 3. 제안 히스토리
- 과거 제안 기록 보기
- 적용/무시 통계

### 4. Smart Warnings
- 필드별 맞춤 경고 규칙
- 교차 검증 (예: 공연 시간 vs 티켓 가격)

---

## 🎯 다음 단계

- **Phase 4**: 자동 품질 검증 및 경고 시스템
- **Phase 5**: AI 학습 및 신뢰도 개선
- **Phase 6**: 제안 승인 워크플로우

---

## 📝 마무리

Phase 3: AI 제안 시스템이 성공적으로 구현되었습니다! 🎉

이제 관리자는 AI가 추출한 정보를 **신뢰도 점수와 출처를 확인한 후**, 선택적으로 적용할 수 있습니다.

**핵심 가치**:
- ✅ 관리자의 최종 판단 존중
- ✅ 투명한 출처 정보
- ✅ 신뢰도 기반 의사결정 지원
- ✅ 유연한 제안 관리

