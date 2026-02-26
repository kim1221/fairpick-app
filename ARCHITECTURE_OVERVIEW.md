# Fairpick Architecture Overview

> **시스템 실행 흐름, 엔트리포인트, API 라우트, 데이터 모델**
> 
> 전체 시스템의 동작 원리와 주요 컴포넌트 간 상호작용

---

## 🎯 System Overview

Fairpick은 **3-Tier 아키텍처**로 구성된 이벤트 추천 플랫폼입니다.

```
┌─────────────────────┐
│   User Frontend     │  React Native (Granite.js)
│   (Toss MiniApp)    │  Port: N/A (Mini App)
└──────────┬──────────┘
           │ HTTP (Public API)
           │
┌──────────▼──────────┐
│   Admin Web         │  React (Vite)
│   (관리자 UI)        │  Port: 5173
└──────────┬──────────┘
           │ HTTP (Admin API)
           │ Proxy: /admin → :5001
           │
┌──────────▼──────────┐
│   Backend           │  Node.js + Express
│   (API Server)      │  Port: 5001
└──────────┬──────────┘
           │
     ┌─────┴─────┐
     │           │
┌────▼────┐ ┌───▼───────┐
│   DB    │ │ External  │
│ (PG)    │ │   APIs    │
└─────────┘ └───────────┘
             - Naver
             - Gemini
             - KOPIS
             - Kakao
```

---

## 🚀 Entrypoints & Execution Flow

### 1. Backend Server (`backend/src/index.ts`)

**역할**: Express HTTP 서버, 모든 API 라우트 정의, Scheduler 초기화

**주요 구성**:
- Express 앱 생성 및 미들웨어 설정
- CORS, Rate Limiting, Multer (파일 업로드)
- Admin API 라우트 (`/admin/*`)
- Public API 라우트 (`/events/*`, `/recommendations/*`, `/user/*`)
- Scheduler 초기화 (`initScheduler()`)
- 포트 5001에서 리스닝

**실행 흐름**:
```
npm run dev
  ↓
ts-node src/index.ts
  ↓
Express 서버 시작 (port 5001)
  ↓
initScheduler() 호출 → Cron Jobs 등록
  ↓
Ready to handle requests
```

**주요 의존성**:
- `./db` → PostgreSQL 연결 풀
- `./config` → 환경 변수
- `./scheduler` → Cron Job 스케줄러
- `./routes/*` → 라우트 모듈
- `./lib/*` → 비즈니스 로직 라이브러리

---

### 2. Scheduler (`backend/src/scheduler.ts`)

**역할**: Cron Job 스케줄러, 배치 작업 자동 실행

**스케줄 (KST 기준)**:
```
01:00 - Cleanup Job (Auto-unfeature, Soft delete)
02:00 - Metadata Update (is_ending_soon, popularity_score)
02:30 - Buzz Score Update (사용자 행동 기반)
03:00, 15:00 - Data Collection (KOPIS, Culture, TourAPI)
03:30, 15:30 - Price Info Backfill
04:00 - AI Enrichment (Naver + Gemini)
04:15 - Internal Fields Generation (추천용)
04:30 - Recommendation Update
```

**실행 흐름**:
```
initScheduler() 호출 (from index.ts)
  ↓
node-cron.schedule() 등록 (각 Job)
  ↓
스케줄 시간마다 runJobSafely() 실행
  ↓
Job 함수 호출 (예: aiEnrichmentBackfill)
  ↓
성공/실패 로깅
```

**주요 Job**:
- `runCollectJob()` → Data Collection
- `aiEnrichmentBackfill()` → AI 자동 보완
- `enrichInternalFields()` → Internal metadata 생성
- `updateBuzzScore()` → Buzz Score 계산
- `updateMetadata()` → is_ending_soon 등 업데이트
- `updateAutoRecommend()` → 추천 결과 캐싱

---

### 3. Admin Web (`backend/admin-web/src/main.tsx`)

**역할**: Admin UI 진입점, React 앱 렌더링

