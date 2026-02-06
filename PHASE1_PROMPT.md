# Phase 1: 거리 기반 추천 고도화 작업 지침서

## 작업 목표
Fairpick 백엔드의 추천 알고리즘에 **거리 하드 제한**을 추가하여, 네이버 플레이스와 차별화된 "내 주변 이벤트 큐레이션" 서비스를 완성합니다.

## 프로젝트 컨텍스트
- **프로젝트**: Fairpick (Toss MiniApp 기반 이벤트 추천 서비스)
- **핵심 정체성**: "지금(Time) + 여기(Space) + 할 것(Experience)"
- **주요 파일**: `/Users/kimsungtae/toss/fairpick-app/backend/src/lib/recommender.ts`
- **데이터베이스**: PostgreSQL
  - 테이블: `canonical_events`
  - 컬럼: `id`, `lat`, `lng`, `address`, `buzz_score`, `start_at`, `end_at`, `created_at`, ...

---

## 현재 코드 상태 (중요 ⭐)

### 현재 `getTodaysPick` 로직:
```typescript
if (location) {
  // 1. 근처 이벤트 100개 (거리 오름차순, 거리 제한 없음!)
  // 2. 인기/신선 이벤트 50개 (전국, 거리 무관)
  // 3. 합쳐서 중복 제거
  // 4. 점수 계산 (거리 30% + 인기 30% + 시간 20% + 카테고리 15% + 신선도 5%)
  // 5. 정렬
}
```

**문제점**:
- "근처 100개"라고 해도 100번째가 300km일 수 있음
- 성수동에서 광주 이벤트가 추천됨 (비현실적)

### 현재 다른 함수들:
- `getTrending`: 전국 이벤트, 거리 무관
- `getNearby`: 거리순 정렬만, 거리 제한 없음
- `getWeekend`: 주말 필터 + 인기순, 거리 무관
- `getLatest`: 최신순, 거리 무관

---

## Phase 1 작업 내용 (4개 태스크)

### Task 1: 거리 하드 제한 SQL 구현 ⭐

#### 목표
SQL WHERE 절에 거리 제한을 추가하여, **후보군부터 거리로 필터링**

#### 기존 문제점
```typescript
// 기존 (잘못됨)
const nearbyQuery = `
  SELECT *, (6371 * acos(...)) AS distance_km
  FROM canonical_events
  WHERE end_at >= NOW() AND is_deleted = false
  ORDER BY distance_km ASC
  LIMIT 100
`;
// → 100번째가 300km일 수도 있음!
```

#### 개선 방향
```typescript
// 개선 (올바름)
const nearbyQuery = `
  SELECT *, (6371 * acos(...)) AS distance_km
  FROM canonical_events
  WHERE end_at >= NOW() 
    AND is_deleted = false
    AND lat IS NOT NULL 
    AND lng IS NOT NULL
    AND (6371 * acos(...)) <= 10  -- ⭐ 거리 하드 컷
  ORDER BY distance_km ASC
  LIMIT 100
`;
```

#### 구현 요구사항
1. **헬퍼 함수 생성**: `buildDistanceFilter(lat, lng, maxDistanceKm): string`
   - Haversine 공식을 WHERE 절로 반환
   - 예: `AND (6371 * acos(...)) <= 10`

2. **거리 제한 상수 정의**:
   ```typescript
   export const DISTANCE_LIMITS = {
     NEARBY: 5,      // 내 주변: 5km
     TODAY: 10,      // 오늘의 추천: 10km
     WEEKEND: 20,    // 이번 주말: 20km
     LATEST: 20,     // 새로 올라왔어요: 20km
     TRENDING: null, // 지금 떠오르는: 도시권 (Task 3)
   };
   ```

3. **모든 쿼리에 적용**:
   - `getTodaysPick`: 10km 제한
   - `getNearby`: 5km 제한
   - `getWeekend`: 20km 제한
   - `getLatest`: 20km 제한 (location 있을 때만)

#### 주의사항
- **Phase 1에서는 자동 확대 구현 안 함** (Phase 2에서 구현)
- 결과가 0개여도 그대로 반환 (빈 배열 OK)

---

### Task 2: 섹션별 거리 제한 적용

#### 함수별 수정 사항

