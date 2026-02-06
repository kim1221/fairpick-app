# REPO_FILE_MAP

이 문서는 Fairpick 레포 전체 구조를 설명하는 지도입니다. (AI/신규 기여자 온보딩용)

**마지막 업데이트:** 2026-02-07

---

## 1) Top-Level Overview

```
fairpick-app/
├── backend/                 # Node.js/Express API 서버 + 데이터 파이프라인
│   └── admin-web/           # React Admin 대시보드 (backend 하위)
├── pages/                   # Granite 클라이언트 앱 페이지
├── src/                     # 클라이언트 앱 소스 (pages 관련)
├── docs/                    # 문서
├── dist/                    # 빌드 산출물
├── node_modules/            # 의존성
└── package.json             # Monorepo 루트
```

### 폴더별 설명

| 폴더 | 설명 | 소유 책임 | 실행 방법 |
|------|------|-----------|-----------|
| **backend/** | 핵심 API 서버, 데이터 수집/정규화, AI 강화, 스케줄러 | Backend 팀 | `cd backend && npm run dev` (포트 5001) |
| **backend/admin-web/** | 관리자 웹 대시보드 (Hot Discovery 승인, 이벤트 관리) | Admin 팀 | `cd backend/admin-web && npm run dev` (포트 5173) |
| **pages/** | 사용자 대면 모바일 앱 (Granite 프레임워크) | Frontend 팀 | `npm run dev` (루트에서) |
| **src/** | 클라이언트 앱 소스 코드 | Frontend 팀 | - |
| **docs/** | 시스템 문서, API 명세 | All | - |

---

## 2) Runtime Components

### 2.1 Backend API (핵심 서버)

**엔트리포인트:**
- `backend/src/index.ts` (5,908 lines) - Express 앱 메인 파일
- 모든 API 라우트, 미들웨어, 인증 로직

**로컬 실행:**
```bash
cd backend
npm run dev                 # 개발 모드 (포트 5001)
npm run start:api          # 프로덕션
```

**배포 방식:**
- Production: `npm run start:api`
- Staging: `npm run start:staging`
- 환경변수: `.env` 파일 필수 (DATABASE_URL, GEMINI_API_KEY, NAVER_CLIENT_ID/SECRET, KAKAO_REST_API_KEY 등)

**주요 책임:**
- REST API 제공 (`/api/recommendations`, `/api/events`, `/admin/*`)
- 데이터 수집 스케줄러 실행 (KOPIS, Culture, Tour API)
- AI 강화 파이프라인 (Naver 검색 + Gemini 추출)
- Hot Score 계산 및 추천 알고리즘

---

### 2.2 Admin UI (관리자 대시보드)

**엔트리포인트:**
- `backend/admin-web/src/main.tsx` - React 19 앱
- `backend/admin-web/src/pages/*.tsx` - 페이지 컴포넌트

**로컬 실행:**
```bash
cd backend/admin-web
npm run dev                 # Vite 개발 서버 (포트 5173)
npm run build              # 프로덕션 빌드
```

**배포 방식:**
- Build: `npm run build` → `dist/` 폴더
- Serve: `npm run start:admin` (backend root에서, http-server on :4000)

**주요 기능:**
- Hot Suggestions 승인/거부 (`admin_hot_suggestions` 테이블 관리)
- 이벤트 수동 생성/편집
- AI 제안 검토 (`ai_suggestions` 테이블)
- 대시보드 (통계, 수집 현황)

---

### 2.3 Client (사용자 앱 - Apps-in-Toss)

**엔트리포인트:**
- `pages/` - Granite.js + React Native 페이지
- `src/` - 클라이언트 앱 소스

**로컬 실행:**
```bash
npm run dev                 # Granite 프레임워크 (루트에서)
npm run build              # 프로덕션 빌드
```

**배포 방식:**
- Toss Apps 플랫폼 배포 프로세스 (Granite 기반)

**주요 기능:**
- 개인화 추천 조회 (`/api/recommendations`)
- 이벤트 검색, 저장, 뷰 트래킹
- 사용자 상호작용 기록

---

## 3) Data & Infrastructure

### 3.1 DB 스키마 / 마이그레이션 위치

**경로:** `backend/migrations/*.sql`

**주요 테이블:**
- `canonical_events` - 모든 이벤트의 단일 진실 소스 (Single Source of Truth)
- `raw_kopis_events` / `raw_culture_events` / `raw_tour_events` - 외부 API Raw 데이터
- `admin_hot_suggestions` - AI Hot Discovery 후보 (pending → approved/rejected)
- `ai_suggestions` - AI 강화 제안 (필드별 confidence score)
- `event_views` / `user_saved_events` - 사용자 상호작용
- `buzz_components` - Hot Score 구성 요소 (consensus, structural, performance, ai_hotness)

**최근 중요 마이그레이션:**
- `20260131_add_ai_suggestions.sql` - AI 강화 워크플로우
- `20260130_add_manually_edited_fields.sql` - 관리자 수동 편집 추적
- `20260130_add_metadata_for_phase2.sql` - Phase 2 추천 메타데이터
- `20260126_add_common_fields_phase1.sql` - 통합 필드 스키마
- `20260120_add_buzz_score_infrastructure.sql` - Hot Score 인프라

---

### 3.2 배치 / 스케줄러 위치

**경로:** `backend/src/scheduler.ts` (249 lines) + `backend/src/jobs/*.ts`

**스케줄 (KST 기준, 실제 cron 확인 완료):**

| 시간 | 작업 | 모듈 | 목적 |
|------|-----|------|------|
| 01:00 | Cleanup | `jobs/cleanup/` | 자동 unfeature, 소프트 삭제 |
| 02:00 | Metadata Update | `jobs/updateMetadata.ts` | `is_ending_soon`, `popularity_score` |
| 02:30 | Buzz Score | `jobs/updateBuzzScore.ts` | 사용자 행동 기반 인기도 |
| 03:00 | Geo Refresh Pipeline | `jobs/geoRefreshPipeline.ts` | KOPIS + Culture + TourAPI 수집 + Dedupe + Normalize + **AI Enrichment 포함** |
| 03:30 | Price Info | `jobs/priceInfoBackfill.ts` | 페이로드에서 가격 정보 추출 |
| 04:15 | Phase 2 Fields | `jobs/enrichInternalFields.ts` | 추천 메타데이터 생성 |
| 04:30 | Recommend Update | `jobs/recommend/` | 추천 점수 재계산 |
| 08:00 | AI Popup Discovery | `scripts/ai-popup-discovery.ts` | 새 팝업 발굴 (Gemini Grounding) |
| 09:00 (월) | AI Hot Rating | `scripts/ai-hot-rating.ts` | 전시/공연 핫함 평가 |
| 15:00 | Geo Refresh Pipeline | `jobs/geoRefreshPipeline.ts` | 오후 수집 (03:00과 동일) |
| 15:30 | Price Info | `jobs/priceInfoBackfill.ts` | 오후 가격 추출 |
| */10 분마다 | Failsafe Cleanup | `maintenance/cleanupStuckCollectionLogs.ts` | 중단된 로그 정리 (선택적) |

