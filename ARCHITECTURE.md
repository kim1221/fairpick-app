# ARCHITECTURE

이 문서는 Fairpick의 **현재 시점 시스템 아키텍처 결정사항**을 설명한다.
WHY(철학, 방향성)는 PROJECT_CONTEXT.md를 기준으로 하며,
본 문서는 HOW(구현 구조, 흐름, 역할 분리)에 집중한다.

---

## 1. Architecture Goals

Fairpick 아키텍처의 목표는 다음과 같다.

1. 사용자 데이터가 없는 Cold Start 상황에서도 추천이 가능할 것
2. “왜 이 이벤트가 핫한가”를 설명 가능한 구조일 것
3. 완전 자동화가 아닌, 운영 가능한 자동화를 지향할 것

Fairpick은 개인화 이전 단계에서
“지금 사회적으로 주목받는 이벤트”를 가장 중요한 가치로 둔다.

---

## 2. High-Level System Flow

### Core Recommendation Flow

공공 API 기반으로 수집된 이벤트가
정규화 → 평가 → 추천으로 이어지는 기본 흐름이다.

공공 API (KOPIS, 문화포털, Tour API 등)
↓
Collector / Normalizer
↓
canonical_events (정규화된 이벤트 마스터)
↓
Hot Score Calculator
↓
Recommendation API
↓
Client (App / Web)

모든 추천은 canonical_events를 기준으로 수행된다.
사용자 개인화 추천은 초기 단계에서 제외된다.

---

### Parallel Discovery Flow (핫 이벤트 발굴)

공공 API로 포착하기 어려운
팝업, 힙한 전시/행사 등을 보완하기 위한 병렬 흐름이다.

검색 시그널 + AI 분석
↓
admin_hot_suggestions (이벤트 후보)
↓
Admin 검토 및 승인
↓
canonical_events

이 흐름의 목적은 “자동 등록”이 아니라 “자동 발견”이다.
최종 판단 책임은 항상 Admin에게 있다.

---

## 3. Event-Centric Data Architecture

### canonical_events

canonical_events는 Fairpick에서
**유일하게 사용자에게 노출되는 이벤트 엔티티**이다.

모든 출처
- 공공 API
- Admin 수동 입력
- AI 기반 발굴

은 최종적으로 canonical_events로 수렴한다.

주요 개념 필드:
- 기본 정보: title, venue, region, category, start_at, end_at
- 상태 정보: created_by, is_featured
- 평가 정보: hot_score, buzz_components(JSON)

---

### admin_hot_suggestions

아직 이벤트로 확정되지 않은 “후보 단계” 데이터를 저장한다.

- AI 또는 검색 기반으로 발견된 이벤트
- Admin이 빠르게 판단할 수 있도록 evidence 포함
- 승인 시 canonical_events로 생성

이 테이블은 자동화와 운영의 경계선 역할을 한다.

---

## 4. Hot Score Architecture

### Hot Score 정의

Hot Score는 다음 질문에 대한 상대적 지표다.

“이 이벤트가 지금 시점에서 얼마나 주목받고 있는가?”

절대적인 인기 수치가 아니라
이벤트 간 비교 가능성이 핵심이다.

---

### Hot Score 구성 요소

Hot Score는 네 가지 신호의 조합이다.

1. Performance Signal
- 공연 전용
- KOPIS 박스오피스 등 실제 소비 데이터

2. Consensus Signal
- 검색 결과에서 ‘실제 이벤트로 다뤄지는 비율’
- 단순 언급량이 아닌 정합성 중심

3. Structural Signal
- 이벤트 자체의 객관적 속성
- 장소, 기간, 출처 신뢰도, 지역 맥락

4. Internal Signal
- 사용자 저장, 클릭 등
- 초기 단계에서는 영향도 낮음

---

### Category-Aware Weighting (현재 기준)

공연:
- Performance 높음
- Consensus 중간
- Structural 중간

전시/축제:
- Consensus 높음
- Structural 중간

팝업:
- Structural 높음
- Consensus 보조

카테고리마다 “핫함을 증명하는 신호”가 다르다는 전제를 따른다.

---

## 5. Consensus Signal 설계

Consensus Signal의 핵심 질문은 하나다.

“이 이벤트가 지금 실제로 ‘이벤트’로 다뤄지고 있는가?”

판단 기준:
- 이벤트명 + 장소 + 시점이 함께 등장하는가
- 종료/후기보다 진행/안내/예매 문맥인가
- 단일 채널이 아닌 복수 채널에서 일관되게 등장하는가

---

## 6. Structural Signal 설계

Structural Signal은 변하지 않는 객관 속성을 평가한다.

주요 요소:
- Venue Prestige (국공립, 대형 공간 가산)
- Duration Balance (너무 짧거나 상설 감점)
- Source Reliability (KOPIS > 공공 API > 수동 입력)
- Region Context (성수, 홍대 등 핫플레이스 가산)

팝업/행사 카테고리에서 특히 중요하다.

---

## 7. Admin Hot Discovery System

목적:
- 자동화로 놓치기 쉬운 힙한 이벤트 발굴
- Admin의 탐색 비용 최소화

흐름:
키워드 조합 + 최신 검색
→ AI 기반 후보 추출
→ 중복 제거
→ admin_hot_suggestions 저장
→ Admin 승인/무시

팝업은 자동 등록하지 않는다.
AI는 추천자, Admin은 편집장이다.

---

## 8. Scheduler & Batch Jobs

설계 원칙:
- 실시간보다 배치 처리 우선
- 비용과 안정성 확보
- 점수 계산 로직 중앙화

주요 작업:
- Hot Score 재계산 (일 1회)
- 핫 이벤트 발굴 (일 1회)
- 종료 이벤트 정리

---

## 9. Recommendation Output 기준

“지금 추천” 이벤트는 다음 조건을 만족한다.

- is_featured = true
  또는
- hot_score가 카테고리별 기준 이상

정렬 우선순위:
1. is_featured
2. hot_score
3. 시간 적합성 (종료 임박 등)

---

END OF ARCHITECTURE

---

<!-- AUTO-GENERATED:START -->
## Auto-Generated Scheduler Summary

**Generated on:** 2026-02-07

### Active Schedules (11)

- **03:00** (`0 3 * * *`): geo-refresh-03
- **15:00** (`0 15 * * *`): geo-refresh-15
- **01:00** (`0 1 * * *`): cleanup
- **02:00** (`0 2 * * *`): metadata
- **02:30** (`30 2 * * *`): buzz-score
- **03:30** (`30 3 * * *`): price-info
- **15:30** (`30 15 * * *`): price-info-15
- **04:15** (`15 4 * * *`): phase2-internal-fields
- **04:30** (`30 4 * * *`): recommend
- **08:00** (`0 8 * * *`): ai-popup-discovery
- **09:00 (Mon)** (`0 9 * * 1`): ai-hot-rating

### Disabled Schedules (1)

- ~~04:00~~ (주석 처리): ai-enrichment

**Environment Variable Required:** `ENABLE_SCHEDULER=true`

<!-- AUTO-GENERATED:END -->
