# Discovery 탭 추천 로직 분석 (Repo-Verified)

## (A) 섹션별 요약 테이블

| Endpoint | 후보군 조건 | 정렬 기준 | 필수 파라미터 | 반환 Shape | 관련 파일 |
|----------|------------|----------|--------------|-----------|----------|
| `/api/recommendations/v2/today` | `end_at >= NOW()`, `is_deleted = false`, location 있으면 10km 이내 (`lat IS NOT NULL AND lng IS NOT NULL`) | 1) `is_featured DESC` 2) `buzz_score` or 마감임박/신규 fallback 3) `distance_km ASC` (location 시) | `userId` (옵션), `lat` + `lng` (옵션) | `{success, data: ScoredEvent}` (1개) | `backend/src/lib/recommender.ts:320-424`, `backend/src/index.ts:328-364` |
| `/api/recommendations/v2/trending` | `end_at >= NOW()`, `is_deleted = false`, location 있으면 도시권 필터 (예: 서울→수도권) | 1) `is_featured DESC` 2) `trend_score DESC` (buzz_score or 마감임박=1000 or 신규=500) 3) `end_at ASC` 4) `created_at DESC` | `limit` (기본 10), `excludeIds` (옵션), `lat` + `lng` (옵션) | `{success, count, data: ScoredEvent[]}` | `backend/src/lib/recommender.ts:432-544`, `backend/src/index.ts:370-401` |
| `/api/recommendations/v2/nearby` | `end_at >= NOW()`, `is_deleted = false`, **5km 이내** (`lat IS NOT NULL AND lng IS NOT NULL`) | 1) `is_featured DESC` 2) `distance_km ASC` | **필수**: `lat` + `lng`, `limit` (기본 10), `excludeIds` (옵션) | `{success, count, data: ScoredEvent[]}` | `backend/src/lib/recommender.ts:549-598`, `backend/src/index.ts:407-446` |
| `/api/recommendations/v2/personalized` | `end_date >= NOW()`, `category = ANY(preferredCategories)`, `user_preferences.category_scores > 50` | score 기반 정렬 (`category*0.5 + buzz*0.3 + time*0.2`) | **필수**: `userId`, `limit` (기본 10), `excludeIds` (옵션) | `{success, count, data: ScoredEvent[]}` | `backend/src/lib/recommender.ts:603-656`, `backend/src/index.ts:452-508` |
| `/api/recommendations/v2/weekend` | `end_at >= $1`, `start_at <= $2` (주말 범위), `is_deleted = false`, location 있으면 **20km 이내** (`lat IS NOT NULL AND lng IS NOT NULL`) | 1) `is_featured DESC` 2) `buzz_score DESC` (없으면 100) | `limit` (기본 10), `excludeIds` (옵션), `lat` + `lng` (옵션) | `{success, count, data: ScoredEvent[]}` | `backend/src/lib/recommender.ts:661-733`, `backend/src/index.ts:513-544` |
| `/api/recommendations/v2/latest` | `end_at >= NOW()`, `is_deleted = false`, location 있으면 **20km 이내** (`lat IS NOT NULL AND lng IS NOT NULL`) | 1) `is_featured DESC` 2) `created_at DESC` | `limit` (기본 10), `excludeIds` (옵션), `lat` + `lng` (옵션) | `{success, count, data: ScoredEvent[]}` | `backend/src/lib/recommender.ts:738-795`, `backend/src/index.ts:550-581` |

---

## (B) 섹션별 상세 분석

### 1. Today (오늘의 추천)

**파일:** `backend/src/lib/recommender.ts:320-424`

**후보군 필터링:**
- Line 338-341: `end_at >= NOW()`, `is_deleted = false`
- Line 341: location 있으면 `buildDistanceFilter()` → 10km 이내 + `lat IS NOT NULL AND lng IS NOT NULL` (Line 211-226)
- LIMIT: location 있으면 100개, 없으면 50개 (Line 352, 369)

**정렬 기준:**
- Line 343: `is_featured DESC NULLS LAST` (최우선)
- Line 344-348: CASE 문
  - `buzz_score > 0` → buzz_score 값
  - 마감 임박 (7일 이내) → 500
  - 신규 등록 (3일 이내) → 400
  - 기타 → 100
- Line 350: `distance_km ASC` (location 있을 때)
- Line 351: `id ASC` (안정적 정렬)

