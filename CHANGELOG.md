# CHANGELOG

## [2026-02-07] 문서 정합성 감사 완료

### 📝 문서 업데이트
- **REPO_FILE_MAP.md** v1.1 업데이트 (정합성 검증 완료)
- **FILE_MAP.md** v1.1 업데이트 (정합성 검증 완료)

### ✅ 주요 수정사항

#### 1. 레포 구조 정합성
- Top-level 폴더 구조 실제 확인: `backend/`, `backend/admin-web/`, `pages/`, `src/`, `docs/`
- 절대경로 제거, 상대경로로 통일 (repo root 기준)
- admin-web 위치 명확화: `backend/admin-web/` (backend 하위)

#### 2. 실행 커맨드 검증
- 루트 package.json: `dev`, `build`, `test` 스크립트 확인
- backend/package.json: 60+ 스크립트 검증 완료
- admin-web/package.json: `dev`, `build`, `preview` 확인
- 존재하지 않는 커맨드 제거, 실제 스크립트명으로 교체

#### 3. Scheduler 스케줄 정확성 (scheduler.ts 실제 확인)
- ⚠️ **중요 발견:** AI Enrichment (04:00) 독립 스케줄 **주석 처리됨**
- 현재는 `geoRefreshPipeline` 내부에서 자동 실행 (03:00, 15:00)
- 실제 스케줄:
  - 01:00: Cleanup
  - 02:00: Metadata Update
  - 02:30: Buzz Score
  - 03:00, 15:00: Geo Refresh Pipeline (**AI Enrichment 포함**)
  - 03:30, 15:30: Price Info
  - 04:15: Phase 2 Internal Fields
  - 04:30: Auto-recommend
  - 08:00: AI Popup Discovery
  - 09:00 (월): AI Hot Rating
  - */10 분마다: Failsafe Cleanup (선택적)
- 환경변수 요구사항 명시: `ENABLE_SCHEDULER=true` 필수

#### 4. 파일 라인 수 정확성 (wc -l 실측)
- `scheduler.ts`: 249 lines (문서: ~400 → 수정)
- `aiExtractor.ts`: 1,691 lines (문서: ~400 → 수정)
- `naverApi.ts`: 913 lines (문서: ~300 → 수정)
- `searchScoring.ts`: 341 lines (문서: ~250 → 수정)
- 기타 파일: 정확성 확인 완료

#### 5. 파일 경로 정합성
- 모든 collectors, jobs, lib, scripts 경로 실제 확인 완료
- 모든 경로 문서에 정확히 반영

### 🔍 추가 발견사항

1. **AI Enrichment 아키텍처 변경**
   - 독립 스케줄 (04:00) → geoRefreshPipeline 통합
   - 데이터 수집 직후 즉시 AI 분석으로 효율성 향상

2. **환경변수 요구사항**
   - `ENABLE_SCHEDULER=true`: 스케줄러 활성화 (기본: disabled)
   - `ENABLE_FAILSAFE=false`: Failsafe 비활성화 가능

3. **NPM Scripts 정확성**
   - `npm run pipeline:geoRefresh` (실제 존재)
   - `npm run metadata:update` (실제 존재)
   - `npm run update:buzz-score` (실제 존재)

### 📌 TODO (추후 확인 필요)
- `npm run migrate` 스크립트 존재 여부
- Hot Discovery 스크립트 수동 실행 방법
- 마이그레이션 실행 정확한 커맨드

---

## 2026-02-06
- Initial documentation structure created



---

<!-- AUTO-GENERATED:START -->
## [2026-02-07] Documentation Auto-Update

### Auto-Generated Changes

- Repository structure scanned and documented
- Scheduler configuration extracted from scheduler.ts
- Package.json scripts inventory updated
- File maps regenerated

**마지막 업데이트:** 2026-02-07 (Asia/Seoul)

<!-- AUTO-GENERATED:END -->
