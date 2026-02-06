# 🔒 수동 편집 보호 기능 가이드

**작성일**: 2026-01-30  
**버전**: 1.0.0  
**원칙**: Admin의 수동 편집은 AI가 덮어쓰지 않음

---

## 📋 개요

### 문제
```
시나리오:
1. AI 보완으로 derived_tags 생성: ["데이트", "힙한", "사진맛집"]
2. Admin이 overview를 정성스럽게 수정 (3문장)
3. external_links가 잘못 채워져서 AI 보완 다시 실행
4. 결과: derived_tags + overview도 덮어씌워짐! (기존 내용 날아감)
```

### 해결책
**수동 편집 추적 (Manual Edit Tracking)**
- DB에 `manually_edited_fields` 컬럼 추가
- Admin UI에서 필드 수정 시 자동 마킹
- AI 보완 시 수동 편집된 필드는 스킵
- `forceFields` 옵션으로 선택적 재생성 가능

---

## 🗄️ DB 구조

### 새 컬럼: `manually_edited_fields`

```sql
-- canonical_events 테이블
CREATE TABLE canonical_events (
  ...
  manually_edited_fields JSONB DEFAULT '{}'::jsonb,
  ...
);

-- 예시 데이터
{
  "overview": true,        -- Admin이 overview를 수동 편집함
  "derived_tags": true,    -- Admin이 derived_tags를 수동 편집함
  "metadata.display.exhibition": true  -- Admin이 전시 필드를 수동 편집함
}
```

### GIN Index
```sql
CREATE INDEX idx_canonical_events_manually_edited_fields 
ON canonical_events USING GIN (manually_edited_fields);
```

---

## 💻 사용 방법

### 1️⃣ Admin UI에서 필드 수동 편집 시

**Admin이 필드를 수정하면 자동으로 마킹**:

```typescript
// Admin PATCH /admin/events/:id
app.patch('/admin/events/:id', async (req, res) => {
  const updates: string[] = [];
  const values: any[] = [];
  const manualEdits: string[] = [];
  
  // overview 수정
  if (req.body.overview !== undefined) {
    updates.push(`overview = $${values.length + 1}`);
    values.push(req.body.overview);
    manualEdits.push('overview');  // 🔒 수동 편집 마킹
  }
  
  // derived_tags 수정
  if (req.body.derived_tags !== undefined) {
    updates.push(`derived_tags = $${values.length + 1}`);
    values.push(JSON.stringify(req.body.derived_tags));
    manualEdits.push('derived_tags');  // 🔒 수동 편집 마킹
  }
  
  // manually_edited_fields 업데이트
  if (manualEdits.length > 0) {
    const markings = manualEdits.map(field => `"${field}": true`).join(', ');
    updates.push(`manually_edited_fields = COALESCE(manually_edited_fields, '{}'::jsonb) || '{${markings}}'::jsonb`);
  }
  
  await pool.query(`
    UPDATE canonical_events
    SET ${updates.join(', ')}, updated_at = NOW()
    WHERE id = $${values.length + 1}
  `, [...values, req.params.id]);
});
```

---

### 2️⃣ AI 보완 실행 (빈 필드만 채우기)

**기본 모드**: 수동 편집된 필드는 **절대 건드리지 않음**

```typescript
// 스케줄러 (매일 04:00)
await aiEnrichmentBackfill({
  limit: null,
  useNaverSearch: true,
  onlyMissingTags: true,
  onlyRecent: true,
  forceFields: [],  // 🔒 빈 배열 = 수동 편집 존중
});

// Admin UI "AI 보완" 버튼
await aiEnrichmentBackfill({
  limit: 1,
  useNaverSearch: true,
  forceFields: [],  // 🔒 수동 편집 존중
});
```

**결과**:
```
✅ overview: 스킵 (🔒 manually edited by admin)
✅ derived_tags: 스킵 (🔒 manually edited by admin)
✅ external_links: 업데이트 (수동 편집 안 됨)
```

