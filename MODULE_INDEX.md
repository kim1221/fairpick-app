# MODULE_INDEX

Last Updated: 2026-02-09

Admin API 상세 스펙은 `ADMIN_API_REFERENCE.md`를 기준으로 확인합니다.

## 1) API 엔트리/인증 모듈
- 파일: `backend/src/index.ts`
- 책임:
  - Express 앱 초기화
  - Public API/Admin API 라우트 등록
  - `requireAdminAuth`(`x-admin-key`) 인증
  - 서버 시작 시 scheduler 초기화
- 주요 입출력:
  - 입력: HTTP 요청, 헤더, query/body
  - 출력: JSON 응답
- 연관 문서: `ADMIN_API_REFERENCE.md`
Source: `backend/src/index.ts`

## 2) DB 액세스 모듈
- 파일: `backend/src/db.ts`
- 책임:
  - `pool` 제공
  - raw 이벤트 upsert (`upsertRawKopisEvent`, `upsertRawCultureEvent`, `upsertRawTourEvent`)
  - canonical upsert (`upsertCanonicalEvent`)
  - remerge 후 보정 (`updateCanonicalEventAfterRemerge`)
- 대표 시그니처:
  - `upsertCanonicalEvent(event: CanonicalEvent): Promise<void>`
  - `updateCanonicalEventAfterRemerge(id: string, fields: CanonicalEventUpdateFields): Promise<void>`
- 핵심 I/O:
  - 입력: 표준화 이벤트 객체(제목/기간/장소/jsonb 필드 포함)
  - 출력: `canonical_events` INSERT/UPDATE
Source: `backend/src/db.ts`

