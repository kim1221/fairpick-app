# Phase 3: Category-Specific Display Fields - 구현 완료 ✅

**구현 날짜**: 2026-01-30  
**처리 이벤트**: 4,566개 (전시 434개, 공연 4,132개)  
**커버리지**: 100%

---

## 📋 구현 내역

### 1. 타입 정의
**파일**: `src/lib/displayFieldsGenerator/types.ts`

```typescript
// 전시
ExhibitionDisplay {
  artists: string[]           // 작가/아티스트 (KOPIS prfcast)
  genre: string[]             // 장르 (KOPIS genrenm)
  type: string                // 전시 유형 (sub_category 매핑)
  duration_minutes: number    // 권장 관람 시간 (기본값: 60분)
  facilities: {...}           // 편의시설 (향후 AI 분석)
  docent_tour: string         // 도슨트 투어 (향후 AI 분석)
  special_programs: string[]  // 특별 프로그램 (향후 AI 분석)
  age_recommendation: string  // 연령 추천 (KOPIS prfage)
  photography_allowed: bool   // 촬영 가능 여부 (향후 AI 분석)
  last_admission: string      // 입장 마감 시간 (향후 AI 분석)
}

// 공연
PerformanceDisplay {
  cast: string[]              // 출연진 (KOPIS prfcast)
  genre: string[]             // 장르 (KOPIS genrenm)
  duration_minutes: number    // 공연 시간 (KOPIS prfruntime)
  intermission: boolean       // 인터미션 (향후 AI 분석)
  age_limit: string           // 연령 제한 (KOPIS prfage)
  showtimes: {...}            // 공연 시간대 (KOPIS dtguidance)
  runtime: string             // 런타임 설명
  crew: {...}                 // 제작진 (향후 AI 분석)
  discounts: string[]         // 할인 정보 (향후 AI 분석)
  last_admission: string      // 입장 마감 시간 (향후 AI 분석)
}
```

### 2. Payload Reader
**파일**: `src/lib/displayFieldsGenerator/utils/payloadReader.ts`

- `getPayloadFromSources()`: raw_* 테이블에서 payload 추출
- `getFirstValue()`: 여러 payload에서 첫 값 추출
- `parseRuntime()`: "1시간 30분", "100분" → 숫자(분) 변환

### 3. Extractors
**파일**: 
- `src/lib/displayFieldsGenerator/extractors/exhibitionExtractor.ts`
- `src/lib/displayFieldsGenerator/extractors/performanceExtractor.ts`

데이터 소스 우선순위:
1. 🔵 **공공 API** (KOPIS payload): prfcast, genrenm, prfruntime, prfage, dtguidance
2. 🟡 **기존 데이터** (sub_category, derived_tags)
3. 🟢 **기본값** (duration_minutes: 60)
4. 🟠 **AI 분석** (향후 구현): facilities, docent_tour, crew, discounts

### 4. Backfill Job
**파일**: `src/jobs/displayFieldsBackfill.ts`

- `displayFieldsBackfill()`: 전체 이벤트 일괄 처리
- `enrichSingleEventDisplay()`: 단일 이벤트 재계산 (Admin UI 저장 시 사용)

### 5. 실행 스크립트
**파일**: `src/scripts/run-display-fields-backfill.ts`

```bash
npm run enrich:display
```

---

## 📊 실행 결과

```
[Phase 3] Display Fields Backfill Complete!
  ✅ Success: 4566
  ⏭️  Skipped: 0
  ❌ Errors:  0
  ⏱️  Duration: 4083ms
```

### 커버리지

| 카테고리 | 총 이벤트 | Display 필드 생성 | 커버리지 |
|---------|----------|-----------------|---------|
| 전시 | 434 | 434 | 100.0% |
| 공연 | 4,132 | 4,132 | 100.0% |

---

## 🗄️ 데이터 구조

### DB 저장 형식

```sql
-- canonical_events 테이블
metadata: {
  "internal": { ... },  -- Phase 2 (추천 엔진용)
  "display": {          -- Phase 3 (사용자 표시용)
    "exhibition": {     -- 전시인 경우
      "artists": ["김창완 등"],
      "genre": ["대중음악"],
      "type": "특별전",
      "duration_minutes": 60,
      "age_recommendation": "만 7세 이상",
      ...
    }
  }
}
```

또는

```sql
metadata: {
  "internal": { ... },
  "display": {
    "performance": {    -- 공연인 경우
      "cast": ["변지혜", "이진성"],
      "genre": ["서양음악(클래식)"],
      "duration_minutes": 40,
      "runtime": "1시간 40분",
      "age_limit": "만 7세 이상",
      "showtimes": {
        "weekday": ["11:30"],
        "notes": "수요일(11:30)"
      },
      ...
    }
  }
}
```

### GIN Index

```sql
-- 이미 존재 (Phase 2에서 생성됨)
CREATE INDEX idx_canonical_events_metadata_gin 
  ON canonical_events 
  USING GIN (metadata);
```

---

## 🔍 쿼리 예시

### 전시: 특정 작가 검색

```sql
SELECT id, title 
FROM canonical_events
WHERE main_category = '전시'
  AND metadata->'display'->'exhibition'->'artists' ? '김창완 등';
```

### 공연: 특정 장르 검색

```sql
SELECT id, title 
FROM canonical_events
WHERE main_category = '공연'
  AND metadata->'display'->'performance'->'genre' ? '서양음악(클래식)';
```

### 공연: 연령 제한 없는 이벤트

```sql
SELECT id, title 
FROM canonical_events
WHERE main_category = '공연'
  AND metadata->'display'->'performance'->>'age_limit' = '전체관람가';
```

---

## 🔄 자동 업데이트

### 새 이벤트 수집 시

