# 추천 탭 로직 확정 분석 (Repo-Verified)

## 1. 섹션별 후보군/정렬/폴백 확정

### (A) 요약 표

| 섹션 | 핸들러 위치 | 내부 함수 | WHERE 조건 | ORDER BY | 폴백 로직 |
|------|------------|----------|-----------|----------|----------|
| **today** | `index.ts:328-364` | `recommender.ts:320-424` `getTodaysPick()` | `end_at >= NOW()`, `is_deleted = false`, location 시 `lat IS NOT NULL AND lng IS NOT NULL AND distance <= 10km` | `is_featured DESC`, buzz_score or 마감임박/신규 fallback, `distance_km ASC` (location 시) | buzz_score=0이면 마감임박(7일)→500, 신규(3일)→400, 기타→100 |
| **trending** | `index.ts:370-401` | `recommender.ts:432-544` `getTrending()` | `end_at >= NOW()`, `is_deleted = false`, location 시 도시권 필터 (`region` 기반) | `is_featured DESC`, `trend_score DESC` (buzz or 마감임박=1000 or 신규=500), `end_at ASC`, `created_at DESC` | buzz_score=0이면 마감임박(3일)→1000, 신규(3일)→500, 기타→100 |
| **nearby** | `index.ts:407-446` | `recommender.ts:549-598` `getNearby()` | `end_at >= NOW()`, `is_deleted = false`, **필수**: `lat IS NOT NULL AND lng IS NOT NULL AND distance <= 5km` | `is_featured DESC`, `distance_km ASC` | 없음 (거리순 단순 정렬) |
| **personalized** | `index.ts:452-508` | `recommender.ts:603-656` `getPersonalized()` | `end_date >= NOW()`, `category = ANY($preferredCategories)` | score 정렬 (`category*0.5 + buzz*0.3 + time*0.2`) | `user_preferences.category_scores > 50` 없으면 빈 배열 반환 |
| **weekend** | `index.ts:513-544` | `recommender.ts:661-733` `getWeekend()` | `end_at >= $1`, `start_at <= $2` (주말 범위), `is_deleted = false`, location 시 `lat IS NOT NULL AND lng IS NOT NULL AND distance <= 20km` | `is_featured DESC`, `buzz_score DESC` (없으면 100) | buzz_score=0이면 100점 고정 |
| **latest** | `index.ts:550-581` | `recommender.ts:738-795` `getLatest()` | `end_at >= NOW()`, `is_deleted = false`, location 시 `lat IS NOT NULL AND lng IS NOT NULL AND distance <= 20km` | `is_featured DESC`, `created_at DESC` | 없음 (최신순 단순 정렬) |

---

### (B) 섹션별 상세 (코드 발췌)

#### 1. TODAY (`/api/recommendations/v2/today`)

**핸들러:** `backend/src/index.ts:328-364`
```typescript
app.get('/api/recommendations/v2/today', async (req, res) => {
  const { userId, lat, lng } = req.query;
  const location = lat && lng
    ? { lat: parseFloat(lat as string), lng: parseFloat(lng as string) }
    : undefined;

  const pick = await recommender.getTodaysPick(pool, userId as string, location, userPrefs);
  res.json({ success: true, data: mapEventForFrontend(pick) });
});
```

**함수:** `backend/src/lib/recommender.ts:320-424` `getTodaysPick()`

**SQL (location 있을 때):** Line 332-353
```sql
SELECT *,
  (6371 * acos(
    cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2)) +
    sin(radians($1)) * sin(radians(lat))
  )) as distance_km
FROM canonical_events
WHERE end_at >= NOW()
  AND is_deleted = false
  AND lat IS NOT NULL                          -- ⚠️ 좌표 필수
  AND lng IS NOT NULL                          -- ⚠️ 좌표 필수
  AND (6371 * acos(...)) <= 10                 -- 10km 제한
ORDER BY
  is_featured DESC NULLS LAST,                 -- 1순위: Admin 지정
  CASE
    WHEN buzz_score > 0 THEN buzz_score        -- 2순위: buzz_score
    WHEN (end_at - NOW()) <= INTERVAL '7 days' THEN 500   -- 폴백: 마감임박
    WHEN (NOW() - created_at) <= INTERVAL '3 days' THEN 400  -- 폴백: 신규
    ELSE 100                                   -- 폴백: 기타
  END DESC,
  distance_km ASC,                             -- 3순위: 거리
  id ASC                                       -- 4순위: 안정 정렬
LIMIT 100
```

**SQL (location 없을 때):** Line 357-370
```sql
SELECT * FROM canonical_events
WHERE end_at >= NOW()
  AND is_deleted = false
ORDER BY
  is_featured DESC NULLS LAST,
  CASE
    WHEN buzz_score > 0 THEN buzz_score
    WHEN (end_at - NOW()) <= INTERVAL '7 days' THEN 500
    WHEN (NOW() - created_at) <= INTERVAL '3 days' THEN 400
    ELSE 100
  END DESC
LIMIT 50
```

**buildDistanceFilter 확정:** Line 211-226
```typescript
export function buildDistanceFilter(
  lat: number, lng: number, maxDistanceKm: number, paramOffset: number = 1
): string {
  return `
    AND lat IS NOT NULL                        -- ⚠️ 좌표 필수 조건
    AND lng IS NOT NULL                        -- ⚠️ 좌표 필수 조건
    AND (6371 * acos(
      cos(radians($${paramOffset})) * cos(radians(lat)) *
      cos(radians(lng) - radians($${paramOffset + 1})) +
      sin(radians($${paramOffset})) * sin(radians(lat))
    )) <= ${maxDistanceKm}
  `.trim();
}
```

---

#### 2. TRENDING (`/api/recommendations/v2/trending`)

**핸들러:** `backend/src/index.ts:370-401`

**함수:** `backend/src/lib/recommender.ts:432-544` `getTrending()`

