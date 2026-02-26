# Archive Tests Index

> **⚠️ 경고: 절대 CI에서 자동 실행하지 말 것**
> 
> 이 디렉토리의 테스트들은 실험/히스토리 보존 목적입니다.
> - DB 데이터 변경 가능 (UPDATE/INSERT/DELETE)
> - 외부 API 호출 (Rate Limit, 비용 발생 가능)
> - 수동 실행만 허용

## 빠른 참조 테이블

| Category | Path | Purpose | Needs DB | Needs Server | Needs External API | Risk | Run Command |
|----------|------|---------|----------|--------------|-------------------|------|-------------|
| **AI Suggestions** | `ai-suggestions/test-ai-suggestions.ts` | Phase 1 AI 제안 시스템 컬럼/신뢰도 검증 | ✅ Yes | ❌ No | ❌ No | 🟡 MED | `ts-node -r dotenv/config archive/tests/ai-suggestions/test-ai-suggestions.ts` |
| **AI Suggestions** | `ai-suggestions/test-phase2-suggestions.ts` | Phase 2 제안 시스템 API 엔드포인트 검증 | ✅ Yes | ✅ Yes | ❌ No | 🟡 MED | `ts-node -r dotenv/config archive/tests/ai-suggestions/test-phase2-suggestions.ts` |
| **API Integration** | `api-integration/test-kopis-detail-api.ts` | KOPIS 상세 API relateurl 필드 확인 | ❌ No | ❌ No | ✅ KOPIS | 🟢 LOW | `ts-node -r dotenv/config archive/tests/api-integration/test-kopis-detail-api.ts` |
| **API Integration** | `api-integration/test-vertex-ai.ts` | Vertex AI (Gemini 2.5) 연결 테스트 | ❌ No | ❌ No | ✅ Google Cloud | 🟢 LOW | `ts-node -r dotenv/config archive/tests/api-integration/test-vertex-ai.ts` |
| **API Integration** | `api-integration/test_kakao_api.ts` | Kakao 주소/키워드 검색 API 테스트 | ❌ No | ❌ No | ✅ Kakao | 🟢 LOW | `ts-node -r dotenv/config archive/tests/api-integration/test_kakao_api.ts` |
| **Category Enrichment** | `category-enrichment/test-category-display-backfill.ts` | 축제/행사/팝업 특화 필드 백필 실험 | ✅ Yes | ❌ No | ✅ Naver, Google | 🔴 HIGH | `npx tsx archive/tests/category-enrichment/test-category-display-backfill.ts` |
| **Category Enrichment** | `category-enrichment/test-exhibition-enrichment.ts` | 전시 카테고리 AI enrichment 검증 | ✅ Yes | ❌ No | ✅ Naver, Google | 🔴 HIGH | `ts-node -r dotenv/config archive/tests/category-enrichment/test-exhibition-enrichment.ts` |
| **Category Enrichment** | `category-enrichment/test-festival-ai.ts` | 특정 축제(대관령눈꽃축제) AI 추출 테스트 | ✅ Yes | ❌ No | ✅ Naver, Google | 🟡 MED | `ts-node -r dotenv/config archive/tests/category-enrichment/test-festival-ai.ts` |
| **Hot Discovery** | `hot-discovery/test-hot-discovery-mock.ts` | Mock 데이터로 Hot Discovery 파이프라인 테스트 | ✅ Yes | ❌ No | ✅ Google (AI) | 🔴 HIGH | `ts-node -r dotenv/config archive/tests/hot-discovery/test-hot-discovery-mock.ts` |
| **Naver API** | `naver-api/test-actual-query.ts` | 실제 venue 포함한 블로그 검색 쿼리 실험 | ❌ No | ❌ No | ✅ Naver | 🟢 LOW | `ts-node -r dotenv/config archive/tests/naver-api/test-actual-query.ts` |
| **Naver API** | `naver-api/test-naver-query-improvement.ts` | 쿼리 개선 (venue 추가) 효과 비교 | ❌ No | ❌ No | ✅ Naver | 🟢 LOW | `ts-node -r dotenv/config archive/tests/naver-api/test-naver-query-improvement.ts` |
| **Naver API** | `naver-api/test-naver-total-accuracy.ts` | 네이버 API total 값 정확도 검증 | ❌ No | ❌ No | ✅ Naver | 🟢 LOW | `ts-node -r dotenv/config archive/tests/naver-api/test-naver-total-accuracy.ts` |
| **Naver API** | `naver-api/test-past-event-pollution.ts` | 과거 이벤트가 검색에 오염되는지 확인 | ✅ Yes | ❌ No | ✅ Naver | 🟡 MED | `ts-node -r dotenv/config archive/tests/naver-api/test-past-event-pollution.ts` |
| **Naver API** | `naver-api/test-place-search.ts` | 네이버 플레이스 검색 단독 테스트 | ❌ No | ❌ No | ✅ Naver | 🟢 LOW | `ts-node -r dotenv/config archive/tests/naver-api/test-place-search.ts` |
| **Naver API** | `naver-api/test-pororo-accuracy.ts` | Pororo/KOPIS 정확도 비교 실험 | ❌ No | ❌ No | ✅ Naver | 🟢 LOW | `ts-node -r dotenv/config archive/tests/naver-api/test-pororo-accuracy.ts` |
| **Naver API** | `naver-api/test_naver_search.ts` | 특정 이벤트(쿠키런 팝업) 검색 테스트 | ❌ No | ❌ No | ✅ Naver | 🟢 LOW | `ts-node -r dotenv/config archive/tests/naver-api/test_naver_search.ts` |
| **Normalization** | `normalization/test_normalize.ts` | 이벤트 제목 정규화 로직 v1 테스트 | ❌ No | ❌ No | ❌ No | 🟢 LOW | `ts-node archive/tests/normalization/test_normalize.ts` |
| **Normalization** | `normalization/test_normalize_v2.ts` | 정규화 로직 v2 (지역 prefix/suffix 제거) | ❌ No | ❌ No | ❌ No | 🟢 LOW | `ts-node archive/tests/normalization/test_normalize_v2.ts` |
| **Specific Events** | `specific-events/test-snow-popup.ts` | 스노우 팝업 End-to-End 파이프라인 검증 | ✅ Yes | ❌ No | ✅ Naver, Google | 🔴 HIGH | `ts-node -r dotenv/config archive/tests/specific-events/test-snow-popup.ts` |
| **Specific Events** | `specific-events/test-vip-magic-show.ts` | VIP매직쇼 End-to-End 파이프라인 검증 | ✅ Yes | ❌ No | ✅ Naver, Google | 🔴 HIGH | `ts-node -r dotenv/config archive/tests/specific-events/test-vip-magic-show.ts` |

