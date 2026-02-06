# buzz_score 설계 요약

**작성일**: 2026-01-20
**작성자**: Claude (AI Assistant)
**목적**: 사용자 행동 기반 buzz_score 시스템 MVP 구축

---

## 1. 설계 철학

### 1.1 핵심 원칙

| 원칙 | 설명 |
|------|------|
| **최소 변경** | 기존 popularity_score 로직 보존, buzz_score는 추가 필드 |
| **미래 확장 가능** | 로그인 없음(session 기반) → 향후 Toss 로그인(user 기반) 자동 전환 |
| **MVP 우선** | Phase 1에서 핵심 기능만 구현, Phase 2에서 고도화 |
| **증거 기반** | DB Truth Audit 결과를 기반으로 설계 |

### 1.2 Toss 미니앱 현실 반영

**현재 환경**:
- 로그인 기본 없음
- session_id 기반 추적
- 익명 사용자 중심

**향후 확장**:
- Toss 로그인 연동 시
- user_id 자동 활용
- 개인화 기능 강화

---

## 2. 데이터 아키텍처

### 2.1 테이블 구조

#### event_views (조회수 추적)

| 컬럼 | 타입 | NULL | 설명 |
|------|------|------|------|
| id | UUID | NOT NULL | PK |
| event_id | UUID | NOT NULL | FK → canonical_events(id) |
| user_id | UUID | NULL | 향후 Toss 로그인 연동 대비 |
| session_id | VARCHAR(255) | NOT NULL | 현재: session 기반 추적 |
| referrer_screen | VARCHAR(50) | NULL | 유입 화면 (home, hot, nearby 등) |
| viewed_at | TIMESTAMP | NOT NULL | 조회 시각 |

**인덱스**:
- `idx_event_views_event_id` (event_id)
- `idx_event_views_session_id` (session_id)
- `idx_event_views_user_id` (user_id) WHERE user_id IS NOT NULL
- `idx_event_views_viewed_at` (viewed_at DESC)
- `idx_event_views_event_id_viewed_at` (event_id, viewed_at DESC)

#### event_actions (액션 추적)

| 컬럼 | 타입 | NULL | 설명 |
|------|------|------|------|
| id | UUID | NOT NULL | PK |
| event_id | UUID | NOT NULL | FK → canonical_events(id) |
| user_id | UUID | NULL | 향후 Toss 로그인 연동 대비 |
| session_id | VARCHAR(255) | NOT NULL | 현재: session 기반 추적 |
| action_type | VARCHAR(50) | NOT NULL | like, share, ticket_click |
| created_at | TIMESTAMP | NOT NULL | 액션 시각 |

**인덱스**:
- `idx_event_actions_event_id` (event_id)
- `idx_event_actions_action_type` (action_type)
- `idx_event_actions_event_id_action_type` (event_id, action_type)
- `idx_event_actions_created_at` (created_at DESC)
- `idx_event_actions_session_id` (session_id)
- `idx_event_actions_user_id` (user_id) WHERE user_id IS NOT NULL

#### canonical_events (점수 저장)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| view_count | INTEGER | 전체 조회수 캐시 |
| buzz_score | FLOAT | 사용자 행동 기반 인기도 (0~1000) |
| buzz_updated_at | TIMESTAMP | buzz_score 마지막 업데이트 시각 |
| buzz_components | JSONB | 점수 구성 요소 (디버깅/분석용) |

**인덱스**:
- `idx_canonical_events_view_count` (view_count DESC)
- `idx_canonical_events_buzz_score` (buzz_score DESC)
- `idx_canonical_events_buzz_updated_at` (buzz_updated_at DESC) WHERE buzz_updated_at IS NOT NULL

---

## 3. buzz_score 계산식 (MVP)

### 3.1 공식

```
buzz_score =
  views_7d * 0.4 +
  (likes_7d * 5 + shares_7d * 10 + ticket_clicks_7d * 15) * 0.3 +
  popularity_score * 0.3

범위: 0~1000 클램핑
```

### 3.2 구성 요소 가중치

| 요소 | 가중치 | 근거 |
|------|--------|------|
| 조회수 (7일) | 40% | 가장 기본적인 관심 지표 |
| 액션 (7일) | 30% | 고관여 행동 (찜, 공유, 티켓 클릭) |
| popularity_score | 30% | 큐레이션 품질 보완 (신규 이벤트 부스트) |

### 3.3 액션별 배수

| 액션 타입 | 배수 | 근거 |
|----------|------|------|
| like (찜) | ×5 | 중간 관여도 |
| share (공유) | ×10 | 높은 관여도 |
| ticket_click (티켓 클릭) | ×15 | 구매 의도 최고 |

### 3.4 예시 계산

**시나리오**: 신규 인기 이벤트

| 지표 | 값 |
|------|-----|
| views_7d | 500 |
| likes_7d | 20 |
| shares_7d | 5 |
| ticket_clicks_7d | 3 |
| popularity_score | 300 |