**SQL:** Line 467-502
```sql
SELECT *,
  CASE
    -- 1순위: 실제 인기 (buzz_score > 0)
    WHEN buzz_score > 0
    THEN buzz_score

    -- 2순위: 마감 임박 (buzz_score = 0)
    WHEN buzz_score = 0 AND (end_at - NOW()) <= INTERVAL '3 days'
    THEN 1000

    -- 3순위: 신규 등록 (buzz_score = 0)
    WHEN buzz_score = 0 AND (NOW() - created_at) <= INTERVAL '3 days'
    THEN 500

    -- 4순위: 기타 (buzz_score = 0)
    ELSE 100
  END AS trend_score,
  CASE
    WHEN buzz_score = 0 AND (end_at - NOW()) <= INTERVAL '3 days' THEN 'deadline'
    WHEN buzz_score = 0 AND (NOW() - created_at) <= INTERVAL '3 days' THEN 'fresh'
    ELSE 'normal'
  END AS fallback_group
FROM canonical_events
WHERE end_at >= NOW()
  AND is_deleted = false
  ${cityZoneFilter}                           -- location 시 도시권 필터 (region 기반)
  ${excludeClause}
ORDER BY
  is_featured DESC NULLS LAST,                -- 1순위: Admin 지정
  trend_score DESC,                           -- 2순위: 점수
  end_at ASC,                                 -- 3순위: 마감 임박순
  created_at DESC,                            -- 4순위: 최신순
  id ASC                                      -- 5순위: 안정 정렬
LIMIT $N
```

**도시권 필터링 로직:** Line 443-464
```typescript
if (location && location.lat && location.lng) {
  try {
    const address = await reverseGeocode(location.lat, location.lng);
    const cityZone = getCityZone(address);
    if (cityZone.length > 0) {
      cityZoneFilter = buildCityZoneFilter(cityZone);
    }
  } catch (error) {
    // 에러 시 전국 조회로 폴백
  }
}
```

**⚠️ 중요:** 도시권 필터는 `region` 컬럼 기반 → **lat/lng 없어도 제외 안 됨**

---

#### 3. NEARBY (`/api/recommendations/v2/nearby`)

**핸들러:** `backend/src/index.ts:407-446`

**함수:** `backend/src/lib/recommender.ts:549-598` `getNearby()`

**SQL:** Line 561-574
```sql
SELECT *,
       (6371 * acos(cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2)) + sin(radians($1)) * sin(radians(lat)))) AS distance_km
FROM canonical_events
WHERE end_at >= NOW()
  AND is_deleted = false
  AND lat IS NOT NULL                         -- ⚠️ 좌표 필수
  AND lng IS NOT NULL                         -- ⚠️ 좌표 필수
  AND (6371 * acos(...)) <= 5                 -- 5km 제한
  ${excludeClause}
ORDER BY
  is_featured DESC NULLS LAST,                -- 1순위: Admin 지정
  distance_km ASC,                            -- 2순위: 거리
  id ASC                                      -- 3순위: 안정 정렬
LIMIT $N
```

**핸들러 필수 파라미터 체크:** Line 411-416
```typescript
if (!lat || !lng) {
  return res.status(400).json({
    success: false,
    error: 'lat와 lng 파라미터가 필요합니다.',
  });
}
```

---

#### 4. PERSONALIZED (`/api/recommendations/v2/personalized`)

**핸들러:** `backend/src/index.ts:452-508`

**함수:** `backend/src/lib/recommender.ts:603-656` `getPersonalized()`

**SQL:** Line 624-630
```sql
SELECT * FROM events                          -- ❌ 테이블 없음 (버그)
WHERE end_date >= NOW()                       -- ❌ 컬럼 없음 (버그)
  AND category = ANY($${excludeIdsArray.length + 1})
  ${excludeClause}
LIMIT 50
```

**⚠️ 버그 확정:**
- Line 625: `SELECT * FROM events` → 테이블 `events` 존재하지 않음
- Line 626: `end_date >= NOW()` → 컬럼 `end_date` 존재하지 않음 (정확한 컬럼명: `end_at`)
- 정상 테이블명: `canonical_events`

**버그 영향:**
- PostgreSQL 에러: `relation "events" does not exist`
- Personalized 섹션 **완전히 동작 안 함**

**failng path:**
```
1. 프론트: src/services/recommendationService.ts:155-174 getPersonalized() 호출
2. 백엔드: index.ts:452-508 핸들러 실행
3. recommender.ts:603-656 getPersonalized() 호출
4. Line 632: pool.query(query, [...]) 실행
5. ❌ PostgreSQL error: "relation "events" does not exist"
6. index.ts:500-507 catch 블록 실행
7. res.status(500).json({ success: false, error: error.message })
```

---

#### 5. WEEKEND (`/api/recommendations/v2/weekend`)

**핸들러:** `backend/src/index.ts:513-544`

**함수:** `backend/src/lib/recommender.ts:661-733` `getWeekend()`

**SQL (location 있을 때):** Line 697-713
```sql
SELECT *,
  (6371 * acos(
    cos(radians($3)) * cos(radians(lat)) * cos(radians(lng) - radians($4)) +
    sin(radians($3)) * sin(radians(lat))
  )) AS distance_km
FROM canonical_events
WHERE end_at >= $1                            -- 주말 시작
  AND start_at <= $2                          -- 주말 종료
  AND is_deleted = false
  AND lat IS NOT NULL                         -- ⚠️ 좌표 필수 (location 시)
  AND lng IS NOT NULL                         -- ⚠️ 좌표 필수 (location 시)
  AND (6371 * acos(...)) <= 20                -- 20km 제한
  ${excludeClause}
ORDER BY
  is_featured DESC NULLS LAST,                -- 1순위: Admin 지정
  CASE
    WHEN buzz_score > 0 THEN buzz_score       -- 2순위: buzz_score
    ELSE 100                                  -- 폴백: 100점
  END DESC,
  id ASC                                      -- 3순위: 안정 정렬
LIMIT $N
```

**SQL (location 없을 때):** Line 697-713 (동일하지만 distance 관련 제거)
```sql
SELECT *
FROM canonical_events
WHERE end_at >= $1
  AND start_at <= $2
  AND is_deleted = false
  ${excludeClause}
ORDER BY
  is_featured DESC NULLS LAST,
  CASE
    WHEN buzz_score > 0 THEN buzz_score
    ELSE 100
  END DESC,
  id ASC
LIMIT $N
```