---

## 상세 파일별 정보

### AI Suggestions

#### `ai-suggestions/test-ai-suggestions.ts`
**목적**: Phase 1 AI 제안 시스템의 컬럼 존재 여부 및 신뢰도 계산 로직 검증

**의존성**:
- **DB**: PostgreSQL `canonical_events` 테이블 (SELECT + UPDATE)
- **External API**: 없음
- **Server**: 불필요

**위험도**: 🟡 **MED** - DB 데이터를 UPDATE하여 ai_suggestions 필드에 샘플 데이터 저장

**다시 쓰는 경우**:
- AI 제안 신뢰도 계산 로직 변경 시 회귀 테스트
- Phase 1 → Phase 2 마이그레이션 검증

**주의사항**:
- `canonical_events` 테이블에 실제 이벤트 데이터 필요
- UPDATE 쿼리로 테스트 데이터 저장 (프로덕션 DB에서 실행 금지)

---

#### `ai-suggestions/test-phase2-suggestions.ts`
**목적**: Phase 2 제안 시스템 `/admin/events/:id/enrich` API 엔드포인트 검증

**의존성**:
- **DB**: PostgreSQL `canonical_events` 테이블 (SELECT + UPDATE - ai_suggestions 초기화)
- **External API**: 없음 (Backend API만 호출)
- **Server**: ✅ **필수** - `localhost:5001` Backend 서버 실행 중이어야 함
- **Auth**: Admin 토큰 필요 (`fairpick-admin-2024`)

**위험도**: 🟡 **MED** - DB ai_suggestions 필드를 초기화하고 API 호출로 재생성

**다시 쓰는 경우**:
- AI 제안 생성 API 로직 변경 시
- 제안 저장/신뢰도 통계 검증

**주의사항**:
- Backend 서버 실행 필수 (`npm run dev`)
- Admin 인증 토큰 환경에 맞게 수정 필요
- 공연 카테고리 이벤트 필요

---

### API Integration

#### `api-integration/test-kopis-detail-api.ts`
**목적**: KOPIS 공공 API의 상세 응답 구조 확인 (relateurl 필드 존재 여부)

**의존성**:
- **DB**: 불필요
- **External API**: KOPIS API (`http://www.kopis.or.kr/openApi/restful`)
- **Env**: `KOPIS_SERVICE_KEY` (하드코딩됨: `bbef54b0049c4570b7b1f46f52b6dd8f`)
- **Server**: 불필요

