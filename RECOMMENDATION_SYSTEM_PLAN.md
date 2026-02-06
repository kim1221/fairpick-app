# ⚠️ DEPRECATED - Fairpick 추천 시스템 개발 계획서 (Naver API 방식)

> **❌ 이 문서는 폐기되었습니다**  
> **폐기 사유**: 네이버 API `total` 값의 정확도 25% 확인 (Sampling 테스트 결과)  
> **새 계획서**: `HOT_SCORE_IMPLEMENTATION_GUIDE.md` 참고  
> **폐기일**: 2026-02-05

---

**최종 수정일**: 2026-02-05  
**목적**: 초기 사용자 데이터 없이도 품질 높은 이벤트 추천 제공  
**AI 피드백 반영**: Gemini, Perplexity, GPT-4 종합 검토 완료

## ⚠️ 주요 변경사항

### 폐기된 접근 방식
- ❌ 네이버 블로그 `total` 언급 수 → Percentile 변환
- ❌ 단일 buzz_score 컬럼 사용
- ❌ 외부 신호(Naver) 중심 전략

### 새로운 접근 방식
- ✅ **카테고리별 Hot Score** (KOPIS + Consensus + Structural)
- ✅ **컴포넌트 분리** (buzz_components JSONB 활용)
- ✅ **기존 buzz_score 시스템 확장**
- ✅ **내부 데이터 중심** (사용자 행동 + 메타데이터)

---

## 📌 이 문서의 보존 이유
- 초기 전략 수립 과정 기록
- AI 피드백 비교 분석 자료
- "하지 말아야 할 것" 참고 자료

---

---

