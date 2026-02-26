# Tests

현재 프로덕션 로직 검증, 회귀 테스트, 지속적 품질 관리를 위한 테스트 스크립트.

## 목적

- **단위 테스트 (Unit)**: 개별 함수 로직 검증, DB 불필요, 빠른 실행
- **통합 테스트 (Integration)**: API + DB 동작 확인, 전체 파이프라인 검증
- **회귀 테스트**: 로직 변경 시 기존 기능 보호, 데이터 무결성 확인

## 디렉토리 구조

```
tests/
├── unit/                          # 단위 테스트 (DB/외부 의존성 불필요)
│   └── utils/                     # 유틸리티 함수 (parse-runtime 등)
│
└── integration/                   # 통합 테스트 (DB 필요, 느림)
    ├── admin-api/                 # Admin API 엔드포인트 검증
    ├── ai-enrichment/             # AI Enrichment 파이프라인 (external_links 등)
    └── data-protection/           # 수동 편집 보호 시스템 검증
```

## Unit vs Integration 차이

| 항목 | Unit | Integration |
|-----|------|-------------|
| **속도** | 빠름 (초 단위) | 느림 (분 단위) |
| **DB 필요** | ❌ 불필요 | ✅ 필요 |
| **외부 API** | ❌ Mock 사용 | ✅ 실제 호출 가능 |
| **격리** | 완전 격리 | End-to-End |
| **CI 적합** | ✅ 매 커밋마다 | ⚠️ PR/배포 시 |

## 실행 전제조건

### Integration 테스트 실행 전 확인사항

1. **환경 변수 (.env)**
   ```bash
   # backend/.env 파일에 다음이 설정되어 있어야 함
   DATABASE_URL=postgresql://...
   NAVER_CLIENT_ID=...
   NAVER_CLIENT_SECRET=...
   GOOGLE_CLOUD_PROJECT=...
   ```

2. **PostgreSQL 연결**
   - `canonical_events` 테이블 존재
   - 테스트용 이벤트 데이터 (전시/공연 카테고리)

3. **Admin API 인증 (admin-api 테스트 시)**
   - Backend 서버 실행 중 (`localhost:5001`)
   - Admin 인증 필요 (`x-admin-key` 헤더 또는 `requireAdminAuth` 미들웨어)

## 실행 예시

### 단위 테스트 (빠름, DB 불필요)

```bash
cd backend

# 유틸리티 함수 테스트
ts-node tests/unit/utils/test-parse-runtime.ts

# 수동 편집 로직 테스트 (DB 호출 없이 순수 함수 검증)
ts-node tests/integration/data-protection/test-manual-edit-logic.ts
```

### 통합 테스트 (느림, DB 필요)

```bash
cd backend

# 데이터 보호 시스템 검증 (DB 읽기/쓰기)
ts-node -r dotenv/config tests/integration/data-protection/test-data-protection.ts

# 수동 편집 보호 시스템 (aiEnrichmentBackfill job 호출)
ts-node -r dotenv/config tests/integration/data-protection/test-manual-edit-protection.ts

# Admin API 수동 편집 마킹 검증 (⚠️ 서버 실행 + 인증 필요)
ts-node -r dotenv/config tests/integration/admin-api/test-admin-manual-marking.ts
```

### Admin API 테스트 주의사항

```bash
# ⚠️ admin-api 테스트는 다음 조건 필요:
# 1. Backend 서버 실행 중 (localhost:5001)
# 2. Admin 인증 (x-admin-key 헤더 또는 requireAdminAuth)
# 3. PostgreSQL 연결

# 서버 실행 후 테스트
npm run dev  # 별도 터미널에서
ts-node -r dotenv/config tests/integration/admin-api/test-admin-manual-marking.ts
```

## 테스트 작성 가이드

### 1. 파일 위치 선택

- **DB 불필요** → `tests/unit/<domain>/`
- **DB 필요** → `tests/integration/<domain>/`

### 2. 파일명 규칙

```
test-<feature-name>.ts
test-<specific-case>.ts
```

### 3. Import 경로

```typescript
// ✅ 올바른 경로 (상대 경로)
import { pool } from '../../../src/db';
import { extractEventInfo } from '../../../src/lib/aiExtractor';

// ❌ 잘못된 경로
import { pool } from '../db';  // 깊이가 맞지 않음
```

### 4. 테스트 구조

```typescript
async function testFeatureName() {
  console.log('🧪 Feature Name Test\n');

  try {
    // 1. Setup: 테스트 데이터 준비
    console.log('📋 Step 1: Setup...');
    
    // 2. Execute: 테스트 대상 실행
    console.log('🔧 Step 2: Execute...');
    
    // 3. Assert: 결과 검증
    console.log('✅ Step 3: Verify...');
    
    // 4. Cleanup: 정리 (필요시)
    console.log('🧹 Step 4: Cleanup...');
    
    console.log('\n✅ Test Passed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Test Failed:', error);
    process.exit(1);
  }
}

testFeatureName();
```

## CI/CD 통합 (향후 계획)

### package.json 스크립트 예시

```json
{
  "scripts": {
    "test": "npm run test:unit && npm run test:integration",
    "test:unit": "find tests/unit -name 'test-*.ts' -exec ts-node {} \\;",
    "test:integration": "find tests/integration -name 'test-*.ts' -exec ts-node -r dotenv/config {} \\;"
  }
}
```

### GitHub Actions 예시

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm install
      - run: npm run test:unit

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
    steps:
      - uses: actions/checkout@v3
      - run: npm install
      - run: npm run test:integration
    env:
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

**현재 상태**: CI 통합 미완료, 수동 실행만 지원

## 트러블슈팅

### 1. "Cannot find module '../../../src/db'"

- **원인**: import 경로 깊이가 맞지 않음
- **해결**: 파일 위치에서 `src/`까지 상대 경로 확인

### 2. "Connection refused (PostgreSQL)"

- **원인**: DB 서버 미실행 또는 `.env` 설정 오류
- **해결**: `DATABASE_URL` 확인, PostgreSQL 실행 상태 확인

### 3. Admin API 테스트 401/403

- **원인**: 인증 미들웨어 차단
- **해결**: Backend 서버 실행 중인지 확인, 인증 헤더/토큰 확인

### 4. "Event not found"

- **원인**: 테스트 데이터 부족
- **해결**: `canonical_events` 테이블에 전시/공연 데이터 삽입

---

**Last Updated:** 2026-02-09
