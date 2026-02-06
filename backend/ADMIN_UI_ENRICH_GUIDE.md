# Admin UI - AI 보완 기능 가이드

## 📋 개요

Admin UI의 이벤트 상세 페이지에서 **3가지 모드**의 AI 보완 기능을 제공합니다.

---

## 🎯 3가지 AI 보완 모드

### 1️⃣ 빈 필드만 AI 보완
**버튼**: `🤖 빈 필드만 AI 보완`

- **동작**: 비어있는 필드만 AI로 채움
- **보호**: 
  - ✅ 기존 값이 있는 필드는 건드리지 않음
  - ✅ 공공 API 데이터 보호
  - ✅ 수동으로 편집한 필드 보호
- **사용 사례**: 
  - 새로운 이벤트 수집 후 자동 보완
  - 누락된 정보만 채우고 싶을 때

**예시**:
```
기존 데이터:
  overview: "이미 작성된 설명"
  derived_tags: []  ← 비어있음

AI 보완 후:
  overview: "이미 작성된 설명"  ← 유지
  derived_tags: ["가족", "주말", "실내"]  ← AI가 채움
```

---

### 2️⃣ 선택한 필드만 재생성
**버튼**: `🎯 선택한 필드만 재생성`

- **동작**: 체크박스로 선택한 필드만 AI로 재생성
- **보호**: 선택하지 않은 필드는 건드리지 않음
- **사용 사례**:
  - 특정 필드만 업데이트하고 싶을 때
  - AI가 잘못 추출한 필드만 다시 생성하고 싶을 때
  - 수동 편집한 필드를 의도적으로 재생성하고 싶을 때

**선택 가능한 필드**:
- 개요 (Overview)
- 태그 (Tags)
- 운영시간 (Hours)
- 외부 링크 (Links)
- 최소 가격
- 최대 가격
- 장소 (Venue)
- 주소 (Address)

**예시**:
```
[✓] 개요 (Overview)
[✓] 태그 (Tags)
[ ] 운영시간 (Hours)
[ ] 외부 링크 (Links)

→ "개요"와 "태그"만 AI로 재생성
→ 나머지 필드는 기존 값 유지
```

---

### 3️⃣ 강제 재생성 (전체)
**버튼**: `🚨 강제 재생성`

- **동작**: 모든 필드를 강제로 AI로 재생성
- **경고**: ⚠️ 수동으로 입력한 데이터도 모두 덮어씌워짐
- **보호**: 없음 (모든 필드 재생성)
- **사용 사례**:
  - 이벤트 정보가 완전히 바뀌었을 때
  - 모든 필드를 처음부터 다시 추출하고 싶을 때
  - 테스트/디버깅용

**경고 메시지**:
```
⚠️ 경고: 모든 필드를 강제로 재생성합니다.
수동으로 입력한 데이터도 덮어씌워집니다.

계속하시겠습니까?
```

---

## 🖼️ UI 구조

```
┌──────────────────────────────────────────────────────┐
│ 이벤트 상세                                      ✕   │
├──────────────────────────────────────────────────────┤
│ [🤖 빈 필드만 AI 보완] [🎯 선택한 필드만 재생성] [🚨 강제 재생성] │
│                                                      │
│ ┌──────────────────────────────────────────────────┐ │
│ │ 재생성할 필드 선택:                              │ │
│ │                                                  │ │
│ │ ☐ 개요 (Overview)      ☐ 태그 (Tags)           │ │
│ │ ☐ 운영시간 (Hours)      ☐ 외부 링크 (Links)     │ │
│ │ ☐ 최소 가격             ☐ 최대 가격              │ │
│ │ ☐ 장소 (Venue)          ☐ 주소 (Address)        │ │
│ │                                                  │ │
│ │ [✅ 선택한 필드 재생성 (3개)]                    │ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│ ... (이벤트 필드들) ...                              │
└──────────────────────────────────────────────────────┘
```

---

## 🔧 기술적 구현

### Backend API

**엔드포인트**: `POST /admin/events/:id/enrich`

**Request Body**:
```json
{
  "forceFields": []  // 빈 배열 = 빈 필드만 채우기
}

{
  "forceFields": ["overview", "derived_tags"]  // 선택한 필드만 재생성
}

{
  "forceFields": ["*"]  // 모든 필드 강제 재생성
}
```

**Response**:
```json
{
  "success": true,
  "enriched": {
    "overview": "AI가 추출한 개요...",
    "derived_tags": ["가족", "주말"],
    "opening_hours": { ... },
    ...
  }
}
```

### Frontend (EventsPage.tsx)