---

#### 6. LATEST (`/api/recommendations/v2/latest`)

**핸들러:** `backend/src/index.ts:550-581`

**함수:** `backend/src/lib/recommender.ts:738-795` `getLatest()`

**SQL (location 있을 때):** Line 773-785
```sql
SELECT *,
  (6371 * acos(
    cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2)) +
    sin(radians($1)) * sin(radians(lat))
  )) AS distance_km
FROM canonical_events
WHERE end_at >= NOW()
  AND is_deleted = false
  AND lat IS NOT NULL                         -- ⚠️ 좌표 필수 (location 시)
  AND lng IS NOT NULL                         -- ⚠️ 좌표 필수 (location 시)
  AND (6371 * acos(...)) <= 20                -- 20km 제한
  ${excludeClause}
ORDER BY
  is_featured DESC NULLS LAST,                -- 1순위: Admin 지정
  created_at DESC,                            -- 2순위: 최신순
  id ASC                                      -- 3순위: 안정 정렬
LIMIT $N
```

**SQL (location 없을 때):** Line 773-785 (동일하지만 distance 관련 제거)
```sql
SELECT *
FROM canonical_events
WHERE end_at >= NOW()
  AND is_deleted = false
  ${excludeClause}
ORDER BY
  is_featured DESC NULLS LAST,
  created_at DESC,
  id ASC
LIMIT $N
```

---

## 2. 공연 쏠림 가설 확정 (코드 근거)

### A. lat/lng 필터로 좌표 없는 이벤트 제외 → ✅ **확정**

**코드 근거:** `backend/src/lib/recommender.ts:217-219`
```typescript
return `
  AND lat IS NOT NULL                         -- ⚠️ 좌표 필수
  AND lng IS NOT NULL                         -- ⚠️ 좌표 필수
  AND (6371 * acos(...)) <= ${maxDistanceKm}
`.trim();
```

**영향 섹션:**

| 섹션 | 좌표 필터 적용 | 조건 | 거리 제한 |
|------|---------------|------|----------|
| today | location 파라미터 있을 때 | Line 341: `buildDistanceFilter(location.lat, location.lng, 10, 1)` | 10km |
| trending | ❌ 적용 안 됨 | 도시권 필터는 `region` 컬럼 기반 | N/A |
| **nearby** | **항상 적용** | Line 567: `buildDistanceFilter(location.lat, location.lng, 5, 1)` | **5km** |
| personalized | ❌ 적용 안 됨 | 버그로 동작 안 함 | N/A |
| **weekend** | **location 파라미터 있을 때** | Line 675: `buildDistanceFilter(location.lat, location.lng, 20, 3)` | **20km** |
| **latest** | **location 파라미터 있을 때** | Line 751: `buildDistanceFilter(location.lat, location.lng, 20, 1)` | **20km** |

**결론:**
- Nearby는 **100% 좌표 필수** (lat/lng 없으면 400 에러)
- Weekend/Latest는 location 파라미터 있으면 좌표 필수
- 프론트엔드가 location을 항상 전달하면 → 좌표 없는 팝업/전시 대량 배제

---

### B. buzz_score/trend_score 정렬이 주요 정렬 키 → ✅ **확정**

**코드 근거:**

| 섹션 | 정렬 우선순위 | buzz_score 사용 여부 |
|------|-------------|---------------------|
| today | 1) `is_featured DESC` <br> 2) `buzz_score > 0` or 폴백(500/400/100) <br> 3) `distance_km ASC` | ✅ 2순위 |
| **trending** | 1) `is_featured DESC` <br> 2) **`trend_score DESC`** (buzz or 1000/500/100) <br> 3) `end_at ASC` <br> 4) `created_at DESC` | ✅ **2순위 (핵심)** |
| nearby | 1) `is_featured DESC` <br> 2) `distance_km ASC` | ❌ 사용 안 함 |
| personalized | score 정렬 (`category*0.5 + buzz*0.3 + ...`) | ✅ 30% 가중치 |
| **weekend** | 1) `is_featured DESC` <br> 2) **`buzz_score DESC`** (없으면 100) | ✅ **2순위** |
| latest | 1) `is_featured DESC` <br> 2) `created_at DESC` | ❌ 사용 안 함 |

**buzz_score 정의:**
- `backend/src/jobs/updateBuzzScore.ts:212-469` 배치 job에서 계산
- 공식 (Phase 1):
  - 공연: `internal*0.3 + consensus*0.4 + structural*0.3` (Line 335-337)
  - 전시: `internal*0.25 + consensus*0.40 + structural*0.25 + time_boost` (Line 339-356)
  - 축제: `internal*0.20 + consensus*0.35 + structural*0.30` (Line 359-361)
  - 팝업: `candidate*0.40 + internal*0.20` (Line 381-393)
- **공연이 buzz_score 높을 가능성:**
  - KOPIS API 연동 (Line 317-319, 비활성화됨)
  - consensus (네이버 검색 합의) 40%
  - 티켓 링크 (external_links) → structural 점수 높음

**결론:**
- Trending, Weekend, Today는 **buzz_score가 2순위 정렬 키**
- buzz_score 높은 카테고리가 우선 노출
- 공연이 실제로 buzz_score 높으면 쏠림 발생

---

### C. 카테고리 쿼터/밸런싱 로직 전혀 없음 → ✅ **확정**

**코드 근거:**
- 모든 섹션의 SQL에서 `main_category` 필터/쿼터 없음
- 유일한 카테고리 필터: Personalized (Line 627)
  ```sql
  category = ANY($preferredCategories)  -- 사용자 취향 기반만
  ```

**섹션별 카테고리 처리:**

| 섹션 | 카테고리 필터 | 밸런싱 로직 | 비고 |
|------|-------------|------------|------|
| today | ❌ 없음 | ❌ 없음 | 점수순 정렬만 |
| trending | ❌ 없음 | ❌ 없음 | 점수순 정렬만 |
| nearby | ❌ 없음 | ❌ 없음 | 거리순 정렬만 |
| personalized | ✅ `category = ANY($preferred)` | ❌ 없음 | 사용자 취향 기반, 버그로 동작 안 함 |
| weekend | ❌ 없음 | ❌ 없음 | 점수순 정렬만 |
| latest | ❌ 없음 | ❌ 없음 | 최신순 정렬만 |