**실행 흐름**:
```
npm run dev (admin-web/)
  ↓
Vite 개발 서버 시작 (port 5173)
  ↓
main.tsx 실행
  ↓
React DOM 렌더링 (<App />)
  ↓
React Router 초기화
  ↓
/login or Protected Routes
```

**라우팅** (`App.tsx`):
```
/login                → LoginPage
/                     → DashboardPage (Protected)
/admin, /events       → EventsPage (Protected)
/events/create        → CreateEventPage (Protected)
/hot-suggestions      → HotSuggestionsPage (Protected)
```

**Protected Route**:
- `localStorage.adminKey` 확인
- 없으면 `/login`으로 리다이렉트
- 있으면 `AdminLayout` 래핑

**Backend API 호출**:
- `services/api.ts` → axios 인스턴스
- `x-admin-key` 헤더 자동 추가
- Proxy: `/admin` → `http://localhost:5001/admin`

---

### 4. User Frontend (`src/_app.tsx`)

**역할**: Toss MiniApp 진입점, Granite.js 라우팅

**실행 흐름**:
```
npm run dev
  ↓
Granite.js 개발 서버 시작
  ↓
_app.tsx 실행
  ↓
AppsInToss.registerApp(AppContainer)
  ↓
TDSProvider (Toss Design System)
  ↓
Granite 라우팅 활성화 (pages/ 디렉토리)
```

**라우팅** (Granite.js):
```
pages/index.tsx        → 홈 (Today Pick, Trending)
pages/hot.tsx          → Hot 이벤트
pages/ending.tsx       → 마감 임박
pages/nearby.tsx       → 내 주변
pages/explore.tsx      → 탐색
pages/mypage.tsx       → 마이페이지
pages/events/[id].tsx  → 이벤트 상세
```

**Backend API 호출**:
- `src/services/recommendationService.ts`
- `src/config/api.ts` → API Base URL
- 추정: `http://localhost:5001` (개발) 또는 프로덕션 URL

---

## 🛣️ API Routes

### Admin API (`/admin/*`)

모든 Admin API는 **`x-admin-key` 헤더 인증 필요**.

#### **인증**
- `POST /admin/verify` - Admin Key 검증

#### **이벤트 관리**
- `GET /admin/events` - 이벤트 목록 (페이징, 필터)
- `GET /admin/events/:id` - 이벤트 상세
- `POST /admin/events` - 이벤트 생성
- `PATCH /admin/events/:id` - 이벤트 수정 (manually_edited_fields 자동 마킹)
- `DELETE /admin/events/:id` - 이벤트 삭제 (soft delete)
- `POST /admin/events/:id/feature` - Featured 설정
- `DELETE /admin/events/:id/feature` - Featured 해제

#### **AI 관련**
- `POST /admin/events/:id/enrich` - AI 재생성 (forceFields 옵션)
- `POST /admin/events/:id/regenerate-naver` - 네이버 검색 재실행
- `POST /admin/events/search-naver` - 네이버 검색 (CreateEventPage용)
- `POST /admin/events/extract-info` - AI 정보 추출 (CreateEventPage용)

#### **이미지 업로드**
- `POST /admin/events/:id/upload-image` - 이벤트 이미지 업로드 (S3)
- `DELETE /admin/events/:id/image` - 이미지 삭제

#### **Hot Suggestions**
- `GET /admin/hot-suggestions` - Hot Suggestions 목록
- `PATCH /admin/hot-suggestions/:id` - Hot Suggestion 상태 변경
- `DELETE /admin/hot-suggestions/:id` - Hot Suggestion 삭제

#### **대시보드**
- `GET /admin/dashboard` - 통계 (총 이벤트, Featured, 카테고리별 등)

---

### Public API (User Frontend용)

#### **이벤트 조회**
- `GET /events` - 이벤트 목록 (페이징, 필터, 정렬)
- `GET /events/:id` - 이벤트 상세
- `GET /events/featured` - Featured 이벤트