**현재**: 수동 실행 필요
```bash
npm run enrich:display
```

**향후**: Scheduler에 추가 예정
```typescript
// src/scheduler.ts
cron.schedule('30 4 * * *', async () => {
  await runJobSafely('phase3-display-fields', displayFieldsBackfill);
}, {
  timezone: 'Asia/Seoul'
});
```

### Admin UI 수동 저장 시

**향후 구현 예정**: `src/index.ts`의 `PATCH /admin/events/:id`에 통합
```typescript
// 특정 필드 변경 시 자동 재계산
if (req.body.sub_category !== undefined) {
  enrichSingleEventDisplay(req.params.id).catch(error => {
    console.error('[Admin] Phase 3 recalculation failed:', error);
  });
}
```

---

## 📈 다음 단계 (Phase 3.1)

### 1. AI 분석 추가

**목표**: AI를 통해 overview에서 추가 정보 추출

**대상 필드**:
- `facilities.photo_zone`, `facilities.audio_guide`, `facilities.goods_shop`, `facilities.cafe`
- `docent_tour` (도슨트 투어 시간)
- `special_programs` (특별 프로그램)
- `crew.director`, `crew.writer`, `crew.composer` (제작진)
- `discounts` (할인 정보)
- `photography_allowed` (촬영 가능 여부)
- `last_admission` (입장 마감 시간)

**구현 방식**:
```typescript
// lib/displayFieldsGenerator/utils/aiAnalyzer.ts
export async function analyzeOverviewForFacilities(overview: string): Promise<{
  photo_zone: boolean;
  audio_guide: boolean;
  goods_shop: boolean;
  cafe: boolean;
}> {
  // Gemini API로 overview 분석
  // "포토존", "오디오가이드" 키워드 탐지
}
```

### 2. Naver API 통합

**목표**: Naver 검색 API로 추가 정보 수집

**대상 필드**:
- `crew` (제작진 정보)
- `discounts` (할인 정보)

**구현 방식**:
```typescript
// lib/displayFieldsGenerator/utils/naverSearcher.ts
export async function searchNaverForEventDetails(title: string): Promise<{
  crew?: {
    director?: string;
    writer?: string;
    composer?: string;
  };
  discounts?: string[];
}> {
  // Naver 검색 API 호출
}
```

### 3. Admin UI 연동

**목표**: Admin UI에서 category별 필드 표시 및 편집

**파일**: `backend/admin-web/src/pages/EventsPage.tsx`

```tsx
// 카테고리별 조건부 렌더링
{event.main_category === '전시' && event.metadata?.display?.exhibition && (
  <div>
    <h3>전시 정보</h3>
    <p>작가: {event.metadata.display.exhibition.artists.join(', ')}</p>
    <p>장르: {event.metadata.display.exhibition.genre.join(', ')}</p>
    <p>전시 유형: {event.metadata.display.exhibition.type}</p>
    ...
  </div>
)}

{event.main_category === '공연' && event.metadata?.display?.performance && (
  <div>
    <h3>공연 정보</h3>
    <p>출연진: {event.metadata.display.performance.cast.join(', ')}</p>
    <p>장르: {event.metadata.display.performance.genre.join(', ')}</p>
    <p>런타임: {event.metadata.display.performance.runtime}</p>
    ...
  </div>
)}
```

---

## 🎯 설계 철학

### 왜 JSONB (`metadata.display`)인가?

1. **유연한 확장성**: 카테고리별로 필드 구조가 다름
2. **NULL 회피**: 공연 이벤트에 `exhibition` 컬럼이 NULL로 남지 않음
3. **프론트엔드 친화적**: JSON 그대로 전달 가능
4. **GIN Index**: PostgreSQL의 JSONB 쿼리 성능 최적화

### Core Data vs Display Data

| 구분 | Core Data (Phase 1/2) | Display Data (Phase 3) |
|-----|----------------------|----------------------|
| 저장 위치 | 전용 DB 컬럼 | `metadata.display` (JSONB) |
| 용도 | 추천 엔진, 필터링, 검색 | 사용자 UI 표시 |
| 범용성 | 모든 카테고리 공통 | 카테고리별 특화 |
| 예시 | `derived_tags`, `lat/lng`, `price_min` | `cast`, `artists`, `facilities` |

---

## 📝 GPT 피드백 반영 사항

### 1. ✅ `photography_allowed` 필드 추가
- 타입: `boolean | 'partial' | null`
- 의미: 전체 촬영 가능(true) / 불가(false) / 일부만('partial')

### 2. ✅ `last_admission` 필드 추가
- 타입: `string | null`
- 의미: 입장 마감 시간 (예: "17:30")

### 3. ✅ `parseRuntime()` 유틸리티 구현
- "1시간 30분" → 90
- "100분" → 100

### 4. 🔄 Negative Hide 방식 (Admin UI에서 적용 예정)
- `facilities.photo_zone === true`일 때만 배지 표시
- `false`/`null`일 때는 숨김 (정보 없음 vs 없다는 것을 의미)

---

## ✅ 완료 체크리스트

- [x] 타입 정의 (`types.ts`)
- [x] Payload Reader (`payloadReader.ts`)
- [x] Exhibition Extractor (`exhibitionExtractor.ts`)
- [x] Performance Extractor (`performanceExtractor.ts`)
- [x] Backfill Job (`displayFieldsBackfill.ts`)
- [x] 실행 스크립트 (`run-display-fields-backfill.ts`)
- [x] npm script 추가 (`enrich:display`)
- [x] 전체 이벤트 Backfill 실행 (4,566개 성공)
- [x] 데이터 검증 (100% 커버리지)
- [x] 문서 작성

---

**다음 TODO**: Phase 3.1 (AI 분석 통합), Admin UI 연동