**점수 계산 (Line 384-410):**
- `calcTotalScore()` 호출: 거리, buzz, time, category, freshness 가중 평균
- 가중치 (Line 55-61): `distance: 0.30, buzz: 0.30, time: 0.20, category: 0.15, freshness: 0.05`

**반환:** 최고 점수 1개 (Line 423)

**사용 테이블/컬럼:**
- `canonical_events`: `id`, `end_at`, `is_deleted`, `lat`, `lng`, `is_featured`, `buzz_score`, `created_at`, `start_at`, `main_category`, `view_count`, `venue`, `region`, `image_url`

---

### 2. Trending (지금 떠오르는)

**파일:** `backend/src/lib/recommender.ts:432-544`

**후보군 필터링:**
- Line 491-492: `end_at >= NOW()`, `is_deleted = false`
- Line 443-464: location 있으면 **도시권 필터링**
  - `reverseGeocode()` → 주소 획득
  - `getCityZone()` → 도시권 판별 (예: 서울 → 수도권)
  - `buildCityZoneFilter()` → SQL WHERE 조건 추가
  - **팝업/전시/공연 모두 포함 (카테고리 필터 없음)**
- Line 439-441: `excludeIds` 제외
- Line 501: LIMIT (기본 10개)

**정렬 기준:**
- Line 496: `is_featured DESC NULLS LAST` (최우선)
- Line 468-484: `trend_score` 계산 (CASE 문)
  - `buzz_score > 0` → buzz_score 값
  - `buzz_score = 0` + 마감 임박 (3일) → 1000
  - `buzz_score = 0` + 신규 (3일) → 500
  - 기타 → 100
- Line 497: `trend_score DESC`
- Line 498: `end_at ASC` (마감임박 그룹에 효과적)
- Line 499: `created_at DESC` (신규 그룹에 효과적)
- Line 500: `id ASC` (안정적 정렬)

**사용 테이블/컬럼:**
- `canonical_events`: `id`, `end_at`, `is_deleted`, `buzz_score`, `created_at`, `is_featured`, `lat`, `lng` (거리 계산 시)

**도시권 필터링 상세:**
- `utils/geo.ts`: `reverseGeocode()` (Kakao Map API 사용 추정)
- `lib/cityZones.ts`: `getCityZone()`, `buildCityZoneFilter()`
- **좌표 없는 이벤트는 제외되지 않음** (도시권 필터는 `region` 컬럼 기반)

---

### 3. Nearby (근처 이벤트)

**파일:** `backend/src/lib/recommender.ts:549-598`

**후보군 필터링:**
- Line 565-566: `end_at >= NOW()`, `is_deleted = false`
- Line 567: `buildDistanceFilter()` → **5km 이내** + `lat IS NOT NULL AND lng IS NOT NULL` (Line 211-226)
  - **⚠️ 팝업이 배제되는 주요 원인: lat/lng 필수**
- Line 557-558: `excludeIds` 제외
- Line 573: LIMIT (기본 10개)

**정렬 기준:**
- Line 570: `is_featured DESC NULLS LAST` (최우선)
- Line 571: `distance_km ASC` (거리순)
- Line 572: `id ASC` (안정적 정렬)

**점수 계산 (Line 579-594):**
- `score = 100 - distance_km` (거리가 가까울수록 높은 점수)

**사용 테이블/컬럼:**
- `canonical_events`: `id`, `end_at`, `is_deleted`, **`lat`, `lng`** (필수), `is_featured`

---

### 4. Personalized (취향 저격)

**파일:** `backend/src/lib/recommender.ts:603-656`

**후보군 필터링:**
- Line 626: `end_date >= NOW()`
- Line 627: `category = ANY($preferredCategories)`
  - Line 615-618: `userPrefs.categories`에서 점수 > 50인 카테고리만
  - **⚠️ 공연/전시 편향 가능: 사용자 취향에 따라 특정 카테고리만 선택**
- Line 628: `excludeIds` 제외
- Line 629: LIMIT 50 (후보군)

**정렬 기준:**
- Line 636-653: `calcTotalScore()` 기반 정렬
  - 가중치 (Line 642): `category: 0.5, buzz: 0.3, time: 0.2`
- Line 652: 점수 내림차순
- Line 653: 최종 limit개만 반환 (기본 10개)

**사용 테이블/컬럼:**
- `events` (⚠️ 주의: `canonical_events`가 아님 - Line 625)
- `user_preferences`: `user_id`, `category_scores`, `preferred_tags`

**⚠️ 버그 가능성:**
- Line 625: `SELECT * FROM events` → 테이블명 불일치 (`canonical_events`여야 함)
- Line 626: `end_date` → 컬럼명 불일치 (`end_at`이어야 함)

