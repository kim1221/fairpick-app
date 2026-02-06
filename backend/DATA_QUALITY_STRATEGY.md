# 데이터 품질 전략 (Data Quality Strategy)

## 🎯 핵심 질문

1. **DB 용량이 계속 차는가?**
2. **새로운 이벤트만 대상으로 하는가?**
3. **수동 입력 후 재계산이 필요한가?**
4. **불완전한 데이터를 노출해야 하는가?**

---

## 1️⃣ DB 용량 (저장 공간)

### ❌ **거의 안 늘어남!**

```
이벤트 1개당 metadata 크기: 약 500 bytes
전체 2,000개 × 500 bytes = 1 MB

→ 영향 없음! (이미지 1장 = 1-5 MB)
```

#### 이유: UPDATE (덮어쓰기)

```sql
-- 첫날
metadata = {"internal": {...}}  -- 500 bytes

-- 다음날 (덮어쓰기)
metadata = {"internal": {...}}  -- 520 bytes (20 bytes 증가)

-- PostgreSQL JSONB 최적화
-- - 바이너리 압축 저장
-- - 변경된 부분만 재작성
```

---

## 2️⃣ 처리 대상

### ✅ **모든 live 이벤트 (약 2,000개)**

```typescript
// 현재 방식
WHERE is_deleted = false 
  AND end_at >= CURRENT_DATE

// 처리 시간: 1.27초 (매우 빠름!)
```

#### 왜 전체를 대상으로?

1. **기존 이벤트도 변경될 수 있음** (Admin 수정)
2. **일관성 유지** (파생 데이터 동기화)
3. **성능 문제 없음** (1.27초는 충분히 빠름)

---

## 3️⃣ 수동 입력 후 재계산

### ✅ **자동 재계산 구현 완료!**

```typescript
// PATCH /admin/events/:id
app.patch('/admin/events/:id', async (req, res) => {
  // 1. DB 업데이트
  await pool.query(`UPDATE canonical_events SET ...`);
  
  // 2. Phase 2 자동 재계산
  if (derived_tags || opening_hours || lat || lng 변경) {
    enrichSingleEvent(eventId);  // 비동기 실행
  }
  
  // 3. 즉시 응답 (재계산 기다리지 않음)
  res.json({ success: true });
});
```

#### 시나리오

```
1. 이벤트 수집 (03:00)
   derived_tags = null
   
2. AI Enrichment (04:00)
   derived_tags = ["전시", "실내"]
   
3. Phase 2 (04:15)
   metadata.internal = {...}  ← 첫 계산
   
4. Admin 수동 입력 (10:00)
   derived_tags = ["전시", "실내", "커플", "힙한"]  ← 추가!
   
5. 자동 재계산 (10:00, 즉시!)
   metadata.internal = {...}  ← 업데이트됨!
```

---

## 4️⃣ 불완전 데이터 노출 전략

### 전략 A: 단계별 노출 (권장) ⭐

```sql
-- status 필드로 관리
CREATE TYPE event_status AS ENUM (
  'draft',      -- 초안 (노출 안함)
  'ready',      -- 검토 완료 (노출 가능)
  'published'   -- 게시됨
);
```

#### 흐름도

```
1. 데이터 수집 (03:00)
   status = 'draft'  -- 자동 설정
   derived_tags = null
   opening_hours = null
   ↓ 사용자 노출 안됨 ❌

2. AI Enrichment (04:00)
   derived_tags = ["전시", "실내"]
   opening_hours = {...}
   ↓ 여전히 노출 안됨 ❌

3. Admin 검토 (10:00)
   - 데이터 확인
   - 누락 필드 수동 입력
   - status = 'ready' 변경
   ↓ 이제 노출 시작! ✅

4. 자동 게시 (11:00)
   status = 'published'
   ↓ 추천 알고리즘에 포함! ✅
```

#### 장점
- ✅ **품질 보장** (검증된 데이터만 노출)
- ✅ **브랜드 신뢰도** 유지
- ✅ **사용자 경험** 향상

#### 단점
- ⚠️ **수동 작업 필요** (Admin 검토)
- ⚠️ **노출 지연** (몇 시간)

---

### 전략 B: 즉시 노출 + 품질 플래그

```sql
-- quality_flags 필드 활용
quality_flags = {
  "has_image": true,
  "has_tags": true,
  "has_opening_hours": false,  -- 누락!
  "has_external_links": false, -- 누락!
  "manual_verified": false     -- 미검증
}
```

#### 흐름도

```
1. 데이터 수집 (03:00)
   status = 'published'  -- 즉시 게시
   quality_flags = {...incomplete...}
   ↓ 즉시 노출! ✅

2. 추천 알고리즘
   WHERE quality_flags->>'has_image' = 'true'
     AND quality_flags->>'has_tags' = 'true'
   ↓ 품질 낮은 이벤트는 순위 하락

3. Admin 보완 (10:00)
   - 누락 필드 입력
   - quality_flags 업데이트
   ↓ 추천 순위 상승! ✅
```