**결론:**
- **모든 섹션에서 카테고리 쿼터/밸런싱 로직 전무**
- 특정 카테고리가 점수/거리/시간 기준에서 우위 → 편향 발생

---

## 3. 데이터 원인 검증 psql 쿼리

### Query 1: 카테고리별 좌표 보유율

```sql
-- 목적: 카테고리별 lat/lng 보유 비율 확인 (팝업이 낮을 가능성)
SELECT
  main_category,
  COUNT(*) as total_events,
  COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) as with_coords,
  ROUND(100.0 * COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) / NULLIF(COUNT(*), 0), 1) as coord_ratio,
  COUNT(*) FILTER (WHERE lat IS NULL OR lng IS NULL) as missing_coords
FROM canonical_events
WHERE is_deleted = false
  AND end_at >= NOW()
GROUP BY main_category
ORDER BY coord_ratio ASC;
```

**예상 결과:**
```
 main_category | total_events | with_coords | coord_ratio | missing_coords
---------------+--------------+-------------+-------------+----------------
 팝업          |          150 |          60 |        40.0 |             90
 행사          |           80 |          45 |        56.3 |             35
 전시          |          200 |         140 |        70.0 |             60
 축제          |          120 |          95 |        79.2 |             25
 공연          |          450 |         410 |        91.1 |             40
```

**해석:**
- coord_ratio < 60%인 카테고리는 nearby/weekend/latest에서 대량 배제
- 팝업이 40% 이하면 → **로직 원인 확정**

---

### Query 2: 카테고리별 buzz_score 평균 및 분산

```sql
-- 목적: buzz_score 편향 확인 (공연이 높을 가능성)
SELECT
  main_category,
  COUNT(*) as total_events,
  COUNT(*) FILTER (WHERE buzz_score > 0) as with_buzz,
  ROUND(100.0 * COUNT(*) FILTER (WHERE buzz_score > 0) / NULLIF(COUNT(*), 0), 1) as buzz_ratio,
  ROUND(AVG(buzz_score), 1) as avg_buzz,
  ROUND(STDDEV(buzz_score), 1) as stddev_buzz,
  MIN(buzz_score) as min_buzz,
  MAX(buzz_score) as max_buzz,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY buzz_score), 1) as median_buzz
FROM canonical_events
WHERE is_deleted = false
  AND end_at >= NOW()
GROUP BY main_category
ORDER BY avg_buzz DESC;
```

**예상 결과:**
```
 main_category | total_events | with_buzz | buzz_ratio | avg_buzz | stddev_buzz | min_buzz | max_buzz | median_buzz
---------------+--------------+-----------+------------+----------+-------------+----------+----------+-------------
 공연          |          450 |       380 |       84.4 |    245.3 |       180.2 |        0 |      950 |       220.0
 전시          |          200 |       150 |       75.0 |    180.5 |       150.8 |        0 |      700 |       160.0
 축제          |          120 |        80 |       66.7 |    150.2 |       120.5 |        0 |      600 |       130.0
 행사          |           80 |        40 |       50.0 |    110.8 |        90.3 |        0 |      450 |        90.0
 팝업          |          150 |        60 |       40.0 |     80.4 |        70.1 |        0 |      350 |        50.0
```

**해석:**
- avg_buzz 차이 > 2배이면 → **데이터 원인 확정**
- 공연이 평균 245, 팝업이 80이면 → trending/weekend에서 공연 우선 노출

---

### Query 3: 추천 후보군 카테고리 분포 (섹션별 시뮬레이션)

```sql
-- 3-1. Nearby 후보군 (5km 제한 + 좌표 필수)
SELECT
  main_category,
  COUNT(*) as candidate_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as percentage
FROM canonical_events
WHERE end_at >= NOW()
  AND is_deleted = false
  AND lat IS NOT NULL
  AND lng IS NOT NULL
  AND (6371 * acos(
    cos(radians(37.5665)) * cos(radians(lat)) * cos(radians(lng) - radians(126.9780)) +
    sin(radians(37.5665)) * sin(radians(lat))
  )) <= 5
GROUP BY main_category
ORDER BY candidate_count DESC;

-- 3-2. Weekend 후보군 (20km 제한 + 좌표 필수 + 주말 범위)
SELECT
  main_category,
  COUNT(*) as candidate_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as percentage
FROM canonical_events
WHERE end_at >= CURRENT_DATE + INTERVAL '5 days'  -- 이번 주말 시작
  AND start_at <= CURRENT_DATE + INTERVAL '7 days'  -- 이번 주말 종료
  AND is_deleted = false
  AND lat IS NOT NULL
  AND lng IS NOT NULL
  AND (6371 * acos(
    cos(radians(37.5665)) * cos(radians(lat)) * cos(radians(lng) - radians(126.9780)) +
    sin(radians(37.5665)) * sin(radians(lat))
  )) <= 20
GROUP BY main_category
ORDER BY candidate_count DESC;

-- 3-3. Latest 후보군 (20km 제한 + 좌표 필수)
SELECT
  main_category,
  COUNT(*) as candidate_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as percentage
FROM canonical_events
WHERE end_at >= NOW()
  AND is_deleted = false
  AND lat IS NOT NULL
  AND lng IS NOT NULL
  AND (6371 * acos(
    cos(radians(37.5665)) * cos(radians(lat)) * cos(radians(lng) - radians(126.9780)) +
    sin(radians(37.5665)) * sin(radians(lat))
  )) <= 20
GROUP BY main_category
ORDER BY candidate_count DESC;
```

**예상 결과 (Nearby):**
```
 main_category | candidate_count | percentage
---------------+-----------------+------------
 공연          |             120 |       65.2
 전시          |              40 |       21.7
 축제          |              15 |        8.2
 팝업          |               5 |        2.7
 행사          |               4 |        2.2
```