---

### 5. Weekend (이번 주말)

**파일:** `backend/src/lib/recommender.ts:661-733`

**후보군 필터링:**
- Line 700: `end_at >= $1` (주말 시작)
- Line 701: `start_at <= $2` (주말 종료)
- Line 702: `is_deleted = false`
- Line 667: `getNextWeekendRange()` → 주말 범위 계산
- Line 674-680: location 있으면 `buildDistanceFilter()` → **20km 이내** + `lat IS NOT NULL AND lng IS NOT NULL`
  - **⚠️ 팝업 배제 가능: 20km 제한 + lat/lng 필수**
- Line 686-691: `excludeIds` 제외
- Line 712: LIMIT (기본 10개)

**정렬 기준:**
- Line 706: `is_featured DESC NULLS LAST` (최우선)
- Line 707-710: CASE 문
  - `buzz_score > 0` → buzz_score 값
  - 기타 → 100
- Line 710: `buzz_score DESC`
- Line 711: `id ASC` (안정적 정렬)

**점수 계산 (Line 718-730):**
- `score = buzz_score || 100`

**사용 테이블/컬럼:**
- `canonical_events`: `id`, `end_at`, `start_at`, `is_deleted`, `lat`, `lng` (location 시), `is_featured`, `buzz_score`

---

### 6. Latest (새로 올라왔어요)

**파일:** `backend/src/lib/recommender.ts:738-795`

**후보군 필터링:**
- Line 776: `end_at >= NOW()`
- Line 777: `is_deleted = false`
- Line 750-756: location 있으면 `buildDistanceFilter()` → **20km 이내** + `lat IS NOT NULL AND lng IS NOT NULL`
  - **⚠️ 팝업 배제 가능: 20km 제한 + lat/lng 필수**
- Line 762-767: `excludeIds` 제외
- Line 784: LIMIT (기본 10개)

**정렬 기준:**
- Line 781: `is_featured DESC NULLS LAST` (최우선)
- Line 782: `created_at DESC` (최신순)
- Line 783: `id ASC` (안정적 정렬)

**점수 계산 (Line 788-792):**
- `score = 100` (고정)

**사용 테이블/컬럼:**
- `canonical_events`: `id`, `end_at`, `is_deleted`, `lat`, `lng` (location 시), `is_featured`, `created_at`

---

## (C) 확인용 커맨드

### 1. 라우트 검색

```bash
cd /Users/kimsungtae/toss/fairpick-app/backend
rg "GET.*recommendations/v2" src/index.ts -n -A 10
```

### 2. recommender 함수 검색

```bash
rg "^export async function (getTodaysPick|getTrending|getNearby|getPersonalized|getWeekend|getLatest)" src/lib/recommender.ts -n
```

### 3. 거리 필터 확인

```bash
rg "buildDistanceFilter" src/lib/recommender.ts -n -B 2 -A 5
```

### 4. 프론트엔드 호출 확인

```bash
rg "recommendations.*v2" src/config/api.ts src/services/recommendationService.ts -n
```

### 5. 실행 curl 예시 (로컬)

```bash
# Today
curl "http://localhost:5001/api/recommendations/v2/today?lat=37.5665&lng=126.9780&userId=test-user-123"

# Trending (도시권 필터 적용)
curl "http://localhost:5001/api/recommendations/v2/trending?lat=37.5665&lng=126.9780&limit=10"

# Nearby (5km 이내, 필수: lat+lng)
curl "http://localhost:5001/api/recommendations/v2/nearby?lat=37.5665&lng=126.9780&limit=10"

# Personalized (필수: userId)
curl "http://localhost:5001/api/recommendations/v2/personalized?userId=test-user-123&limit=10"

# Weekend (주말 범위, 20km 제한)
curl "http://localhost:5001/api/recommendations/v2/weekend?lat=37.5665&lng=126.9780&limit=10"

# Latest (최신순, 20km 제한)
curl "http://localhost:5001/api/recommendations/v2/latest?lat=37.5665&lng=126.9780&limit=10"
```

---

## (D) "공연만 많이 나오는" 원인 체크리스트

### ✅ 확인된 원인

#### 1. **lat/lng 필수 조건으로 팝업 배제**