**중요 변경사항:**
- ⚠️ **AI Enrichment (04:00)는 더 이상 독립 스케줄이 아닙니다.**
- 현재는 `geoRefreshPipeline` 내부에서 자동 실행됩니다 (03:00, 15:00).

**실행 방법:**
```bash
# 자동 (서버 시작 시):
ENABLE_SCHEDULER=true npm run dev

# 수동 (특정 잡):
npm run collect:kopis       # KOPIS 수집
npm run backfill:ai-enrich  # AI 강화 (수동)
npm run pipeline:refresh    # 전체 파이프라인
```

**환경변수:**
- `ENABLE_SCHEDULER=true` - 스케줄러 활성화 (기본: disabled)
- `ENABLE_FAILSAFE=false` - Failsafe 비활성화 (기본: enabled)
- `FAILSAFE_CRON=*/10 * * * *` - Failsafe 주기 (기본: 10분)

---

### 3.3 외부 API 클라이언트 위치

**경로:** `backend/src/lib/*.ts`

| 파일 | 서비스 | 인증 | 레이트 리밋 | 용도 |
|------|---------|------|-------------|------|
| **naverApi.ts** (913 lines) | Naver 검색 (Blog, Web, Place, Cafe) | NAVER_CLIENT_ID/SECRET | 25k req/일 | Consensus 점수, AI 입력 |
| **kopisApi.ts** | KOPIS 박스오피스 | KOPIS_API_KEY | ~5 req/sec | 공연 시그널 |
| **geocode.ts** | Kakao Maps → Nominatim fallback | KAKAO_REST_API_KEY | Kakao: 30k/일 | 위치 추출, 지역 추론 |
| **imageUpload.ts** | AWS S3 | AWS credentials | N/A | 이벤트 이미지 저장 |