---

### 3️⃣ 특정 필드만 선택 재생성

**Admin UI에서 체크박스로 필드 선택**:

```typescript
// 사용자가 "derived_tags"와 "external_links"만 재생성 선택
await aiEnrichmentBackfill({
  limit: 1,
  useNaverSearch: true,
  forceFields: ['derived_tags', 'external_links'],  // 🔧 이 필드들만 강제 재생성
});
```

**결과**:
```
🔧 derived_tags: 재생성 (forceFields에 포함)
✅ overview: 스킵 (🔒 manually edited, forceFields에 없음)
🔧 external_links: 재생성 (forceFields에 포함)
```

---

### 4️⃣ 모든 필드 강제 재생성

**"강제 재생성" 버튼 (경고 포함)**:

```typescript
// 모든 수동 편집 무시하고 전부 재생성
await aiEnrichmentBackfill({
  limit: 1,
  useNaverSearch: true,
  forceFields: ['*'],  // 🚨 모든 필드 강제 재생성 (특수 값)
});
```

**주의**: 이 기능은 Admin UI에서 경고 메시지와 함께 제공해야 합니다.

---

## 🔍 동작 원리

### isManuallyEdited 함수

```typescript
function isManuallyEdited(
  event: CanonicalEventRow,
  fieldName: string,
  forceFields: string[]
): boolean {
  // 1. forceFields에 포함되면 → 수동 편집 무시
  if (forceFields.includes(fieldName)) {
    return false;
  }
  
  // 2. manually_edited_fields 체크
  if (event.manually_edited_fields && event.manually_edited_fields[fieldName] === true) {
    return true;  // 🔒 수동 편집됨!
  }
  
  return false;
}
```

### AI 보완 로직

```typescript
// derived_tags 업데이트
if (extractedInfo.derived_tags && extractedInfo.derived_tags.length > 0) {
  const manuallyEdited = isManuallyEdited(event, 'derived_tags', forceFields);
  
  if (manuallyEdited) {
    console.log('[Enrich] 🔒 derived_tags skipped (manually edited by admin)');
  } else {
    updateFields.push(`derived_tags = $${paramIndex++}`);
    console.log('[Enrich] ✅ derived_tags updated');
  }
}
```

---

## 📊 보호 대상 필드

| 필드 | 공공 API | AI 보완 | 수동 편집 보호 |
|-----|---------|---------|--------------|
| `title` | ✅ | - | 🛡️ (절대 수정 안 함) |
| `price_min/max` | ✅ | 🔄 | 🛡️ (기존 값 있으면 보호) |
| `opening_hours` | 🔄 | ✅ | 🛡️ (기존 값 있으면 보호) |
| `derived_tags` | - | ✅ | 🔒 **수동 편집 추적** |
| `overview` | - | ✅ | 🔒 **수동 편집 추적** |
| `metadata.display` | - | ✅ | 🔒 **수동 편집 추적** |
| `external_links` | - | ✅ | 🔒 **수동 편집 추적** |

**범례**:
- 🛡️ 보호: 공공 API 데이터 우선
- 🔒 추적: `manually_edited_fields`로 추적

---

## 🎯 사용 시나리오

### 시나리오 A: 일부 필드만 채우고 싶음

```typescript
// 상황: derived_tags와 overview는 잘 채워졌는데,
//      external_links만 잘못 채워짐

// 해결: forceFields로 external_links만 재생성
await aiEnrichmentBackfill({
  limit: 1,
  forceFields: ['external_links'],  // 이것만 재생성
});

// 결과:
// - derived_tags: 유지 (수동 편집 존중)
// - overview: 유지 (수동 편집 존중)
// - external_links: 재생성 ✅
```

---

### 시나리오 B: 빈 필드만 채우기

