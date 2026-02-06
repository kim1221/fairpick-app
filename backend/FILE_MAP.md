# FILE_MAP (backend)

이 문서는 Backend 폴더의 상세 구조와 각 파일의 역할을 설명합니다.

**마지막 업데이트:** 2026-02-07

---

## 1) Backend 실행 개요

### 엔트리포인트
- **메인 서버:** `src/index.ts` (5,908 lines)
- **스케줄러:** `src/scheduler.ts` (249 lines)
- **DB 연결:** `src/db.ts`

### 환경변수 (.env) 요구사항

**필수:**
```env
DATABASE_URL=postgresql://user:password@localhost:5432/fairpick
GEMINI_API_KEY=AIzaSy...                # Google Gemini API (AI 추출)
NAVER_CLIENT_ID=...                     # Naver 검색 API
NAVER_CLIENT_SECRET=...
KAKAO_REST_API_KEY=...                  # Kakao Maps (지오코딩)
KOPIS_API_KEY=...                       # KOPIS 공연 API
```

**선택:**
```env
ADMIN_KEY=fairpick-admin-2024           # Admin 인증 (기본값 제공)
PORT=5001                               # 서버 포트 (기본: 5001)
ENABLE_SCHEDULER=true                   # 스케줄러 활성화 (기본: false) ⚠️ 필수!
AWS_ACCESS_KEY_ID=...                   # S3 이미지 업로드 (선택)
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=...
```

### 로컬 실행 커맨드

```bash
# 개발 모드 (ts-node + nodemon)
npm run dev

# 프로덕션 모드
npm run build           # TypeScript 컴파일
npm run start:api      # 컴파일된 JS 실행

# 특정 포트 지정
PORT=3000 npm run dev
```

### 스케줄러 실행 커맨드

**스케줄러 포함 실행:**
```bash
# ⚠️ 중요: ENABLE_SCHEDULER=true 환경변수 필수!
ENABLE_SCHEDULER=true npm run dev
```

**개별 잡 수동 실행:**
```bash
npm run collect:kopis          # KOPIS 수집
npm run collect:culture        # 문화 이벤트 수집
npm run collect:tourapi        # 관광 축제 수집
npm run pipeline:geoRefresh    # 전체 파이프라인
npm run backfill:ai-enrich     # AI 강화
npm run job:cleanup            # 정리 잡
npm run metadata:update        # 메타데이터 업데이트
npm run job:geoBackfill        # 지오코딩
```

---

## 2) Core Domains

### 2.1 Collectors / Normalizers

**경로:** `src/collectors/*.ts`

| 파일 | 라인 수 | 수집 대상 | API | 주기 | 저장 테이블 | 주의사항 |
|------|---------|-----------|-----|------|-------------|----------|
| **kopisCollector.ts** | ~300 | 공연/연극/뮤지컬 | KOPIS XML API | 03:00, 15:00 KST | `raw_kopis_events` | XML 파싱, 페이지네이션 처리 |
| **cultureCollector.ts** | ~250 | 전시/문화 이벤트 | Culture API (REST) | 03:00, 15:00 KST | `raw_culture_events` | JSON 파싱, 카테고리 매핑 |
| **tourApiCollector.ts** | ~280 | 축제/관광 이벤트 | Tour API (REST) | 03:00, 15:00 KST | `raw_tour_events` | JSON 파싱, 지역 필터링 |

**공통 로직:**
- **입력:** 외부 API (XML/JSON)
- **출력:** `raw_*_events` 테이블에 payload 저장
- **처리:** 페이지네이션, 에러 재시도, 레이트 리밋 준수
- **실행:** `src/jobs/geoRefreshPipeline.ts`에서 호출

**실행 예시:**
```bash
# 개별 실행
npm run collect:kopis

# 전체 파이프라인 (수집 + 정규화)
npm run pipeline:geoRefresh
```

**변경 시 영향:**
- 수집 로직 변경 시: 모든 신규 이벤트 영향
- API 스펙 변경 시: 파싱 로직 업데이트 필요
- 테이블 스키마 변경 시: 마이그레이션 필요

---

### 2.2 Recommendation & Scoring

**경로:** `src/lib/*.ts`

#### **recommender.ts** (795 lines)

**역할:** Phase 2 개인화 추천 알고리즘

**입력:**
- 사용자 요청: `companions`, `time`, `region`, `budget`, `indoor`, `category`
- DB: `canonical_events` (metadata.internal이 있는 이벤트만)

**출력:**
- 추천 이벤트 배열 (점수 + 이유 포함)
- 섹션: Nearby, Today, Weekend, Latest, Trending

**핵심 점수 가중치:**
```typescript
const weights = {
  distance: 0.3,    // 거리 (1km=100, 5km=60, 20km=20)
  buzz: 0.3,        // 인기도 (로그 스케일)
  time: 0.2,        // 시간 근접성 (마감임박 높음)
  category: 0.15,   // 카테고리 매칭
  freshness: 0.05   // 신규 이벤트 가산점
};
```

**주의사항:**
- Phase 2 enrichment 필수 (metadata.internal 없으면 추천 불가)
- 가중치 변경 시 전체 추천 결과 영향
- 거리 계산: Haversine formula 사용

**변경 시 영향:** 모든 사용자 추천 결과

---

#### **hotScoreCalculator.ts** (459 lines)

**역할:** Hot Score 계산 (Featured 이벤트 순위 결정)

**입력:**
- `canonical_events` 전체
- `buzz_components` 테이블 (consensus, structural, performance, ai_hotness)

**출력:**
- `canonical_events.hot_score` 업데이트
- `is_featured` 플래그 (상위 N개)

**핵심 공식:**
```typescript
hot_score =
  consensus_score * 0.4 +      // Naver 검색 결과 수 (로그 스케일)
  structural_score * 0.3 +      // venue, duration, source 신뢰도
  performance_score * 0.2 +     // KOPIS 박스오피스 순위
  ai_hotness_score * 0.1        // AI 핫함 평가 (주간)
```