#### **추천 API (`/recommendations/*`)**
- `GET /recommendations/today-pick` - Today Pick
- `GET /recommendations/trending` - Trending
- `GET /recommendations/nearby` - 내 주변 (위경도 기반)
- `GET /recommendations/weekend` - 이번 주말
- `GET /recommendations/latest` - 최신 등록
- `GET /recommendations/ending-soon` - 마감 임박
- `GET /recommendations/hot` - Hot Score 기반

#### **사용자 행동 (`/user/*`)**
- `POST /user/events/:id/view` - 조회 기록 (Buzz Score 반영)
- `POST /user/events/:id/like` - 좋아요
- `POST /user/events/:id/unlike` - 좋아요 취소
- `GET /user/events/liked` - 좋아요한 이벤트 목록
- `GET /user/events/recent` - 최근 본 이벤트

#### **검색**
- `GET /search` - 이벤트 검색 (키워드, 카테고리, 지역)

---

## 🗄️ Data Model

### Core Tables

#### **`canonical_events`** (정규화된 이벤트)

**Primary Fields**:
- `id` (UUID) - Primary Key
- `title` (TEXT) - 이벤트 제목
- `main_category` (TEXT) - 메인 카테고리 (공연/전시/팝업/축제 등)
- `sub_category` (TEXT) - 서브 카테고리
- `status` (TEXT) - scheduled / ongoing / ended

**Date & Location**:
- `start_date` (DATE) - 시작일
- `end_date` (DATE) - 종료일
- `venue` (TEXT) - 장소명
- `address` (TEXT) - 주소
- `latitude` (FLOAT) - 위도
- `longitude` (FLOAT) - 경도
- `region_1depth` (TEXT) - 시/도
- `region_2depth` (TEXT) - 구/군

**Content**:
- `overview` (TEXT) - 사용자용 개요
- `overview_raw` (TEXT) - 내부용 상세 개요
- `thumbnail_url` (TEXT) - 썸네일 이미지
- `detail_image_url` (TEXT) - 상세 이미지

**Price & Hours**:
- `price_min` (INT) - 최저 가격
- `price_max` (INT) - 최고 가격
- `price_notes` (TEXT) - 가격 설명
- `opening_hours` (JSONB) - 운영 시간 `{ weekday, weekend, closed, notes }`
- `is_free` (BOOLEAN) - 무료 여부

**Links & Reservation**:
- `external_links` (JSONB) - `{ official, ticket, reservation }`
- `reservation_required` (BOOLEAN) - 예약 필수 여부
- `reservation_link` (TEXT) - 예약 링크

**Tags & Categorization**:
- `derived_tags` (JSONB) - AI 추출 태그 (배열)
- `age_restriction` (TEXT) - 연령 제한

**Scores**:
- `hot_score` (FLOAT) - Hot Score (Consensus + Structural)
- `buzz_score` (INT) - Buzz Score (사용자 행동 기반)
- `popularity_score` (FLOAT) - Popularity Score
- `quality_score` (FLOAT) - Quality Score (추천용)

**AI & Data Protection**:
- `ai_suggestions` (JSONB) - AI 제안 `{ field_name: { value, confidence, source } }`
- `field_sources` (JSONB) - 필드별 데이터 소스 `{ field_name: source }`
- `manually_edited_fields` (JSONB) - 수동 편집 마킹 `{ field_name: true }`

**Metadata**:
- `metadata` (JSONB) - 확장 메타데이터
  - `metadata.display` - 카테고리별 특화 필드 (전시: 작가, 공연: 출연진 등)
  - `metadata.internal` - 추천 알고리즘용 필드
  - `metadata.raw_payload` - API 원본 응답

**Admin**:
- `featured` (BOOLEAN) - Featured 여부
- `is_ending_soon` (BOOLEAN) - 마감 임박 여부 (자동 계산)

**Source & Timestamps**:
- `source` (TEXT) - 데이터 소스 (kopis, culture, tour_api)
- `external_id` (TEXT) - 외부 소스 ID
- `content_key` (TEXT) - 중복 제거 키
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

---

#### **`raw_events`** (원본 이벤트)

**역할**: 수집 직후 원본 데이터 저장 (정규화 전)

