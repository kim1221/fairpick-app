# Phase 2: Internal Fields & Recommendations API

**완료일**: 2026-01-30  
**목적**: 추천 알고리즘 기반 데이터 구조화 및 추천 API 구축

---

## 📊 개요

Phase 2에서는 기존 데이터(derived_tags, opening_hours, lat/lng)를 가공하여 추천 알고리즘이 바로 사용할 수 있는 `metadata.internal` 필드를 생성합니다.

### Before (Phase 1)
```json
{
  "derived_tags": ["커플", "데이트", "힙한", "실내", "20대"],
  "opening_hours": {"weekday": "10:00-20:00", "weekend": "10:00-22:00"}
}
```

### After (Phase 2)
```json
{
  "derived_tags": ["커플", "데이트", "힙한", "실내", "20대"],
  "metadata": {
    "internal": {
      "matching": {
        "companions": ["커플", "데이트"],
        "age_groups": ["20대"],
        "mood": ["힙한"],
        "indoor": true
      },
      "timing": {
        "evening_available": true,
        "best_days": ["월","화","수","목","금","토","일"]
      },
      "location": {
        "metro_nearby": true,
        "downtown": true
      }
    }
  }
}
```

---

## 🚀 실행 방법

### 1. Migration 실행

```bash
cd backend
psql -d fairpick -f migrations/20260130_add_metadata_for_phase2.sql
```

### 2. Internal Fields 생성

```bash
npm run enrich:phase2
```

예상 소요 시간: 약 2-3분 (2,000개 이벤트 기준)

### 3. 통계 확인

```bash
npm run enrich:phase2:stats
```

### 4. 서버 재시작

```bash
npm run dev
# or
npm run start
```

### 5. API 테스트

```bash
./test-phase2.sh
```

---

## 🔧 주요 파일

### Backend

| 파일 | 역할 |
|-----|------|
| `migrations/20260130_add_metadata_for_phase2.sql` | metadata 컬럼 추가 |
| `src/lib/internalFieldsGenerator.ts` | Internal fields 생성 로직 |
| `src/jobs/enrichInternalFields.ts` | Enrichment Job (CLI) |
| `src/routes/recommendations.ts` | 추천 API 엔드포인트 |
| `scripts/run-phase2-enrichment.ts` | 실행 스크립트 |
| `test-phase2.sh` | 테스트 스크립트 |

---

## 📡 API 엔드포인트

### 1. 개인화 추천

```bash
GET /recommendations

Query Parameters:
  - companions: 동행자 (커플, 가족, 친구, 혼자)
  - time: 시간대 (morning, afternoon, evening, night)
  - region: 지역 (서울, 경기, 부산 등)
  - budget: 예산 (최대 가격)
  - indoor: 실내 여부 (true/false)
  - main_category: 카테고리 (공연, 전시, 팝업, 축제, 행사)
  - limit: 결과 개수 (기본 20, 최대 100)

예시:
  curl 'http://localhost:4000/recommendations?companions=커플&time=evening&region=서울&limit=10'
```

**Response:**
```json
{
  "success": true,
  "count": 10,
  "filters": {
    "companions": "커플",
    "time": "evening",
    "region": "서울"
  },
  "items": [
    {
      "id": "...",
      "title": "전시명",
      "mainCategory": "전시",
      "venue": "...",
      "matching": {
        "companions": ["커플", "데이트"],
        "indoor": true
      },
      "timing": {
        "evening_available": true
      },
      "location": {
        "metro_nearby": true
      }
    }
  ]
}
```

### 2. 필터 옵션 조회

```bash
GET /recommendations/filters

예시:
  curl 'http://localhost:4000/recommendations/filters'
```

**Response:**
```json
{
  "success": true,
  "filters": {
    "companions": ["커플", "가족", "친구", "혼자"],
    "time": ["morning", "afternoon", "evening", "night"],
    "regions": ["서울", "경기", "부산", ...],
    "categories": ["공연", "전시", "팝업", "축제", "행사"]
  }
}
```

### 3. 상황별 추천 프리셋

```bash
GET /recommendations/presets/:presetName

Available Presets:
  - date-evening: 저녁 데이트 코스
  - family-weekend: 주말 가족 나들이
  - rainy-day: 비 오는 날
  - solo-cultural: 혼자 즐기는 문화생활

예시:
  curl 'http://localhost:4000/recommendations/presets/date-evening?region=서울&limit=10'
```