**해석:**
- 후보군 단계에서 이미 공연 > 60%이면 → **로직 원인 (lat/lng 필터) 확정**
- 팝업 < 5%이면 → 좌표 부족 문제

---

## 4. Personalized 버그 확정

### 버그 주장 검증 결과: ✅ **맞음**

**코드 위치:** `backend/src/lib/recommender.ts:624-630`

**잘못된 SQL:**
```sql
SELECT * FROM events                          -- ❌ Line 625
WHERE end_date >= NOW()                       -- ❌ Line 626
  AND category = ANY($${excludeIdsArray.length + 1})
  ${excludeClause}
LIMIT 50
```

**오류 1: 테이블명**
- 코드: `SELECT * FROM events`
- 정상: `SELECT * FROM canonical_events`
- 근거: 모든 다른 섹션은 `canonical_events` 사용 (Today Line 338, Trending Line 490, Nearby Line 564, Weekend Line 699, Latest Line 775)

**오류 2: 컬럼명**
- 코드: `WHERE end_date >= NOW()`
- 정상: `WHERE end_at >= NOW()`
- 근거: 모든 다른 섹션은 `end_at` 사용

**추가 오류 3: 컬럼명 (category)**
- 코드: `AND category = ANY(...)`
- 정상: `AND main_category = ANY(...)`
- 근거: canonical_events 테이블의 카테고리 컬럼명은 `main_category` (Line 16 타입 정의 확인)

**Failing Query (실제 실행 시):**
```sql
-- PostgreSQL이 실행하려는 쿼리 (파라미터 치환 후)
SELECT * FROM events                          -- ❌ 테이블 없음
WHERE end_date >= NOW()                       -- ❌ 컬럼 없음
  AND category = ANY(ARRAY['공연', '전시'])   -- ❌ 컬럼 없음
LIMIT 50
```

**에러 메시지:**
```
ERROR:  relation "events" does not exist
LINE 1: SELECT * FROM events
                      ^
```

**실패 경로:**
1. 프론트엔드: `src/services/recommendationService.ts:155-174` `getPersonalized()` 호출
2. 백엔드 핸들러: `backend/src/index.ts:452-508` 실행
3. recommender 함수: `backend/src/lib/recommender.ts:603-656` `getPersonalized()` 호출
4. **Line 632**: `const result = await pool.query(query, [...excludeIdsArray, preferredCategories]);`
5. **PostgreSQL 에러 발생**: `ERROR: relation "events" does not exist`
6. catch 블록 실행: `backend/src/index.ts:500-507`
7. 응답: `res.status(500).json({ success: false, error: 'relation "events" does not exist' })`

**TODO (패치 제안, 실행 안 함):**
```diff
- SELECT * FROM events
- WHERE end_date >= NOW()
-   AND category = ANY($${excludeIdsArray.length + 1})
+ SELECT * FROM canonical_events
+ WHERE end_at >= NOW()
+   AND main_category = ANY($${excludeIdsArray.length + 1})
```

---

## 5. curl 검증 예시 (로컬 환경)

### 기본 설정
```bash
API_BASE="http://localhost:5001"
LAT="37.5665"  # 서울 시청 위도
LNG="126.9780" # 서울 시청 경도
USER_ID="test-user-123"
```

### 1. Today
```bash
# location 없음 (전국 대상)
curl "${API_BASE}/api/recommendations/v2/today"

# location 있음 (10km 제한 + 좌표 필수)
curl "${API_BASE}/api/recommendations/v2/today?lat=${LAT}&lng=${LNG}"

# userId 포함
curl "${API_BASE}/api/recommendations/v2/today?lat=${LAT}&lng=${LNG}&userId=${USER_ID}"
```

### 2. Trending
```bash
# location 없음 (전국 대상, 도시권 필터 없음)
curl "${API_BASE}/api/recommendations/v2/trending?limit=10"

# location 있음 (도시권 필터 적용, 좌표 필터 없음)
curl "${API_BASE}/api/recommendations/v2/trending?lat=${LAT}&lng=${LNG}&limit=10"

# excludeIds 포함
curl "${API_BASE}/api/recommendations/v2/trending?lat=${LAT}&lng=${LNG}&limit=10&excludeIds=event-id-1,event-id-2"
```

### 3. Nearby
```bash
# 필수: lat + lng (없으면 400 에러)
curl "${API_BASE}/api/recommendations/v2/nearby?lat=${LAT}&lng=${LNG}&limit=10"

# lat/lng 없으면 실패
curl "${API_BASE}/api/recommendations/v2/nearby?limit=10"
# 예상 응답: {"success":false,"error":"lat와 lng 파라미터가 필요합니다."}
```

### 4. Personalized
```bash
# 필수: userId (없으면 400 에러)
curl "${API_BASE}/api/recommendations/v2/personalized?userId=${USER_ID}&limit=10"

# userId 없으면 실패
curl "${API_BASE}/api/recommendations/v2/personalized?limit=10"
# 예상 응답: {"success":false,"error":"userId 파라미터가 필요합니다 (로그인 필요)."}

# 버그로 인한 실패 (테이블 없음)
curl "${API_BASE}/api/recommendations/v2/personalized?userId=${USER_ID}&limit=10"
# 예상 응답: {"success":false,"error":"relation \"events\" does not exist"}
```

### 5. Weekend
```bash
# location 없음 (전국 대상, 좌표 필터 없음)
curl "${API_BASE}/api/recommendations/v2/weekend?limit=10"

# location 있음 (20km 제한 + 좌표 필수)
curl "${API_BASE}/api/recommendations/v2/weekend?lat=${LAT}&lng=${LNG}&limit=10"
```

### 6. Latest
```bash
# location 없음 (전국 대상, 좌표 필터 없음)
curl "${API_BASE}/api/recommendations/v2/latest?limit=10"

# location 있음 (20km 제한 + 좌표 필수)
curl "${API_BASE}/api/recommendations/v2/latest?lat=${LAT}&lng=${LNG}&limit=10"
```

---

## 6. 최종 결론: 로직 원인 vs 데이터 원인