**Fields**:
- `id`, `source`, `external_id`
- `title`, `description`, `venue`, `period_text`
- `start_date`, `end_date`, `region`, `category`, `tags`
- `thumbnail_url`, `detail_image_url`, `detail_link`
- `created_at`, `updated_at`

**관계**: `raw_events` → (정규화/중복제거) → `canonical_events`

---

#### **`admin_hot_suggestions`** (Hot Suggestions)

**역할**: Admin이 수동으로 선택할 수 있는 Hot 이벤트 후보

**Fields**:
- `id` (UUID)
- `title`, `venue`, `region`
- `link`, `description`
- `source` (blog / web / cafe)
- `candidate_score` (FLOAT) - AI 스코어
- `evidence_links` (TEXT[]) - 근거 링크
- `evidence_count` (INT)
- `status` (pending / approved / rejected)
- `metadata` (JSONB)
- `created_at`, `updated_at`

---

#### **`collection_logs`** (수집 로그)

**역할**: 데이터 수집 작업 로그

**Fields**:
- `id`
- `source` (kopis / culture / tour_api)
- `status` (in_progress / completed / failed)
- `started_at`, `completed_at`
- `events_collected` (INT)
- `error_message` (TEXT)

---

#### **`user_events`** (사용자 행동)

**역할**: 사용자의 이벤트 상호작용 기록

**Fields** (추정):
- `user_id` (TEXT or UUID)
- `event_id` (UUID)
- `action` (view / like / unlike)
- `created_at`

**관계**: Buzz Score 계산에 사용

---

### Data Flow

#### **수집 → 정규화 → AI Enrichment → 추천**

```
External APIs (KOPIS, Culture, TourAPI)
  ↓ Collectors (kopisCollector.ts, etc.)
raw_events (원본)
  ↓ normalizeCategories.ts
  ↓ dedupeCanonicalEvents.ts
canonical_events (정규화, 중복 제거)
  ↓ detailBackfill.ts (KOPIS 상세)
  ↓ overviewBackfill.ts (개요 생성)
  ↓ aiEnrichmentBackfill.ts (AI 자동 보완)
  ↓   - searchEventInfo() → Naver API
  ↓   - extractEventInfo() → Gemini AI
  ↓   - UPDATE canonical_events (derived_tags, opening_hours, etc.)
  ↓ enrichInternalFields.ts (metadata.internal 생성)
  ↓ updateBuzzScore.ts (Buzz Score 계산)
  ↓ calculateConsensusLight() (Consensus Signal)
  ↓ calculateStructuralScore() (Structural Signal)
  ↓ → hot_score
  ↓ updateMetadata.ts (is_ending_soon, popularity_score)
  ↓ updateAutoRecommend() (추천 결과 캐싱)
recommendations (캐시)
  ↓
User Frontend (GET /recommendations/*)
```

---

## 🧠 Key Algorithms & Concepts

### 1. Hot Score

**정의**: 이벤트의 "지금 뜨고 있는" 정도를 측정

**구성**:
- **Consensus Signal** (40%) - 외부 지표 합의 (Naver 블로그 수, 플레이스 리뷰 등)
- **Structural Signal** (60%) - 구조적 품질 (데이터 완성도, 이미지 품질 등)

**계산**:
```typescript
hot_score = (consensus_light * 0.4) + (structural_score * 0.6)
```

**구현**: `src/lib/hotScoreCalculator.ts`

---

### 2. Buzz Score

**정의**: 사용자 행동 기반 인기도 (조회, 좋아요)

**계산**:
```sql
buzz_score = (view_count * 1) + (like_count * 10)
```

**업데이트**: `updateBuzzScore.ts` (스케줄러)

---

### 3. AI Enrichment

**목적**: 비어있는 필드를 자동으로 채우기

**파이프라인**:
```
1. Naver API 검색 (naverApi.ts)
   - searchEventInfo(title, venue)
   - 블로그/웹/플레이스 결과 수집

2. Gemini AI 추출 (aiExtractor.ts)
   - extractEventInfo(title, category, overview, searchText)
   - 구조화된 정보 추출 (tags, opening_hours, price, links)

3. Data Protection (enrichmentPolicy.ts)
   - isManuallyEdited() 확인
   - 수동 편집된 필드는 건너뛰기
   - 빈 필드만 채우기

4. DB 저장 (aiEnrichmentBackfill.ts)
   - UPDATE canonical_events
   - field_sources 기록
```