**Consensus Score (Naver 검색):**
- Blog + Web + Cafe 결과 수 합산
- 로그 스케일: `log10(count + 1) * 20`
- 도메인 권위 가중치 적용

**Structural Score:**
- 유명 venue: +20 (롯데백화점, 현대백화점, 코엑스 등)
- 장기 이벤트: duration > 30일 시 +10
- 신뢰 source: KOPIS, Culture API +10

**주의사항:**
- Naver API 레이트 리밋 주의 (25k/일)
- Consensus 계산 비용 (이벤트당 ~3초)
- 캐싱 전략 필요 (buzz_components 테이블)

**변경 시 영향:** Featured 탭 전체 순위

---

#### **searchScoring.ts** (341 lines)

**역할:** Naver 검색 결과 필터링 및 점수화

**입력:**
- Naver API 응답 (Blog, Web, Cafe)
- 이벤트 메타데이터 (title, dates)

**출력:**
- 필터링된 결과 + 신뢰도 점수
- AI Extractor 입력용 상위 N개 선택

**필터링 규칙:**
1. 만료 콘텐츠 제거 (제목에 "2024", "종료" 등)
2. 중복 제거 (동일 title + 도메인)
3. 저품질 제거 (제목 길이 < 10자)
4. 광고/스팸 제거 (특정 키워드)

**점수화:**
- 도메인 권위: 공식 사이트 (100) > 뉴스 (80) > 블로그 (60) > 카페 (40)
- 날짜 신선도: 최근 7일 (100) > 30일 (80) > 90일 (60)
- 제목 매칭: 이벤트명 포함 여부

**주의사항:**
- 필터링 너무 엄격하면 결과 부족
- 도메인 권위 리스트 주기적 업데이트

**변경 시 영향:** AI 추출 입력 품질

---

#### **cityZones.ts** (~150 lines)

**역할:** 지역별 존(zone) 정의 및 거리 필터링

**입력:**
- 사용자 위치 (lat, lng)
- 이벤트 위치 (lat, lng)

**출력:**
- 존 매칭 여부
- 거리 계산 (km)

**서울 존 정의:**
```typescript
{
  '강남': { center: [37.4979, 127.0276], radius: 5 },
  '홍대': { center: [37.5563, 126.9223], radius: 3 },
  '성수': { center: [37.5444, 127.0557], radius: 2 },
  // ...
}
```

**주의사항:**
- 존 반경 조정 시 추천 결과 크게 변경
- 신규 핫플레이스 추가 필요 시 업데이트

**변경 시 영향:** 지역 기반 추천 정확도

---

#### **confidenceCalculator.ts** (~200 lines)

**역할:** AI 추출 결과의 신뢰도 점수 계산

**입력:**
- AI 추출 필드 (dates, venue, price 등)
- 검색 결과 메타데이터

**출력:**
- Confidence score (0-100)
- Action: `auto-apply` (>80) | `suggest` (0-80) | `skip` (<0)

**신뢰도 시그널:**
- 다수 소스 일치 (3개 이상 동일 값 → +30)
- 공식 사이트 포함 (→ +20)
- 날짜 포맷 정확 (ISO 8601 → +10)
- venue 주소 일치 (→ +15)
- price 범위 합리성 (→ +10)

**주의사항:**
- 임계값 조정 시 자동 적용 비율 변경
- False positive vs False negative 트레이드오프

**변경 시 영향:** AI 자동 적용 비율, Admin 검토 부담

---

### 2.3 AI Enrichment / Extraction

**경로:** `src/lib/*.ts`, `src/lib/displayFieldsGenerator/*.ts`

#### **aiExtractor.ts** (1,691 lines)

**역할:** Google Gemini API로 이벤트 정보 구조화 추출

**입력:**
- 이벤트 title, 기존 description
- Naver 검색 결과 (상위 N개 snippet)

**출력:**
- 구조화 필드: start_date, end_date, venue, address, opening_hours, price_min, price_max, age_restriction, parking_info, public_transport_info, derived_tags, official_link, ticket_link, reservation_link, overview

**Gemini Config:**
```typescript
{
  model: 'gemini-2.5-flash',
  temperature: 0.05,        // 최소 variance (일관성)
  maxOutputTokens: 8192,
  topP: 0.8,
  topK: 10
}
```

**프롬프트 전략:**
- JSON schema 제공 (타입 강제)
- 예시 포함 (few-shot learning)
- 한국어 최적화 ("정확한", "공식적인" 강조)

**비용:**
- ~$0.001/이벤트 (8k tokens)
- 월 1,000개 강화 시 ~$1

**레이트 리밋:**
- Gemini: 15 RPM (free tier)
- 해결: 배치 처리 + 딜레이 (4초/요청)

**Fallback:**
- API 실패 시: 기존 description 유지
- Parsing 실패 시: 로그 + 재시도 큐

**주의사항:**
- 프롬프트 변경 시 전체 재강화 고려
- 비용 모니터링 필수
- 한국어 NER 정확도 주기적 검증

**변경 시 영향:** 이벤트 데이터 품질 전체

---

#### **enrichmentPolicy.ts** (~100 lines)

**역할:** AI 추출 결과 적용 정책 정의

**정책 모드:**
```typescript
enum EnrichmentPolicy {
  DEFAULT = 'default',       // 80% 이상 auto-apply
  AGGRESSIVE = 'aggressive', // 70% 이상 auto-apply
  CONSERVATIVE = 'conservative' // 90% 이상 auto-apply
}
```

**필드별 임계값:**
- 날짜 (start_date, end_date): 85% (높은 정확도 요구)
- venue: 80%
- price: 75%
- tags: 70%
- overview: 60% (주관적 내용)

**주의사항:**
- AGGRESSIVE: 비용 절감, 품질 위험
- CONSERVATIVE: 품질 보장, Admin 부담 증가

**변경 시 영향:** AI 자동 적용 비율, Admin 검토 큐 크기

---

#### **enrichmentHelper.ts** (~150 lines)

**역할:** 필드별 적용 결정 (auto-apply vs suggest)