**계산**:
```
view_contribution = 500 * 0.4 = 200
action_score = (20*5 + 5*10 + 3*15) = 195
action_contribution = 195 * 0.3 = 58.5
popularity_contribution = 300 * 0.3 = 90

buzz_score = 200 + 58.5 + 90 = 348.5 → 349
```

---

## 4. 설계 판단 근거

### 4.1 왜 user_id를 지금 넣는가?

**결정**: user_id 컬럼을 NULL로 추가

**근거**:
1. **마이그레이션 비용 최소화**:
   - 향후 로그인 연동 시 테이블 구조 변경 불필요
   - 스키마 안정성 확보

2. **Toss 로그인 연동 대비**:
   - Toss 미니앱은 향후 로그인 기능 추가 가능성 높음
   - user_id 기반 개인화 기능 즉시 활용 가능

3. **중복 제거 정확도 향상**:
   - 현재: session_id 기반 중복 제거
   - 향후: user_id 기반 정확한 unique viewer 집계

**Phase 1 (현재)**:
```sql
user_id = NULL  -- 모든 레코드
session_id = 'session-abc-123'  -- 필수
```

**Phase 2 (Toss 로그인 연동 후)**:
```sql
user_id = 'user-uuid-456'  -- 로그인 사용자
session_id = 'session-abc-123'  -- 여전히 유지 (로그아웃 대비)
```

### 4.2 왜 popularity_score를 보조 신호로 재사용하는가?

**결정**: buzz_score 계산 시 popularity_score를 30% 반영

**근거**:
1. **신규 이벤트 부스트**:
   - 신규 이벤트는 아직 조회수/액션 데이터가 없음
   - popularity_score로 초기 랭킹 부스트 (featured, 시작 임박 등)

2. **큐레이션 품질 보완**:
   - 사용자 행동만으로는 품질 저하 위험 (클릭베이트)
   - 관리자 큐레이션(featured)과 일정 기반 신호 혼합

3. **점진적 전환**:
   - 데이터 누적 전: popularity_score 의존도 높음
   - 데이터 누적 후: views/actions 의존도 증가
   - 자연스러운 전환

**예시**:

| 상황 | views_7d | actions_7d | popularity | buzz_score | 설명 |
|------|----------|------------|------------|-----------|------|
| 신규 featured 이벤트 | 0 | 0 | 400 | 120 | popularity로 부스트 |
| 일반 이벤트 (데이터 누적) | 1000 | 50 (×10) | 200 | 610 | 사용자 행동 우세 |
| 먼 미래 이벤트 | 500 | 30 | -400 | 80 | 페널티 반영 |

### 4.3 왜 event_impressions / 집계 테이블은 Phase 2로 미루는가?

**Phase 1에서 제외한 요소**:
- event_impressions (노출 추적)
- daily_event_stats (일자별 집계 캐시)
- hourly_trending_events (실시간 트렌드)

**근거**:
1. **MVP 우선**:
   - Phase 1 목표: buzz_score 기본 인프라 구축
   - 노출/실시간 트렌드는 고도화 기능

2. **데이터 볼륨 관리**:
   - event_impressions는 대용량 테이블 (초당 수백 건)
   - Phase 1에서 검증 후 Phase 2에서 최적화

3. **점진적 도입**:
   - Phase 1: 조회/액션만 추적 → 부하 최소
   - Phase 2: 노출 추적 추가 → CTR 계산 가능
   - Phase 3: 실시간 트렌드 → Redis/Stream 처리

**Phase 2 로드맵**:
```
event_impressions (노출 추적)
└─> CTR 계산 (Click-Through Rate)
    └─> 개인화 추천 (협업 필터링)

daily_event_stats (일자별 집계)
└─> 트렌드 분석 (7일/30일 비교)
    └─> 계절성 패턴 분석

hourly_trending_events (실시간 트렌드)
└─> Redis 캐싱
    └─> HOT 페이지 실시간 업데이트
```

---

## 5. 운영 계획

### 5.1 배치 스케줄

**권장 스케줄**:
```
02:00 KST - Metadata Update (popularity_score)
02:30 KST - Buzz Score Update (buzz_score) ← 신규
03:00 KST - Geo Refresh Pipeline
```

**근거**:
- popularity_score 업데이트 후 buzz_score 계산 (30분 여유)
- Geo Refresh 전에 점수 업데이트 완료

### 5.2 모니터링 지표

| 지표 | 설명 | 목표 |
|------|------|------|
| buzz_score 분포 | min/max/avg/median | avg > 100 |
| zero_score_count | buzz_score = 0인 이벤트 수 | < 30% |
| 업데이트 성공률 | 배치 성공/실패 | 100% |
| 배치 실행 시간 | 완료 시간 | < 5분 |

### 5.3 알림 기준

| 조건 | 심각도 | 액션 |
|------|--------|------|
| buzz_score 업데이트 실패 | 🔴 Critical | 즉시 재실행 |
| zero_score_count > 50% | 🟡 Warning | 데이터 수집 점검 |
| 배치 실행 시간 > 10분 | 🟡 Warning | 인덱스 최적화 |

