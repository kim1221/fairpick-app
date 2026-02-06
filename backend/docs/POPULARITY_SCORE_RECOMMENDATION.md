# popularity_score 보완 권고안

**작성일**: 2026-01-20
**작성자**: Claude (AI Assistant)
**목적**: popularity_score 의미 정리 및 운영 개선

---

## 1. 현재 상태 요약

### 1.1 DB 실측 데이터 (2026-01-20)

| 지표 | 값 |
|------|-----|
| 전체 이벤트 (is_deleted=false) | 1,955 |
| NULL 개수 | 0 |
| Zero 개수 | 119 (6.1%) |
| 최솟값 | 0 |
| 최댓값 | 379 |
| 평균값 | 204.90 |
| 중앙값 | ~200 추정 |

### 1.2 현재 계산 로직

**파일**: `src/jobs/updateMetadata.ts`

```typescript
popularity_score = LEAST(1000, GREATEST(0, (
  -- 기본 점수
  CASE WHEN is_featured THEN 100 ELSE 0 END +
  CASE source_priority_winner
    WHEN 'kopis' THEN 50
    WHEN 'culture' THEN 30
    ELSE 10
  END +

  -- 최신성 (등록 후 30일간)
  GREATEST(0, 30 - EXTRACT(DAY FROM (CURRENT_DATE - created_at))::INTEGER) +

  -- 긴급도 (시작 임박)
  CASE
    WHEN start_at <= CURRENT_DATE + INTERVAL '7 days' THEN 300
    WHEN start_at <= CURRENT_DATE + INTERVAL '14 days' THEN 150
    WHEN start_at <= CURRENT_DATE + INTERVAL '30 days' THEN 50
    ELSE 0
  END +

  -- 먼 미래 페널티
  CASE
    WHEN start_at > CURRENT_DATE + INTERVAL '90 days' THEN -500
    ELSE 0
  END +

  -- 종료 임박 페널티
  CASE
    WHEN end_at <= CURRENT_DATE + INTERVAL '3 days' THEN -20
    ELSE 0
  END
)))
```

**스케줄**: 매일 02:00 KST (`scheduler.ts` LINE 120-124)

---

## 2. 의미 정리

### 2.1 현재 문제점

**용어 혼란**: "popularity_score"라는 이름이 "사용자 행동 기반 인기도"를 암시하지만, 실제로는 **큐레이션/랭킹 점수**입니다.

| 요소 | 포함 여부 | 비고 |
|------|----------|------|
| 사용자 조회수 | ❌ | event_views 미사용 |
| 사용자 찜 | ❌ | event_actions 미존재 |
| 사용자 공유 | ❌ | event_actions 미존재 |
| featured 여부 | ✅ | 관리자 큐레이션 |
| 소스 신뢰도 | ✅ | kopis > culture > tour |
| 최신성 | ✅ | 등록 후 30일 |
| 시작 임박도 | ✅ | 7일 이내 +300 |
| 일정 기반 페널티 | ✅ | 먼 미래, 종료 임박 |

### 2.2 권고 사항

**의미 재정의**: popularity_score는 **"큐레이션/랭킹 점수"**로 문서화하고, 사용자 행동 기반 점수는 별도의 **buzz_score**로 분리합니다.

#### 문서 및 코드 주석 수정 예시

```typescript
/**
 * popularity_score: 큐레이션/랭킹 점수
 *
 * 사용자 행동(조회, 찜, 클릭)을 반영하지 않으며,
 * 다음 요소를 기반으로 계산됩니다:
 * - 일정 (시작/종료 임박도)
 * - 소스 신뢰도 (KOPIS > Culture > Tour)
 * - featured 여부 (관리자 큐레이션)
 * - 최신성 (등록 후 30일)
 *
 * 사용자 행동 기반 점수는 buzz_score를 참조하세요.
 */
```

---

## 3. 상한 보완 권고

### 3.1 현재 상태 분석

- **설계 상한**: 1000
- **실제 최댓값**: 379
- **실사용 범위**: 0~400
- **평균**: 204.90

### 3.2 옵션 비교

#### 옵션 A: 스케일링 계수 적용 (×2.0)

```sql
popularity_score = LEAST(1000, GREATEST(0, (
  ... (기존 로직) ...
) * 2.0))
```

**장점**:
- 간단한 구현
- 실사용 범위를 0~800으로 확장

**단점**:
- 로직 의도가 불명확 (왜 2.0인가?)
- 향후 요소 추가 시 재조정 필요

#### 옵션 B: 상한을 500으로 재정의 ⭐ **권고**

```sql
popularity_score = LEAST(500, GREATEST(0, (
  ... (기존 로직) ...
)))
```