| 함수 | 현재 | 변경 후 |
|------|------|---------|
| `getTodaysPick` | 근처 100개 (제한 없음) | **10km 이내만** 조회 |
| `getNearby` | 거리순 (제한 없음) | **5km 이내만** 조회 |
| `getWeekend` | 주말 필터 (거리 무관) | **20km 이내만** 조회 (location 있을 때) |
| `getLatest` | 최신순 (거리 무관) | **20km 이내만** 조회 (location 있을 때) |
| `getTrending` | 전국 (거리 무관) | Task 3에서 도시권 필터 구현 |

#### 구현 요구사항
1. 각 함수의 SQL 쿼리에 Task 1의 `buildDistanceFilter()` 적용
2. `location` 파라미터가 없으면 거리 제한 안 함 (전국 조회)
3. 결과 배열에 `distance_km` 포함

---

### Task 3: "지금 떠오르는" 도시권 제한

#### 도시권 정의
새 파일 생성: `/Users/kimsungtae/toss/fairpick-app/backend/src/lib/cityZones.ts`

```typescript
export const CITY_ZONES: Record<string, string[]> = {
  '수도권': ['서울', '인천', '경기'],
  '부울경': ['부산', '울산', '경남'],
  '대경권': ['대구', '경북'],
  '호남권': ['광주', '전남', '전북'],
  '충청권': ['대전', '세종', '충남', '충북'],
  '강원권': ['강원'],
  '제주권': ['제주'],
};

/**
 * 주소에서 도시권 판별
 * @param address - "서울 성동구 성수동..." 형식
 * @returns 도시권 지역 배열 (예: ['서울', '인천', '경기'])
 */
export function getCityZone(address: string): string[] {
  for (const [zoneName, regions] of Object.entries(CITY_ZONES)) {
    if (regions.some(region => address.includes(region))) {
      return regions;
    }
  }
  return []; // 매핑 안 되면 빈 배열 (전국으로 처리)
}
```

#### `getTrending` 수정
```typescript
export async function getTrending(
  pool: Pool,
  location?: Location,  // ⭐ location 추가
  excludeIds: Set<string> = new Set(),
  limit: number = 10
): Promise<ScoredEvent[]> {
  
  // location 있으면 도시권 필터링
  let regionFilter = '';
  if (location) {
    // 1. Reverse Geocoding으로 주소 획득 (기존 /geo/reverse API 활용)
    const address = await reverseGeocode(location.lat, location.lng);
    
    // 2. 도시권 판별
    const cityZone = getCityZone(address);
    
    // 3. SQL WHERE 조건 추가
    if (cityZone.length > 0) {
      const regionList = cityZone.map(r => `'${r}'`).join(',');
      regionFilter = `AND address LIKE ANY(ARRAY[${cityZone.map(r => `'%${r}%'`).join(',')}])`;
    }
  }
  
  // 쿼리 실행
  const query = `
    SELECT * FROM canonical_events
    WHERE end_at >= NOW() AND is_deleted = false
      ${regionFilter}  -- ⭐ 도시권 필터
    ORDER BY buzz_score DESC, id ASC
    LIMIT ${limit}
  `;
  
  // ...
}
```

#### 주의사항
- Reverse Geocoding은 **백엔드의 기존 `/geo/reverse` 엔드포인트 재사용**
- location 없으면 전국 조회 (기존 동작 유지)

---

### Task 4: 폴백 2단계 단순화

#### 목표
buzz_score = 0일 때 복잡한 점수 계산 제거 → 그룹 기반 정렬

#### 기존 문제점
```typescript
// 기존 (복잡함)
CASE 
  WHEN buzz_score > 0 THEN buzz_score
  WHEN buzz_score = 0 AND (end_at - NOW()) <= INTERVAL '7 days'
  THEN 500 + (7 - EXTRACT(DAY FROM (end_at - NOW()))) * 50  // 🤔 뭔 뜻?
  // ...
END AS trend_score
```