**위험도**: 🟢 **LOW** - Read-only API 호출, DB 변경 없음

**다시 쓰는 경우**:
- KOPIS API 응답 구조 변경 확인
- 새로운 필드 추가 탐색

**주의사항**:
- 특정 mt20id (데스노트: `PF273019`) 하드코딩됨
- API 키 공개되어 있음 (공공 키로 추정)

---

#### `api-integration/test-vertex-ai.ts`
**목적**: Vertex AI (Gemini 2.5 Flash) 연결 및 간단한 텍스트 생성 테스트

**의존성**:
- **DB**: 불필요
- **External API**: Google Cloud Vertex AI
- **Env**: `GOOGLE_CLOUD_PROJECT`, Google Application Credentials
- **Server**: 불필요

**위험도**: 🟢 **LOW** - 간단한 인사 응답만 생성, 비용 최소

**다시 쓰는 경우**:
- Gemini 모델 연결 확인
- 새로운 모델 버전 테스트 (2.5 → 3.0 등)

**주의사항**:
- Google Cloud 인증 설정 필요 (ADC or Service Account)
- 비용 발생 가능 (소량)

---

#### `api-integration/test_kakao_api.ts`
**목적**: Kakao REST API (주소 검색, 키워드 검색) 연동 테스트

**의존성**:
- **DB**: 불필요
- **External API**: Kakao Local API (`https://dapi.kakao.com`)
- **Env**: `KAKAO_REST_API_KEY`
- **Server**: 불필요

**위험도**: 🟢 **LOW** - Read-only API 호출, DB 변경 없음

**다시 쓰는 경우**:
- Kakao API 지오코딩 정확도 확인
- 대체 지오코딩 솔루션 탐색

**주의사항**:
- API 키 필요 (`.env`에 설정)
- Rate Limit 주의

---

### Category Enrichment

#### `category-enrichment/test-category-display-backfill.ts`
**목적**: 축제/행사/팝업 카테고리별 특화 필드 AI 백필 실험

**의존성**:
- **DB**: PostgreSQL `canonical_events` 테이블 (SELECT + aiEnrichmentBackfill job 내부에서 UPDATE)
- **External API**: Naver (검색), Google (Gemini)
- **Env**: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `GOOGLE_CLOUD_PROJECT`
- **Server**: 불필요

**위험도**: 🔴 **HIGH** - `aiEnrichmentBackfill` job 호출로 DB 데이터 대량 변경 가능

**다시 쓰는 경우**:
- 카테고리별 특화 필드 추출 로직 개선 후 검증
- display 메타데이터 백필 전 테스트

**주의사항**:
- **testMode: true**로 설정되어 있으나 DB 변경 가능성 있음
- 프로덕션 DB에서 절대 실행 금지
- Naver/Google API Rate Limit 주의

---

#### `category-enrichment/test-exhibition-enrichment.ts`
**목적**: 전시 카테고리 이벤트의 Phase 3 필드 AI 추출 검증

**의존성**:
- **DB**: PostgreSQL `canonical_events` 테이블 (SELECT + UPDATE metadata)
- **External API**: Naver (검색), Google (Gemini)
- **Env**: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `GOOGLE_CLOUD_PROJECT`
- **Server**: 불필요

**위험도**: 🔴 **HIGH** - DB metadata 필드를 UPDATE하여 display 데이터 저장

**다시 쓰는 경우**:
- 전시 특화 필드 추출 로직 검증
- AI Enrichment 결과 품질 확인

**주의사항**:
- 전시 카테고리 이벤트 필요
- UPDATE 쿼리로 metadata 변경 (백업 권장)

---

#### `category-enrichment/test-festival-ai.ts`
**목적**: 특정 축제 이벤트(대관령눈꽃축제)로 AI 추출 파이프라인 테스트

**의존성**:
- **DB**: PostgreSQL `canonical_events` 테이블 (SELECT only, READ-ONLY)
- **External API**: Naver (검색), Google (Gemini)
- **Env**: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `GOOGLE_CLOUD_PROJECT`
- **Server**: 불필요

**위험도**: 🟡 **MED** - DB 읽기만 수행하나 외부 API 다량 호출

**다시 쓰는 경우**:
- 축제 카테고리 AI 추출 정확도 확인
- 특정 이벤트 디버깅

**주의사항**:
- 특정 festivalId 하드코딩 (`9721e6e7-ab51-4e2d-89b3-0026c50276a2`)
- 해당 이벤트가 DB에 없으면 실패

---

### Hot Discovery

#### `hot-discovery/test-hot-discovery-mock.ts`
**목적**: Mock 데이터로 Admin Hot Discovery 파이프라인 테스트 (Naver API Rate Limit 회피)