**장점**:
- 실사용 범위와 설계 상한이 일치
- 혼란 제거 (max 379 → 상한 500은 합리적)
- 향후 요소 추가 여유 (379 → 500)

**단점**:
- 기존 문서/코드에서 "1000"을 "500"으로 수정 필요

### 3.3 최종 권고

**옵션 B (상한 500)를 권장합니다.**

**근거**:
1. 실사용 범위(0~379)와 설계 상한(500)이 합리적으로 매칭
2. 향후 요소 추가 시 여유 공간 (379 → 500)
3. 혼란 제거 (1000은 사용되지 않음)
4. buzz_score와의 구분 명확화 (popularity: 0~500, buzz: 0~1000)

---

## 4. 시간대 정합성 점검

### 4.1 현재 스케줄 설정

**파일**: `src/scheduler.ts`

| 작업 | 예약 시각 | 실제 시각 | 불일치 원인 |
|------|----------|----------|------------|
| 01:00 KST | Cleanup | 01:00 | ✅ 정상 |
| 02:00 KST | Metadata Update | 02:00 | ✅ 정상 |
| 03:00 KST | Geo Refresh | 03:00~04:00 | ⚠️ 파이프라인 지연 |
| 04:00 KST | Auto Recommend | 04:00~05:00 | ⚠️ 이전 작업 지연 |
| 15:00 KST | Geo Refresh | 15:00~16:00 | ⚠️ 파이프라인 지연 |

### 4.2 사용자 관찰과의 불일치 분석

**사용자 관찰**: "updated_at이 03~04시에 몰림"

**원인 추정**:
1. **배치 체인 지연**:
   - 02:00: Metadata Update (popularity_score 업데이트)
   - 03:00: Geo Refresh 시작 → 데이터 수집/처리 → 중복 제거 → **canonical_events 업데이트**
   - updated_at이 03:00~04:00에 찍힘

2. **Geo Refresh 파이프라인이 canonical_events를 수정**:
   - `geoRefreshPipeline.ts`에서:
     - 데이터 수집 (KOPIS, Culture, Tour)
     - geoBackfill (좌표 보강)
     - venueBackfill (장소 보강)
     - dedupeCanonicalEvents (중복 제거 및 병합)
   - 이 과정에서 canonical_events.updated_at이 갱신됨

### 4.3 권고 사항

**옵션 1: 문서 기준을 현실에 맞춤** ⭐ **권고**

```markdown
- 02:00 KST: Metadata Update (popularity_score 계산)
- 03:00 KST: Geo Refresh 시작 (데이터 수집/좌표 보강/중복 제거)
- **실제 updated_at 반영 시각: 03:00~04:00** (파이프라인 완료 시점)
```

**근거**:
- 배치 체인은 정상 작동 중
- updated_at은 "마지막 수정 시각"을 정확히 반영
- 사용자 혼란 제거

**옵션 2: 스케줄 재조정 (불필요)**

- Metadata Update를 05:00으로 변경 → Geo Refresh 이후 실행
- **권장하지 않음**: 현재 스케줄이 논리적으로 타당 (Metadata는 Geo와 독립적)

---

## 5. 실행 계획

### 5.1 즉시 실행 가능

1. **문서 수정**:
   - `scheduler.ts` 주석 업데이트 (updated_at 반영 시각 명시)
   - `updateMetadata.ts` 주석 업데이트 (popularity_score 의미 명확화)

2. **상한 변경** (선택):
   - `updateMetadata.ts` LINE 49: `LEAST(1000, ...)` → `LEAST(500, ...)`

### 5.2 향후 고려 사항

1. **popularity_score 리네이밍** (Phase 2):
   - `popularity_score` → `curation_score` (의미 명확화)
   - API 응답 필드명 변경 (하위 호환성 주의)

2. **buzz_score 통합** (Phase 2):
   - HOT 페이지: `buzz_score DESC` 사용
   - 큐레이션 페이지: `popularity_score DESC` 사용 (또는 curation_score)

---

## 6. 변경 요약

| 항목 | 현재 | 권고 | 우선순위 |
|------|------|------|----------|
| 의미 | "인기도 점수" | "큐레이션/랭킹 점수" | 🔥 높음 |
| 상한 | 1000 (미사용) | 500 (실사용) | 🔥 높음 |
| 시간대 문서 | 02:00 업데이트 | 02:00 계산, 03~04:00 반영 | 🔥 높음 |
| 필드명 | popularity_score | curation_score | 🔸 중간 (Phase 2) |

---

**최종 작성일**: 2026-01-20
**검토 완료**: ✅