**전략:**
- Kakao 주소 API (신뢰도: A) → Kakao 키워드 (B) → Nominatim (C) → 실패 (D)
- Naver 검색: 만료 콘텐츠 필터링, 도메인 권위 기반 점수화

---

## 4) AI & Hot Discovery 파이프라인 위치

### 완전한 데이터 흐름도

```
┌─────────────────────────────────────────────────────────────┐
│                  DATA COLLECTION PHASE                       │
│  경로: backend/src/collectors/*.ts                           │
└─────────────────────────────────────────────────────────────┘
    KOPIS API → raw_kopis_events
    Culture API → raw_culture_events
    Tour API → raw_tour_events

        ↓ (Dedupe + Normalize)

┌─────────────────────────────────────────────────────────────┐
│              CANONICAL EVENTS REPOSITORY                     │
│  경로: DB 테이블 canonical_events                            │
│  (모든 추천의 단일 진실 소스)                                 │
└─────────────────────────────────────────────────────────────┘

    ↓ ↓ ↓ (3개 병렬 강화 경로)

PATH A: AI ENRICHMENT (자동, geoRefreshPipeline 내부 실행)
    경로: backend/src/jobs/aiEnrichmentBackfill.ts
    Naver API (Blog + Web 검색)
        ↓ backend/src/lib/naverApi.ts
    Gemini 추출 (구조화 필드)
        ↓ backend/src/lib/aiExtractor.ts
    Confidence 점수화
        ↓ backend/src/lib/confidenceCalculator.ts
    Auto-apply (>80%) OR Suggest (0-80%)
        ↓ backend/src/lib/enrichmentPolicy.ts
    canonical_events.metadata 강화됨

PATH B: HOT DISCOVERY (AI-Powered)
    경로: backend/src/scripts/ai-popup-discovery.ts (daily 08:00)
    경로: backend/src/scripts/ai-hot-rating.ts (weekly Mon 09:00)
    Gemini Grounding (Google Search)
        ↓
    admin_hot_suggestions (status: pending)
        ↓
    Admin 검토 (backend/admin-web/src/pages/HotSuggestionsPage.tsx)
        ↓
    승인 → canonical_events

PATH C: INTERNAL FIELDS (Phase 2 - 추천 준비)
    경로: backend/src/lib/internalFieldsGenerator.ts
    derived_tags → matching fields (companions, age, mood)
    opening_hours → timing availability
    lat/lng → location fields
        ↓
    metadata.internal (개인화 추천용)

┌─────────────────────────────────────────────────────────────┐
│            RECOMMENDATION & HOT SCORE CALCULATION             │
│  경로: backend/src/lib/recommender.ts                        │
│  경로: backend/src/lib/hotScoreCalculator.ts                 │
└─────────────────────────────────────────────────────────────┘
    hot_score = Consensus + Structural + Performance + Internal
        ↓
    is_featured, ranking_order

┌─────────────────────────────────────────────────────────────┐
│                   CLIENT RECOMMENDATION                      │
│  경로: backend/src/index.ts (GET /api/recommendations)       │
│  필터: companions, time, region, budget, indoor, category    │
└─────────────────────────────────────────────────────────────┘
```