| 섹션 | 거리 제한 | lat/lng 필수 여부 | 팝업 영향 |
|------|----------|------------------|----------|
| Today | 10km (location 시) | ❌ 옵션 (없으면 전국) | 🟡 중간 |
| Trending | 도시권 (location 시) | ❌ 옵션 (없으면 전국) | 🟢 낮음 |
| **Nearby** | **5km** | **✅ 필수** | **🔴 높음** |
| Personalized | 없음 | ❌ 없음 | 🟢 낮음 |
| **Weekend** | **20km (location 시)** | **✅ location 시 필수** | **🟡 중간** |
| **Latest** | **20km (location 시)** | **✅ location 시 필수** | **🟡 중간** |

**근거:**
- `buildDistanceFilter()` (Line 211-226): `lat IS NOT NULL AND lng IS NOT NULL` 조건 포함
- 팝업은 좌표 데이터가 부족할 가능성 높음 (백화점/거리 위치는 있지만, DB에 lat/lng 입력 안 됨)

**확인 쿼리:**
```sql
SELECT main_category,
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) as with_coords,
       ROUND(100.0 * COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) / COUNT(*), 1) as coord_ratio
FROM canonical_events
WHERE is_deleted = false AND end_at >= NOW()
GROUP BY main_category
ORDER BY coord_ratio ASC;
```

#### 2. **buzz_score 편향 (공연이 높을 가능성)**

**영향 섹션:** Today, Trending, Weekend

**근거:**
- Trending (Line 471-472): `buzz_score > 0`이면 우선 노출
- buzz_score는 `updateBuzzScore()` job에서 계산 (Phase 1)
  - consensus (네이버 검색 합의), structural (구조적 특징), KOPIS (공연만) 조합
  - 공연은 KOPIS 데이터 + 티켓 링크가 많아 buzz_score 높을 가능성

**확인 쿼리:**
```sql
SELECT main_category,
       COUNT(*) as total,
       AVG(buzz_score) as avg_buzz,
       COUNT(*) FILTER (WHERE buzz_score > 0) as with_buzz,
       ROUND(100.0 * COUNT(*) FILTER (WHERE buzz_score > 0) / COUNT(*), 1) as buzz_ratio
FROM canonical_events
WHERE is_deleted = false AND end_at >= NOW()
GROUP BY main_category
ORDER BY avg_buzz DESC;
```

#### 3. **카테고리 필터 없음 (명시적 밸런싱 없음)**

**모든 섹션 공통:**
- 카테고리별 쿼터 없음 → buzz_score/거리/시간 순 정렬만
- 특정 카테고리가 점수 우위면 편향 발생

**예외:** Personalized (Line 616-618)
- 사용자 취향 기반 카테고리 필터 (`category_scores > 50`)
- 사용자가 공연만 선호하면 공연만 노출됨

#### 4. **is_featured 최우선 정렬**

**모든 섹션 공통:**
- `is_featured DESC NULLS LAST` (최우선, Line 343, 496, 570, 706, 781)
- Admin이 수동으로 공연을 featured 지정하면 최상단 노출
- **편향이 아닌 의도된 큐레이션**

**확인 쿼리:**
```sql
SELECT main_category, COUNT(*)
FROM canonical_events
WHERE is_featured = true AND is_deleted = false AND end_at >= NOW()
GROUP BY main_category;
```

### ❓ 확인 필요 (TODO)

#### 5. **공연 데이터 비율 자체가 높을 가능성**

**확인 쿼리:**
```bash
psql $DATABASE_URL -c "
SELECT main_category, COUNT(*) as count, ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as percentage
FROM canonical_events
WHERE is_deleted = false AND end_at >= NOW()
GROUP BY main_category
ORDER BY count DESC;
"
```

#### 6. **getPersonalized 테이블명 버그**

**파일:** `backend/src/lib/recommender.ts:625`

**버그:**
- `SELECT * FROM events` → `canonical_events`여야 함
- `end_date >= NOW()` → `end_at >= NOW()`이어야 함

**영향:**
- 현재 쿼리 실패 가능 → Personalized 섹션 동작 안 함

**확인 방법:**
```bash
curl "http://localhost:5001/api/recommendations/v2/personalized?userId=test-user-123&limit=10"
# 에러 발생 시: "relation \"events\" does not exist"
```

---

## (E) 섹션 편향 방지 최소 변경 아이디어 (TODO)

### 1. **카테고리 쿼터 기반 샘플링**

**변경 위치:** `backend/src/lib/recommender.ts` (각 함수)