```typescript
// 상황: 새 이벤트가 수집되었고, 몇 개 필드만 비어있음

// 해결: forceFields 없이 실행
await aiEnrichmentBackfill({
  limit: 1,
  forceFields: [],  // 빈 배열
});

// 결과:
// - 비어있는 필드: 채워짐 ✅
// - 이미 있는 필드: 유지 ✅
// - 수동 편집 필드: 유지 ✅
```

---

### 시나리오 C: 전부 다시 생성

```typescript
// 상황: AI 알고리즘이 업그레이드되어서 모든 필드를 다시 생성하고 싶음

// 해결: 모든 필드 강제 재생성
await aiEnrichmentBackfill({
  limit: null,  // 전체
  forceFields: [
    'derived_tags',
    'overview',
    'metadata.display.exhibition',
    'metadata.display.performance',
    'external_links'
  ],
});

// 결과:
// - 모든 필드: 재생성 ✅
// - 수동 편집도 무시됨 (의도적)
```

---

## 🧪 테스트

### 단위 테스트
```bash
ts-node -r dotenv/config src/scripts/test-manual-edit-logic.ts
```

### DB 테스트
```bash
ts-node -r dotenv/config src/scripts/test-manual-edit-marking.ts
```

### 통합 테스트
```bash
ts-node -r dotenv/config src/scripts/test-manual-edit-protection.ts
```

---

## 🚀 Admin UI 구현 예시

### UI 구성

```typescript
// EventDetailPage.tsx

<div>
  <h2>AI 보완</h2>
  
  {/* 옵션 1: 빈 필드만 채우기 */}
  <button onClick={() => runAIEnrich({ forceFields: [] })}>
    🤖 빈 필드만 AI 보완
  </button>
  
  {/* 옵션 2: 필드 선택 */}
  <div>
    <h3>재생성할 필드 선택:</h3>
    <label>
      <input type="checkbox" value="derived_tags" />
      추천 태그 (derived_tags)
    </label>
    <label>
      <input type="checkbox" value="overview" />
      개요 (overview)
    </label>
    <label>
      <input type="checkbox" value="external_links" />
      외부 링크 (external_links)
    </label>
    <label>
      <input type="checkbox" value="metadata.display.exhibition" />
      전시 특화 필드
    </label>
    <button onClick={handleSelectedFieldsEnrich}>
      🔧 선택한 필드만 재생성
    </button>
  </div>
  
  {/* 옵션 3: 전체 재생성 (경고) */}
  <button 
    onClick={() => {
      if (confirm('⚠️ 수동으로 편집한 내용이 모두 사라집니다. 계속하시겠습니까?')) {
        runAIEnrich({ forceFields: ['*'] });
      }
    }}
    style={{ backgroundColor: 'red', color: 'white' }}
  >
    🚨 강제 재생성 (경고)
  </button>
</div>

// 수동 편집 마킹 표시
{event.manually_edited_fields?.overview && (
  <span title="Admin이 수동으로 편집함">🔒</span>
)}
```

---

## ✅ 체크리스트

### Phase 1 구현 (완료)
- [x] DB Migration: `manually_edited_fields` 컬럼 추가
- [x] `isManuallyEdited()` 함수 구현
- [x] `aiEnrichmentBackfill`에 `forceFields` 옵션 추가
- [x] 모든 AI 필드에 수동 편집 체크 적용
- [x] 단위 테스트 작성 및 통과
- [x] DB 테스트 작성 및 통과
- [x] 문서 작성

### Phase 2 구현 (TODO)
- [ ] Admin UI에 수동 편집 마킹 로직 추가
- [ ] Admin UI에 필드 선택 체크박스 추가
- [ ] "빈 필드만 AI 보완" 버튼 추가
- [ ] "선택한 필드만 재생성" 버튼 추가
- [ ] "강제 재생성" 버튼 추가 (경고 포함)
- [ ] 수동 편집 표시 아이콘 (🔒) 추가

---

**마지막 업데이트**: 2026-01-30  
**작성자**: Fairpick AI Agent  
**버전**: 1.0.0