### 각 단계별 핵심 파일

| 단계 | 파일 경로 | 역할 |
|------|-----------|------|
| **수집** | `src/collectors/kopisCollector.ts` | KOPIS 공연 수집 |
| | `src/collectors/cultureCollector.ts` | 문화 이벤트 수집 |
| | `src/collectors/tourApiCollector.ts` | 관광 축제 수집 |
| **정규화** | `src/jobs/geoRefreshPipeline.ts` | Dedupe + Normalize + Geocode + AI Enrichment |
| **후보 발굴** | `src/scripts/ai-popup-discovery.ts` | AI가 새 팝업 찾기 (Gemini Grounding) |
| | `src/scripts/ai-hot-rating.ts` | AI가 핫함 평가 (전시/공연) |
| **검증** | `admin-web/src/pages/HotSuggestionsPage.tsx` | 관리자 승인 UI |
| **승인** | `src/index.ts` (POST /admin/hot-suggestions/:id/approve) | 승인 → canonical_events 생성 |
| **AI 강화** | `src/jobs/aiEnrichmentBackfill.ts` | Naver + Gemini 데이터 보강 |
| **추천 준비** | `src/lib/internalFieldsGenerator.ts` | Phase 2 메타데이터 생성 |
| **점수 계산** | `src/lib/hotScoreCalculator.ts` | Hot Score 알고리즘 |
| **추천 API** | `src/lib/recommender.ts` | 개인화 추천 로직 |

---

## 5) Tests / Experiments

### 5.1 프로덕션에 영향 주는 스크립트 (주의!)

**경로:** `backend/test_*.ts`, `backend/backfill_*.ts`, `backend/fix_*.ts`

| 파일 | 목적 | DB 영향? | 실행 전 체크리스트 |
|------|------|---------|-------------------|
| `backfill_*.ts` | 데이터 역채우기 | ✅ YES | 1. DB 백업 확인<br>2. Dry-run 모드 확인<br>3. 영향 범위 파악 |
| `fix_*.ts` | 데이터 수정 | ✅ YES | 1. 변경 대상 수 확인<br>2. 롤백 계획 수립<br>3. 스테이징 테스트 |
| `test_*.ts` | API/기능 테스트 | ❌ NO | Read-only 확인 |

### 5.2 안전한 테스트 스크립트

**경로:** `backend/test_*.ts`, `backend/src/scripts/test_*.ts`

| 파일 | 목적 | 안전성 |
|------|------|--------|
| `test_kakao_api.ts` | Kakao Maps API 테스트 | ✅ 안전 (Read-only) |
| `test_naver_search.ts` | Naver 검색 API 테스트 | ✅ 안전 |
| `test_gemini_simple.ts` | Gemini API 테스트 | ✅ 안전 |
| `test_normalize.ts` | 정규화 로직 테스트 | ✅ 안전 (Mock 데이터) |
| `test_pororo_accuracy.ts` | 한국어 NER 정확도 측정 | ✅ 안전 |

### 5.3 실험 스크립트 (Adhoc 도구)

**경로:** `backend/src/scripts/test_*.ts`

