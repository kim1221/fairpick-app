# Archive - Test Scripts

이 디렉토리는 과거 실험, 의사결정 근거, 시스템 진화 히스토리를 보존합니다.

## 목적

- **실험 기록**: 네이버 API 정확도 검증, 쿼리 최적화 실험
- **의사결정 근거**: 로직 개선 전후 비교, A/B 테스트 결과
- **시스템 진화**: Phase 1→2 전환 기록, 초기 구현 검증

## 디렉토리 구조

```
archive/tests/
├── naver-api/          # 네이버 API 실험 기록
├── normalization/      # 정규화 로직 변경 히스토리
├── ai-discovery/       # AI Discovery 초기 검증
└── ai-suggestions/     # AI Suggestions Phase 1/2 기록
```

## 실행 여부

이 디렉토리의 파일들은:
- ❌ **production 코드에서 사용되지 않음**
- ❌ **CI/CD 파이프라인에 포함되지 않음**
- ✅ **히스토리 참조용으로만 보관**

재실행이 필요하면 수동으로 `ts-node -r dotenv/config` 실행 가능.

## 정리 규칙

- 삭제하지 말 것 (참조 가치 있음)
- 신규 실험 스크립트는 완료 후 여기로 이동
- 6개월마다 불필요한 파일 검토

---

**Last Updated:** 2026-02-09

