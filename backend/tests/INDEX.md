# Tests Index

> **회귀 테스트 후보 - 프로덕션 로직 검증**
> 
> 이 디렉토리의 테스트들은 현재 프로덕션 로직을 검증합니다.
> - 로직 변경 시 회귀 테스트로 실행 권장
> - CI/CD 통합 가능 (향후)
> - 실행 전제조건 필수 (DB, 환경변수, 인증)

## 실행 전제조건

### 필수 환경 설정

1. **PostgreSQL 연결**
   ```env
   DATABASE_URL=postgresql://user:password@localhost:5432/fairpick
   ```
   - `canonical_events` 테이블 필요
   - 테스트 데이터 (전시/공연 카테고리) 필요

2. **Naver API 키** (integration 테스트)
   ```env
   NAVER_CLIENT_ID=...
   NAVER_CLIENT_SECRET=...
   ```

3. **Google Cloud** (AI enrichment 테스트)
   ```env
   GOOGLE_CLOUD_PROJECT=...
   ```
   - Application Default Credentials 설정 필요

4. **Admin 인증** (admin-api 테스트만)
   - Backend 서버 실행 중: `localhost:5001`
   - Admin 토큰 또는 `requireAdminAuth` 미들웨어 통과
   - 별도 터미널에서 `npm run dev` 실행 필요

---

## 빠른 참조 테이블

| Category | Path | Purpose | Needs DB | Needs Server | Needs External API | Risk | Run Command |
|----------|------|---------|----------|--------------|-------------------|------|-------------|
| **Unit - Utils** | `unit/utils/test-parse-runtime.ts` | parseRuntime 함수 단위 테스트 | ❌ No | ❌ No | ❌ No | 🟢 LOW | `ts-node tests/unit/utils/test-parse-runtime.ts` |
| **Integration - Admin API** | `integration/admin-api/test-admin-manual-marking.ts` | Admin PATCH 수동 편집 마킹 검증 | ✅ Yes | ❌ No | ❌ No | 🟡 MED | `ts-node -r dotenv/config tests/integration/admin-api/test-admin-manual-marking.ts` |
| **Integration - AI Enrichment** | `integration/ai-enrichment/test-external-links.ts` | external_links 추출 정확도 검증 | ✅ Yes | ❌ No | ✅ Naver, Google | 🟡 MED | `ts-node -r dotenv/config tests/integration/ai-enrichment/test-external-links.ts` |
| **Integration - Data Protection** | `integration/data-protection/test-data-protection.ts` | 데이터 보호 정책 (빈 필드만 채우기) 검증 | ✅ Yes | ❌ No | ✅ Naver, Google | 🟢 LOW | `ts-node -r dotenv/config tests/integration/data-protection/test-data-protection.ts` |
| **Integration - Data Protection** | `integration/data-protection/test-manual-edit-logic.ts` | 수동 편집 로직 순수 함수 단위 테스트 | ❌ No | ❌ No | ❌ No | 🟢 LOW | `ts-node tests/integration/data-protection/test-manual-edit-logic.ts` |
| **Integration - Data Protection** | `integration/data-protection/test-manual-edit-marking.ts` | manually_edited_fields 마킹 로직 검증 | ✅ Yes | ❌ No | ❌ No | 🟡 MED | `ts-node -r dotenv/config tests/integration/data-protection/test-manual-edit-marking.ts` |
| **Integration - Data Protection** | `integration/data-protection/test-manual-edit-protection.ts` | aiEnrichmentBackfill 수동 편집 보호 검증 | ✅ Yes | ❌ No | ✅ Naver, Google | 🟡 MED | `ts-node -r dotenv/config tests/integration/data-protection/test-manual-edit-protection.ts` |

---

## 상세 파일별 정보

### Unit Tests

#### `unit/utils/test-parse-runtime.ts`
**목적**: `parseRuntime` 유틸리티 함수의 순수 로직 검증

**분류**: Unit Test

**의존성**:
- **DB**: 불필요
- **External API**: 없음
- **Server**: 불필요

**위험도**: 🟢 **LOW** - 순수 함수 테스트, 외부 의존성 전혀 없음

**다시 쓰는 경우**:
- `parseRuntime` 함수 로직 변경 시 회귀 테스트
- 새로운 시간 포맷 추가 시
- CI/CD에서 매 커밋마다 실행 가능

**주의사항**:
- dotenv 불필요
- 빠른 실행 (초 단위)
- 실패하면 즉시 수정 필요 (core util 함수)

---

### Integration Tests - Admin API

#### `integration/admin-api/test-admin-manual-marking.ts`
**목적**: Admin PATCH 엔드포인트의 `manually_edited_fields` 자동 마킹 로직 검증

**분류**: Integration Test (SQL 직접 실행)