#### 장점
- ✅ **빠른 노출** (즉시)
- ✅ **데이터 활용도** 높음
- ✅ **점진적 개선** 가능

#### 단점
- ⚠️ **품질 혼재** (완전/불완전 데이터)
- ⚠️ **사용자 혼란** 가능성

---

## 📊 전략 비교

| 항목 | 전략 A (단계별 노출) | 전략 B (즉시 노출) |
|-----|---------------------|-------------------|
| **노출 속도** | 느림 (몇 시간) | 빠름 (즉시) |
| **데이터 품질** | 높음 | 혼재 |
| **수동 작업** | 필수 (검토) | 선택적 (보완) |
| **사용자 경험** | 우수 | 보통 |
| **브랜드 신뢰도** | 높음 | 중간 |
| **초기 데이터 부족 시** | ❌ 노출 이벤트 적음 | ✅ 많은 이벤트 노출 |

---

## 🎯 권장 전략: **하이브리드**

### 핵심 필드는 필수, 나머지는 선택

```typescript
// 필수 필드 (없으면 draft)
const requiredFields = [
  'title',
  'main_category',
  'start_at',
  'end_at',
  'venue',
  'image_url'  // 이미지 필수!
];

// 선택 필드 (없어도 게시)
const optionalFields = [
  'derived_tags',      // AI가 채움 → 수동 보완
  'opening_hours',     // AI가 채움 → 수동 보완
  'external_links',    // AI가 채움 → 수동 보완
  'overview'           // AI가 채움 → 수동 보완
];
```

### 자동 상태 전환

```typescript
// enrichInternalFields.ts 또는 별도 job

async function updateEventStatus(eventId: string) {
  const event = await pool.query(`
    SELECT * FROM canonical_events WHERE id = $1
  `, [eventId]);
  
  // 필수 필드 체크
  const hasRequired = 
    event.title &&
    event.main_category &&
    event.start_at &&
    event.end_at &&
    event.venue &&
    event.image_url &&
    !event.image_url.includes('placeholder');
  
  // 품질 점수 계산
  const qualityScore = calculateQualityScore(event);
  
  // 상태 결정
  let status = 'draft';
  if (hasRequired && qualityScore >= 60) {
    status = 'ready';  // 자동 게시 가능
  }
  if (qualityScore >= 80) {
    status = 'published';  // 우선 노출
  }
  
  await pool.query(`
    UPDATE canonical_events
    SET status = $1, quality_score = $2
    WHERE id = $3
  `, [status, qualityScore, eventId]);
}
```

---

## 🚀 구현 우선순위

### Phase 1: 자동 재계산 (완료! ✅)
```typescript
// PATCH /admin/events/:id
if (derived_tags || opening_hours 변경) {
  enrichSingleEvent(eventId);
}
```

### Phase 2: 품질 플래그 활용 (진행 중)
```sql
-- 이미 quality_flags 필드 있음!
WHERE quality_flags->>'has_image' = 'true'
  AND quality_flags->>'has_tags' = 'true'
```

### Phase 3: 상태 관리 시스템 (계획)
```sql
ALTER TABLE canonical_events
ADD COLUMN status event_status DEFAULT 'draft',
ADD COLUMN quality_score INTEGER DEFAULT 0;

-- 인덱스
CREATE INDEX idx_events_status ON canonical_events(status);
CREATE INDEX idx_events_quality ON canonical_events(quality_score);
```

### Phase 4: Admin UI 개선 (계획)
```
- 이벤트 목록: status 필터 추가
- 이벤트 상세: 누락 필드 하이라이트
- 대시보드: 품질 통계 표시
```

---

## 💡 핵심 요약

### 질문 1: DB 용량?
**답**: ❌ 거의 안 늘어남 (1 MB 수준)

### 질문 2: 새 이벤트만?
**답**: ❌ 모든 live 이벤트 (2,000개, 1.27초)

### 질문 3: 수동 입력 후 재계산?
**답**: ✅ 자동 재계산 구현 완료!

### 질문 4: 불완전 데이터 노출?
**답**: 🎯 하이브리드 전략 권장
- 필수 필드 있으면 → 게시
- 품질 점수로 → 순위 조정
- 자동 상태 전환

---

## 📝 다음 단계

```bash
# 1. 서버 재시작 (자동 재계산 반영)
npm run dev

# 2. 테스트
# 2-1. Admin에서 이벤트 수정
# 2-2. derived_tags 추가
# 2-3. 로그 확인: "[Admin] Triggering Phase 2 recalculation"
# 2-4. API 호출: /recommendations?companions=가족

# 3. 품질 관리 시스템 구현 (선택)
# - status 필드 추가
# - quality_score 계산
# - Admin UI 개선
```

모든 준비 완료! 🎉