---

## 6. API 통합 가이드

### 6.1 기존 API 수정 (예시)

**HOT 페이지 API** (기존: popularity_score 기반)

```typescript
// BEFORE
const hotEvents = await pool.query(`
  SELECT * FROM canonical_events
  WHERE is_deleted = false
  ORDER BY popularity_score DESC
  LIMIT 20
`);

// AFTER (buzz_score 우선, popularity_score fallback)
const hotEvents = await pool.query(`
  SELECT * FROM canonical_events
  WHERE is_deleted = false
  ORDER BY
    CASE
      WHEN buzz_updated_at IS NOT NULL THEN buzz_score
      ELSE popularity_score
    END DESC
  LIMIT 20
`);
```

### 6.2 새로운 정렬 옵션

| 정렬 기준 | 설명 | 사용처 |
|----------|------|--------|
| `buzz_score DESC` | 사용자 행동 기반 인기도 | HOT 페이지 |
| `popularity_score DESC` | 큐레이션/일정 기반 랭킹 | EXPLORE 페이지 |
| `view_count DESC` | 전체 조회수 | 통계 페이지 |
| `buzz_score * 0.7 + popularity_score * 0.3 DESC` | 하이브리드 | 메인 피드 |

---

## 7. Phase 2 확장 계획

### 7.1 단기 (1~2개월)

1. **개인화 추천**:
   - 사용자별 조회/찜 이력 기반
   - 협업 필터링 (비슷한 사용자가 좋아한 이벤트)

2. **실시간 트렌드**:
   - 1시간 단위 조회수 급증 감지
   - Redis 캐싱으로 HOT 페이지 실시간 업데이트

3. **CTR 계산**:
   - event_impressions 테이블 추가
   - CTR = clicks / impressions

### 7.2 중기 (3~6개월)

1. **계절성 패턴 분석**:
   - 일자별/시간대별 조회 패턴
   - 추천 시점 최적화

2. **A/B 테스트 인프라**:
   - buzz_score vs popularity_score 효과 비교
   - 가중치 최적화 실험

3. **ML 기반 점수 예측**:
   - 신규 이벤트의 buzz_score 예측
   - 조기 부스트 전략

---

## 8. 변경 파일 요약

| 파일 | 변경 내용 | 유형 |
|------|----------|------|
| `migrations/20260120_add_buzz_score_infrastructure.sql` | 스키마 생성 | 신규 |
| `src/jobs/updateBuzzScore.ts` | 배치 잡 | 신규 |
| `package.json` | npm script 추가 | 수정 |
| `docs/BUZZ_SCORE_DESIGN_SUMMARY.md` | 설계 문서 | 신규 |
| `docs/POPULARITY_SCORE_RECOMMENDATION.md` | 권고안 | 신규 |

---

## 9. 실행 체크리스트

### 9.1 마이그레이션 실행

```bash
# 1. 마이그레이션 실행
psql -d fairpick -f migrations/20260120_add_buzz_score_infrastructure.sql

# 2. 스키마 검증
psql -d fairpick -c "\d event_views"
psql -d fairpick -c "\d event_actions"
psql -d fairpick -c "\d canonical_events" | grep buzz
```

### 9.2 배치 테스트

```bash
# 1. 첫 실행 (데이터 없음)
npm run update:buzz-score

# 2. 로그 확인
# - buzz_score 분포 출력
# - zero_score_count 확인
# - 배치 실행 시간 확인
```

### 9.3 API 통합

```typescript
// 1. HOT 페이지에서 buzz_score 사용
// 2. 응답 JSON에 buzz_score 포함
// 3. 프론트엔드에서 "인기 급상승" 배지 표시
```

---

## 10. FAQ

**Q1: buzz_score가 0인 이벤트가 많은데 괜찮은가?**

A: Phase 1에서는 정상입니다. 신규 이벤트는 아직 조회/액션 데이터가 없어 popularity_score만 반영되므로 점수가 낮을 수 있습니다. 데이터 누적 후 자연스럽게 개선됩니다.

**Q2: popularity_score와 buzz_score를 언제 어디서 사용해야 하는가?**

A:
- **HOT 페이지**: `buzz_score DESC` (사용자 행동 기반)
- **EXPLORE 페이지**: `popularity_score DESC` (큐레이션 기반)
- **메인 피드**: 하이브리드 (buzz * 0.7 + popularity * 0.3)

**Q3: user_id를 지금 넣는 이유는?**

A: 향후 Toss 로그인 연동 시 마이그레이션 비용을 최소화하기 위함입니다. Phase 1에서는 모두 NULL이지만, Phase 2에서 자동으로 활용됩니다.

**Q4: 7일 lookback 기간이 짧지 않은가?**

A: MVP에서는 7일이 적절합니다. 문화/공연 이벤트는 시즌성이 강하므로 최근 트렌드가 더 중요합니다. Phase 2에서 30일 옵션 추가 가능.

---

**최종 작성일**: 2026-01-20
**검토 완료**: ✅