**의존성**:
- **DB**: PostgreSQL `canonical_events` 테이블 (SELECT + UPDATE)
- **External API**: 없음
- **Server**: 불필요 (SQL 직접 실행, API 호출 안 함)

**위험도**: 🟡 **MED** - UPDATE 쿼리로 테스트 데이터 변경 후 원상복구

**다시 쓰는 경우**:
- Admin PATCH API 수동 편집 마킹 로직 변경 시
- manually_edited_fields JSONB 병합 동작 검증
- 회귀 테스트 (로직 변경 후 실행)

**주의사항**:
- 전시/공연 카테고리 이벤트 필요
- UPDATE 쿼리 실행 (테스트 후 cleanup 수행)
- 프로덕션 DB에서 주의해서 실행

**실행 흐름**:
1. 테스트 이벤트 조회
2. `manually_edited_fields` 초기화
3. SQL로 overview 수정 + 마킹
4. SQL로 derived_tags 수정 + 마킹
5. 결과 검증
6. 원상 복구

---

### Integration Tests - AI Enrichment

#### `integration/ai-enrichment/test-external-links.ts`
**목적**: 다양한 카테고리 이벤트에서 예매/티켓/예약 링크 추출 정확도 검증

**분류**: Integration Test (End-to-End 파이프라인)

**의존성**:
- **DB**: PostgreSQL `canonical_events` 테이블 (SELECT only, READ-ONLY)
- **External API**: Naver (검색), Google (Gemini AI 추출)
- **Env**: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `GOOGLE_CLOUD_PROJECT`
- **Server**: 불필요

**위험도**: 🟡 **MED** - DB 읽기 전용이나 외부 API 다량 호출

**다시 쓰는 경우**:
- `external_links` 추출 로직 개선 후 정확도 확인
- 네이버 플레이스 → official link 자동 설정 로직 검증
- 카테고리별 링크 추출 품질 비교

**주의사항**:
- 특정 이벤트 하드코딩 (VIP매직쇼, 스노우 팝업 등)
- 해당 이벤트가 DB에 없으면 실패
- API 요청 간 1초 delay (Rate Limit 방지)
- 외부 API 비용 발생 가능

**실행 흐름**:
1. 특정 이벤트 조회 (LIKE 쿼리)
2. 네이버 검색 (Place + Blog + Web)
3. AI 추출 (extractEventInfo)
4. external_links 결과 검증
5. 종합 통계 출력

---

### Integration Tests - Data Protection

#### `integration/data-protection/test-data-protection.ts`
**목적**: AI enrichment가 기존 데이터를 덮어쓰지 않고 빈 필드만 채우는지 검증

**분류**: Integration Test (Read-only 검증)

**의존성**:
- **DB**: PostgreSQL `canonical_events` 테이블 (SELECT only, READ-ONLY)
- **External API**: Naver (검색), Google (Gemini)
- **Env**: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `GOOGLE_CLOUD_PROJECT`
- **Server**: 불필요

**위험도**: 🟢 **LOW** - DB 읽기 전용, UPDATE 실행하지 않음 (would be 로그만 출력)

**다시 쓰는 경우**:
- 데이터 보호 정책 (빈 필드만 채우기) 회귀 테스트
- AI enrichment 로직 변경 후 검증
- 기존 데이터 보존 확인

**주의사항**:
- price_min/price_max/opening_hours 데이터가 있는 이벤트 필요
- 실제 UPDATE하지 않고 "would be UPDATED" 또는 "would be SKIPPED" 로그만 출력
- 안전한 테스트 (DB 변경 없음)

**실행 흐름**:
1. 기존 price 데이터가 있는 이벤트 조회
2. 네이버 검색 + AI 추출
3. 추출 결과와 기존 데이터 비교
4. "덮어쓸지" vs "건너뛸지" 판단 로그 출력

---

#### `integration/data-protection/test-manual-edit-logic.ts`
**목적**: `isManuallyEdited` 함수의 순수 로직 단위 테스트

**분류**: Unit Test (integration 폴더에 있으나 unit 성격)

**의존성**:
- **DB**: 불필요
- **External API**: 없음
- **Server**: 불필요

**위험도**: 🟢 **LOW** - 순수 함수 테스트, 외부 의존성 전혀 없음

**다시 쓰는 경우**:
- `isManuallyEdited` 로직 변경 시 회귀 테스트
- forceFields 동작 확인
- CI/CD에서 매 커밋마다 실행 가능

**주의사항**:
- 함수 복사본 포함 (테스트 격리)
- dotenv 불필요
- 빠른 실행 (초 단위)

**테스트 케이스**:
1. manually_edited_fields = null → false
2. manually_edited_fields = {} → false
3. manually_edited_fields.overview = true → true
4. forceFields 포함 시 → false (강제 재생성)
5. 다른 필드 마킹 시 → false

---