| 파일 | 목적 | 실행 시나리오 |
|------|------|--------------|
| `test-ai-suggestions.ts` | AI 제안 시스템 테스트 | 새 AI 필드 추가 시 |
| `test-manual-edit-protection.ts` | 수동 편집 보호 로직 검증 | Admin 편집 충돌 방지 |
| `test-exhibition-enrichment.ts` | 전시 카테고리 강화 테스트 | 전시 특화 필드 개발 |
| `test-hot-discovery-mock.ts` | Hot Discovery 모킹 | AI API 비용 없이 테스트 |

---

## 6) 수정 포인트 TOP 10 (레포 기준)

| 순위 | 파일 경로 | 라인 수 | 왜 중요한가? | 자주 하는 변경 |
|------|-----------|---------|-------------|--------------|
| **1** | `backend/src/index.ts` | 5,908 | 모든 API 엔드포인트 정의 | 새 API 추가, 응답 포맷 변경, 유효성 검사 규칙 |
| **2** | `backend/src/lib/recommender.ts` | 795 | 추천 알고리즘 핵심 | 점수 가중치 튜닝 (distance, buzz, time, category), 필터 로직 |
| **3** | `backend/src/scheduler.ts` | 249 | 모든 배치 작업 스케줄링 | 실행 시간 조정, 새 잡 추가, 순서 변경 |
| **4** | `backend/src/lib/hotScoreCalculator.ts` | 459 | Featured 이벤트 순위 결정 | Hot Score 공식 조정 (consensus, structural, performance) |
| **5** | `backend/src/jobs/aiEnrichmentBackfill.ts` | 754 | AI 강화 파이프라인 | Naver 쿼리 전략, Gemini 프롬프트, confidence 임계값 |
| **6** | `backend/src/lib/naverApi.ts` | 913 | 데이터 수집 품질 | 검색 쿼리 최적화, 필터링 규칙, 점수화 로직 |
| **7** | `backend/src/lib/aiExtractor.ts` | 1,691 | AI 출력 품질 | 프롬프트 엔지니어링, 필드 추출 규칙, 에러 핸들링 |
| **8** | `backend/src/lib/searchScoring.ts` | 341 | AI 입력 검증 | 만료 콘텐츠 필터, 도메인 권위 점수, 중복 제거 |
| **9** | `backend/admin-web/src/pages/HotSuggestionsPage.tsx` | ~200 | 관리자 워크플로우 효율성 | UI/UX 개선, 승인 프로세스, 필터링 |
| **10** | `backend/src/lib/enrichmentPolicy.ts` | ~100 | 자동화 수준 제어 | Confidence 임계값 (auto-apply vs suggest), 정책 규칙 |

### TOP 10 선정 근거

**빈도 기준:**
- #1-3: 거의 모든 기능 요청에 관련 (주 1회 이상 변경)
- #4-6: 데이터 품질/추천 품질 개선 시 (월 1-2회)
- #7-10: AI 비용 최적화, Admin UX 개선 시 (월 1회)

**영향 범위:**
- #1: 모든 클라이언트 (API 계약 변경)
- #2, #4: 모든 사용자 추천 (알고리즘 변경)
- #5-8: 이벤트 데이터 품질 (사용자 경험)
- #9: 관리자 효율성 (운영 비용)
- #10: AI 비용 vs 품질 트레이드오프

---

## 7) 신규 개발자 온보딩 체크리스트

### 7.1 환경 설정
- [ ] PostgreSQL 설치 및 DB 생성 (`fairpick`)
- [ ] `.env` 파일 설정 (모든 API 키 확보)
- [ ] `npm install` (루트 및 backend, backend/admin-web)
- [ ] 마이그레이션 실행: `cd backend && npm run migrate` (TODO: migrate script 확인 필요)

### 7.2 로컬 실행
- [ ] Backend 서버 시작: `cd backend && npm run dev` (포트 5001)
- [ ] Admin 대시보드 시작: `cd backend/admin-web && npm run dev` (포트 5173)
- [ ] 클라이언트 앱 시작: `npm run dev` (루트에서)