**State**:
```typescript
const [selectedFields, setSelectedFields] = useState<string[]>([]);
const [showFieldSelector, setShowFieldSelector] = useState(false);
```

**AI 보완 함수**:
```typescript
const handleAIEnrich = async (forceFields: string[] = []) => {
  const result = await adminApi.enrichEvent(selectedEvent.id, { forceFields });
  // ...
};
```

**3가지 호출 방법**:
```typescript
// 1️⃣ 빈 필드만 채우기
handleAIEnrich([]);

// 2️⃣ 선택한 필드만 재생성
handleAIEnrich(['overview', 'derived_tags']);

// 3️⃣ 모든 필드 강제 재생성
handleAIEnrich(['*']);
```

---

## 📊 데이터 보호 계층

### 우선순위 (높은 순서)

1. **forceFields에 포함된 필드**
   - 무조건 AI로 재생성
   - 기존 값, 수동 편집 무시

2. **공공 API 데이터** (price_min, price_max 등)
   - forceFields에 없으면 보호됨
   - 더 정확한 데이터이므로 우선

3. **수동 편집 데이터** (manually_edited_fields)
   - forceFields에 없으면 보호됨
   - Admin이 의도적으로 수정한 값

4. **AI 생성 데이터**
   - 비어있거나 forceFields에 포함된 경우만 채움

---

## 💡 사용 팁

### ✅ 추천하는 사용 패턴

1. **신규 이벤트 수집 후**:
   - `🤖 빈 필드만 AI 보완` 사용
   - 공공 API에서 못 채운 필드만 자동 보완

2. **특정 필드 수정이 필요할 때**:
   - `🎯 선택한 필드만 재생성` 사용
   - 원하는 필드만 체크해서 재생성

3. **이벤트 정보가 완전히 바뀌었을 때**:
   - `🚨 강제 재생성` 사용
   - 모든 정보를 처음부터 다시 추출

### ❌ 피해야 할 패턴

1. **수동 편집 후 바로 "빈 필드만 AI 보완" 실행**:
   - ✅ 문제없음: 수동 편집한 필드는 보호됨

2. **수동 편집 후 "강제 재생성" 실행**:
   - ⚠️ 주의: 수동 편집한 내용이 모두 사라짐

3. **공공 API 데이터가 있는 필드를 "강제 재생성"**:
   - ⚠️ 주의: 더 정확한 공공 API 데이터가 AI 데이터로 덮어씌워짐

---

## 🧪 테스트 시나리오

### 시나리오 1: 빈 필드만 채우기
```
1. 이벤트 선택
2. "빈 필드만 AI 보완" 클릭
3. AI 분석 완료
4. 비어있던 필드만 채워짐
5. 기존 값은 그대로 유지
```

### 시나리오 2: 선택한 필드만 재생성
```
1. 이벤트 선택
2. "선택한 필드만 재생성" 클릭
3. "개요"와 "태그" 체크
4. "선택한 필드 재생성 (2개)" 클릭
5. 확인 메시지 클릭
6. 선택한 필드만 AI로 재생성
```

### 시나리오 3: 강제 재생성
```
1. 이벤트 선택
2. "강제 재생성" 클릭
3. 경고 메시지 확인
4. "확인" 클릭
5. 모든 필드가 AI로 재생성
```

---

## 🔍 로그 확인

### Backend 로그
```bash
tail -f /tmp/backend_admin_ui.log
```

**AI 보완 실행 시 로그**:
```
[Admin] [Enrich] forceFields: []  // 빈 필드만
[Admin] [Enrich] forceFields: ["overview", "derived_tags"]  // 선택한 필드
[Admin] [Enrich] forceFields: ["*"]  // 모든 필드
```

---

## 📝 관련 문서

- `MANUAL_EDIT_PROTECTION_GUIDE.md` - 수동 편집 보호 메커니즘
- `DATA_PROTECTION_POLICY.md` - 공공 API 데이터 보호 정책
- `AI_ENRICHMENT_PROCESS.md` - AI 보완 프로세스 전체 설명
- `PHASE3_FINAL_PLAN.md` - Phase 3 카테고리별 필드 계획

---

## 🎉 구현 완료!

- ✅ Backend API (`forceFields` 옵션 추가)
- ✅ Frontend API (`adminApi.enrichEvent` 수정)
- ✅ Admin UI (3가지 버튼 + 체크박스)
- ✅ CSS 스타일 (`.btn-outline` 추가)
- ✅ 데이터 보호 로직 (공공 API + 수동 편집)
- ✅ 문서 작성 (이 파일)

**서버 실행**:
- Backend: `http://localhost:5001`
- Admin UI: `http://localhost:5173`

**테스트 가능** 🚀