## 3) 환경설정 모듈
- 파일: `backend/src/config.ts`
- 책임: `.env` 로딩 및 런타임 설정 객체 제공
- 주요 키:
  - DB: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
  - API: `TOUR_API_KEY`, `KAKAO_REST_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`
  - 저장소: `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `AWS_REGION`, `CDN_BASE_URL`
Source: `backend/src/config.ts`

## 4) 수집/정규화 파이프라인 모듈
- 파일:
  - `backend/src/jobs/collect/index.ts`
  - `backend/src/collectors/kopisCollector.ts`
  - `backend/src/collectors/cultureCollector.ts`
  - `backend/src/collectors/tourApiCollector.ts`
  - `backend/src/jobs/dedupeCanonicalEvents.ts`
  - `backend/src/jobs/normalizeCategories.ts`
- 책임:
  - 다중 소스 수집 → canonical 정규화
  - 실행 로그 `collection_logs` 기록
- 대표 시그니처:
  - `runCollectionJob(): Promise<void>`
- 연관 라우트/잡:
  - 스케줄러에서 정기 실행 (`geo-refresh`, `collect` 연동)
Source: `backend/src/jobs/collect/index.ts`, `backend/src/scheduler.ts`

## 5) AI Enrichment 모듈
- 파일:
  - `backend/src/lib/aiExtractor.ts`
  - `backend/src/lib/naverApi.ts`
  - `backend/src/lib/searchScoring.ts`
  - `backend/src/lib/suggestionBuilder.ts`
  - `backend/src/lib/enrichmentPolicy.ts`
  - `backend/src/lib/enrichmentHelper.ts`
- 책임:
  - 네이버 검색 + Gemini 추출 + 제안 생성
  - 수동 편집 보호 정책 적용
- 대표 시그니처:
  - `extractEventInfo(...)`, `extractEventInfoEnhanced(...)`
  - `searchEventInfo(...)`, `searchEventInfoEnhanced(...)`
  - `buildSuggestionsFromAI(...)`, `buildSuggestionsFromAIDirect(...)`
- 연관 라우트:
  - `POST /admin/events/enrich-preview`
  - `POST /admin/events/:id/enrich`
  - `POST /admin/events/:id/enrich-ai-direct`
  - `POST /admin/events/:id/apply-suggestion`
  - `POST /admin/events/:id/dismiss-suggestion`
- 연관 문서: `ADMIN_API_REFERENCE.md`
Source: `backend/src/index.ts`, `backend/src/lib/`

## 6) 지오코딩/위치 모듈
- 파일: `backend/src/lib/geocode.ts`
- 책임:
  - Best-effort geocoding
  - 우선순위: Kakao address → Kakao keyword → Nominatim
- 대표 시그니처:
  - `geocodeBestEffort({ address?, venue? }): Promise<GeocodeBestEffortResult>`
- 연관 라우트:
  - `POST /admin/events`
  - `POST /admin/events/popup`
  - `POST /admin/hot-suggestions/:id/approve`
Source: `backend/src/lib/geocode.ts`, `backend/src/index.ts`

## 7) 이미지 업로드/DMCA 모듈
- 파일: `backend/src/lib/imageUpload.ts`
- 책임:
  - 이미지 검증/최적화(WebP)/S3-R2 업로드
  - 삭제 및 설정 검증
- 대표 시그니처:
  - `uploadEventImage(buffer, originalName, options): Promise<UploadResult>`
  - `deleteEventImage(key: string): Promise<void>`
  - `validateS3Config(): { valid: boolean; errors: string[] }`
- 연관 라우트:
  - `POST /admin/uploads/image`
  - `POST /admin/dmca/approve`
- 연관 문서: `ADMIN_API_REFERENCE.md`
Source: `backend/src/lib/imageUpload.ts`, `backend/src/index.ts`

## 8) 추천/스코어 모듈
- 파일:
  - `backend/src/lib/hotScoreCalculator.ts`
  - `backend/src/lib/recommender.ts`
  - `backend/src/jobs/updateBuzzScore.ts`
- 책임:
  - consensus/structural 기반 점수 계산
  - 추천 리스트 계산
- 대표 시그니처:
  - `calculateConsensusLight(event): Promise<number>`
  - `calculateStructuralScore(event): StructuralComponents`
  - `getTodaysPick(...)`, `getTrending(...)`, `getNearby(...)`
- 연관 라우트:
  - `/api/recommendations/v2/today`
  - `/api/recommendations/v2/trending`
  - `/api/recommendations/v2/nearby`
  - `/api/recommendations/v2/personalized`
  - `/api/recommendations/v2/weekend`
  - `/api/recommendations/v2/latest`
  - `/events/hot`, `/events/recommend`, `/events/nearby`
Source: `backend/src/lib/hotScoreCalculator.ts`, `backend/src/lib/recommender.ts`, `backend/src/index.ts`

## 9) 스케줄러/운영 안정화 모듈
- 파일:
  - `backend/src/scheduler.ts`
  - `backend/src/maintenance/cleanupStuckCollectionLogs.ts`
- 책임:
  - Cron 잡 등록/실행 보호(`runJobSafely`)
  - stuck `collection_logs` fail-safe 정리
- 관련 ENV:
  - `ENABLE_SCHEDULER`, `ENABLE_FAILSAFE`, `FAILSAFE_CRON`, `FAILSAFE_STUCK_MINUTES`
- 관련 API:
  - `GET /admin/metrics` (최근 수집 로그 표시)
Source: `backend/src/scheduler.ts`, `backend/src/maintenance/cleanupStuckCollectionLogs.ts`, `backend/src/index.ts`

## 10) 프론트 데이터 바인딩 모듈
- 파일:
  - `src/lib/http.ts`
  - `src/services/eventService.ts`
  - `src/services/adminService.ts`
- 책임:
  - API baseURL 및 요청 래핑
  - 이벤트 응답 → UI 타입 매핑
  - admin metrics/featured 호출
- 대표 시그니처:
  - `getEventList(params): Promise<{ items; totalCount }>`
  - `getEventById(id): Promise<EventCardData | undefined>`
  - `getAdminMetrics(): Promise<AdminMetricsResponse>`
- 연관 화면:
  - `pages/explore.tsx`, `pages/events/[id].tsx`, `src/pages/admin.tsx`
Source: `src/lib/http.ts`, `src/services/eventService.ts`, `src/services/adminService.ts`

## 11) 데이터 보호 관련 모듈
- 파일:
  - `backend/migrations/20260130_add_manually_edited_fields.sql`
  - `backend/src/lib/enrichmentPolicy.ts`
  - `backend/tests/integration/data-protection/`
- 책임:
  - 수동 편집 필드를 AI가 덮어쓰지 않도록 보호
- 관련 API:
  - `PATCH /admin/events/:id`
  - `POST /admin/events/:id/enrich` (`forceFields` 예외 처리)
- 연관 문서: `ADMIN_API_REFERENCE.md`
Source: 각 파일

## 12) TODO (불확실/정리 필요)
- TODO: `pages/`와 `src/pages/`가 병행되어 실제 라우트 소스가 화면별로 다릅니다. 라우트 단일 소스 정책 문서화 필요.
- TODO: `backend/README.md`와 실제 런타임/포트 설정(`backend/package.json`)의 불일치 정리가 필요.