**입력:**
- 추출 결과 + confidence
- 기존 값 (manually_edited_fields 체크)
- 정책 (enrichmentPolicy)

**출력:**
- Action: `auto-apply` | `suggest` | `skip`
- Reason: 이유 설명

**보호 로직:**
1. manually_edited_fields 체크 → 항상 skip
2. 기존 값이 있고 confidence < 90% → suggest
3. 기존 값 없고 confidence >= 임계값 → auto-apply

**주의사항:**
- Admin 편집 보호 최우선
- False positive 방지 (기존 값 덮어쓰기 주의)

**변경 시 영향:** AI 적용 정확도, 데이터 안정성

---

#### **internalFieldsGenerator.ts** (~300 lines)

**역할:** Phase 2 추천 메타데이터 생성 (metadata.internal)

**입력:**
- canonical_events (Phase 1 AI 추출 완료)

**출력:**
- metadata.internal 객체:
```typescript
{
  matching: {
    companions: ['solo', 'couple', 'family', 'friends'],
    age_groups: ['10s', '20s', '30s', '40s', 'senior'],
    mood: ['calm', 'exciting', 'romantic', 'cultural']
  },
  timing: {
    is_weekend_suitable: boolean,
    is_weekday_suitable: boolean,
    is_evening_suitable: boolean,
    requires_reservation: boolean
  },
  location: {
    has_parking: boolean,
    has_public_transport: boolean,
    is_indoor: boolean,
    accessibility_score: number
  },
  budget: {
    level: 'free' | 'low' | 'medium' | 'high',
    estimated_per_person: number
  }
}
```

**변환 규칙:**
- derived_tags → companions, mood (규칙 기반 매핑)
- opening_hours → timing fields (시간 파싱)
- price_min/max → budget fields (범위 분류)
- parking_info → has_parking (키워드 탐지)

**주의사항:**
- 규칙 변경 시 전체 재생성 필요
- 비용 없음 (AI 호출 없음)
- 빠름 (~100ms/이벤트)

**변경 시 영향:** 추천 필터링 정확도

---

#### **displayFieldsGenerator/** (카테고리별 Rich 필드)

**경로:** `src/lib/displayFieldsGenerator/*.ts`

| 파일 | 카테고리 | 추출 필드 | 용도 |
|------|----------|-----------|------|
| **exhibitionExtractor.ts** | 전시 | artist, artworks_count, exhibition_type, guided_tour | 전시 상세 페이지 |
| **performanceExtractor.ts** | 공연 | actors, director, duration, intermission | 공연 상세 페이지 |
| **festivalExtractor.ts** | 축제 | programs, highlights, best_time_to_visit | 축제 상세 페이지 |
| **popupExtractor.ts** | 팝업 | brand, collaboration, limited_items | 팝업 상세 페이지 |

**공통 로직:**
- Gemini API 호출 (카테고리별 프롬프트)
- metadata.display 필드에 저장
- 선택적 실행 (필요 시에만)

**주의사항:**
- 비용 발생 (카테고리당 추가 $0.001)
- 실행 주기: 신규 이벤트만 또는 수동

**변경 시 영향:** 카테고리별 상세 페이지 UX

---

### 2.4 External API Clients

**경로:** `src/lib/*.ts`

#### **naverApi.ts** (913 lines)

**역할:** Naver 검색 API 클라이언트

**제공 메서드:**
- `searchBlog(query, display)` - 블로그 검색
- `searchWeb(query, display)` - 웹 검색
- `searchCafe(query, display)` - 카페 검색
- `searchPlace(query, display)` - 장소 검색

**인증:**
- Header: `X-Naver-Client-Id`, `X-Naver-Client-Secret`

**레이트 리밋:**
- 25,000 req/일 (free tier)
- display: 최대 100/요청

**재시도 전략:**
- 429 (Rate Limit): 1시간 대기
- 500 (Server Error): 지수 백오프 (1s, 2s, 4s)
- 400 (Bad Request): 로그 + 스킵

**주의사항:**
- 일일 쿼터 모니터링
- 쿼리 최적화 (불필요한 호출 제거)

**변경 시 영향:** AI 입력 품질, Consensus 점수

---

#### **kopisApi.ts** (~200 lines)

**역할:** KOPIS (공연예술통합전산망) API 클라이언트

**제공 메서드:**
- `getPerformanceList(startDate, endDate)` - 공연 목록
- `getPerformanceDetail(id)` - 공연 상세
- `getBoxOffice(date)` - 박스오피스 순위

**인증:**
- Query param: `service=${KOPIS_API_KEY}`

**레이트 리밋:**
- ~5 req/sec (비공식)
- 딜레이: 200ms/요청

**데이터 포맷:**
- XML (파싱 필요)

**주의사항:**
- XML 파싱 에러 핸들링
- 페이지네이션 (rows=100)

**변경 시 영향:** 공연 수집 품질, Performance Score

---

#### **geocode.ts** (~250 lines)

**역할:** 주소 → 좌표 변환 (Kakao Maps API + Nominatim fallback)

**제공 메서드:**
- `geocodeAddress(address)` - 주소 지오코딩
- `reverseGeocode(lat, lng)` - 역지오코딩 (좌표 → 주소)

**전략:**
1. **Kakao Address API** (우선)
   - 신뢰도: A (정확)
   - 한국 주소 최적화
2. **Kakao Keyword Search** (fallback 1)
   - 신뢰도: B (근사)
   - 장소명으로 검색
3. **Nominatim** (fallback 2)
   - 신뢰도: C (부정확)
   - 오픈소스, 무료
4. **Failed**
   - 신뢰도: D (실패)

**인증:**
- Kakao: Header `Authorization: KakaoAK ${KAKAO_REST_API_KEY}`

**레이트 리밋:**
- Kakao: 30,000 req/일
- Nominatim: 1 req/sec (User-Agent 필수)

**주의사항:**
- 주소 정규화 (전처리)
- 결과 캐싱 (중복 요청 방지)

**변경 시 영향:** 위치 기반 추천 정확도

---

#### **imageUpload.ts** (~150 lines)

