# RUNBOOK

Last Updated: 2026-02-09

## 1) 로컬 실행
### 1-1. Frontend 앱
```bash
cd /Users/kimsungtae/toss/fairpick-app
npm run dev
```
Source: `package.json`

### 1-2. Backend API
```bash
cd /Users/kimsungtae/toss/fairpick-app/backend
npm run dev
```
- `backend/package.json`에서 dev는 `PORT=5001` 주입
- 서버 코드 기본값은 `process.env.PORT ?? 4000`
Source: `backend/package.json`, `backend/src/index.ts`

### 1-3. 헬스 체크
```bash
curl -sS http://127.0.0.1:5001/health
```
Source: `backend/src/index.ts`

## 2) 테스트 실행 가이드
### 2-1. Unit/Integration (활성 테스트)
```bash
cd /Users/kimsungtae/toss/fairpick-app/backend

# 예시: unit
TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
ts-node tests/unit/utils/test-parse-runtime.ts

# 예시: integration
ts-node -r dotenv/config tests/integration/data-protection/test-data-protection.ts
ts-node -r dotenv/config tests/integration/admin-api/test-admin-manual-marking.ts
```
Source: `backend/tests/README.md`

### 2-2. Archive 테스트 (참조/수동 실행)
```bash
cd /Users/kimsungtae/toss/fairpick-app/backend
ts-node -r dotenv/config archive/tests/<category>/<test-file>.ts
```
- 프로덕션/CI 파이프라인에 포함되지 않음
Source: `backend/archive/tests/README.md`

## 3) 운영성 체크 포인트
### 3-1. 스케줄러
- 활성화 조건: `ENABLE_SCHEDULER=true`
- 등록 위치: `initScheduler()`
- 서버 시작 시 자동 호출
Source: `backend/src/scheduler.ts`, `backend/src/index.ts`

### 3-2. 수집 로그/Fail-safe
- 실행 로그: `collection_logs`
- fail-safe: 오래된 `status='running'`을 `failed`로 정리
- 제어 ENV: `ENABLE_FAILSAFE`, `FAILSAFE_STUCK_MINUTES`, `FAILSAFE_CRON`
Source: `backend/src/maintenance/cleanupStuckCollectionLogs.ts`, `backend/src/scheduler.ts`, `backend/migrations/20251227_admin_automation_logging.sql`

## 4) 자주 나는 에러와 해결 체크리스트
### 4-1. 401 Unauthorized (Admin API)
증상:
- `/admin/events`, `/admin/dashboard`, `/admin/hot-suggestions` 호출 시 401

체크:
1. 요청 헤더 `x-admin-key` 포함 여부
2. 서버 `ADMIN_KEY`와 일치 여부
3. `/admin/verify`로 키 검증

Source: `backend/src/index.ts`, `ADMIN_API_REFERENCE.md`

### 4-2. DB 연결 실패
증상:
- `ECONNREFUSED`, `role does not exist`, query 실패

체크:
1. `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` 또는 `DATABASE_URL`
2. PostgreSQL 실행 여부
3. `canonical_events`, `collection_logs` 등 핵심 테이블 존재

Source: `backend/src/config.ts`, `backend/src/db.ts`, `backend/migrations/`, `backend/tests/README.md`

### 4-3. Naver/Kakao/Gemini 외부 API 실패
증상:
- AI 제안 미생성, geocode 실패, 검색 429/403/401

체크:
1. `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`
2. `KAKAO_REST_API_KEY`
3. `GEMINI_API_KEY` (`GEMINI_MODEL` 포함)
4. Rate limit/쿼터 상태 확인

Source: `backend/src/lib/naverApi.ts`, `backend/src/lib/geocode.ts`, `backend/src/lib/aiExtractor.ts`

### 4-4. 이미지 업로드 실패
증상:
- `/admin/uploads/image` 500

체크:
1. `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_ENDPOINT`, `CDN_BASE_URL`
2. 파일 형식/크기 제한(JPG/PNG/WebP, 5MB)
3. 업로드 rate limit(15분/20회)

Source: `backend/src/lib/imageUpload.ts`, `backend/src/index.ts`, `ADMIN_API_REFERENCE.md`

## 5) 안전 규칙
### 5-1. 데이터 보호 규칙
- `manually_edited_fields`가 true인 필드는 AI 자동 덮어쓰기 금지
- 강제 재생성은 `forceFields`를 명시적으로 사용
Source: `backend/migrations/20260130_add_manually_edited_fields.sql`, `ADMIN_API_REFERENCE.md`

### 5-2. 고위험 엔드포인트 주의
- `POST /admin/events/enrich-preview`
- `POST /admin/events/:id/enrich`
- `POST /admin/events/:id/enrich-ai-direct`
- `POST /admin/hot-suggestions/:id/approve`

위 엔드포인트는 외부 API 비용/레이트리밋/DB 변경 영향을 동반합니다.
Source: `ADMIN_API_REFERENCE.md`, `backend/src/index.ts`

### 5-3. 비용/레이트리밋 경고
- Gemini 호출량은 비용에 직접 영향
- Naver API 호출량은 쿼터/429 리스크
- Kakao/Nominatim 지오코딩은 네트워크 실패 시 fallback 동작
Source: `backend/src/lib/aiExtractor.ts`, `backend/src/lib/naverApi.ts`, `backend/src/lib/geocode.ts`

## 6) 운영 커맨드 모음
```bash
# Backend 개발 서버
cd /Users/kimsungtae/toss/fairpick-app/backend && npm run dev

# Admin metrics 확인
curl -sS http://127.0.0.1:5001/admin/metrics

# 스케줄러 수동성 검증용 health
curl -sS http://127.0.0.1:5001/health
```
Source: `backend/package.json`, `backend/src/index.ts`

## 7) TODO
- TODO: root `README.md`가 최소 정보만 포함하므로, 실행/테스트/ENV 항목의 단일 진실원 문서 보강 필요
- TODO: `backend/README.md`의 포트/구조 설명이 최신 코드와 일부 불일치
Source: `README.md`, `backend/README.md`, `backend/package.json`

## 8) Buzz 검증 커맨드
### 8-1. NAVER creds 존재 여부(true/false만)
```bash
cd /Users/kimsungtae/toss/fairpick-app/backend
node -e "require('ts-node/register/transpile-only'); require('./src/config'); console.log(JSON.stringify({hasNaverClientId:!!(process.env.NAVER_CLIENT_ID&&process.env.NAVER_CLIENT_ID.trim()),hasNaverClientSecret:!!(process.env.NAVER_CLIENT_SECRET&&process.env.NAVER_CLIENT_SECRET.trim())}));"
```
Source: `backend/src/config.ts`

### 8-2. Buzz 노이즈 억제 검증 실행
```bash
cd /Users/kimsungtae/toss/fairpick-app/backend
TS_NODE_COMPILER_OPTIONS='{\"module\":\"CommonJS\",\"moduleResolution\":\"node\"}' \
ts-node --transpile-only scripts/verify-buzz-noise-suppression.ts --limit=10
```
Source: `backend/scripts/verify-buzz-noise-suppression.ts`

### 8-3. 기대 출력(정의)
- `oldConsensus/newConsensus`, `oldFinalLight/newFinalLight`, `delta`가 포함된 markdown 테이블과 요약 JSON(`separationConsensus`, `separationFinalLight`) 1회 출력