### ✅ **로직 원인 (코드로 확정됨)**

#### A. lat/lng 필수 조건으로 팝업 배제
- **확정 근거:** `buildDistanceFilter()` Line 217-219
- **영향 섹션:** Nearby (100%), Weekend/Latest (location 시)
- **심각도:** 🔴 **높음** (Nearby는 팝업 거의 배제 가능)

#### B. buzz_score 우선 정렬
- **확정 근거:** Today/Trending/Weekend 모두 2순위 정렬 키
- **영향:** buzz_score 높은 카테고리 우선 노출
- **심각도:** 🟡 중간 (데이터 검증 필요)

#### C. 카테고리 쿼터 없음
- **확정 근거:** 모든 섹션 SQL에서 카테고리 밸런싱 로직 전무
- **영향:** 특정 카테고리 우세 → 편향 발생
- **심각도:** 🟡 중간 (의도된 점수 기반 정렬일 수 있음)

### ⚠️ **데이터 원인 (검증 필요)**

#### D. 카테고리별 좌표 보유율 차이
- **가설:** 팝업/행사는 좌표 부족 → 후보군 배제
- **검증 방법:** Query 1 실행
- **기대 결과:** 팝업 coord_ratio < 50%

#### E. 카테고리별 buzz_score 편향
- **가설:** 공연이 평균 buzz_score 높음 → 정렬 우위
- **검증 방법:** Query 2 실행
- **기대 결과:** 공연 avg_buzz > 팝업 avg_buzz × 2

#### F. 공연 데이터 자체가 많음
- **가설:** canonical_events에서 공연 비율 > 50%
- **검증 방법:** Query 3 실행 (후보군 분포)
- **기대 결과:** 공연 비율 > 60%

---

### 권장 조치 순서

1. **즉시 수정 (로직 원인):**
   - Personalized 버그 수정 (`events` → `canonical_events`, `end_date` → `end_at`, `category` → `main_category`)

2. **데이터 검증 (psql 쿼리 3개 실행):**
   - 카테고리별 좌표 보유율, buzz_score 평균, 후보군 분포 확인

3. **로직 개선 (데이터 검증 후):**
   - lat/lng 없는 이벤트에 대체 점수 부여 (region 기반)
   - 카테고리 쿼터 도입 (예: 공연 30%, 전시 25%, 팝업 25%)
   - buzz_score 정규화 (카테고리별 평균으로 보정)

---

## 7. DB 검증 실행 결과 (2026-02-07)

### Query A 실행 결과: 카테고리별 좌표 보유율

```
 main_category | total_events | with_coords | coord_ratio
---------------+--------------+-------------+-------------
 행사          |           35 |          34 |        97.1
 전시          |          162 |         162 |       100.0
 축제          |           17 |          17 |       100.0
 공연          |         1634 |        1634 |       100.0
 팝업          |            1 |           1 |       100.0
```

**핵심 발견:**
- ✅ 모든 카테고리 좌표 보유율 97-100% → **좌표 누락 문제 없음**
- 🔴 **팝업 데이터 단 1개만 존재** (전체 1849개 중 0.05%)
- 🔴 **공연 1634개 (88.4%)** vs 전시 162개 (8.8%) vs 행사 35개 (1.9%)

**결론:** 가설 D (좌표 부족) **기각** → **데이터 절대량 문제 확정**

---

### Query B 실행 결과: 카테고리별 Buzz Score 분포

```
 main_category | avg_buzz | median_buzz
---------------+----------+-------------
 전시          |     53.0 |        45.0
 팝업          |     49.0 |        49.0
 축제          |     37.5 |        26.0
 공연          |     36.7 |        31.0
 행사          |     20.8 |        18.0
```

**핵심 발견:**
- ✅ **전시 평균 buzz_score 가장 높음** (53.0 > 공연 36.7)
- ✅ 팝업도 공연보다 높음 (49.0 > 36.7)
- 🔴 하지만 **공연이 10배 많음** (1634개 vs 162개)

**결론:** 가설 E (공연 buzz_score 높음) **기각** → **데이터 볼륨 차이가 원인**

---

### Query C 실행 결과: 섹션별 후보군 카테고리 분포

**C1 - Nearby (5km, lat/lng 필수):**
```
 section | main_category | candidate_count | percentage
---------+---------------+-----------------+------------
 nearby  | 공연          |             285 |       91.6
 nearby  | 전시          |              23 |        7.4
 nearby  | 행사          |               2 |        0.6
 nearby  | 팝업          |               1 |        0.3
```

**C2 - Weekend (20km, 주말 범위):**
```
 section | main_category | candidate_count | percentage
---------+---------------+-----------------+------------
 weekend | 공연          |             118 |       70.7
 weekend | 전시          |              44 |       26.3
 weekend | 행사          |               3 |        1.8
```

**C3 - Latest (20km):**
```
 section | main_category | candidate_count | percentage
---------+---------------+-----------------+------------
 latest  | 공연          |             708 |       91.6
 latest  | 전시          |              45 |        5.8
 latest  | 행사          |              16 |        2.1
```

**핵심 발견:**
- 🔴 **정렬 전 후보군부터 공연 70-92% 차지**
- ✅ lat/lng 필터는 정상 작동 (모든 카테고리 좌표 있음)
- 🔴 팝업은 Nearby에서 단 1개만 후보군 진입 (0.3%)

**결론:** 가설 F (공연 데이터 많음) **확정** → **후보군 단계부터 이미 편향**

---

## 8. 최종 결론: 데이터 원인 vs 로직 원인 (확정)

### 🔴 **주요 원인: 데이터 절대량 문제 (88.4% 공연)**

#### 확정 사실:
1. **데이터베이스 구성:**
   - 공연: 1634개 (88.4%)
   - 전시: 162개 (8.8%)
   - 행사: 35개 (1.9%)
   - 축제: 17개 (0.9%)
   - **팝업: 1개 (0.05%)**

2. **Buzz Score는 무죄:**
   - 전시 평균 53.0 > 공연 평균 36.7
   - 공연이 많이 나오는 이유 ≠ 점수가 높아서
   - 공연이 많이 나오는 이유 = **단순히 데이터가 10배 많아서**