**역할:** AWS S3 이미지 업로드

**제공 메서드:**
- `uploadImage(buffer, filename)` - 이미지 업로드
- `deleteImage(key)` - 이미지 삭제

**인증:**
- AWS credentials (환경변수)

**주의사항:**
- 이미지 크기 제한 (5MB)
- 파일명 중복 방지 (UUID)

**변경 시 영향:** 이미지 저장 안정성

---

### 2.5 Routes

**경로:** `src/index.ts` (라우트 정의), `src/routes/*.ts` (별도 라우터)

#### **Public Routes (인증 불필요)**

| 라우트 | 메서드 | 입력 | 반환 | 역할 |
|--------|--------|------|------|------|
| `/api/recommendations` | GET | companions, time, region, budget, indoor, category, limit | `{ success, items, meta }` | Phase 2 개인화 추천 |
| `/api/events` | GET | category, region, startDate, endDate, limit, offset | `{ success, events, total }` | 이벤트 검색 |
| `/api/events/:id` | GET | id | `{ success, event }` | 이벤트 상세 |
| `/api/events/:id/related` | GET | id, limit | `{ success, events }` | 관련 이벤트 |
| `/api/user-events` | GET | user_id, type (saved/viewed) | `{ success, events }` | 사용자 상호작용 |
| `/api/user-events/save` | POST | user_id, event_id | `{ success }` | 이벤트 저장 |
| `/api/user-events/unsave` | POST | user_id, event_id | `{ success }` | 저장 취소 |
| `/api/user-events/view` | POST | user_id, event_id | `{ success }` | 뷰 카운트 |

---

#### **Admin Routes (requireAdminAuth)**

| 라우트 | 메서드 | 입력 | 반환 | 역할 |
|--------|--------|------|------|------|
| `/admin/dashboard` | GET | - | `{ stats }` | 대시보드 통계 |
| `/admin/events` | GET | status, category, limit, offset | `{ events, total }` | 이벤트 관리 |
| `/admin/events/:id` | GET | id | `{ event }` | 이벤트 상세 (AI 제안 포함) |
| `/admin/events` | POST | title, category, dates, venue, ... | `{ success, event }` | 이벤트 생성 |
| `/admin/events/:id` | PUT | 변경 필드 | `{ success, event }` | 이벤트 수정 |
| `/admin/events/:id` | DELETE | id | `{ success }` | 이벤트 삭제 |
| `/admin/hot-suggestions` | GET | status (pending/approved/rejected) | `{ success, items, total }` | Hot Suggestions 목록 |
| `/admin/hot-suggestions/:id/approve` | POST | title, venue, dates, ... | `{ success, event }` | Hot Suggestion 승인 |
| `/admin/hot-suggestions/:id/reject` | POST | id | `{ success }` | Hot Suggestion 거부 |
| `/admin/ai-suggestions/:id/apply` | POST | id | `{ success }` | AI 제안 적용 |
| `/admin/ai-suggestions/:id/reject` | POST | id | `{ success }` | AI 제안 거부 |
| `/admin/image-upload` | POST | file (multipart) | `{ success, url }` | 이미지 업로드 |

---

#### **핵심 쿼리 (Performance Critical)**

**`/api/recommendations` 쿼리:**
```sql
SELECT * FROM canonical_events
WHERE
  metadata->'internal' IS NOT NULL
  AND (metadata->'internal'->'matching'->'companions' @> $1::jsonb)
  AND is_active = true
  AND end_at >= NOW()
ORDER BY hot_score DESC, created_at DESC
LIMIT $2
```

**최적화:**
- 인덱스: `(metadata->'internal')` GIN 인덱스
- 인덱스: `(is_active, end_at, hot_score)`

---

### 2.6 Jobs / Scheduler

**경로:** `src/jobs/*.ts`, `src/maintenance/*.ts`, `src/scripts/*.ts`

#### **Scheduled Jobs (from scheduler.ts)**

**⚠️ 중요: 스케줄러 활성화에는 `ENABLE_SCHEDULER=true` 환경변수가 필수입니다!**

| 시간 (KST) | 잡 파일 | 함수 | 업데이트 테이블 | 실행 시간 | 영향 |
|------------|---------|------|----------------|-----------|------|
| 01:00 | `cleanup/index.ts` | `runCleanupJob()` | canonical_events | ~5분 | `is_featured`, `deleted_at` |
| 02:00 | `updateMetadata.ts` | `updateMetadata()` | canonical_events | ~10분 | `is_ending_soon`, `popularity_score` |
| 02:30 | `updateBuzzScore.ts` | `updateBuzzScore()` | canonical_events, buzz_components | ~30분 | `buzz_score` |
| 03:00, 15:00 | `geoRefreshPipeline.ts` | `runGeoRefreshPipeline()` | raw_*, canonical_events | ~60분 | 신규 이벤트 생성 + AI 강화 |
| 03:30, 15:30 | `priceInfoBackfill.ts` | `runPriceInfoBackfill()` | canonical_events | ~15분 | `price_min`, `price_max` |
| ~~04:00~~ | ~~`aiEnrichmentBackfill.ts`~~ | ~~`aiEnrichmentBackfill()`~~ | ~~canonical_events, ai_suggestions~~ | ~~N/A~~ | **COMMENTED OUT** (이제 geoRefreshPipeline 내부에서 자동 실행) |
| 04:15 | `enrichInternalFields.ts` | `enrichInternalFields()` | canonical_events | ~30분 | `metadata.internal` |
| 04:30 | `recommend/index.ts` | `updateAutoRecommend()` | canonical_events | ~20분 | `hot_score` 재계산 |
| 08:00 | `scripts/ai-popup-discovery.ts` | `runPopupDiscovery()` | admin_hot_suggestions | ~10분 | 신규 팝업 발견 |
| 09:00 (월) | `scripts/ai-hot-rating.ts` | `runHotRating()` | buzz_components | ~30분 | `ai_hotness` |
| */10 분마다 (옵션) | `maintenance/cleanupStuckCollectionLogs.ts` | `cleanupStuckCollectionLogs()` | collection_logs | ~1분 | 실패 로그 정리 |