**Manual Edit Protection**:
- Admin이 수정한 필드는 `manually_edited_fields` JSONB에 마킹
- AI Enrichment가 자동으로 덮어쓰지 않음
- `forceFields` 옵션으로 강제 재생성 가능

---

### 4. Recommendation Algorithm

**추천 타입**:
- **Today Pick** - Quality Score + 최신성 + 카테고리 다양성
- **Trending** - Hot Score 기반
- **Nearby** - 위경도 거리 기반 (Haversine)
- **Weekend** - 주말에 진행되는 이벤트
- **Latest** - 최근 등록 순
- **Ending Soon** - is_ending_soon=true 이벤트

**Quality Score**:
```typescript
quality_score = 
  (data_completeness * 0.3) +  // 필드 채움 정도
  (has_image * 0.2) +           // 이미지 존재
  (has_overview * 0.2) +        // 개요 존재
  (hot_score * 0.3)             // Hot Score
```

**구현**: `src/lib/recommender.ts`

---

## 🔄 Data Protection Policy

### Manual Edit Protection

**목적**: Admin이 수동으로 수정한 필드를 AI가 덮어쓰지 않도록 보호

**동작 방식**:
1. Admin이 PATCH `/admin/events/:id`로 필드 수정
2. Backend가 `manually_edited_fields`에 자동 마킹
   ```json
   {
     "overview": true,
     "derived_tags": true
   }
   ```
3. AI Enrichment 시 `isManuallyEdited(field, manually_edited_fields)` 확인
4. 마킹된 필드는 건너뛰기

**강제 재생성**:
- `POST /admin/events/:id/enrich?forceFields=overview,derived_tags`
- `forceFields`에 포함된 필드는 manual edit 무시하고 재생성

**구현**:
- `src/lib/enrichmentPolicy.ts` - `isManuallyEdited()`
- `src/jobs/aiEnrichmentBackfill.ts` - AI Enrichment Job

---

## 🔐 Security & Authentication

### Admin Authentication

**방식**: Simple Key-based (x-admin-key 헤더)

**흐름**:
```
1. LoginPage에서 adminKey 입력
2. POST /admin/verify로 검증
3. localStorage.setItem('adminKey', key)
4. 이후 모든 요청에 x-admin-key 헤더 자동 추가
```

**Backend 검증**:
```typescript
function requireAdminAuth(req, res, next) {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
```

### User Authentication

**추정**: Toss MiniApp 프레임워크의 사용자 인증 사용 (상세 미확인)

---

## 📊 Performance & Monitoring

### API Instrumentation

**구현**: `src/utils/instrumentApi.ts`

**측정 항목**:
- API 응답 시간
- JSON 크기
- 데이터베이스 쿼리 시간

**사용 예**:
```typescript
const timer = startTimer();
// ... API 로직 ...
const elapsed = getElapsedMs(timer);
logApiMetrics('GET /events', elapsed, resultSize);
```

### Rate Limiting

**구현**: `express-rate-limit` 미들웨어

**추정**: Admin API에 적용 (자세한 설정은 index.ts 확인 필요)

---

## 🗂️ File Organization Strategy

### Backend 레이어 구조

```
src/
├── index.ts          # HTTP 서버 (Controller)
├── routes/           # 라우트 모듈 (Controller)
├── lib/              # 비즈니스 로직 (Service)
├── jobs/             # 배치 작업 (Service)
├── collectors/       # 데이터 수집 (Service)
├── utils/            # 유틸리티 함수
├── db.ts             # 데이터베이스 (Repository)
└── config.ts         # 설정
```

**레이어 분리**:
- **Controller** (index.ts, routes/) - HTTP 요청/응답
- **Service** (lib/, jobs/) - 비즈니스 로직
- **Repository** (db.ts) - 데이터베이스 접근

---

**Last Updated**: 2026-02-09