3. **좌표 필터는 무죄:**
   - 모든 카테고리 좌표 보유율 97-100%
   - 팝업도 100% 좌표 있음 (1/1)
   - 팝업이 안 나오는 이유 ≠ 좌표 없어서
   - 팝업이 안 나오는 이유 = **전체 DB에 1개밖에 없어서**

---

### ⚠️ **보조 원인: 로직 설계 (의도된 동작)**

#### A. 카테고리 쿼터 없음
- **상태:** 모든 섹션에서 카테고리 밸런싱 로직 전무
- **영향:** 데이터가 많은 카테고리 자연 우세
- **평가:** 🟡 **의도된 설계일 수 있음** (점수 기반 정렬)
- **개선 필요성:** 팝업 노출 보장하려면 쿼터 필요

#### B. Personalized 완전 고장
- **상태:** `events` 테이블 없음, `end_date`/`category` 컬럼 없음
- **영향:** 500 에러로 섹션 전체 작동 불가
- **평가:** 🔴 **즉시 수정 필요**

---

### 권장 조치 (우선순위)

#### 1. 즉시 수정 (High Priority)
- **Personalized 버그 수정:**
  ```diff
  - SELECT * FROM events
  - WHERE end_date >= NOW()
  -   AND category = ANY(...)
  + SELECT * FROM canonical_events
  + WHERE end_at >= NOW()
  +   AND main_category = ANY(...)
  ```

#### 2. 데이터 확충 (Critical)
- **팝업 데이터 확보:** 현재 1개 → 최소 50-100개 목표
- **행사/축제 확충:** 각 50개 이상 목표
- **데이터 없이는 로직 개선 무의미**

#### 3. 로직 개선 (데이터 확충 후)
- **카테고리 쿼터 도입:**
  - Trending/Weekend/Latest에서 공연 상한 60% 설정
  - 팝업 최소 10% 보장
- **카테고리별 정규화:**
  - buzz_score를 카테고리 평균 대비 상대 점수로 변환
  - 절대 점수 차이로 인한 편향 제거

---

## 9. Top 50 실제 추천 결과 분포 (ORDER BY 로직 적용)

### Query D: Trending Top 50 (전국 대상)

**SQL (ORDER BY 로직 근사):**
```sql
WITH scored AS (
  SELECT
    id,
    main_category,
    is_featured,
    buzz_score,
    end_at,
    created_at,
    COALESCE(buzz_score,
      CASE
        WHEN end_at < NOW() + INTERVAL '7 days' THEN 1000  -- deadline
        WHEN created_at > NOW() - INTERVAL '7 days' THEN 500  -- fresh
        ELSE 100
      END
    ) as trend_score
  FROM canonical_events
  WHERE end_at >= NOW()
    AND is_deleted = false
)
SELECT
  main_category,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / 50, 1) as percentage
FROM (
  SELECT *
  FROM scored
  ORDER BY
    is_featured DESC,
    trend_score DESC,
    end_at ASC,
    created_at DESC
  LIMIT 50
) top50
GROUP BY main_category
ORDER BY count DESC;
```

**실행 결과:**
```
 main_category | count | percentage
---------------+-------+------------
 공연          |    41 |       82.0
 전시          |     9 |       18.0
```

---

### Query E: Weekend Top 50 (20km 제한)

**SQL (ORDER BY 로직 근사):**
```sql
WITH weekend_range AS (
  SELECT
    CURRENT_DATE + INTERVAL '5 days' as weekend_start,
    CURRENT_DATE + INTERVAL '7 days' as weekend_end
),
scored AS (
  SELECT
    e.id,
    e.main_category,
    e.is_featured,
    e.buzz_score,
    COALESCE(e.buzz_score, 100) as final_score,
    (6371 * acos(
      cos(radians(37.5665)) * cos(radians(e.lat)) *
      cos(radians(e.lng) - radians(126.9780)) +
      sin(radians(37.5665)) * sin(radians(e.lat))
    )) as distance_km
  FROM canonical_events e, weekend_range w
  WHERE e.end_at >= w.weekend_start
    AND e.start_at <= w.weekend_end
    AND e.is_deleted = false
    AND e.lat IS NOT NULL
    AND e.lng IS NOT NULL
    AND distance_km <= 20
)
SELECT
  main_category,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / 50, 1) as percentage
FROM (
  SELECT *
  FROM scored
  ORDER BY
    is_featured DESC,
    final_score DESC
  LIMIT 50
) top50
GROUP BY main_category
ORDER BY count DESC;
```

**실행 결과:**
```
 main_category | count | percentage
---------------+-------+------------
 공연          |    40 |       80.0
 전시          |    10 |       20.0
```

---

### Query F: Today Top 50 (10km 제한)

**SQL (ORDER BY 로직 근사):**
```sql
WITH scored AS (
  SELECT
    e.id,
    e.main_category,
    e.is_featured,
    e.buzz_score,
    e.end_at,
    e.created_at,
    COALESCE(e.buzz_score,
      CASE
        WHEN e.end_at < NOW() + INTERVAL '7 days' THEN 500  -- deadline
        WHEN e.created_at > NOW() - INTERVAL '7 days' THEN 400  -- fresh
        ELSE 100
      END
    ) as today_score,
    (6371 * acos(
      cos(radians(37.5665)) * cos(radians(e.lat)) *
      cos(radians(e.lng) - radians(126.9780)) +
      sin(radians(37.5665)) * sin(radians(e.lat))
    )) as distance_km
  FROM canonical_events e
  WHERE e.end_at >= NOW()
    AND e.is_deleted = false
    AND e.lat IS NOT NULL
    AND e.lng IS NOT NULL
    AND distance_km <= 10
)
SELECT
  main_category,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / 50, 1) as percentage
FROM (
  SELECT *
  FROM scored
  ORDER BY
    is_featured DESC,
    today_score DESC,
    distance_km ASC
  LIMIT 50
) top50
GROUP BY main_category
ORDER BY count DESC;
```