**📝 Note:** AI Enrichment는 이제 Geo Refresh Pipeline(03:00, 15:00) 내에서 자동으로 실행됩니다!
데이터 수집 직후 바로 AI 분석이 진행되므로 별도의 04:00 스케줄은 주석 처리되었습니다.

---

#### **Manual Backfill Jobs**

| 파일 | 커맨드 | 목적 | 실행 시간 | DB 영향 |
|------|--------|------|-----------|---------|
| **aiEnrichmentBackfill.ts** | `npm run backfill:ai-enrich` | AI 강화 (전체) | ~2시간 | canonical_events.metadata |
| **detailBackfill.ts** | `npm run backfill:detail` | 추가 상세 정보 | ~30분 | canonical_events |
| **overviewBackfill.ts** | `npm run backfill:overview` | 사용자 친화 설명 | ~1시간 | canonical_events.overview |
| **priceCoreBackfill.ts** | `npm run backfill:price-core` | 가격 정보 추출 | ~15분 | canonical_events.price_* |
| **geoBackfill.ts** | `npm run job:geoBackfill` | 지오코딩 | ~30분 | canonical_events.lat/lng |
| **addressBackfill.ts** | `npm run backfill:address` | 주소 채우기 | ~20분 | canonical_events.address |
| **displayFieldsBackfill.ts** | `npm run enrich:display` | 카테고리별 Rich 필드 | ~1시간 | canonical_events.metadata.display |

---

#### **Maintenance Jobs**

| 파일 | 커맨드 | 목적 | 주기 |
|------|--------|------|------|
| **cleanup/index.ts** | `npm run job:cleanup` | 만료 이벤트 정리, auto-unfeature | Daily 01:00 |
| **updateMetadata.ts** | `npm run metadata:update` | 메타데이터 갱신 | Daily 02:00 |
| **dedupeCanonicalEvents.ts** | `npm run dedupe:canonical` | 중복 제거 | On-demand |
| **reindexSearch.ts** | (미정의) | 검색 인덱스 재구축 | Weekly |

---

## 3) Migrations

**경로:** `migrations/*.sql`

### 최근 중요 마이그레이션

| 파일 | 날짜 | 변경 내역 | 영향 |
|------|------|-----------|------|
| `20260131_add_ai_suggestions.sql` | 2026-01-31 | ai_suggestions 테이블 생성 | AI 제안 워크플로우 |
| `20260130_add_manually_edited_fields.sql` | 2026-01-30 | manually_edited_fields 컬럼 추가 | Admin 편집 보호 |
| `20260130_add_metadata_for_phase2.sql` | 2026-01-30 | metadata.internal 스키마 정의 | Phase 2 추천 |
| `20260128_add_instagram_url.sql` | 2026-01-28 | instagram_url 컬럼 추가 | 소셜 링크 |
| `20260126_add_common_fields_phase1.sql` | 2026-01-26 | 통합 필드 스키마 | Phase 1 AI 추출 |
| `20260120_add_buzz_score_infrastructure.sql` | 2026-01-20 | buzz_components 테이블 생성 | Hot Score 인프라 |

### 마이그레이션 실행 방법

```bash
# 모든 마이그레이션 실행 (미정의)
# npm run migrate

# 특정 마이그레이션 실행
psql $DATABASE_URL -f migrations/20260131_add_ai_suggestions.sql

# 롤백 (수동)
psql $DATABASE_URL -f migrations/rollback/20260131_rollback.sql
```

---

## 4) Experiments / One-off Scripts

### 4.1 테스트 스크립트 (안전)

**경로:** `test_*.ts`

| 파일 | 목적 | DB 영향? | 실행 전 체크리스트 |
|------|------|---------|-------------------|
| `test_kakao_api.ts` | Kakao Maps API 테스트 | ❌ NO | API 키 유효성 |
| `test_naver_search.ts` | Naver 검색 API 테스트 | ❌ NO | API 키 유효성 |
| `test_gemini_simple.ts` | Gemini API 테스트 | ❌ NO | API 키 유효성 |
| `test_normalize.ts` | 정규화 로직 테스트 | ❌ NO | Mock 데이터 사용 |
| `test_normalize_v2.ts` | 정규화 v2 테스트 | ❌ NO | Mock 데이터 사용 |
| `test_vertex_ai.ts` | Google Vertex AI 테스트 | ❌ NO | GCP 인증 |
| `test_pororo_accuracy.ts` | 한국어 NER 정확도 측정 | ❌ NO | - |
| `test_naver-total-accuracy.ts` | Naver 정확도 측정 | ❌ NO | - |

**실행 방법:**
```bash
npx ts-node --transpile-only test_kakao_api.ts
```

---

### 4.2 실험 스크립트 (주의!)

**경로:** `src/scripts/test_*.ts`

| 파일 | 목적 | DB 영향? | 실행 전 체크리스트 |
|------|------|---------|-------------------|
| `test-ai-suggestions.ts` | AI 제안 시스템 테스트 | ⚠️ YES (ai_suggestions 테이블) | 1. 테스트 이벤트 ID 확인<br>2. Dry-run 모드 확인 |
| `test-manual-edit-protection.ts` | 수동 편집 보호 로직 검증 | ⚠️ YES (manually_edited_fields) | 1. 테스트 데이터 준비<br>2. 롤백 가능 확인 |
| `test-data-protection.ts` | 데이터 보호 로직 검증 | ⚠️ YES (canonical_events) | 1. 백업 완료 확인<br>2. 스테이징 테스트 |
| `test-exhibition-enrichment.ts` | 전시 강화 테스트 | ⚠️ YES (metadata.display) | 1. AI API 키 확인<br>2. 비용 한도 설정 |
| `test-festival-ai.ts` | 축제 AI 테스트 | ⚠️ YES | 1. 테스트 범위 제한<br>2. 결과 검증 |
| `test-phase2-suggestions.ts` | Phase 2 제안 테스트 | ⚠️ YES (metadata.internal) | 1. Phase 1 완료 확인<br>2. 결과 검증 |
| `test-hot-discovery-mock.ts` | Hot Discovery 모킹 | ⚠️ YES (admin_hot_suggestions) | 1. Mock 데이터 사용<br>2. 실제 승인 금지 |
| `test-category-display-backfill.ts` | 카테고리 Display 백필 | ⚠️ YES | 1. 대상 카테고리 제한<br>2. 비용 모니터링 |

