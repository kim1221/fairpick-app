# Archive - Test Scripts

이 디렉토리는 과거 실험, 의사결정 근거, 시스템 진화 히스토리를 보존합니다.

## 목적

- **실험 기록**: 새로운 API, 알고리즘, 데이터 처리 방식의 초기 검증
- **의사결정 근거**: 로직 변경 전후 비교, 성능/정확도 측정 결과
- **시스템 진화**: Phase 1→2 전환, 아키텍처 변경 이력 추적
- **히스토리 보존**: 왜 이 방식을 선택했는지, 무엇을 시도했는지 기록

## 실행 여부

이 디렉토리의 파일들은:
- ❌ **프로덕션 코드에서 사용되지 않음**
- ❌ **CI/CD 파이프라인에 포함되지 않음**
- ✅ **히스토리 참조 및 문서화 목적으로만 보관**

재실행이 필요하면 수동으로:
```bash
cd backend
ts-node -r dotenv/config archive/tests/<category>/<test-file>.ts
```

**주의**: API 키(.env), DB 연결, 외부 서비스 의존성이 필요할 수 있음.

## 디렉토리 구조

```
archive/tests/
├── ai-suggestions/         # AI 제안 시스템 Phase 1/2 초기 검증
├── api-integration/        # 외부 API (KOPIS, Kakao, Vertex AI) 연동 실험
├── category-enrichment/    # 카테고리별 AI enrichment 실험 (전시/축제/팝업)
├── hot-discovery/          # Hot Discovery 파이프라인 Mock 테스트
├── naver-api/              # 네이버 검색 API 정확도/쿼리 최적화 실험
├── normalization/          # 이벤트 정규화 로직 v1/v2 비교
└── specific-events/        # 특정 이벤트 단발성 테스트 (VIP매직쇼, 스노우 팝업 등)
```

### 각 카테고리 설명

| 디렉토리 | 설명 | 대표 파일 |
|---------|------|----------|
| `ai-suggestions/` | AI 제안 시스템 초기 개발 단계 검증 | `test-phase2-suggestions.ts` |
| `api-integration/` | 외부 API 연동 가능성 및 응답 구조 탐색 | `test-kopis-detail-api.ts`, `test_kakao_api.ts` |
| `category-enrichment/` | 카테고리별 특화 필드 AI 추출 실험 | `test-exhibition-enrichment.ts` |
| `hot-discovery/` | Hot Discovery 로직 네이버 API Rate Limit 없이 테스트 | `test-hot-discovery-mock.ts` |
| `naver-api/` | 네이버 검색 total 정확도, 쿼리 개선, 과거 이벤트 오염 실험 | `test-naver-total-accuracy.ts` |
| `normalization/` | 이벤트 제목 정규화 로직 v1 → v2 진화 기록 | `test_normalize_v2.ts` |
| `specific-events/` | 특정 이벤트로 End-to-End 파이프라인 검증 | `test-vip-magic-show.ts` |

## 정리 규칙

- ❌ **함부로 삭제하지 말 것** (의사결정 근거 보존)
- ✅ **신규 실험 완료 후 여기로 이동** (src/scripts/ → archive/tests/)
- 🔍 **6개월마다 불필요한 파일 검토** (중복/가치 없는 것만 제거)

## 재실행 시 주의사항

1. **환경 변수**: `.env` 파일에 API 키 필요 (NAVER_CLIENT_ID, GOOGLE_CLOUD_PROJECT 등)
2. **DB 연결**: PostgreSQL 필요 (`pool` import하는 파일)
3. **외부 API 의존성**: 네이버/Kakao/Google API Rate Limit 주의
4. **데이터 변경**: DB 수정하는 테스트는 주의 (백업 권장)

---

**Last Updated:** 2026-02-09
