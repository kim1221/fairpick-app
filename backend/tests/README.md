# Tests

현재 로직 검증, 회귀 테스트, 지속적 품질 관리를 위한 테스트 스크립트.

## 목적

- **단위 테스트**: 개별 함수 로직 검증
- **통합 테스트**: API + DB 동작 확인
- **회귀 테스트**: 로직 변경 시 기존 기능 보호

## 디렉토리 구조

```
tests/
├── unit/                      # 단위 테스트 (DB 불필요)
│   ├── data-protection/       # 수동 편집 보호 로직
│   └── utils/                 # 유틸리티 함수
└── integration/               # 통합 테스트 (DB 필요)
    ├── ai-enrichment/         # AI Enrichment 파이프라인
    ├── admin-api/             # Admin API 엔드포인트
    └── data-protection/       # 데이터 보호 정책
```

## 실행 방법

### 단위 테스트 (빠름)
```bash
cd backend
ts-node -r dotenv/config tests/unit/utils/test-parse-runtime.ts
ts-node tests/unit/data-protection/test-manual-edit-logic.ts
```

### 통합 테스트 (느림, DB 필요)
```bash
cd backend
ts-node -r dotenv/config tests/integration/data-protection/test-data-protection.ts
ts-node -r dotenv/config tests/integration/admin-api/test-admin-manual-marking.ts
```

## 테스트 추가 규칙

1. **파일명**: `test-{feature-name}.ts`
2. **위치 선택**:
   - DB 불필요 → `unit/`
   - DB 필요 → `integration/`
3. **import 경로**: `../../src/...` 형식 사용

## CI/CD 통합 (향후)

```bash
# 모든 단위 테스트 실행
npm run test:unit

# 모든 통합 테스트 실행
npm run test:integration
```

---

**Last Updated:** 2026-02-09