**실행 방법:**
```bash
npx ts-node --transpile-only src/scripts/test-ai-suggestions.ts
```

---

### 4.3 백필 스크립트 (프로덕션 영향!)

**경로:** `backfill_*.ts`, `fix_*.ts`

| 파일 | 목적 | DB 영향 | 실행 전 체크리스트 |
|------|------|---------|-------------------|
| `backfill_*.ts` | 데이터 역채우기 | ✅ YES (대량 UPDATE) | 1. **DB 백업 완료**<br>2. Dry-run 실행<br>3. 영향 범위 파악 (SELECT COUNT)<br>4. 롤백 계획 수립<br>5. 스테이징 테스트 |
| `fix_*.ts` | 데이터 수정 | ✅ YES (UPDATE/DELETE) | 1. **DB 백업 완료**<br>2. WHERE 조건 검증<br>3. 변경 대상 확인<br>4. 롤백 SQL 준비<br>5. 트랜잭션 사용 |

**주의:**
- 프로덕션 DB에서 절대 테스트하지 말 것
- 항상 스테이징에서 먼저 실행
- 백업 없이 실행 금지

---

## 5) Admin Web Interface

**경로:** `admin-web/`

### 디렉토리 구조

```
admin-web/
├── src/
│   ├── pages/                  # 페이지 컴포넌트
│   │   ├── DashboardPage.tsx  # 대시보드
│   │   ├── EventsPage.tsx     # 이벤트 목록
│   │   ├── CreateEventPage.tsx # 이벤트 생성
│   │   ├── HotSuggestionsPage.tsx # Hot Suggestions 관리
│   │   └── LoginPage.tsx      # 로그인
│   ├── components/            # 공통 컴포넌트
│   ├── api.ts                 # API 클라이언트
│   ├── main.tsx               # 앱 엔트리
│   └── App.tsx                # 라우터
├── index.html
└── package.json
```

### 주요 페이지

| 페이지 | 파일 | 역할 | API |
|--------|------|------|-----|
| **Dashboard** | `DashboardPage.tsx` | 통계, 수집 현황 | `GET /admin/dashboard` |
| **Events** | `EventsPage.tsx` | 이벤트 목록, 검색, 필터 | `GET /admin/events` |
| **Event Detail** | `EventDetailPage.tsx` | 이벤트 상세, AI 제안 검토 | `GET /admin/events/:id` |
| **Create Event** | `CreateEventPage.tsx` | 수동 이벤트 생성 | `POST /admin/events` |
| **Hot Suggestions** | `HotSuggestionsPage.tsx` | AI 발굴 후보 승인/거부 | `GET /admin/hot-suggestions` |
| **Login** | `LoginPage.tsx` | Admin 인증 | - (localStorage) |

### 실행

```bash
cd admin-web
npm run dev              # 개발 모드 (port 5173)
npm run build           # 프로덕션 빌드 (dist/)
npm run preview         # 빌드 미리보기
```

---

## 6) 수정 포인트 TOP 10 (backend 기준)

| 순위 | 파일 경로 | 라인 수 | 왜 중요한가? | 자주 하는 변경 | 변경 영향 범위 |
|------|-----------|---------|-------------|--------------|--------------|
| **1** | `src/index.ts` | 5,908 | 모든 API 엔드포인트 정의 | 새 API 추가, 응답 포맷 변경, 유효성 검사 규칙, 미들웨어 순서 | **모든 클라이언트** (API 계약) |
| **2** | `src/lib/recommender.ts` | 795 | 추천 알고리즘 핵심 | 점수 가중치 튜닝 (distance, buzz, time, category, freshness), 필터 로직, 섹션 정의 | **모든 사용자 추천** |
| **3** | `src/scheduler.ts` | 249 | 모든 배치 작업 스케줄링 | 실행 시간 조정 (KST), 새 잡 추가, 순서 변경, 에러 핸들링 | **데이터 파이프라인 전체** |
| **4** | `src/lib/hotScoreCalculator.ts` | 459 | Featured 이벤트 순위 | Hot Score 공식 조정 (consensus, structural, performance, ai_hotness 가중치) | **Featured 탭 전체** |
| **5** | `src/jobs/aiEnrichmentBackfill.ts` | 754 | AI 강화 파이프라인 | Naver 쿼리 전략, Gemini 프롬프트, confidence 임계값, 비용 최적화 | **이벤트 데이터 품질** |
| **6** | `src/lib/naverApi.ts` | 913 | 데이터 수집 품질 | 검색 쿼리 최적화, 필터링 규칙, 점수화 로직, 레이트 리밋 핸들링 | **AI 입력 품질, Consensus 점수** |
| **7** | `src/lib/aiExtractor.ts` | 1,691 | AI 출력 품질 | 프롬프트 엔지니어링, 필드 추출 규칙, JSON 스키마, 에러 핸들링 | **이벤트 메타데이터 전체** |
| **8** | `src/lib/searchScoring.ts` | 341 | AI 입력 검증 | 만료 콘텐츠 필터, 도메인 권위 점수, 중복 제거, 품질 임계값 | **AI 추출 정확도** |
| **9** | `admin-web/src/pages/HotSuggestionsPage.tsx` | ~200 | 관리자 워크플로우 | UI/UX 개선, 승인 프로세스, 필터링, 정렬, 페이지네이션 | **Admin 효율성, 운영 비용** |
| **10** | `src/lib/enrichmentPolicy.ts` | ~100 | 자동화 수준 제어 | Confidence 임계값 (DEFAULT, AGGRESSIVE, CONSERVATIVE), 필드별 정책 | **AI 비용 vs 품질 트레이드오프** |