### 7.3 데이터 수집 테스트
- [ ] KOPIS 수집: `npm run collect:kopis`
- [ ] Culture 수집: `npm run collect:culture`
- [ ] AI 강화 테스트: `npm run backfill:ai-enrich:test`

### 7.4 Admin 워크플로우 체험
- [ ] Admin 대시보드 접속 (http://localhost:5173)
- [ ] Hot Suggestions 페이지 확인
- [ ] 이벤트 수동 생성 테스트
- [ ] AI 제안 검토 및 승인

### 7.5 추천 API 테스트
```bash
curl "http://localhost:5001/api/recommendations?region=서울&companions=커플&limit=10"
```

---

## 8) 주요 커맨드 치트시트

### 서버 실행
```bash
# Backend
cd backend
npm run dev                    # 개발 서버 (포트 5001)
npm run start:api             # 프로덕션
npm run start:staging         # 스테이징

# Admin UI
cd backend/admin-web
npm run dev                    # Vite 개발 서버 (포트 5173)
npm run build                 # 프로덕션 빌드

# Client App
npm run dev                    # Granite 개발 (루트에서)
npm run build                 # 프로덕션 빌드
```

### 데이터 수집
```bash
cd backend
npm run collect:kopis         # KOPIS 공연
npm run collect:culture       # 문화 이벤트
npm run collect:tourapi       # 관광 축제
npm run pipeline:refresh      # 전체 파이프라인 (수집 + 정규화)
npm run pipeline:geoRefresh   # Geo 파이프라인 (수집 + 지오코딩 + dedupe)
```

### AI 강화
```bash
cd backend
npm run backfill:ai-enrich          # 전체 AI 강화
npm run backfill:ai-enrich:test     # 테스트 (소수)
npm run backfill:ai-enrich:tags     # 태그만
npm run enrich:phase2               # Phase 2 메타데이터
npm run enrich:display              # 카테고리별 Display 필드
```

### Hot Discovery
```bash
cd backend
# 스케줄러로 자동 실행 (08:00 KST)
# 수동 실행 시 (TODO: 실행 방법 확인 필요)
```

### 유지보수
```bash
cd backend
npm run job:cleanup          # 정리 잡
npm run metadata:update      # 메타데이터 업데이트
npm run update:buzz-score    # Hot Score 재계산
npm run job:geoBackfill      # 지오코딩 백필
```

---

## 9) 아키텍처 결정 기록 (ADR)

### 왜 Gemini API를 선택했는가?
- **이유:** Google Search Grounding 기능 (실시간 웹 검색 + AI 추출)
- **비용:** ~$0.001/이벤트 (GPT-4보다 저렴)
- **품질:** 한국어 NER 정확도 우수 (Pororo보다 유연)

### 왜 Naver 검색 API를 사용하는가?
- **이유:** 한국 로컬 콘텐츠 커버리지 최고 (블로그, 카페, 웹)
- **대안:** Google Custom Search (비용 10배), 직접 크롤링 (법적 리스크)

### 왜 Phase 2 메타데이터를 분리했는가?
- **이유:** AI 추출 비용 절감 + 추천 로직 분리
- **구조:** Phase 1 (AI 추출) → Phase 2 (규칙 기반 변환)
- **장점:** Phase 2는 무료, Phase 1은 1회만 실행

### 왜 admin_hot_suggestions 테이블을 만들었는가?
- **이유:** AI 발굴 이벤트를 자동으로 canonical_events에 넣으면 품질 위험
- **프로세스:** AI 발굴 → pending → 관리자 검토 → 승인 → canonical_events
- **효과:** 데이터 품질 보장 + 관리자 통제

### 왜 AI Enrichment를 geoRefreshPipeline에 통합했는가?
- **이유:** 데이터 수집 직후 즉시 AI 분석이 더 효율적
- **변경 전:** 수집 (03:00) → 대기 → AI (04:00)
- **변경 후:** 수집 + AI (03:00, 한 번에)
- **장점:** 지연 시간 단축, 신규 데이터 즉시 활용

---

## 10) 트러블슈팅 가이드

### Q1: Backend 서버가 시작되지 않음
**체크:**
- [ ] PostgreSQL 실행 중? (`pg_isready`)
- [ ] `.env` 파일 존재? (모든 필수 변수 설정?)
- [ ] 포트 5001 사용 중? (`lsof -i :5001`)
- [ ] 마이그레이션 실행? (TODO: migrate 커맨드 확인)

### Q2: AI 강화가 실패함
**체크:**
- [ ] GEMINI_API_KEY 유효?
- [ ] NAVER_CLIENT_ID/SECRET 유효?
- [ ] 레이트 리밋 초과? (Gemini: 15 RPM, Naver: 25k/일)
- [ ] 네트워크 연결 정상?

### Q3: 추천 결과가 비어있음
**체크:**
- [ ] canonical_events에 데이터 존재? (`SELECT COUNT(*) FROM canonical_events`)
- [ ] metadata.internal 존재? (`SELECT COUNT(*) FROM canonical_events WHERE metadata->'internal' IS NOT NULL`)
- [ ] Phase 2 강화 실행? (`npm run enrich:phase2`)
- [ ] 필터 조건 너무 엄격? (region, companions, category 완화)

### Q4: Hot Discovery가 중복 발견
**체크:**
- [ ] `isAlreadyInDB()` 함수 정상 작동? (title + venue 매칭)
- [ ] 정규화 로직 문제? (공백, 대소문자, 특수문자 제거)
- [ ] DB 인덱스 존재? (title, venue 컬럼)

### Q5: Scheduler가 실행 안됨
**체크:**
- [ ] `ENABLE_SCHEDULER=true` 환경변수 설정?
- [ ] 서버 시간대가 KST인지 확인? (Docker: TZ=Asia/Seoul)
- [ ] 로그에서 `[Scheduler]` 메시지 확인

---

**문서 버전:** v1.1 (2026-02-07)
**다음 업데이트:** 주요 아키텍처 변경 시 또는 분기별
**변경 이력:** backend/CHANGELOG.md 참조


---

<!-- AUTO-GENERATED:START -->
## Auto-Generated Repository Overview

**Generated on:** 2026-02-07

### Repository Structure

| Directory | File Count |
|-----------|------------|
| Root | 38 |
| Backend | 84 |
| Backend/src | 98 |
| Backend/admin-web | 29 |
| Pages | 14 |
| Src | 79 |
| Docs | 2 |
| Migrations | 24 |

### Scheduler Jobs (11 active)

| Time | Cron | Job Name | Module | Status |
|------|------|----------|--------|--------|
| 03:00 | `0 3 * * *` | geo-refresh-03 | runJobSafely | Active |
| 15:00 | `0 15 * * *` | geo-refresh-15 | runJobSafely | Active |
| 01:00 | `0 1 * * *` | cleanup | runJobSafely | Active |
| 02:00 | `0 2 * * *` | metadata | runJobSafely | Active |
| 02:30 | `30 2 * * *` | buzz-score | runJobSafely | Active |
| 03:30 | `30 3 * * *` | price-info | runJobSafely | Active |
| 15:30 | `30 15 * * *` | price-info-15 | runJobSafely | Active |
| ~~04:00~~ | `0 4 * * *` | ~~ai-enrichment~~ | runJobSafely | (주석 처리) |
| 04:15 | `15 4 * * *` | phase2-internal-fields | runJobSafely | Active |
| 04:30 | `30 4 * * *` | recommend | runJobSafely | Active |
| 08:00 | `0 8 * * *` | ai-popup-discovery | runJobSafely | Active |
| 09:00 (Mon) | `0 9 * * 1` | ai-hot-rating | runJobSafely | Active |

**Timezone:** Asia/Seoul

<!-- AUTO-GENERATED:END -->