**로직:**
```typescript
// 예: Trending, Weekend, Latest
const CATEGORY_QUOTA = {
  '공연': 0.30,  // 30%
  '전시': 0.25,
  '팝업': 0.25,
  '축제': 0.10,
  '행사': 0.10,
};

// 각 카테고리별로 쿼리 후 쿼터에 맞춰 mix
async function getTrendingBalanced(pool, location, excludeIds, limit) {
  const results = [];

  for (const [category, ratio] of Object.entries(CATEGORY_QUOTA)) {
    const categoryLimit = Math.ceil(limit * ratio);
    const categoryEvents = await pool.query(`
      SELECT * FROM canonical_events
      WHERE main_category = $1 AND end_at >= NOW() AND is_deleted = false
      ORDER BY trend_score DESC
      LIMIT $2
    `, [category, categoryLimit]);

    results.push(...categoryEvents.rows);
  }

  return results.slice(0, limit);
}
```

**영향 범위:**
- Trending, Weekend, Latest (카테고리 필터 없는 섹션)
- 쿼리 횟수 증가 (카테고리 수만큼), 성능 고려 필요

---

### 2. **lat/lng 없는 이벤트에 대체 거리 점수 부여**

**변경 위치:** `backend/src/lib/recommender.ts:211-226` (`buildDistanceFilter`)

**로직:**
```typescript
// 기존: lat/lng 없으면 제외
AND lat IS NOT NULL AND lng IS NOT NULL

// 변경: lat/lng 없으면 region 기반 매칭
AND (
  (lat IS NOT NULL AND lng IS NOT NULL)
  OR
  (region IS NOT NULL AND region ILIKE '%서울%')  -- 사용자 도시권 기반
)

// 점수 계산 시: lat/lng 없으면 낮은 거리 점수 (예: 50점)
const distanceScore = event.lat && event.lng
  ? calcDistanceScore(distance)
  : 50;  // 기본 중간 점수
```

**영향 범위:**
- Nearby, Weekend, Latest (거리 제한 있는 섹션)
- 팝업 노출 증가 가능

---

### 3. **팝업 전용 섹션 추가 (카테고리 하드코딩)**

**변경 위치:** `backend/src/index.ts`, `backend/src/lib/recommender.ts`

**로직:**
```typescript
// 신규 라우트
app.get('/api/recommendations/v2/popup-focus', async (req, res) => {
  const events = await pool.query(`
    SELECT * FROM canonical_events
    WHERE main_category = '팝업'
      AND end_at >= NOW()
      AND is_deleted = false
    ORDER BY
      is_featured DESC NULLS LAST,
      buzz_score DESC NULLS LAST,
      created_at DESC
    LIMIT 10
  `);

  res.json({ success: true, data: events.rows });
});
```

**영향 범위:**
- 프론트엔드에 새 섹션 추가 필요
- 백엔드만 추가하면 기존 로직 영향 없음

---

## (F) 파일 경로 요약

### 백엔드
- **라우트 핸들러:** `backend/src/index.ts:328-581`
- **추천 로직:** `backend/src/lib/recommender.ts`
  - getTodaysPick: Line 320-424
  - getTrending: Line 432-544
  - getNearby: Line 549-598
  - getPersonalized: Line 603-656 (⚠️ 버그 있음)
  - getWeekend: Line 661-733
  - getLatest: Line 738-795
- **헬퍼 함수:**
  - buildDistanceFilter: Line 211-226
  - calcDistanceScore: Line 82-89
  - calcBuzzScore: Line 94-101
- **도시권 필터:** `backend/src/lib/cityZones.ts` (TODO: 확인 필요)
- **지오코딩:** `backend/src/utils/geo.ts` (TODO: 확인 필요)

### 프론트엔드
- **API 설정:** `src/config/api.ts:15-24`
- **API 서비스:** `src/services/recommendationService.ts`
  - getTodayPick: Line 84-103
  - getTrending: Line 108-126
  - getNearby: Line 131-150
  - getPersonalized: Line 155-174
  - getWeekend: Line 179-197
  - getLatest: Line 202-220
- **호출 페이지:** `src/pages/home.tsx` (Line 14: import)

### 데이터베이스
- **테이블:** `canonical_events`
- **주요 컬럼:**
  - `id`, `title`, `main_category`, `start_at`, `end_at`, `created_at`
  - `lat`, `lng`, `venue`, `region`
  - `buzz_score`, `is_featured`, `is_deleted`
  - `view_count`, `image_url`, `metadata`
- **Personalized용:** `user_preferences` (Line 464-467)
  - `user_id`, `category_scores`, `preferred_tags`