---

### TOP 10 선정 근거 (변경 빈도 + 영향 범위)

#### Tier 1 (거의 매주 변경)
- **#1 index.ts:** 모든 기능 요청은 API 변경을 수반
- **#2 recommender.ts:** 추천 품질 개선 = 핵심 비즈니스 로직
- **#3 scheduler.ts:** 데이터 신선도 = 사용자 경험 직결

#### Tier 2 (월 1-2회 변경)
- **#4 hotScoreCalculator.ts:** Featured 탭 = 메인 화면 = 높은 가시성
- **#5 aiEnrichmentBackfill.ts:** AI 비용 최적화 = 지속적 튜닝 필요
- **#6 naverApi.ts:** 검색 전략 = 데이터 커버리지 개선

#### Tier 3 (월 1회 또는 분기별)
- **#7 aiExtractor.ts:** 프롬프트 개선 = 품질 향상
- **#8 searchScoring.ts:** 필터링 규칙 = 노이즈 제거
- **#9 HotSuggestionsPage.tsx:** Admin UX = 운영 효율
- **#10 enrichmentPolicy.ts:** 정책 조정 = 비용 vs 품질 밸런스

---

### 변경 시 주의사항 (파일별)

#### #1 index.ts
- [ ] API 스펙 변경 시 클라이언트 팀 사전 공지
- [ ] 응답 포맷 변경 시 하위 호환성 유지
- [ ] 새 엔드포인트 추가 시 인증 미들웨어 확인
- [ ] Rate limit 설정 확인

#### #2 recommender.ts
- [ ] 가중치 변경 시 A/B 테스트 고려
- [ ] 필터 로직 변경 시 결과 수 모니터링
- [ ] 거리 계산 변경 시 성능 영향 측정

#### #3 scheduler.ts
- [ ] 실행 시간 변경 시 서버 부하 고려
- [ ] 새 잡 추가 시 실행 시간 예측
- [ ] 순서 변경 시 의존성 확인 (geo → AI → phase2)

#### #4 hotScoreCalculator.ts
- [ ] 공식 변경 시 기존 점수와 비교
- [ ] Consensus 가중치 변경 시 Naver API 비용 영향
- [ ] Performance Score 변경 시 KOPIS API 안정성 확인

#### #5 aiEnrichmentBackfill.ts
- [ ] 프롬프트 변경 시 비용 영향 계산
- [ ] Confidence 임계값 변경 시 Auto-apply 비율 모니터링
- [ ] 배치 크기 변경 시 메모리 사용량 확인

#### #6 naverApi.ts
- [ ] 쿼리 변경 시 결과 품질 검증
- [ ] 필터링 규칙 변경 시 결과 수 모니터링
- [ ] 레이트 리밋 변경 시 일일 쿼터 확인

#### #7 aiExtractor.ts
- [ ] 프롬프트 변경 시 샘플 테스트 (10개)
- [ ] JSON 스키마 변경 시 파싱 로직 업데이트
- [ ] Temperature 변경 시 일관성 검증

#### #8 searchScoring.ts
- [ ] 필터링 규칙 변경 시 결과 수 모니터링
- [ ] 도메인 권위 리스트 업데이트 시 점수 분포 확인
- [ ] 중복 제거 로직 변경 시 정확도 측정

#### #9 HotSuggestionsPage.tsx
- [ ] UI 변경 시 Admin 팀 사용성 테스트
- [ ] 승인 프로세스 변경 시 워크플로우 검증
- [ ] 필터링 변경 시 성능 영향 확인

#### #10 enrichmentPolicy.ts
- [ ] 임계값 변경 시 Auto-apply 비율 모니터링
- [ ] 정책 추가 시 기존 정책과 충돌 확인
- [ ] 필드별 임계값 변경 시 데이터 품질 검증

---

## 7) 파일 의존성 그래프 (주요 모듈)

```
src/index.ts (API Server)
  ├─ src/db.ts (Database Connection)
  ├─ src/scheduler.ts (Background Jobs)
  │   ├─ src/jobs/geoRefreshPipeline.ts
  │   │   ├─ src/collectors/kopisCollector.ts
  │   │   ├─ src/collectors/cultureCollector.ts
  │   │   ├─ src/collectors/tourApiCollector.ts
  │   │   └─ src/jobs/aiEnrichmentBackfill.ts (내부 호출)
  │   ├─ src/jobs/enrichInternalFields.ts
  │   │   └─ src/lib/internalFieldsGenerator.ts
  │   └─ src/jobs/updateBuzzScore.ts
  │       └─ src/lib/hotScoreCalculator.ts
  ├─ src/lib/recommender.ts (Recommendation)
  │   ├─ src/lib/cityZones.ts
  │   └─ src/lib/hotScoreCalculator.ts
  └─ src/lib/geocode.ts (Geocoding)
      └─ Kakao Maps API / Nominatim

src/jobs/aiEnrichmentBackfill.ts (AI Enrichment)
  ├─ src/lib/naverApi.ts
  ├─ src/lib/aiExtractor.ts
  ├─ src/lib/searchScoring.ts
  ├─ src/lib/confidenceCalculator.ts
  └─ src/lib/enrichmentPolicy.ts

src/scripts/ai-popup-discovery.ts (Hot Discovery)
  ├─ src/lib/aiExtractor.ts (Gemini Grounding)
  └─ src/db.ts

admin-web/src/main.tsx (Admin Dashboard)
  ├─ admin-web/src/pages/HotSuggestionsPage.tsx
  └─ admin-web/src/api.ts
      └─ Backend API (GET /admin/hot-suggestions)
```

---

## 8) 신규 파일 추가 시 체크리스트

### 새 Collector 추가 시
- [ ] `src/collectors/newCollector.ts` 생성
- [ ] API 클라이언트 함수 구현 (fetchData, parseData)
- [ ] `src/jobs/geoRefreshPipeline.ts`에 collector 추가
- [ ] 마이그레이션 생성 (`migrations/YYYYMMDD_add_raw_new_events.sql`)
- [ ] **이 파일맵 업데이트** (Section 2.1)

