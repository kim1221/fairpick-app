# PR: Overview Backfill - canonical_events.overview 컬럼 보강

## 📌 요약

canonical_events 테이블에 overview 컬럼을 추가하고, raw payload에서 이벤트 소개글을 추출하여 30개 이벤트의 overview를 보강했습니다.

## 🎯 작업 목표

- canonical_events.overview 컬럼이 누락된 이벤트에 대해 raw payload에서 소개글 추출
- HTML 태그 제거, entity 디코딩 등 텍스트 클렌징 적용
- Tour API 소스의 높은 커버리지 달성 (68%)
- 재실행 가능한 멱등성 보장 (기존 overview 덮어쓰지 않음)

## 📊 작업 결과

### 전후 비교

| 지표                     | 작업 전   | 작업 후   | 개선     |
|-------------------------|----------|----------|---------|
| 전체 이벤트              | 1,955    | 1,955    | -       |
| overview 있는 이벤트     | 0        | 30       | +30     |
| overview 커버리지        | 0%       | 1.5%     | +1.5%   |
| **Tour 소스 커버리지**   | **0%**   | **68.0%**| **+68%**|

### 소스별 커버리지

| source_priority_winner | total_events | has_overview | coverage_percentage |
|------------------------|--------------|--------------|---------------------|
| kopis                  | 1,677        | 3            | 0.2%                |
| culture                | 253          | 10           | 4.0%                |
| **tour**               | **25**       | **17**       | **68.0%**           |

## 🔧 주요 변경사항

### 1. Migration
**파일**: `migrations/20260119_add_overview_to_canonical_events.sql`
- canonical_events 테이블에 overview TEXT 컬럼 추가
- overview 존재 여부 필터링용 인덱스 생성

### 2. Overview 추출 로직
**파일**: `src/jobs/overviewBackfill.ts`
- **소스별 추출 규칙**:
  - KOPIS: overview 관련 필드 없음 (스킵)
  - Culture: overview 관련 필드 거의 없음 (스킵)
  - **Tour**: `payload.overview` 또는 `payload.detailText` 추출
- **텍스트 클렌징**:
  - HTML 태그 제거
  - HTML entity 디코딩
  - 불필요한 메타 정보 제거 (홈페이지, 문의, 주소 등)
  - 최소 길이 30자, 최대 길이 800자 제한

### 3. Package Scripts
**파일**: `package.json`
```json
{
  "backfill:overview": "ts-node -r dotenv/config src/jobs/overviewBackfill.ts",
  "backfill:overview:dry": "ts-node -r dotenv/config src/jobs/overviewBackfill.ts --dry-run"
}
```

### 4. 문서화
- `docs/OVERVIEW_BACKFILL_REPORT.md`: 작업 보고서 (전후 증거, 샘플 레코드 등)
- `docs/PR_OVERVIEW_BACKFILL.md`: 본 PR 설명

## 💡 실행 방법

### Dry-run (미리보기)
```bash
npm run backfill:overview:dry
npm run backfill:overview:dry -- --limit=20
```

### 실제 업데이트
```bash
npm run backfill:overview
npm run backfill:overview -- --limit=100
```

## 📝 샘플 레코드 (10개)

| title (축약)           | source  | overview 길이 | overview 미리보기 (앞 80자)                                 |
|------------------------|---------|--------------|-----------------------------------------------------------|
| 서울라이트 DDP 겨울    | culture | 277자        | '서울라이트 DDP'는 세계 3대 디자인 어워드(iF, Red Dot, IDEA)와 기네스 세계기록(세계 최대 비정형 건축물 3D 맵핑... |
| 겨울, 청계천의 빛      | culture | 262자        | 올해로 11회째를 맞는 '2025 겨울, 청계천의 빛'이 '황금빛 포근함 속, 모두가 하나되는 겨울'을 주제로 12월 12일부터... |
| 관악별빛산책           | culture | 296자        | 올해 5회째인 '관악별빛산책'은 관악구 대표 겨울축제로 별빛내린천(도림천)을 따라 조성된 산책형 빛예술을 경험할 수... |
| 여수향일암일출제       | culture | 128자        | 향일암은 전국 4대 관음처로 국내 최고의 기도처이다. 향일암은 매년 12월 31일이 되면 새해에 대한 소망을 기원하는... |
| 카운트다운 부산        | culture | 196자        | 부산 광안리 해수욕장 일원에서 한 해를 보내고 새로운 한 해를 맞으며 보내는 행사로 병오년(丙午年) 말의 해를 맞아... |

*전체 샘플 10개는 `docs/OVERVIEW_BACKFILL_REPORT.md` 참고*

## ⚠️ 주의사항

### 운영 환경 배포 시
1. **백업**: 운영 DB 백업 먼저 수행
2. **Migration**: `migrations/20260119_add_overview_to_canonical_events.sql` 실행
3. **Dry-run**: 반드시 dry-run으로 먼저 검증
4. **Limit**: 처음에는 소량(--limit=10)으로 테스트
5. **시간대**: 트래픽이 적은 시간대에 실행

### 멱등성
- **기존 overview가 있는 이벤트는 절대 덮어쓰지 않음**
- 동일한 job을 여러 번 실행해도 안전

### 성능
- Rate limiting: 50ms 간격으로 처리
- 1,955개 이벤트 처리 시간: 약 2분

## 🔮 향후 개선 방안

### 1. KOPIS 상세 정보 수집
- KOPIS API에서 상세 페이지 크롤링
- 공연 소개글 추출
- **목표**: 현재 0.2% → 50%+ 커버리지

### 2. Culture 상세 정보 수집
- Culture API에서 상세 정보 추가 수집
- **목표**: 현재 4.0% → 50%+ 커버리지

### 3. AI 기반 Overview 생성
- GPT API를 활용한 자동 요약
- Title, Venue, Category 정보로 소개글 생성
- 최후 수단으로 사용 (비용 고려)

### 4. 스케줄러 통합
- 매일 자동 실행 (신규 이벤트 대상)
- 점진적 보강

## 📦 변경된 파일

- ✅ `migrations/20260119_add_overview_to_canonical_events.sql` (신규)
- ✅ `src/jobs/overviewBackfill.ts` (신규)
- ✅ `package.json` (스크립트 추가)
- ✅ `docs/OVERVIEW_BACKFILL_REPORT.md` (신규)
- ✅ `docs/PR_OVERVIEW_BACKFILL.md` (신규)

## ✅ 테스트 완료

- [x] Dry-run 검증 (1,955개 → 30개 추출 가능)
- [x] 실제 업데이트 수행 (30개 보강 완료)
- [x] DB 업데이트 확인 (updated_at 타임스탬프 검증)
- [x] 샘플 레코드 확인 (10개 랜덤 샘플)
- [x] Tour 소스 커버리지 확인 (68% 달성)

## 🎯 결론

- **총 30개 이벤트의 overview 보강 완료**
- **Tour 소스 68% 커버리지 달성** (17/25)
- KOPIS, Culture 소스는 향후 상세 데이터 수집으로 개선 필요
- Job 재실행 가능 (멱등성 보장)
- 프로덕션 배포 준비 완료

---

**관련 문서**: `docs/OVERVIEW_BACKFILL_REPORT.md`