#### `integration/data-protection/test-manual-edit-marking.ts`
**목적**: `manually_edited_fields` JSONB 마킹 및 병합 로직 검증

**분류**: Integration Test (SQL 직접 실행)

**의존성**:
- **DB**: PostgreSQL `canonical_events` 테이블 (SELECT + UPDATE)
- **External API**: 없음
- **Server**: 불필요

**위험도**: 🟡 **MED** - UPDATE 쿼리로 테스트 데이터 변경 후 원상복구

**다시 쓰는 경우**:
- JSONB || 연산자 동작 확인
- 여러 필드 순차 마킹 시 병합 검증
- manually_edited_fields 구조 변경 시

**주의사항**:
- 전시/공연 카테고리 이벤트 필요
- UPDATE 쿼리 실행 (테스트 후 cleanup 수행)
- 프로덕션 DB에서 주의해서 실행

**실행 흐름**:
1. 테스트 이벤트 조회
2. derived_tags 수동 마킹
3. overview 추가 마킹
4. 특정 필드 확인 (PostgreSQL ->> 연산자)
5. 원상 복구

---

#### `integration/data-protection/test-manual-edit-protection.ts`
**목적**: `aiEnrichmentBackfill` job이 수동 편집된 필드를 보호하는지 검증

**분류**: Integration Test (Job 실행)

**의존성**:
- **DB**: PostgreSQL `canonical_events` 테이블 (SELECT + UPDATE - job 내부)
- **External API**: Naver (검색), Google (Gemini) - job 내부에서 호출
- **Env**: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `GOOGLE_CLOUD_PROJECT`
- **Server**: 불필요

**위험도**: 🟡 **MED** - `aiEnrichmentBackfill` job이 실제 DB 수정 (limit=1)

**다시 쓰는 경우**:
- aiEnrichmentBackfill 로직 변경 후 회귀 테스트
- forceFields 강제 재생성 동작 확인
- 수동 편집 보호 시스템 검증

**주의사항**:
- 전시/공연 카테고리 이벤트 필요 (derived_tags 있어야 함)
- **실제 UPDATE 실행** (limit=1로 제한되나 주의)
- 프로덕션 DB에서 실행 금지
- 테스트 후 manually_edited_fields 초기화

**실행 흐름**:
1. 테스트 이벤트 조회
2. derived_tags를 수동 편집으로 마킹
3. aiEnrichmentBackfill 실행 (forceFields: [])
4. derived_tags 변경 여부 확인 → 보호되어야 함 ✅
5. forceFields: ['derived_tags']로 재실행
6. 강제 재생성 확인 ✅
7. Cleanup

---

## 위험도 범례

- 🟢 **LOW**: Read-only 또는 순수 함수, DB 변경 없음
- 🟡 **MED**: DB 수정하나 테스트 후 원상복구, 또는 limit=1로 제한
- 🔴 **HIGH**: 대량 DB 변경, 프로덕션 영향 가능 (이 폴더에는 없음)

## CI/CD 통합 권장사항

### Unit Tests (빠름)
```bash
# 매 커밋마다 실행
ts-node tests/unit/utils/test-parse-runtime.ts
ts-node tests/integration/data-protection/test-manual-edit-logic.ts
```

### Integration Tests (느림, 선택적)
```bash
# PR/배포 시에만 실행
ts-node -r dotenv/config tests/integration/data-protection/test-data-protection.ts
ts-node -r dotenv/config tests/integration/data-protection/test-manual-edit-marking.ts
ts-node -r dotenv/config tests/integration/data-protection/test-manual-edit-protection.ts
```

### Admin API Tests (수동 전용)
```bash
# 로컬 개발 환경에서만 수동 실행
# Backend 서버 실행 후
ts-node -r dotenv/config tests/integration/admin-api/test-admin-manual-marking.ts
```

## 실행 순서 권장

1. **Unit Tests 먼저** (빠르고 안전)
   ```bash
   ts-node tests/unit/utils/test-parse-runtime.ts
   ts-node tests/integration/data-protection/test-manual-edit-logic.ts
   ```

2. **Read-only Integration Tests** (안전)
   ```bash
   ts-node -r dotenv/config tests/integration/data-protection/test-data-protection.ts
   ```

3. **DB 수정 Integration Tests** (주의)
   ```bash
   ts-node -r dotenv/config tests/integration/data-protection/test-manual-edit-marking.ts
   ts-node -r dotenv/config tests/integration/data-protection/test-manual-edit-protection.ts
   ts-node -r dotenv/config tests/integration/admin-api/test-admin-manual-marking.ts
   ```

4. **외부 API 호출 Tests** (비용/Rate Limit 주의)
   ```bash
   ts-node -r dotenv/config tests/integration/ai-enrichment/test-external-links.ts
   ```

---

**Last Updated**: 2026-02-09