### 새 AI Extractor 추가 시
- [ ] `src/lib/displayFieldsGenerator/newExtractor.ts` 생성
- [ ] Gemini 프롬프트 정의 (JSON schema 포함)
- [ ] Confidence 계산 로직 추가
- [ ] 테스트 스크립트 작성 (`src/scripts/test-new-extractor.ts`)
- [ ] **이 파일맵 업데이트** (Section 2.3)

### 새 API Route 추가 시
- [ ] `src/index.ts`에 라우트 정의
- [ ] 인증 미들웨어 적용 (`requireAdminAuth` 또는 public)
- [ ] 입력 검증 (zod 또는 express-validator)
- [ ] 에러 핸들링 (try-catch + res.status)
- [ ] **이 파일맵 업데이트** (Section 2.5)

### 새 Scheduled Job 추가 시
- [ ] `src/jobs/newJob.ts` 생성
- [ ] `src/scheduler.ts`에 cron 등록
- [ ] 실행 시간 결정 (기존 잡과 충돌 방지)
- [ ] 에러 알림 설정 (Slack, Email 등)
- [ ] **이 파일맵 업데이트** (Section 2.6)

### 새 Admin Page 추가 시
- [ ] `admin-web/src/pages/NewPage.tsx` 생성
- [ ] `admin-web/src/App.tsx`에 라우트 추가
- [ ] API 클라이언트 함수 추가 (`admin-web/src/api.ts`)
- [ ] 네비게이션 메뉴 업데이트
- [ ] **이 파일맵 업데이트** (Section 5)

---

## 9) 트러블슈팅 (Backend 특화)

### Q1: AI Enrichment가 멈춤
**체크:**
- [ ] Gemini API 레이트 리밋? (15 RPM)
- [ ] Naver API 쿼터 소진? (25k/일)
- [ ] DB 커넥션 풀 고갈? (max: 20)
- [ ] 메모리 부족? (Node.js heap size)

**해결:**
```bash
# 레이트 리밋 확인
tail -f /tmp/backend*.log | grep "429"

# DB 커넥션 확인
SELECT count(*) FROM pg_stat_activity WHERE datname='fairpick';

# 메모리 사용량 확인
ps aux | grep node | awk '{print $6}'
```

---

### Q2: Scheduler가 실행 안됨
**체크:**
- [ ] `ENABLE_SCHEDULER=true` 설정?
- [ ] 서버 시간대 확인? (KST vs UTC)
- [ ] Cron 표현식 정확?

**해결:**
```bash
# 환경변수 확인
echo $ENABLE_SCHEDULER

# 서버 시간 확인
date

# 로그 확인
tail -f /tmp/backend*.log | grep "Scheduler"
```

---

### Q3: Hot Score가 0으로 계산됨
**체크:**
- [ ] buzz_components 테이블에 데이터 존재?
- [ ] Naver 검색 결과 없음? (쿼리 최적화 필요)
- [ ] Consensus 점수 계산 로직 에러?

**해결:**
```sql
-- buzz_components 확인
SELECT * FROM buzz_components WHERE event_id = 'xxx';

-- Hot Score 재계산
npm run update:buzz-score
```

---

### Q4: Geocoding 실패
**체크:**
- [ ] Kakao API 키 유효?
- [ ] Kakao 일일 쿼터 소진? (30k/일)
- [ ] 주소 형식 정규화?

**해결:**
```bash
# API 키 확인
curl -H "Authorization: KakaoAK $KAKAO_REST_API_KEY" \
  "https://dapi.kakao.com/v2/local/search/address.json?query=서울시 강남구"

# 수동 지오코딩
npm run job:geoBackfill
```

---

### Q5: Admin 대시보드 404
**체크:**
- [ ] Admin web 빌드 완료? (`npm run build`)
- [ ] Static 파일 서빙 경로 확인?
- [ ] Backend 서버 실행 중?

**해결:**
```bash
# Admin web 빌드
cd admin-web
npm run build

# Backend 서버 확인
curl http://localhost:5001/admin/dashboard
```

---

**문서 버전:** v1.1 (2026-02-07)
**다음 업데이트:** 주요 파일 추가/변경 시 즉시 반영
**관리자:** Backend 팀


---

<!-- AUTO-GENERATED:START -->
## Auto-Generated Backend Overview

**Generated on:** 2026-02-07

### Backend File Structure

| Directory | Files |
|-----------|-------|
| src/ | 98 |
| admin-web/ | 29 |
| migrations/ | 24 |

### Available NPM Scripts (55)

```bash

# Server
npm run build
npm run dev
npm run start
npm run start:api
npm run start:staging
npm run start:admin

# Collectors
npm run collect:tourapi
npm run collect:culture
npm run collect:kopis
npm run collect:naver-buzz
npm run collect:naver-buzz:test
npm run collect:naver-buzz:sampling

# Jobs
npm run pipeline:refresh
npm run job:collect
npm run job:cleanup
npm run job:geoBackfill
npm run job:venueBackfill
npm run pipeline:geoRefresh

# Backfill
npm run backfill:overview
npm run backfill:overview:dry
npm run backfill:detail
npm run backfill:detail:kopis
npm run backfill:detail:culture
npm run backfill:detail:dry
npm run backfill:price-core
npm run backfill:price-core:dry
npm run backfill:kopis-tickets
npm run backfill:kopis-relates

# Reports
npm run report:geo
npm run report:geoV2
npm run verify:nearby
npm run verify:price-core
npm run analyze:popularity
npm run audit:db-truth
npm run audit:common-fields:sql
npm run audit:common-fields

# Enrichment
npm run enrich:images
npm run backfill:ai-enrich:test
npm run backfill:ai-enrich:tags
npm run enrich:phase2
npm run enrich:phase2:stats
npm run enrich:display
```

### Key Files

- **src/index.ts** (5909 lines) - Main server entry point
- **src/scheduler.ts** (250 lines) - Cron job scheduler
- **src/db.ts** (640 lines) - Database connection

<!-- AUTO-GENERATED:END -->