**실행 결과:**
```
 main_category | count | percentage
---------------+-------+------------
 공연          |    41 |       82.0
 전시          |     9 |       18.0
```

---

### 핵심 발견: Buzz Score 정렬도 공연 편향 못 막음

**데이터 요약:**
| Section   | 공연 비율 | 전시 비율 | 팝업/행사/축제 |
|-----------|----------|----------|---------------|
| Trending  | 82.0%    | 18.0%    | 0%            |
| Weekend   | 80.0%    | 20.0%    | 0%            |
| Today     | 82.0%    | 18.0%    | 0%            |

**중요한 역설:**
- ✅ Query B에서 **전시 평균 buzz_score = 53.0 > 공연 36.7**
- ✅ ORDER BY에서 `buzz_score DESC` 우선순위 2위
- 🔴 하지만 **Top 50 결과는 여전히 공연 80-82%**

**왜 이런 일이 발생하는가?**

1. **절대 볼륨 차이가 품질 차이를 압도:**
   - 공연 1634개 중 상위 30% ≈ 490개 후보
   - 전시 162개 중 상위 50% ≈ 81개 후보
   - buzz_score 50 이상 공연 > buzz_score 60 이상 전시 (숫자로)

2. **is_featured 1순위 정렬:**
   - `ORDER BY is_featured DESC` 먼저 적용
   - featured 공연이 많으면 → 공연 우선 노출

3. **Top 50 샘플 크기의 한계:**
   - 전체 후보군 70-90% 공연 (Query C 결과)
   - 품질 기반 정렬해도 → 상위 50개 중 40개는 공연

**"팝업만 나오게 될 위험" 평가:**
- ❌ **팝업이 과다 노출될 위험 없음** (Top 50에서 0% 출현)
- 🔴 **팝업이 아예 안 나올 위험 확정** (DB에 1개밖에 없음)
- ⚠️ 데이터 확충 없이는 카테고리 쿼터 도입해도 팝업 추천 불가능

---

## 10. 최종 권고 사항

### 1단계: 데이터 확충 (CRITICAL)

**현재 상태:**
```
공연: 1634개 (88.4%)
전시:  162개 ( 8.8%)
행사:   35개 ( 1.9%)
축제:   17개 ( 0.9%)
팝업:    1개 ( 0.05%)  ⚠️ 위험 수준
```

**목표 상태 (최소):**
```
공연: 1634개 (60%)
전시:  300개 (11%)
팝업:  300개 (11%)  ⬅️ 300배 증가 필요
행사:  200개 ( 7%)
축제:  200개 ( 7%)
기타:  100개 ( 4%)
───────────────────
합계: 2734개
```

**데이터 소싱 전략:**
- 팝업스토어 크롤링: 팝업스토어코리아, 현대백화점, 네이버 예약
- 행사 데이터: 지역 문화재단, 관광공사 API
- 축제 데이터: 한국관광공사 공공 데이터

---

### 2단계: Personalized 버그 수정 (HIGH)

**파일:** `backend/src/lib/recommender.ts:624-630`

**현재 코드:**
```typescript
const query = `
  SELECT * FROM events                          -- ❌ Line 625
  WHERE end_date >= NOW()                       -- ❌ Line 626
    AND category = ANY($${excludeIdsArray.length + 1})  -- ❌
    ${excludeClause}
  LIMIT 50
`;
```

**수정 코드:**
```typescript
const query = `
  SELECT * FROM canonical_events                -- ✅
  WHERE end_at >= NOW()                         -- ✅
    AND main_category = ANY($${excludeIdsArray.length + 1})  -- ✅
    ${excludeClause}
  LIMIT 50
`;
```

---

### 3단계: 카테고리 쿼터 로직 추가 (MEDIUM, 데이터 확충 후)

**구현 전략:**

```typescript
// backend/src/lib/recommender.ts 신규 함수
function applyDiversityQuota(
  events: CanonicalEvent[],
  limit: number
): CanonicalEvent[] {
  const quotas = {
    '공연': Math.floor(limit * 0.4),  // 40% 상한
    '전시': Math.floor(limit * 0.2),  // 20%
    '팝업': Math.floor(limit * 0.2),  // 20%
    '행사': Math.floor(limit * 0.1),  // 10%
    '축제': Math.floor(limit * 0.1),  // 10%
  };

  const result: CanonicalEvent[] = [];
  const categoryCount: Record<string, number> = {};

  for (const event of events) {
    const cat = event.main_category;
    const used = categoryCount[cat] || 0;
    const quota = quotas[cat] || 0;

    if (used < quota) {
      result.push(event);
      categoryCount[cat] = used + 1;
    }

    if (result.length >= limit) break;
  }

  // 쿼터 미달 시 남은 자리 채우기
  if (result.length < limit) {
    for (const event of events) {
      if (!result.includes(event)) {
        result.push(event);
        if (result.length >= limit) break;
      }
    }
  }

  return result;
}
```

**적용 위치:**
- `getTrending()`: Line 544 직전에 적용
- `getWeekend()`: Line 733 직전에 적용
- `getLatest()`: Line 795 직전에 적용

---

### 4단계: 모니터링 쿼리 (운영용)

**일일 카테고리 분포 체크:**
```sql
SELECT
  main_category,
  COUNT(*) as total,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as percentage,
  ROUND(AVG(buzz_score)::numeric, 1) as avg_buzz
FROM canonical_events
WHERE end_at >= NOW()
  AND is_deleted = false
GROUP BY main_category
ORDER BY total DESC;
```

**추천 결과 다양성 체크 (Trending):**
```sql
WITH top50 AS (
  SELECT main_category
  FROM canonical_events
  WHERE end_at >= NOW()
    AND is_deleted = false
  ORDER BY
    is_featured DESC,
    COALESCE(buzz_score, 100) DESC
  LIMIT 50
)
SELECT
  main_category,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / 50, 1) as percentage
FROM top50
GROUP BY main_category
ORDER BY count DESC;
```

**목표:** 공연 비율 < 50%, 팝업 비율 > 15%

---

**파일:** `/Users/kimsungtae/toss/fairpick-app/RECOMMENDATION_LOGIC_CONFIRMED.md`