## 📋 목차
1. [프로젝트 개요](#1-프로젝트-개요)
2. [AI 피드백 종합 및 핵심 수정사항](#2-ai-피드백-종합-및-핵심-수정사항)
3. [핵심 전략](#3-핵심-전략)
4. [추천 시스템 아키텍처](#4-추천-시스템-아키텍처)
5. [단계별 개발 로드맵](#5-단계별-개발-로드맵)
6. [섹션별 추천 로직](#6-섹션별-추천-로직)
7. [다양성 확보 메커니즘](#7-다양성-확보-메커니즘)
8. [성공 지표](#8-성공-지표)
9. [리스크 및 대응](#9-리스크-및-대응)

---

## 1. 프로젝트 개요

### 1.1 Fairpick의 정체성
- **Toss MiniApp** 기반 이벤트 추천 서비스
- **핵심 가치**: "지금(Time) + 여기(Space) + 바로 할 수 있음(Experience)"
- **차별점**: 장소가 아닌 이벤트 중심, 광고 없는 공정한 추천

### 1.2 기술 환경
- **Backend**: Node.js, TypeScript, PostgreSQL
- **Frontend**: React (Toss MiniApp 환경 - Storage API만 사용)
- **External APIs**: 
  - Naver Search API (블로그 언급 수) ⭐ 핵심
  - Kakao Local API (지오코딩)
  - 공공 API (KOPIS, 문화포털, Tour API)
- **AI**: Claude/GPT (메타데이터 추출)

### 1.3 제약사항
- **Cold Start**: 초기 사용자 데이터 없음
- **법적 제약**: 크롤링/스크래핑 불가 (공식 API만)
- **API 한도**: Naver API 일일 25,000 쿼리
- **비용**: 월 ~$50 (AI API만, 나머지 무료)

---

## 2. AI 피드백 종합 및 핵심 수정사항

### 2.1 3개 AI 공통 지적 (⭐ 최우선 반영)

| 이슈 | Gemini | Perplexity | GPT-4 | 최종 결정 |
|------|--------|------------|-------|----------|
| **buzz_score > 15 고정값 위험** | Dynamic Threshold (percentile) | 섹션별 차등 임계값 | 섹션별 + 3단계 Fallback | ✅ 모두 반영 |
| **지역 커버리지 문제** | - | 지역별 정책 (서울/지방) | "내 주변" 2-트랙 필수 | ✅ 반영 |
| **Naver 쿼리 품질** | - | - | region/venue 포함 필수 | ✅ 반영 |
| **점진적 도입 필요** | - | 한 번에 하나씩 추가 | Week별 명확히 분리 | ✅ 반영 |
| **API 한도 관리** | Tiered Update (중요도별) | - | 우선순위 업데이트 | ✅ 반영 |
| **캐싱 전략** | Geohash 격자 캐싱 | - | - | ✅ 반영 |

### 2.2 착수 전 필수 수정 3가지 (GPT 지적)

#### ⭐⭐⭐ 1. "내 주변" 2-트랙 전략
```
문제: buzz_score > 15로 필터하면 지방/소도시는 텅 빔
해결: 트랙1 (핫한 근처 70%) + 트랙2 (진짜 근처 30%)
```

#### ⭐⭐⭐ 2. Naver 쿼리에 region/venue 필수 포함
```
문제: title만 검색 시 동명이벤트 오염 심각
해결: "${title} ${region} ${year}" 형식 필수
```

#### ⭐⭐⭐ 3. 섹션별 Threshold + 3단계 Fallback
```
문제: 모든 섹션 동일 기준 = 비현실적
해결: 섹션별 다른 임계값 + 부족 시 단계적 하향
```

---

## 3. 핵심 전략

### 3.1 품질 우선 원칙 (수정됨)

**Before (원래)**:
```
모든 섹션 = buzz_score > 15 (고정, 강제)
```

**After (AI 피드백 반영)**:
```
섹션별 목적에 맞는 차등 전략
- "지금 떠오르는": 엄격 (20/15/10)
- "오늘의 추천": 보통 (15/10/5)
- "내 주변": 관대 + 2-트랙 (10/0)
- "새로 올라왔어요": 관대 (10/0)
```

### 3.2 Buzz Score 시스템

#### 데이터 수집
- **소스**: Naver Search API (블로그 검색)
- **쿼리 형식**: `"${title} ${region} ${year}"` (동명이벤트 오염 방지)
- **저장**: 
  - `raw_mentions`: 실제 언급 수 (원본)
  - `buzz_score`: Percentile 0~100 (정규화)

#### Percentile 기반 정규화 (Gemini + GPT 제안)
```
raw_mentions → percentile 변환 (주간 배치)
"15점" = 항상 상위 85% (안정적)
```

**장점**:
- 시간이 지나도 임계값 의미 일정
- 전체 이벤트 수 변해도 안정적

#### 업데이트 주기 (Gemini 제안: Tiered Update)
```
P0 (긴급): 매일
  - D-7 이내 마감
  - 진행 중
  - buzz_score > 80

P1 (중요): 3일마다
  - D-7~14 마감
  - buzz_score 50~80

P2 (보통): 주 1회
  - 나머지
```

**효과**: API 사용량 1/3~1/5 감소

### 3.3 지역별 정책 (Perplexity 제안)

| 지역 | Buzz 조정 | 거리 범위 | 설명 |
|------|----------|----------|------|
| **서울** | 1.0배 (기준) | 3km | 엄격 |
| **수도권** | 0.7배 (30% 낮춤) | 5km | 보통 |
| **광역시** | 0.5배 (50% 낮춤) | 7km | 관대 |
| **기타** | 0.3배 (70% 낮춤) | 10km | 매우 관대 |

**효과**: "서울 전용 앱" 문제 해결

### 3.4 "내 주변" 2-트랙 전략 (GPT 제안)

**트랙1 (핫한 근처, 70%)**:
- buzz_score >= 10
- 거리 < 3km
- 거리순 정렬

**트랙2 (진짜 근처, 30%)**:
- buzz 무관
- 거리 < 3km
- 단, 시간성 강하게 (마감 임박 or 신규)
- 거리순 정렬

**결과**: 품질 유지 + 커버리지 보장

### 3.5 시간 감쇠 (Decay)

등록일 기준 자동 점수 감소:
- 0~7일: 1.0배
- 8~14일: 0.9배
- 15~21일: 0.8배
- 22~28일: 0.7배
- 29일~: 0.6배

### 3.6 Exploration Slot (섹션별 차등)

| 섹션 | Exploration 비율 | 이유 |
|------|-----------------|------|
| 지금 떠오르는 | 20% | 핫함이 목적 |
| 오늘의 추천 | 30% | 균형 |
| 이번 주말 | 20% | 계획 세우기 |
| 마감 임박 | 10% | 마감이 목적 |
| 내 주변 | 30% | 로컬 발견 중요 |
| 지금 바로 | 30% | 다양성 중요 |
| 새로 올라왔어요 | 0% | 이미 탐색 목적 |

### 3.7 근거 배지 필수 (GPT 제안)

**모든 추천 카드에 최소 1개 배지 필수**

우선순위:
1. 마감 임박 (D-3)
2. 도보 거리 (< 1km)
3. 무료
4. 이번 주말
5. 요즘 인기 (buzz > 80)
6. 새로 올라옴
7. 최소: 거리 표시

---

## 4. 추천 시스템 아키텍처

### 4.1 DB 스키마

**canonical_events 테이블 추가 컬럼**:
```sql
-- Buzz Score 관련
raw_mentions INTEGER DEFAULT 0            -- 네이버 실제 언급 수
buzz_score FLOAT DEFAULT 0                -- Percentile 0~100
buzz_updated_at TIMESTAMP                 -- 마지막 업데이트
update_priority INTEGER DEFAULT 2         -- 0(매일), 1(3일), 2(주1)

-- 수동 큐레이션
manual_boost INTEGER DEFAULT 0            -- 0/10/20/30

-- 내부 행동 (Phase 2+)
view_count INTEGER DEFAULT 0
click_count INTEGER DEFAULT 0
save_count INTEGER DEFAULT 0
share_count INTEGER DEFAULT 0
internal_buzz_score FLOAT DEFAULT 0
```

**사용자 행동 테이블** (Phase 2+):
```sql
user_event_views (user_id, event_id, viewed_at)
user_event_saves (user_id, event_id, saved_at)
user_event_hides (user_id, event_id, hidden_at, expires_at)
user_event_shares (user_id, event_id, shared_at, platform)
```

**Admin 추천 테이블** (Phase 2+):
```sql
admin_hot_event_suggestions (
  id, keyword, naver_mention_count, 
  suggested_at, status, notes
)
```

### 4.2 점수 계산 흐름

```
1. Base Score
   = buzz_score × w1 + distance_score × w2 + time_score × w3 + ...
   (섹션별 가중치 다름)

2. Manual Boost 적용
   = base_score + manual_boost

3. Decay 적용
   = boosted_score × decay_multiplier

4. 지역 조정
   = decayed_score (단, 임계값이 지역별로 이미 조정됨)

5. 사용자 행동 반영 (Phase 2+)
   = final_score × user_action_multiplier
```

---

## 5. 단계별 개발 로드맵

### Phase 1: Core System (Week 1-4) ⭐ 최우선

#### Week 1: 기본 인프라 구축
**목표**: Naver API 연동 및 데이터 수집

**작업**:
1. **DB 마이그레이션**
   - `raw_mentions`, `buzz_score`, `update_priority` 컬럼 추가
   - `manual_boost` 컬럼 추가
   - 인덱스 생성

2. **Naver API 연동 모듈**
   - `naverBuzzCollector.ts` 구현
   - 쿼리 형식: `"${title} ${region} ${year}"`
   - Rate limiting (25,000/day)
   - 에러 핸들링 및 재시도

3. **초기 데이터 수집**
   - 전체 이벤트 raw_mentions 수집
   - Percentile 계산 및 buzz_score 변환
   - update_priority 자동 계산

4. **검증**
   - 상위 20개 이벤트 수동 확인 (정말 핫한지?)
   - 동명이벤트 오염 체크
   - API 사용량 모니터링

**산출물**:
- ✅ buzz_score 데이터 채워짐
- ✅ Naver API 안정적 동작
- ✅ 초기 품질 검증 완료

---

#### Week 2: 품질 필터 적용 (단순 버전)
**목표**: 섹션별 기본 추천 동작 (Decay/Exploration 없이)

**작업**:
1. **섹션별 Threshold 구현**
   - 섹션별 3단계 Fallback 로직
   - 지역별 정책 적용
   - Config 외부화 (재배포 없이 조정 가능)

2. **"내 주변" 2-트랙 구현**
   - 트랙1: buzz >= 10, 거리순
   - 트랙2: buzz 무관, 시간성 강함, 거리순
   - 7:3 비율로 혼합

3. **Time Window 적용**
   - 오늘의 추천: 오늘만
   - 지금 바로: 현재 ±3시간
   - 이번 주말: 토/일
   - 마감 임박: D-7
   - 새로 올라왔어요: 최근 7일

4. **Safe Hours 체크** (Gemini 제안)
   - 카테고리별 영업시간 정의
   - "지금 바로" 섹션에 적용

**검증 (3일)**:
- 각 섹션 10개씩 결과 확인
- "내 주변" 트랙 비율 확인 (7:3)
- 지방 지역 테스트 (강원도 등)
- 섹션 간 중복률 < 20%

**산출물**:
- ✅ 7개 섹션 기본 동작
- ✅ 지역 커버리지 보장
- ✅ 품질 + 다양성 균형

---

#### Week 3: 다양성 메커니즘 (단계적 추가)
**목표**: Decay → Exploration 순차 적용

**Day 1-3: Decay 추가**
- Decay 함수 적용
- 매일 추천 변화 확인
- 검증: 전날 대비 30% 이상 변화

**Day 4: 검증 및 조정**
- Decay multiplier 튜닝
- 문제 발생 시 롤백 가능

**Day 5-7: Exploration 추가**
- 섹션별 Exploration 비율 적용
- "숨은 보석" 발굴 확인
- 검증: 인디/소규모 이벤트 노출 확인

**산출물**:
- ✅ 매일 추천 자동 변화
- ✅ 신규 이벤트 자동 우대
- ✅ 다양성 확보

---

#### Week 4: 최적화 및 검증
**목표**: 성능 개선, 운영 자동화

**작업**:
1. **Tiered Update Policy** (Gemini 제안)
   - P0/P1/P2 우선순위 자동 계산
   - 스케줄러 구현 (매일/3일/주1)
   - API 사용량 1/3 감소 확인

2. **Geohash 캐싱** (Gemini 제안)
   - Redis 연동
   - 행정동 단위 캐싱
   - 캐시 히트율 > 80% 목표

3. **근거 배지 구현** (GPT 제안)
   - 우선순위 로직
   - 최소 1개 보장
   - Frontend 연동

4. **모니터링**
   - Sentry 에러 추적
   - API 사용량 대시보드
   - 추천 품질 지표 수집

**최종 검증 (5일)**:
- 팀 전체 테스트 (10명 × 5일)
- 지역별 테스트 (서울/지방)
- 성능 테스트 (응답 시간 < 500ms)
- 다양성 테스트 (매일 30%+ 변화)

**Phase 1 완료 조건**:
- ✅ 모든 섹션 안정적 동작
- ✅ 지방 커버리지 확인
- ✅ API 에러율 < 1%
- ✅ 추천 품질 80% 이상 만족

---

### Phase 2: Admin Hot Event Discovery (Week 5-6)

#### Week 5: 키워드 기반 검색
**목표**: DB에 없는 화제 이벤트 발견

**작업**:
1. **키워드 생성**
   - 서울 핫스팟 20개 정의
   - 이벤트 타입 10개 정의
   - 조합: `"${region} ${type} ${month}"`
   - 총 200개 키워드

2. **네이버 검색 및 필터링**
   - 주간 배치 (월요일 오전)
   - 언급 수 > 100 임계값
   - DB 중복 체크
   - admin_hot_event_suggestions 저장

3. **우선순위 정렬**
   - 언급 수 높은 순
   - Top 20~30개만 Admin에게 제공

**산출물**:
- ✅ 주간 20~30개 추천
- ✅ 중복 제거 완료

---

#### Week 6: Admin UI 및 워크플로우
**목표**: Admin이 쉽게 확인하고 등록

**작업**:
1. **Admin 대시보드**
   - 추천 목록 조회 (/admin/hot-suggestions)
   - 언급 수, 키워드 표시
   - 수락/거부 버튼

2. **수락 플로우**
   - 수락 → 이벤트 등록 폼 (키워드 자동 입력)
   - 등록 완료 → status = 'added'

3. **자동 알림**
   - 슬랙/이메일로 주간 알림
   - "이번 주 핫 이벤트 20개 발견"

**검증**:
- Admin 수락률 > 30%
- 수락된 이벤트 평균 buzz_score > 50

**산출물**:
- ✅ 화제 이벤트 놓치지 않음
- ✅ 수동 입력 부담 최소화

---

### Phase 3: 사용자 행동 기반 개인화 (Week 7-8)
**시작 조건**: DAU 100+ 달성 시

#### Week 7: 행동 추적 인프라
**목표**: 사용자 행동 데이터 수집

**작업**:
1. **DB 테이블 생성**
   - user_event_views
   - user_event_saves
   - user_event_hides
   - user_event_shares

2. **Backend API**
   - POST /api/events/:id/view
   - POST /api/events/:id/save
   - POST /api/events/:id/hide
   - POST /api/events/:id/share

3. **Frontend 연동**
   - 이벤트 카드 노출 시 자동 view 추적
   - 저장/공유/숨기기 버튼
   - 비동기 처리 (UX 방해 없이)

4. **실시간 카운트 증가**
   - view_count, click_count, save_count, share_count

**산출물**:
- ✅ 사용자 행동 데이터 수집 시작
- ✅ 2주 데이터 축적 대기

---

#### Week 8: Soft Downranking 및 개인화
**목표**: 사용자별 맞춤 추천

**작업**:
1. **Soft Downranking 구현**
   - 조회: -15% (7일 유효)
   - 저장: +30%
   - 공유: +50%
   - 숨기기: 완전 제외 (30일)

2. **Internal Buzz Score 계산**
   - 매시간 배치
   - view×1 + click×2 + save×3 + share×5
   - Percentile 0~100 변환

3. **Hybrid Buzz Score**
   - final_buzz = external_buzz × 0.5 + internal_buzz × 0.5

4. **"최근에 본 이벤트" 섹션**
   - 마이페이지에 추가
   - 진행 중인 것만
   - 최근 조회순

**검증**:
- 저장률 > 5%
- 7일 리텐션 > 30%
- 사용자 인터뷰 만족도 > 70%

**산출물**:
- ✅ 개인화 추천
- ✅ Fairpick만의 추천 정체성

---

### Phase 4: 자동화 및 고도화 (Week 9+)

**작업**:
- 배치 스케줄러 완전 자동화
- 성능 최적화 (쿼리, 인덱스)
- A/B 테스트 프레임워크
- 머신러닝 기반 추천 (추후)

---

## 6. 섹션별 추천 로직

### 공통 원칙

**1. 섹션별 Threshold (3단계 Fallback)**

| 섹션 | Primary | Fallback | Final | 설명 |
|------|---------|----------|-------|------|
| 지금 떠오르는 | 20 | 15 | 10 | 진짜 핫한 것만 |
| 오늘의 추천 | 15 | 10 | 5 | 균형 |
| 이번 주말 | 15 | 10 | 5 | 계획용 |
| 마감 임박 | 15 | 10 | 5 | FOMO |
| 내 주변 | 10 (트랙1) | 0 (트랙2) | - | 2-트랙 |
| 지금 바로 | 10 | 5 | 0 | 즉시성 |
| 새로 올라왔어요 | 10 | 0 | - | 신규는 관대 |

**2. 지역별 조정**

임계값 × 지역 multiplier:
- 서울: 1.0
- 수도권: 0.7
- 광역시: 0.5
- 기타: 0.3

**3. Fallback 로직**

```
1. Primary 임계값으로 쿼리
   → 10개 이상 나오면 완료

2. Fallback 임계값으로 추가 쿼리
   → 부족한 개수만큼만

3. Final 임계값으로 마지막 시도
   → 최후의 수단
```

---

### 6.1 오늘의 추천 (1개)

**목적**: 오늘 가장 균형잡힌 이벤트

**조건**:
- buzz_score > 15 (Fallback: 10 → 5)
- 거리 < 5km
- 오늘 진행 중

**가중치**:
- buzz: 40%
- distance: 30%
- time_urgency: 20%
- category: 10%

**정렬**: 종합 점수 DESC

**배지**: 마감 임박 or 도보 or 무료 or 인기

---

### 6.2 지금 바로 갈 수 있어요 ⚡ (10개)

**목적**: 예약 없이 즉시 방문 가능

**조건**:
- buzz_score > 10 (Fallback: 5 → 0)
- 거리 < 3km
- 카테고리: 전시, 팝업, 마켓, 축제
- 현재 시각 ±3시간 내 진행 중
- **Safe Hours 체크** (카테고리별 영업시간)

**정렬**:
1. 거리 ASC
2. buzz_score DESC

**배지**: 도보 or 지금 가능 or 무료

---

### 6.3 지금 떠오르는 (10개)

**목적**: 요즘 가장 핫한 이벤트

**조건**:
- buzz_score > 20 (Fallback: 15 → 10)
- 거리 < 10km
- 최근 14일 내 등록 권장

**가중치**:
- buzz: 60%
- time_urgency: 20%
- distance: 10%
- category: 10%

**Exploration**: 20%

**정렬**: buzz × decay DESC

**배지**: 요즘 인기 or 마감 임박 or 주말

---

### 6.4 내 주변 (10개) ⭐ 2-트랙

**목적**: 가까운 곳 발견

**트랙1 (핫한 근처, 7개)**:
- buzz_score >= 10
- 거리 < 3km
- 정렬: 거리 ASC, buzz DESC

**트랙2 (진짜 근처, 3개)**:
- buzz 무관
- 거리 < 3km
- 시간성: 마감 D-7 OR 신규 7일
- 정렬: 거리 ASC

**혼합**: 트랙1 + 트랙2

**배지**: 도보 거리 필수

---

### 6.5 이번 주말 (10개)

**목적**: 주말 계획 세우기

**조건**:
- buzz_score > 15 (Fallback: 10 → 5)
- 거리 < 7km
- 이번 주 토/일 포함

**가중치**:
- weekend_overlap: 40%
- buzz: 40%
- distance: 20%

**Exploration**: 20%

**배지**: 이번 주말 or 인기 or 무료

---

### 6.6 마감 임박 (10개)

**목적**: FOMO 자극

**조건**:
- buzz_score > 15 (Fallback: 10 → 5)
- 거리 < 7km
- D-7 이내

**정렬**:
1. end_at ASC (마감일 빠른 순)
2. buzz_score DESC

**Exploration**: 10%

**배지**: D-N 필수

---

### 6.7 새로 올라왔어요 (10개)

**목적**: 신규 이벤트 발견

**조건**:
- buzz_score > 10 (Fallback: 0)
- 거리 < 5km
- 최근 7일 내 등록

**정렬**:
1. created_at DESC
2. buzz_score DESC

**Exploration**: 0% (이미 탐색 목적)

**배지**: 새로 올라옴 필수

---

## 7. 다양성 확보 메커니즘

### 7.1 Decay 함수
- 등록 후 경과일에 따라 자동 점수 감소
- 신규 이벤트 자동 우대
- 매일 추천 자동 변화

### 7.2 Exploration Slot
- 섹션별 차등 (0~30%)
- 품질 유지하며 숨은 보석 발굴

### 7.3 Time Window
- 섹션별 다른 시간 범위
- 자연스러운 변화 유도

### 7.4 excludeIds 체인
- 섹션 간 중복 최소화
- 순차적 제외 (오늘의 추천 → 지금 바로 → ...)

### 7.5 Daily Seed
- 같은 점수일 때 매일 다른 순서

---

## 8. 성공 지표

### 8.1 Phase 1 검증

**정량**:
- 상위 추천 80% 실제 화제성 있음
- buzz_score > 0 비율 > 70%
- 섹션 간 중복률 < 20%
- 매일 변화율 > 30%
- API 응답 < 500ms
- 에러율 < 1%

**정성**:
- 팀 테스트 "관심 있는 것 발견" > 50%
- 지방 테스트 "근처 이벤트 보임" > 80%

### 8.2 Phase 2 검증

- 주간 추천 20~30개
- Admin 수락률 > 30%
- 수락 이벤트 평균 buzz > 50

### 8.3 Phase 3 검증

- 저장률 > 5%
- 공유율 > 2%
- 7일 리텐션 > 30%
- 맞춤 추천 만족도 > 70%

### 8.4 전체 KPI (3개월)

| 지표 | 목표 |
|------|------|
| DAU | 500+ |
| 7일 리텐션 | 30%+ |
| 평균 세션 시간 | 3분+ |
| 이벤트 진입률 | 40%+ |
| 저장률 | 5%+ |

---

## 9. 리스크 및 대응

### 9.1 API 한도 초과
- **현황**: 일 ~120 쿼리 (한도의 0.48%)
- **대응**: Tiered Update로 1/3 감소

### 9.2 지역 커버리지
- **리스크**: 지방 텅 빔
- **대응**: 2-트랙 + 지역별 정책

### 9.3 동명이벤트 오염
- **리스크**: 잘못된 buzz_score
- **대응**: region/venue 포함 필수

### 9.4 품질 임계값 실패
- **리스크**: 추천 부족
- **대응**: 3단계 Fallback

### 9.5 법적 문제
- **리스크**: API 약관 위반?
- **대응**: 공식 API만, 크롤링 금지

---

## 10. 네이버 API 사용 (명확화)

### 10.1 Phase 1: 기존 이벤트 Buzz Score

**목적**: DB의 모든 이벤트 인기도 측정

**프로세스**:
1. 전체 이벤트 순회
2. 각 이벤트마다 Naver Search API 호출
3. 쿼리: `"${title} ${region} ${year}"`
4. 결과 total count → raw_mentions
5. Percentile 계산 → buzz_score

**업데이트 주기**:
- P0: 매일 (D-7, 진행 중, buzz > 80)
- P1: 3일마다 (D-7~14, buzz 50~80)
- P2: 주 1회 (나머지)

---

### 10.2 Phase 2: Admin Hot Event Discovery

**목적**: DB에 없는 화제 이벤트 발견

**프로세스**:
1. 키워드 생성 (200개)
   - `"${region} ${type} ${month}"`
   - 예: "성수동 팝업 2월"
2. Naver Search API로 검색
3. 언급 수 > 100 임계값
4. DB 중복 체크
5. 없으면 Admin에게 추천

**주기**: 주 1회 (월요일 오전)

---

## 11. 최종 체크리스트

### Phase 1 착수 전 필수
- [ ] "내 주변" 2-트랙 로직 확정
- [ ] Naver 쿼리 형식 확정 (region/venue)
- [ ] 섹션별 Threshold 테이블 확정
- [ ] 지역별 정책 확정
- [ ] Config 파일 설계

### Phase 1 완료 조건
- [ ] 모든 섹션 안정적 동작
- [ ] 지방 커버리지 확인
- [ ] 정량 지표 달성
- [ ] 팀 검증 통과

---

## 12. 결론

### 핵심 성공 요인
1. **품질 + 커버리지 균형** (2-트랙)
2. **지역별 정책** (서울/지방 다르게)
3. **점진적 도입** (한 번에 하나씩)
4. **데이터 품질** (region/venue 포함)
5. **운영 효율** (Tiered Update)

### Fairpick의 약속
**"지금 여기서 할 수 있는 좋은 것"**

- 복잡한 AI < 명확한 큐레이션
- 모든 이벤트 < 핫한 것 중심
- 개인화(나중) < 시간성(지금)

---

**문서 끝**

*이 계획서는 Gemini, Perplexity, GPT-4의 피드백을 종합 반영했습니다.*