**의존성**:
- **DB**: PostgreSQL `admin_hot_suggestions` 테이블 (CREATE TABLE + INSERT + DELETE)
- **External API**: Google (Gemini - AI Seed 추출용)
- **Env**: `GOOGLE_CLOUD_PROJECT`
- **Server**: 불필요

**위험도**: 🔴 **HIGH** - `admin_hot_suggestions` 테이블 생성/수정, pending 데이터 삭제

**다시 쓰는 경우**:
- Hot Discovery 로직 변경 후 API 없이 빠른 검증
- Seed 추출/정규화 로직 테스트

**주의사항**:
- `admin_hot_suggestions` 테이블에 직접 접근
- 기존 pending 상태 데이터를 DELETE
- 프로덕션 DB에서 절대 실행 금지

---

### Naver API

#### `naver-api/test-actual-query.ts`
**목적**: 실제 DB에 저장된 venue를 사용한 네이버 블로그 검색 쿼리 실험

**의존성**:
- **DB**: 불필요
- **External API**: Naver Blog Search API
- **Env**: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`
- **Server**: 불필요

**위험도**: 🟢 **LOW** - Read-only API 호출, DB 변경 없음

**다시 쓰는 경우**:
- 쿼리 문자열 최적화 실험
- venue 포함 여부에 따른 검색 정확도 비교

**주의사항**:
- 하드코딩된 특정 이벤트 ("라흐마니노프의 위로")
- Naver API Rate Limit 주의

---

#### `naver-api/test-naver-query-improvement.ts`
**목적**: 쿼리에 venue 추가 시 검색 개선 효과 측정

**의존성**:
- **DB**: 불필요
- **External API**: Naver Blog Search API
- **Env**: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`
- **Server**: 불필요

**위험도**: 🟢 **LOW** - Read-only API 호출, DB 변경 없음

**다시 쓰는 경우**:
- 검색 쿼리 개선 전후 비교
- 노이즈 감소 효과 검증

**주의사항**:
- 특정 전시 ("사진이 할 수 있는 모든 것") 하드코딩
- Naver API 다량 호출 (30개 결과 요청)

---

#### `naver-api/test-naver-total-accuracy.ts`
**목적**: 네이버 API의 total 필드 값이 실제 검색 결과 수와 일치하는지 검증

**의존성**:
- **DB**: 불필요
- **External API**: Naver Blog Search API
- **Env**: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`
- **Server**: 불필요

**위험도**: 🟢 **LOW** - Read-only API 호출, DB 변경 없음

**다시 쓰는 경우**:
- Naver API total 필드 신뢰도 확인
- 검색 결과 수 기반 로직 검증

**주의사항**:
- 여러 쿼리로 연속 호출 (Rate Limit 주의)

---

#### `naver-api/test-past-event-pollution.ts`
**목적**: 과거 이벤트가 현재 검색 결과에 오염되는지 확인

**의존성**:
- **DB**: PostgreSQL `canonical_events` 테이블 (SELECT only)
- **External API**: Naver Blog Search API
- **Env**: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`
- **Server**: 불필요

**위험도**: 🟡 **MED** - DB 읽기 + 외부 API 호출

**다시 쓰는 경우**:
- 과거 이벤트 필터링 로직 검증
- 날짜 기반 검색 개선

**주의사항**:
- DB에서 특정 이벤트 조회 필요

---

#### `naver-api/test-place-search.ts`
**목적**: 네이버 플레이스 검색 API 단독 테스트

**의존성**:
- **DB**: 불필요
- **External API**: Naver Place Search API
- **Env**: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`
- **Server**: 불필요

**위험도**: 🟢 **LOW** - Read-only API 호출, DB 변경 없음

**다시 쓰는 경우**:
- 플레이스 검색 정확도 확인
- venue/address 추출 로직 검증

**주의사항**:
- 하드코딩된 검색어 (VIP매직쇼, 스노우 팝업 등)

---

#### `naver-api/test-pororo-accuracy.ts`
**목적**: Pororo와 KOPIS 데이터 정확도 비교 실험

**의존성**:
- **DB**: 불필요
- **External API**: Naver Blog Search API
- **Env**: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`
- **Server**: 불필요

**위험도**: 🟢 **LOW** - Read-only API 호출, DB 변경 없음

**다시 쓰는 경우**:
- Pororo 데이터 품질 검증
- KOPIS 대체 데이터 소스 탐색

**주의사항**:
- 특정 공연 데이터 하드코딩

---

#### `naver-api/test_naver_search.ts`
**목적**: 특정 이벤트(쿠키런 팝업)로 네이버 검색 테스트

