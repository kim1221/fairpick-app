# REPO_FILE_MAP

Last Updated: 2026-02-09

## 1) 루트 구조
- `backend/`: Express API, 배치, 마이그레이션, Admin Web
- `src/`: 앱 공통 컴포넌트/서비스/페이지 구현
- `pages/`: Granite 라우트 엔트리(일부는 `src/pages/` re-export, 일부는 직접 구현)
- `docs/`, `scripts/`: 문서/유틸 스크립트
Source: `ls -la`, `pages/`, `src/pages/`

## 2) 실행 엔트리 파일
- Frontend 엔트리: `index.ts` (`register(App)`), 앱 컨테이너: `src/_app.tsx`
- Backend 엔트리: `backend/src/index.ts`
- Backend 스케줄 초기화: `backend/src/scheduler.ts`
Source: `index.ts`, `src/_app.tsx`, `backend/src/index.ts`, `backend/src/scheduler.ts`

## 3) 백엔드 핵심 파일 맵
- `backend/src/index.ts`: Public/Admin API 라우트 집합, 인증, 업로드/DMCA, 추천/조회 API
- `backend/src/db.ts`: Postgres Pool + raw/canonical upsert/update 함수
- `backend/src/config.ts`: `.env` 로딩과 설정 키 집계
- `backend/src/scheduler.ts`: cron 등록 및 배치 orchestration
- `backend/src/jobs/collect/index.ts`: 수집 파이프라인 실행 + `collection_logs` 기록
- `backend/src/maintenance/cleanupStuckCollectionLogs.ts`: `running` 로그 fail-safe 정리
Source: 각 파일

## 4) 백엔드 라이브러리 맵 (`backend/src/lib`)
- `backend/src/lib/aiExtractor.ts`: Gemini 기반 구조화 추출
- `backend/src/lib/naverApi.ts`: 네이버 검색 API 클라이언트
- `backend/src/lib/geocode.ts`: Kakao 우선 + Nominatim fallback 지오코딩
- `backend/src/lib/imageUpload.ts`: S3/R2 업로드/삭제/설정 검증
- `backend/src/lib/searchScoring.ts`: 검색 결과 필터/스코어/캡핑
- `backend/src/lib/suggestionBuilder.ts`: AI 제안 payload 구성
- `backend/src/lib/enrichmentPolicy.ts`, `backend/src/lib/enrichmentHelper.ts`: 수동편집 보호와 적용정책
- `backend/src/lib/hotScoreCalculator.ts`, `backend/src/lib/recommender.ts`: 점수/추천 계산
Source: `backend/src/lib/`

## 5) 마이그레이션/스키마 관련
- 주요 스키마 변경 SQL: `backend/migrations/*.sql`
- 운영 핵심 변경 파일
  - `backend/migrations/20251227_admin_automation_logging.sql` (`collection_logs`, soft delete)
  - `backend/migrations/20260126_add_common_fields_phase1.sql` (공통 JSONB/가격/상태)
  - `backend/migrations/20260130_add_manually_edited_fields.sql` (데이터 보호)
  - `backend/migrations/20260131_add_ai_suggestions.sql` (AI 제안/출처)
  - `backend/migrations/20260123_add_image_metadata.sql` (`image_audit_log` 포함)
Source: 각 migration 파일

## 6) 테스트 관련
- 활성 테스트 가이드: `backend/tests/README.md`
- 아카이브 테스트 가이드: `backend/archive/tests/README.md`
- 활성 테스트 디렉토리: `backend/tests/unit`, `backend/tests/integration/admin-api`, `backend/tests/integration/ai-enrichment`, `backend/tests/integration/data-protection`
- 아카이브 실험 디렉토리: `backend/archive/tests/`
Source: `backend/tests/README.md`, `backend/archive/tests/README.md`

## 7) 프론트 핵심 파일 맵
- 서비스
  - `src/lib/http.ts`: 앱 API baseURL/요청 로깅
  - `src/services/eventService.ts`: 이벤트 목록/상세/nearby 조회 및 매핑
  - `src/services/adminService.ts`: admin metrics/featured API 클라이언트
- 화면
  - `pages/events/[id].tsx`: 이벤트 상세(직접 구현)
  - `pages/index.tsx`, `pages/explore.tsx`, `pages/admin.tsx`: 일부는 `src/pages` re-export
  - `src/pages/`: 실제 구현 컴포넌트 다수
Source: 각 파일

### 7-1) Frontend 라우팅 구조 검증 (`pages/**` vs `src/pages/**`)
- 실제 라우트 엔트리 디렉토리: `pages/`
- 구현 컴포넌트 저장 디렉토리: `src/pages/`
- `pages`가 `src/pages`를 재-export하는 케이스
  - `pages/index.tsx` → `src/pages/index.tsx`
  - `pages/explore.tsx` → `src/pages/explore.tsx`
  - `pages/admin.tsx` → `src/pages/admin.tsx`
  - `pages/hot.tsx` → `src/pages/hot.tsx`
  - `pages/ending.tsx` → `src/pages/ending.tsx`
  - `pages/nearby.tsx` → `src/pages/nearby.tsx`
  - `pages/mypage.tsx` → `src/pages/mypage.tsx`
- `pages`에 직접 구현된 케이스
  - `pages/events/[id].tsx`
Source: `pages/index.tsx`, `pages/explore.tsx`, `pages/admin.tsx`, `pages/hot.tsx`, `pages/ending.tsx`, `pages/nearby.tsx`, `pages/mypage.tsx`, `pages/events/[id].tsx`, `src/pages/`

## 8) 자주 수정되는 파일 TOP N (근거: git log 집계)
집계 커맨드:
```bash
git log --all --name-only --pretty=format: \
| rg -v '^$' \
| rg '^(src/|pages/|backend/src/|backend/tests/|backend/migrations/|backend/package.json|package.json)' \
| sort | uniq -c | sort -nr | head -20
```
최근 히스토리 기준 상위:
1. `backend/src/index.ts` (2)
2. `backend/src/lib/aiExtractor.ts` (2)
3. `backend/src/lib/suggestionBuilder.ts` (2)
4. `src/utils/` 다수 파일 (각 1)

주의:
- 현재 저장소 히스토리가 얕아(카운트가 1~2 위주) 장기적인 “핫 파일” 판단에는 한계가 있습니다.
- `*.backup`, 로그 파일은 집계에서 제외하는 것이 적절합니다.
Source: `git log` 집계 결과

## 9) 즉시 참조 우선순위 (온보딩용)
1. `ADMIN_API_REFERENCE.md` (Admin API 전체 스펙)
2. `backend/src/index.ts` (실제 라우트 동작)
3. `backend/src/db.ts` + `backend/migrations/` (데이터 모델)
4. `src/services/eventService.ts` (앱 데이터 바인딩)