---

## 📊 Internal Fields 구조

### matching (사용자 매칭)

```typescript
{
  companions: string[];           // ["커플", "가족", "친구", "혼자"]
  age_groups: string[];           // ["10대", "20대", "30대"]
  mood: string[];                 // ["힙한", "조용한", "감성적"]
  characteristics: string[];      // ["사진맛집", "체험형", "힐링"]
  location_tags: string[];        // ["실내", "야외"]
  indoor?: boolean;               // 실내 여부
  weather_dependent?: boolean;    // 날씨 영향
}
```

**생성 방법**: `derived_tags` 배열을 카테고리별로 분류

### timing (시간 정보)

```typescript
{
  morning_available: boolean;     // 06:00-12:00
  afternoon_available: boolean;   // 12:00-18:00
  evening_available: boolean;     // 18:00-22:00
  night_available: boolean;       // 22:00-06:00
  best_days: string[];            // ["월","화",...] (휴무일 제외)
  avg_duration: number;           // 평균 소요 시간 (분)
}
```

**생성 방법**: `opening_hours` 파싱 + `main_category` 기본값

### location (위치 정보)

```typescript
{
  metro_nearby: boolean;          // 지하철 인근 (500m 이내)
  nearest_station: string | null; // 가장 가까운 역
  walking_distance: number | null;// 도보 거리 (미터)
  downtown: boolean;              // 도심 여부
  tourist_area: boolean;          // 관광지 여부
}
```

**생성 방법**: `lat/lng` + `address` 분석

---

## 🎯 추천 알고리즘 예시

### 예시 1: 저녁 데이트 코스

```sql
SELECT * FROM canonical_events
WHERE 
  metadata->'internal'->'matching'->'companions' @> '["커플"]'
  AND (metadata->'internal'->'timing'->>'evening_available')::boolean = true
  AND (metadata->'internal'->'matching'->>'indoor')::boolean = true
  AND region = '서울'
ORDER BY popularity_score DESC
LIMIT 10;
```

### 예시 2: 비 오는 날 추천

```sql
SELECT * FROM canonical_events
WHERE 
  (metadata->'internal'->'matching'->>'indoor')::boolean = true
  AND (metadata->'internal'->'location'->>'metro_nearby')::boolean = true
ORDER BY popularity_score DESC
LIMIT 10;
```

### 예시 3: 가족 나들이 (주말)

```sql
SELECT * FROM canonical_events
WHERE 
  metadata->'internal'->'matching'->'companions' @> '["가족"]'
  AND metadata->'internal'->'timing'->'best_days' @> '["토","일"]'
  AND (price_max IS NULL OR price_max <= 30000)
ORDER BY popularity_score DESC
LIMIT 10;
```

---

## 📈 성능

- **Enrichment 속도**: 약 20-30 이벤트/초
- **API 응답 시간**: 평균 50-100ms
- **DB 쿼리 최적화**: GIN 인덱스 활용

---

## 🔄 정기 업데이트

Phase 2 enrichment는 다음 경우에 재실행이 필요합니다:

1. **새로운 이벤트 추가 후**
   ```bash
   npm run pipeline:refresh  # 데이터 수집
   npm run enrich:phase2     # Internal fields 생성
   ```

2. **derived_tags 업데이트 후** (AI 보완)
   ```bash
   npm run backfill:ai-enrich  # AI 보완
   npm run enrich:phase2       # Internal fields 재생성
   ```

3. **opening_hours 변경 후**
   ```bash
   npm run enrich:phase2
   ```

---

## ✅ 체크리스트

- [x] Migration 실행
- [x] Internal fields generator 작성
- [x] Enrichment job 작성
- [x] Recommendations API 작성
- [x] API 라우터 등록
- [x] 테스트 스크립트 작성
- [x] 문서 작성

---

## 🚀 다음 단계: Phase 3

Phase 3에서는 카테고리별 특화 필드를 추가합니다:

- 공연: `cast`, `crew`, `runtime`, `seating_info`
- 전시: `artist`, `interactive`, `photo_zone`
- 팝업: `brand`, `waiting_time`, `freebies`
- 축제: `programs`, `food_court`, `shuttle_bus`
- 행사: `speakers`, `capacity`, `registration_status`

→ `metadata.display` 구조로 추가 예정