**의존성**:
- **DB**: 불필요
- **External API**: Naver Search API (Place + Blog)
- **Env**: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`
- **Server**: 불필요

**위험도**: 🟢 **LOW** - Read-only API 호출, DB 변경 없음

**다시 쓰는 경우**:
- 특정 이벤트 검색 디버깅
- searchEventInfo 함수 동작 확인

**주의사항**:
- 하드코딩된 이벤트 ("쿠키런: 킹덤 아트 콜라보 프로젝트")

---

### Normalization

#### `normalization/test_normalize.ts`
**목적**: 이벤트 제목 정규화 로직 v1 테스트 (HTML 엔티티, 지역 prefix/suffix 제거)

**의존성**:
- **DB**: 불필요
- **External API**: 없음
- **Server**: 불필요

**위험도**: 🟢 **LOW** - 순수 함수 테스트, 외부 의존성 없음

**다시 쓰는 경우**:
- 정규화 로직 변경 후 회귀 테스트
- 새로운 케이스 추가 시

**주의사항**:
- 자체 함수 포함 (import 없음)
- dotenv 불필요

---

#### `normalization/test_normalize_v2.ts`
**목적**: 정규화 로직 v2 테스트 (v1 개선, 지역명 제거 강화)

**의존성**:
- **DB**: 불필요
- **External API**: 없음
- **Server**: 불필요

**위험도**: 🟢 **LOW** - 순수 함수 테스트, 외부 의존성 없음

**다시 쓰는 경우**:
- v1 → v2 비교 검증
- 정규화 규칙 확장 시

**주의사항**:
- 자체 함수 포함 (import 없음)
- dotenv 불필요

---

### Specific Events

#### `specific-events/test-snow-popup.ts`
**목적**: 스노우 팝업 이벤트로 End-to-End 파이프라인 검증 (검색 → AI 추출 → DB 저장)

**의존성**:
- **DB**: PostgreSQL `canonical_events` 테이블 (SELECT + UPDATE)
- **External API**: Naver (검색), Google (Gemini)
- **Env**: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `GOOGLE_CLOUD_PROJECT`
- **Server**: 불필요

**위험도**: 🔴 **HIGH** - UPDATE 쿼리로 이벤트 데이터 직접 변경

**다시 쓰는 경우**:
- 전체 파이프라인 End-to-End 검증
- 특정 팝업 이벤트 디버깅

**주의사항**:
- 특정 이벤트 ("스노우%롯데월드몰") 하드코딩
- UPDATE 쿼리로 derived_tags, opening_hours, price, external_links 변경
- 프로덕션 DB에서 절대 실행 금지

---

#### `specific-events/test-vip-magic-show.ts`
**목적**: VIP매직쇼 이벤트로 End-to-End 파이프라인 검증

**의존성**:
- **DB**: PostgreSQL `canonical_events` 테이블 (SELECT + UPDATE)
- **External API**: Naver (검색), Google (Gemini)
- **Env**: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `GOOGLE_CLOUD_PROJECT`
- **Server**: 불필요

**위험도**: 🔴 **HIGH** - UPDATE 쿼리로 이벤트 데이터 직접 변경

**다시 쓰는 경우**:
- 전체 파이프라인 End-to-End 검증
- 특정 공연 이벤트 디버깅

**주의사항**:
- 특정 이벤트 ("VIP매직쇼") 하드코딩
- UPDATE 쿼리로 이벤트 필드 변경
- 프로덕션 DB에서 절대 실행 금지

---

## 위험도 범례

- 🟢 **LOW**: Read-only 작업, DB/외부 의존성 없거나 최소
- 🟡 **MED**: DB 읽기 또는 소량 변경, 외부 API 호출
- 🔴 **HIGH**: DB 대량 변경 (UPDATE/INSERT/DELETE), 프로덕션 영향 가능

## 환경 변수 요구사항

실행 전 `backend/.env`에 다음 변수 설정 필요:

```env
# PostgreSQL
DATABASE_URL=postgresql://user:password@localhost:5432/fairpick

# Naver API (대부분의 테스트)
NAVER_CLIENT_ID=...
NAVER_CLIENT_SECRET=...

# Google Cloud (AI 관련 테스트)
GOOGLE_CLOUD_PROJECT=...
# + Application Default Credentials 설정

# Kakao API (지오코딩 테스트)
KAKAO_REST_API_KEY=...

# KOPIS (일부 테스트, 하드코딩되어 있음)
# KOPIS_SERVICE_KEY=... (선택)
```

---

**Last Updated**: 2026-02-09