#### 개선 방향
```typescript
// 2단계 폴백: 그룹 → 정렬
// 1단계: buzz_score > 0
SELECT * FROM canonical_events
WHERE buzz_score > 0
ORDER BY buzz_score DESC, id ASC

// 2단계: buzz_score = 0
SELECT *,
  CASE
    WHEN (end_at - NOW()) <= INTERVAL '3 days' THEN 'deadline'
    WHEN (NOW() - created_at) <= INTERVAL '3 days' THEN 'fresh'
    ELSE 'normal'
  END AS fallback_group
FROM canonical_events
WHERE buzz_score = 0
ORDER BY
  CASE fallback_group
    WHEN 'deadline' THEN 1
    WHEN 'fresh' THEN 2
    ELSE 3
  END,
  end_at ASC,      -- deadline 그룹: 마감 임박순
  created_at DESC, -- fresh 그룹: 최신순
  id ASC
```

#### 구현 요구사항
1. `getTrending` 수정:
   - buzz_score > 0: 기존 로직
   - buzz_score = 0: 그룹 기반 정렬

2. `reason` 라벨:
   - buzz_score > 0: `['인기 급상승']`
   - deadline: `['마감 임박', 'D-3']`
   - fresh: `['새로 등록']`
   - normal: `['추천']`

3. 외부 크롤링 코드 제거 (MVP 단계)

---

## 제약 사항 (Hard Rules) ⚠️

### Fairpick 프로젝트 규칙
1. **추측 금지**: 반드시 실제 코드/파일 기반으로만 작업
2. **언어**: 모든 주석과 설명은 **한국어**로 작성
3. **Toss MiniApp 환경**: localStorage/window/DOM API **절대 사용 금지**

### 데이터베이스 규칙
- 테이블: `canonical_events` 사용 (events 테이블 사용 금지)
- 필수 컬럼 확인: `lat`, `lng`, `address`, `buzz_score`

### 코딩 규칙
- TypeScript strict mode
- 모든 SQL 쿼리는 Parameterized Query 사용 (SQL Injection 방지)
- 에러 핸들링 필수

---

## 작업 순서

1. **파일 읽기**:
   - `/Users/kimsungtae/toss/fairpick-app/backend/src/lib/recommender.ts`

2. **Task 1 구현**:
   - `buildDistanceFilter` 헬퍼 함수 생성
   - `DISTANCE_LIMITS` 상수 정의

3. **Task 2 구현**:
   - 각 함수별로 거리 제한 적용

4. **Task 3 구현**:
   - `cityZones.ts` 파일 생성
   - `getTrending` 수정

5. **Task 4 구현**:
   - `getTrending` 폴백 로직 단순화

6. **검증**:
   - 코드 리뷰
   - 변경사항 요약

---

## 검증 기준

### 기능 검증
- [ ] **성수동(37.5444, 127.0557)에서 `getTodaysPick` 호출 시**:
  - 10km 이내 이벤트만 반환
  - 광주 이벤트(300km) 제외

- [ ] **각 섹션의 거리 제한**:
  - 내 주변: 5km 이내만
  - 오늘의 추천: 10km 이내만
  - 이번 주말: 20km 이내만
  - 새로 올라왔어요: 20km 이내만

- [ ] **buzz_score = 0인 이벤트**:
  - 마감 임박 → 최상위
  - 신규 등록 → 그 다음
  - 의미있게 정렬됨

- [ ] **location 없을 때**:
  - 전국 조회 (기존 동작 유지)

### 코드 품질
- [ ] 주석 모두 한국어
- [ ] SQL Injection 방지
- [ ] 에러 핸들링 존재
- [ ] 가독성 및 유지보수성

---

## 참고 자료

### 기존 Haversine 공식
```typescript
// recommender.ts:192-203
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // 지구 반지름 (km)
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
```

### SQL 버전 (참고용)
```sql
-- WHERE 절에서 사용
(6371 * acos(
  cos(radians($1)) * cos(radians(lat)) * 
  cos(radians(lng) - radians($2)) + 
  sin(radians($1)) * sin(radians(lat))
)) <= 10
```

---

## 예상 결과

### 변경 전
```typescript
// 성수동에서 호출
const result = await getTodaysPick(pool, userId, { lat: 37.5444, lng: 127.0557 });
// result: "광주 이벤트" (300km) ← 비현실적!
```

### 변경 후
```typescript
// 성수동에서 호출
const result = await getTodaysPick(pool, userId, { lat: 37.5444, lng: 127.0557 });
// result: "성수동 이벤트" (2km) ← 현실적!
```

---

**시작해주세요!**

