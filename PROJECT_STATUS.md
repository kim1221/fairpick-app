# Fairpick 프로젝트 현황 보고서

> **마지막 업데이트**: 2026-02-05 (Hot Score 시스템 구현 계획 확정)  
> **현재 단계**: Hot Score 시스템 구현 대기 중  
> **개발 환경**: ✅ 정상 (Node.js v20.19.6, Watchman 활성화, Backend/Frontend 모두 실행 중)  
> **다음 작업**: Hot Score 시스템 구현 (8시간 예상)
> 
> ## 🔥 Hot Score 시스템이란?
> 
> **목적**: 초기 사용자 데이터 없이도 "요즘 핫한 이벤트" 추천
> 
> **전략**:
> - 카테고리별 점수 계산 (KOPIS + Consensus + Structural)
> - 기존 `buzz_score` 시스템 확장 (중복 방지)
> - Admin Discovery (팝업/힙한 이벤트 자동 발견)
> 
> **참고 문서**: `HOT_SCORE_IMPLEMENTATION_GUIDE.md` ⭐ **새 세션은 여기부터!**

---

## 📋 목차

1. [프로젝트 개요](#프로젝트-개요)
2. [전체 아키텍처](#전체-아키텍처)
3. [완료된 작업](#완료된-작업)
4. [3-5일 개발 계획](#3-5일-개발-계획)
5. [현재 상태](#현재-상태)
6. [다음 단계](#다음-단계)
7. [주요 파일 구조](#주요-파일-구조)
8. [데이터베이스 스키마](#데이터베이스-스키마)
9. [API 엔드포인트](#api-엔드포인트)
10. [환경 설정](#환경-설정)
11. [트러블슈팅](#트러블슈팅)

---

## 🎯 프로젝트 개요

### 서비스 콘셉트
**"이벤트를 찾는 게 아니라, 나에게 맞는 이벤트가 찾아오는 경험"**

- **플랫폼**: Toss MiniApp (Apps-in-Toss)
- **목표**: 추천 중심의 이벤트 발견 서비스
- **핵심 기능**: AI 기반 추천 + 사용자 행동 로그 기반 개인화

### 주요 특징
1. **추천 우선**: 단순 나열이 아닌 추천 알고리즘 기반
2. **익명 → 로그인 전환**: 처음에는 익명으로 시작, 저장/좋아요 시 로그인 유도
3. **AI 데이터 보강**: Naver Search API + Gemini AI로 이벤트 정보 자동 수집
4. **실시간 인기도**: 사용자 행동(조회, 저장, 공유) 기반 buzz_score 계산

---

## 🏗️ 전체 아키텍처

```
┌─────────────────────────────────────────────────────┐
│                  Toss MiniApp (Frontend)            │
│  - Granite Framework (React Native)                 │
│  - TDS React Native (UI Components)                 │
│  - 익명 사용자 관리 (Storage API)                    │
└─────────────────┬───────────────────────────────────┘
                  │ HTTP API
                  ▼
┌─────────────────────────────────────────────────────┐
│              Backend (Node.js + Express)            │
│  - 추천 알고리즘 (recommender.ts)                    │
│  - AI 데이터 보강 (Naver API + Gemini)              │
│  - 사용자 행동 로그 (user_events)                    │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│                PostgreSQL Database                  │
│  - canonical_events: 이벤트 원본 데이터              │
│  - events: 사용자 인게이지먼트 데이터                 │
│  - users: 익명 + 로그인 사용자                       │
│  - user_events: 사용자 행동 로그                     │
└─────────────────────────────────────────────────────┘
```

---

## ✅ 완료된 작업

### Phase 1: 데이터베이스 설계 및 백엔드 추천 시스템 (완료)

#### 1-1. 데이터베이스 스키마 설계
- **파일**: `backend/src/migrations/20260203_add_recommendation_schema.sql`
- **주요 테이블**:
  - `users`: 익명 사용자 + 로그인 사용자 통합 관리
  - `user_events`: 사용자 행동 로그 (view, save, unsave, share, click)
  - `user_preferences`: 사용자 선호 정보 (향후 사용)
  - `events` 테이블에 컬럼 추가:
    - `view_count`, `save_count`, `share_count`: 인게이지먼트 카운터
    - `buzz_score`: 인기도 점수 (시간 가중 합산)
    - `last_buzz_updated_at`: buzz_score 마지막 업데이트 시간

#### 1-2. 추천 알고리즘 구현
- **파일**: `backend/src/lib/recommender.ts`
- **알고리즘 특징**:
  - **Rule-based 스코어링**: 거리, 인기도, 시간, 카테고리, 신선도
  - **Cold Start 대응**: 사용자 데이터 없을 때 시간 기반 우선순위
  - **3-tier Fallback**:
    1. 사용자 행동 데이터 (buzz_score)
    2. 시간 기반 관련성 (마감 임박, 새로 등록)
    3. 외부 소스 신뢰도 (KOPIS > 문화포털)

- **주요 함수**:
  - `calcDistanceScore`: 거리 점수 (0-100)
  - `calcBuzzScore`: 인기도 점수 (로그 스케일, 0-100)
  - `calcTimeScore`: 시간 점수 (시작 임박 우대, 0-100)
  - `calcCategoryScore`: 카테고리 매칭 점수 (0-100)
  - `calcFreshnessScore`: 신선도 점수 (새로운 이벤트 우대, 0-100)
  - `calcTotalScore`: 가중치 합산 (기본: distance 40%, buzz 30%, time 20%, freshness 10%)

- **추천 섹션 구현**:
  - `getTodaysPick`: 오늘의 추천 1개 (종합 점수 최고)
  - `getTrending`: 지금 떠오르는 (buzz_score 높은 순)
  - `getNearby`: 내 주변 이벤트 (거리 기반)
  - `getPersonalized`: 취향 저격 (사용자 선호 기반, 향후 고도화)
  - `getThisWeekend`: 이번 주말 추천 (금/토/일 진행 이벤트)
  - `getLatest`: 새로 올라왔어요 (최신순)

#### 1-3. 추천 API 엔드포인트
- **파일**: `backend/src/routes/recommendations.ts`
- **엔드포인트** (6개):
  - `GET /api/recommendations/v2/today`: 오늘의 추천
  - `GET /api/recommendations/v2/trending`: 지금 떠오르는
  - `GET /api/recommendations/v2/nearby`: 내 주변
  - `GET /api/recommendations/v2/personalized`: 취향 저격
  - `GET /api/recommendations/v2/weekend`: 이번 주말
  - `GET /api/recommendations/v2/latest`: 새로 올라왔어요
- **쿼리 파라미터**:
  - `userId`: 사용자 ID (익명 ID 또는 로그인 ID)
  - `lat`, `lng`: 위치 좌표
  - `excludeIds`: 제외할 이벤트 ID (중복 방지)
  - `limit`: 결과 개수

#### 1-4. 사용자 행동 로그 API
- **파일**: `backend/src/routes/userEvents.ts`
- **엔드포인트** (3개):
  - `POST /api/user-events`: 행동 로그 기록
    - `actionType`: view, save, unsave, share, click
    - 익명 사용자 자동 생성
  - `POST /api/user-events/link-anonymous`: 익명 → 로그인 전환
    - 익명 사용자의 로그를 로그인 계정에 연결
  - `GET /api/user-events/stats/:userId`: 사용자 통계 조회

#### 1-5. 이벤트 상세 API
- **파일**: `backend/src/index.ts`
- **엔드포인트**:
  - `GET /api/events/:id`: 이벤트 상세 정보 조회
  - `canonical_events` + `events` JOIN
  - `view_count`, `save_count`, `share_count`, `buzz_score` 포함

### Phase 2: 프론트엔드 기본 UI 구현 (완료)

#### 2-1. 익명 사용자 관리
- **파일**: `src/utils/anonymousUser.ts`
- **기능**:
  - `getOrCreateAnonymousId()`: UUID 생성 및 Storage 저장
  - `getCurrentUserId()`: 로그인 여부 확인 후 ID 반환
  - `isLoggedIn()`: 로그인 여부 확인
  - `saveLoginInfo()`: 로그인 정보 저장
  - `logout()`: 로그아웃 (익명 ID는 유지)
- **Storage API 사용**: `@apps-in-toss/framework`의 Storage
- **주의**: localStorage, sessionStorage 사용 불가

#### 2-2. API 서비스 레이어
- **파일**: `src/services/recommendationService.ts`
  - 추천 API 호출 함수 (6개)
  - 타임아웃 처리 (10초)
  - 에러 핸들링
  - `getEventDetail()`: 이벤트 상세 조회
- **파일**: `src/services/userEventService.ts`
  - 사용자 행동 로그 기록
  - 익명 → 로그인 전환
  - 사용자 통계 조회
- **파일**: `src/config/api.ts`
  - API Base URL 설정 (개발/프로덕션)
  - **중요**: React Native에서는 `localhost` 대신 **로컬 IP 사용** (예: `172.20.10.4:5001`)

#### 2-3. UI 컴포넌트
- **파일**: `src/components/BottomTabBar.tsx`
  - 3-tab 구조: 추천, 발견, MY
  - 현재 활성 탭 표시
  - 네비게이션 연결

- **파일**: `src/components/EventCard.tsx`
  - 4가지 variants:
    - `large`: 오늘의 추천용 (큰 이미지, 200px)
    - `default`: 일반 리스트용 (180px)
    - `small`: 가로 스크롤용 (160px, 2줄 제목)
    - `horizontal`: 세로 리스트용 (100px, 가로 배치)
  - 카테고리 배지, 추천 이유 태그, 거리 표시
  - 날짜 계산 (오늘, N일 남음, N일 후 시작)

#### 2-4. 홈 화면 (추천)
- **파일**: `src/pages/home.tsx`
- **섹션 구조**:
  1. **오늘의 추천**: AI 기반 1개 (large 카드)
  2. **지금 떠오르는**: 인기 급상승 (small 카드, 가로 스크롤)
  3. **새로 올라왔어요**: 최신 이벤트 (default 카드, 세로 리스트)
- **기능**:
  - Pull-to-refresh 지원
  - 익명 사용자 자동 생성
  - 이벤트 클릭 시 `click` 로그 기록
  - 이벤트 상세 페이지로 네비게이션
  - 로딩/에러 상태 처리

#### 2-5. 이벤트 상세 페이지
- **파일**: `src/pages/event-detail.tsx`
- **기능**:
  - 이벤트 상세 정보 표시 (헤더 이미지, 기본 정보, 설명, 링크)
  - 저장/저장 취소 기능 (로컬 상태)
  - 공유 기능 (React Native Share API)
  - 사용자 행동 로그 자동 기록:
    - 페이지 진입 시: `view`
    - 저장/취소 시: `save` / `unsave`
    - 공유 시: `share`
  - 로딩/에러 상태 처리
  - 뒤로 가기 버튼

#### 2-6. 위치 기반 추천 고도화 (2026-02-04 완료)

##### 위치 권한 및 지오코딩
- **파일**: `src/pages/index.tsx`
- **기능**:
  - Toss SDK `getCurrentLocation` 연동 (Accuracy.Balanced)
  - 위치 권한 요청 (`openPermissionDialog`)
  - 위치 정보를 추천 API에 전달 (`lat`, `lng`)
  - 새로고침 시 위치 재획득

- **파일**: `src/utils/geocoding.ts` → `backend/src/index.ts`
- **변경**: Kakao Local API 직접 호출 → Backend `/geo/reverse` 엔드포인트 사용
- **이유**: API 키 보안, CORS 문제 방지

##### 행정동 이름 표시
- **파일**: `backend/src/index.ts` (`/geo/reverse` 엔드포인트)
- **기능**:
  - Kakao `coord2address` API 호출
  - `region_3depth_h_name` (행정동) 우선 사용 (예: "성수2가1동")
  - `region_3depth_h_name` 없으면 `region_3depth_name` (법정동) 사용 (예: "성수동2가")
  - **행정동 매핑 테이블 구현**:
    - 법정동 → 행정동 변환 (예: "성수동2가" → "성수2가1동")
    - 서울 주요 지역 50+ 매핑 (성동구, 강남구, 강북구, 서초구, 송파구, 용산구, 종로구, 중구, 마포구, 영등포구 등)

##### 거리 및 이동 시간 표시
- **파일**: `backend/src/lib/recommender.ts`
- **기능**: `formatTravelTime` 함수 추가
  - 실제 도로 우회율 1.3 적용
  - 3km 이내: 도보 시간 표시 (4km/h)
  - 3km 초과: 대중교통 시간 표시 (20km/h + 대기 5분)

- **파일**: `src/components/EventCard.tsx`
- **UI**: 거리 + 이동 시간 동시 표시
  - 예: "1.2km · 도보 18분"
  - 예: "8.5km · 대중교통 35분"

##### canonical_events 사용
- **파일**: `backend/src/lib/recommender.ts`
- **변경**: `events` 테이블 → `canonical_events` 테이블 사용
- **이유**: `canonical_events`에 `lat`, `lng`, `address`, `buzz_score` 등 완전한 데이터 존재
- **영향**: `getTodaysPick`, `getTrending`, `getLatest`, `getNearby`, `getWeekend` 모두 수정

##### 안정적 정렬 (Stable Sorting)
- **파일**: `backend/src/lib/recommender.ts`
- **구현**: 점수 차이 < 0.01일 때 `id ASC`로 2차 정렬
- **효과**: 같은 위치에서 새로고침 시 추천 순서 일관성 유지

##### Frontend 헤더 UI 개선
- **파일**: `src/pages/index.tsx`
- **추가**: 
  - 현재 위치 표시 (행정동 이름)
  - 새로고침 버튼 (위치 재획득)
  - "📍 성수2가1동" 스타일 표시

##### 새 추천 섹션 추가
- **파일**: `src/pages/index.tsx`
- **추가 섹션**:
  - 📍 내 주변 이벤트 (5km 이내)
  - 📅 이번 주말 (주말 기간 필터)
  - ❤️ 당신만을 위한 추천 🔒 (로그인 티저)

---

## 🎯 추천 시스템 전략 수립 (2026-02-04)

> 3개 AI (Gemini, Perplexity, GPT)의 답변을 비교 분석하여 Fairpick의 추천 전략 수립 완료

### 배경: 네이버 플레이스와의 차별화 고민
**문제점**:
- 현재 대부분 섹션에서 **거리 제한 없음** → 성수동에서 광주 이벤트 추천 (비현실적)
- "지역/전국" 탭 추가 시 네이버 플레이스와 동일해짐 → 차별성 상실

**질문**:
- [추천] 탭과 [발견] 탭의 역할을 어떻게 구분할까?
- 각 섹션의 거리 기준을 어떻게 설정할까?
- 지방 유저에게는 어떤 전략을 사용할까?

### 3개 AI 답변 비교

| 쟁점 | Gemini 🤖 | Perplexity 🔍 | GPT 🧠 | 최종 채택 |
|------|-----------|---------------|--------|----------|
| **정체성** | A안 (내 주변) | A + C 살짝 | **A + B 문장** | 🏆 GPT |
| **지금 떠오르는** | ❌ 전국 | 도시권/50km | **도시권 + 전국 3개** | 🏆 GPT |
| **동적 반경** | 5→15→30 | 10→20→50→100 | **5→10→20→50→100** | 🏆 GPT |
| **스코어링 개선** | - | **거리 먼저, 점수 나중** | - | 🏆 Perplexity |
| **지방 유저 UX** | **여행 제안 카드** | 확대 + 라벨 | 확대 + 필터 | 🏆 Gemini |
| **콜드 스타트** | 블로그 크롤링 | 폴백 단순화 | **폴백 2단계 (외부 X)** | 🏆 GPT |
| **도시권 정의** | 서울+경기 일부 | - | **행정구역 단순화** | 🏆 GPT |

### 최종 전략 (3개 AI 베스트 믹스)

#### 1. **정체성** (GPT 채택)
```
정체성: "내 주변 이벤트 큐레이션 (시간성 포함)"
슬로건: "오늘 뭐 하지?" 해결
One Thing: "지금(Time) + 여기(Space) + 할 것(Experience)"

[추천] 탭: "지금 당장 내 근처에서 할 수 있는 것"
[발견] 탭: "내가 탐색해서 고르는 것 (지역/전국/카테고리/검색)"
[My] 탭: "취향과 히스토리의 저장소"
```

#### 2. **섹션별 거리 기준** (GPT + Perplexity)

| 섹션 | 기본 반경 | 자동 확장 | 상한 | 근거 |
|------|----------|----------|------|------|
| 📍 내 주변 | 5km | 10 → 20 → 50 | 50km | "진짜 내 주변" (도보/자전거) |
| 📌 오늘의 추천 | 10km | 20 → 50 → 100 | 100km | 지하철 30분 이내 |
| 🔥 지금 떠오르는 | **도시권** | 50 → 100 → **전국 3개** | 전국 | 트렌드지만 갈 수 있는 곳 |
| 📅 이번 주말 | 20km | 50 → 100 | 100km | 주말엔 멀리 가도 OK |
| ✨ 새로 올라왔어요 | 20km | 50 → 100 | 100km | 신선도 우선, 너무 멀면 X |

**도시권 정의** (행정구역 기반):
- 수도권: 서울, 인천, 경기
- 부울경: 부산, 울산, 경남
- 대경권: 대구, 경북
- 호남권: 광주, 전남, 전북
- 충청권: 대전, 세종, 충남, 충북

#### 3. **스코어링 파이프라인 개선** (Perplexity ⭐)
```
기존 (잘못됨):
1. 전국 이벤트 100개 가져옴
2. 거리 점수 30% 포함해서 종합 점수 계산
3. 정렬

개선 (Perplexity 제안):
1. 거리 필터로 후보군 먼저 하드 컷 (10km 이내만)
2. 그 안에서 종합 점수 계산
3. 정렬
4. 결과 < 10개면 거리 확대 (20km) 후 반복
```

#### 4. **지방 유저 전략** (Gemini ⭐)
```
자동 확장 후에도 결과 < 3개면:

┌─────────────────────────────────┐
│ 💡 내 주변엔 이벤트가 많지 않아요  │
│                                  │
│ 🚗 이번 주말, [서울] 나들이 어때요?│
│ [서울 핫한 이벤트 보러가기 →]      │
└─────────────────────────────────┘

클릭 시 → 발견 탭 (지역=서울, 정렬=인기순)
```

#### 5. **콜드 스타트 전략** (GPT ⭐)
```typescript
// 폴백 2단계 단순화
1단계: buzz_score > 0인 이벤트
  → buzz_score 내림차순 정렬

2단계: buzz_score = 0 → 시간성 + 신선도
  2-1) 마감 임박 (3일 이내) → "마감 임박, D-3"
  2-2) 신규 등록 (3일 이내) → "새로 등록"
  2-3) 신뢰 소스 (KOPIS > CULTURE)

외부 크롤링은 MVP에서 제외 (비용/법적/유지보수 리스크)
```

#### 6. **"지금 떠오르는" 최종 정책** (GPT)
```
기본: 도시권 (수도권, 부울경 등)
폴백: 도시권 결과 < 3개면 "전국 TOP 3" 미리보기 추가

UI:
┌─────────────────────────────┐
│ 🔥 지금 떠오르는 (수도권)    │
│ - 이벤트 1                   │
│ - 이벤트 2                   │
│ - 이벤트 3                   │
└─────────────────────────────┘
┌─────────────────────────────┐
│ 🌏 전국에서 뜨는 중 (미리보기)│
│ - 부산 이벤트 (350km)        │
│ - 광주 이벤트 (280km)        │
│ → 더보기 (발견 탭으로 이동)   │
└─────────────────────────────┘
```

---

## 🔍 현재 추천 알고리즘 상세 분석 (2026-02-04)

> **목적**: 새로운 세션이 즉시 작업을 시작할 수 있도록 현재 코드의 동작 방식과 문제점을 상세히 기록

### 파일 위치
- **주요 파일**: `backend/src/lib/recommender.ts` (673 lines)
- **API 라우터**: `backend/src/routes/recommendations.ts`, `backend/src/index.ts`
- **데이터베이스**: PostgreSQL `canonical_events` 테이블

### 데이터베이스 스키마 (canonical_events)
```sql
-- 주요 컬럼
id TEXT PRIMARY KEY
title TEXT
main_category TEXT
start_at TIMESTAMPTZ
end_at TIMESTAMPTZ
created_at TIMESTAMPTZ
lat FLOAT              -- 위도 (필수)
lng FLOAT              -- 경도 (필수)
address TEXT           -- 주소 (예: "서울 성동구 성수동2가")
venue TEXT             -- 장소명
buzz_score FLOAT       -- 인기도 점수 (현재 대부분 0)
view_count INTEGER
is_deleted BOOLEAN
```

### 현재 구현된 추천 함수 (6개)

#### 1. `getTodaysPick` - 오늘의 추천 (1개)

**현재 로직**:
```typescript
if (location) {
  // 1단계: 근처 이벤트 100개 가져오기
  const nearbyQuery = `
    SELECT *, (6371 * acos(...)) AS distance_km
    FROM canonical_events
    WHERE end_at >= NOW() AND is_deleted = false
      AND lat IS NOT NULL AND lng IS NOT NULL
    ORDER BY distance_km ASC
    LIMIT 100
  `;
  // ⚠️ 문제: 100번째가 300km일 수 있음 (거리 제한 없음!)
  
  // 2단계: 인기/신선 이벤트 50개 (전국)
  const popularFreshQuery = `
    SELECT * FROM canonical_events
    WHERE end_at >= NOW() AND is_deleted = false
    ORDER BY buzz_score DESC NULLS LAST, created_at DESC
    LIMIT 50
  `;
  // ⚠️ 문제: 전국 이벤트 (거리 무관)
  
  // 3단계: 합쳐서 중복 제거 (150개 → ~120개)
  // 4단계: 종합 점수 계산 (거리 30% + 인기 30% + 시간 20% + 카테고리 15% + 신선도 5%)
  // 5단계: 최고점 1개 반환
} else {
  // location 없으면 전국 인기/신선 50개
}
```

**문제점**:
- ❌ **거리 제한 없음**: 성수동(37.5444, 127.0557)에서 광주 이벤트(300km) 추천 가능
- ❌ **전국 이벤트 혼합**: 인기 이벤트가 멀리 있어도 포함됨

**개선 방향**:
```sql
-- WHERE 절에 거리 하드 컷 추가
WHERE end_at >= NOW() 
  AND is_deleted = false
  AND (6371 * acos(...)) <= 10  -- ⭐ 10km 제한
```

---

#### 2. `getTrending` - 지금 떠오르는 (10개)

**현재 로직**:
```typescript
// buzz_score 기반 정렬 (전국, 거리 무관)
const query = `
  SELECT *,
    CASE 
      WHEN buzz_score > 0 THEN buzz_score
      WHEN (end_at - NOW()) <= INTERVAL '7 days' THEN 500 + (7-D)*50
      WHEN (NOW() - created_at) <= INTERVAL '7 days' THEN 400 + (7-D)*40
      WHEN source_priority_winner = 'KOPIS' THEN 300
      ELSE 100
    END AS trend_score
  FROM canonical_events
  ORDER BY trend_score DESC, id ASC
  LIMIT 10
`;
```

**문제점**:
- ❌ **전국 조회**: 부산 사용자에게 서울 이벤트 추천 (350km)
- ⚠️ **복잡한 폴백 점수**: 500점, 400점 등 의미 불명확

**개선 방향**:
- **도시권 필터 추가**: 같은 도시권(수도권, 부울경 등) 내에서만 검색
- **폴백 단순화**: 그룹(마감임박/신규/일반) → 정렬 방식

---

#### 3. `getNearby` - 내 주변 이벤트 (10개)

**현재 로직**:
```typescript
const query = `
  SELECT *, (6371 * acos(...)) AS distance_km
  FROM canonical_events
  WHERE end_at >= NOW() AND is_deleted = false
    AND lat IS NOT NULL AND lng IS NOT NULL
  ORDER BY distance_km ASC
  LIMIT 10
`;
```

**문제점**:
- ❌ **거리 제한 없음**: "내 주변"이라고 하지만 10번째가 50km일 수 있음

**개선 방향**:
```sql
-- 5km 하드 컷
WHERE ... AND (6371 * acos(...)) <= 5
```

---

#### 4. `getWeekend` - 이번 주말 (10개)

**현재 로직**:
```typescript
// 주말 기간 필터 (토요일 00:00 ~ 일요일 23:59)
const query = `
  SELECT * FROM canonical_events
  WHERE end_at >= $1 AND start_at <= $2
    AND is_deleted = false
  ORDER BY buzz_score DESC NULLS LAST, id ASC
  LIMIT 10
`;
```

**문제점**:
- ❌ **거리 무관**: 전국 주말 이벤트

**개선 방향**:
- `location` 있을 때 20km 제한 추가

---

#### 5. `getLatest` - 새로 올라왔어요 (10개)

**현재 로직**:
```typescript
const query = `
  SELECT * FROM canonical_events
  WHERE end_at >= NOW() AND is_deleted = false
  ORDER BY created_at DESC, id ASC
  LIMIT 10
`;
```

**문제점**:
- ❌ **거리 무관**: 전국 신규 이벤트
- ❌ **7일 필터 없음**: 1개월 전 등록도 "새로 올라왔어요"

**개선 방향**:
- `location` 있을 때 20km 제한
- `created_at >= NOW() - INTERVAL '7 days'` 필터 추가 (선택사항)

---

#### 6. `getPersonalized` - 취향 저격 (10개, 로그인 시)

**현재 로직**:
```typescript
// 사용자 선호 카테고리 필터
const query = `
  SELECT * FROM events  -- ⚠️ events 테이블 사용 (레거시)
  WHERE end_date >= NOW()
    AND category = ANY($1)  -- 선호 카테고리 배열
  LIMIT 50
`;
```

**문제점**:
- ❌ **events 테이블 사용**: canonical_events로 변경 필요
- ⚠️ **사용자 데이터 부족**: 현재 로그인 사용자 거의 없음

---

### 점수 계산 알고리즘

#### 기본 가중치 (WEIGHTS_BALANCED)
```typescript
{
  distance: 0.30,    // 거리 점수 (0-100)
  buzz: 0.30,        // 인기 점수 (0-100, 로그 스케일)
  time: 0.20,        // 시간 점수 (마감 임박 100점)
  category: 0.15,    // 카테고리 매칭 점수 (0-100)
  freshness: 0.05,   // 신선도 점수 (1일 이내 100점)
}
```

#### 거리 점수 계산
```typescript
function calcDistanceScore(distanceKm: number): number {
  if (distanceKm <= 1) return 100;
  if (distanceKm <= 3) return 80;
  if (distanceKm <= 5) return 60;
  if (distanceKm <= 10) return 40;
  if (distanceKm <= 20) return 20;
  return 0;  // 20km 초과는 0점
}
```

**문제점**:
- ⚠️ **점수 계산 전에 이미 300km 이벤트가 후보군에 포함됨**
- 거리 점수 0점을 받아도, 인기 점수가 높으면 추천됨

---

### Haversine 거리 계산 공식

#### TypeScript 버전
```typescript
// recommender.ts:192-203
function calculateDistance(lat1, lng1, lat2, lng2): number {
  const R = 6371; // 지구 반지름 (km)
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng/2) * Math.sin(dLng/2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
```

#### SQL WHERE 절 버전 (필요)
```sql
-- 10km 이내만 조회
WHERE (6371 * acos(
  cos(radians($1)) * cos(radians(lat)) * 
  cos(radians(lng) - radians($2)) + 
  sin(radians($1)) * sin(radians(lat))
)) <= 10
```

---

### 핵심 문제 요약

| 함수 | 현재 동작 | 문제점 | 개선 필요 |
|------|----------|--------|----------|
| `getTodaysPick` | 근처 100개 + 전국 50개 | 300km 이벤트 가능 | ✅ 10km 하드 컷 |
| `getTrending` | 전국 buzz_score 순 | 지역 무관 | ✅ 도시권 필터 |
| `getNearby` | 거리순 10개 | 50km도 "주변" | ✅ 5km 하드 컷 |
| `getWeekend` | 주말 필터 + 인기순 | 전국 조회 | ✅ 20km 제한 |
| `getLatest` | 최신순 10개 | 전국 조회 | ✅ 20km 제한 |
| `getPersonalized` | 선호 카테고리 | events 테이블 | ⚠️ canonical_events로 |

---

### 테스트 시나리오 (검증용)

#### 시나리오 1: 성수동에서 "오늘의 추천" 호출
```typescript
const location = { lat: 37.5444, lng: 127.0557 }; // 서울 성수동
const result = await getTodaysPick(pool, userId, location);

// 현재 결과 (문제):
// - "광주 아트센터 전시" (300km) ← 비현실적!

// 개선 후 기대 결과:
// - "성수동 팝업스토어" (2km) ← 현실적!
```

#### 시나리오 2: 부산에서 "지금 떠오르는" 호출
```typescript
const location = { lat: 35.1796, lng: 129.0756 }; // 부산 해운대
const result = await getTrending(pool, location);

// 현재 결과 (문제):
// - 서울 이벤트 10개 (350km)

// 개선 후 기대 결과:
// - 부산/울산/경남 이벤트 10개 (도시권 내)
```

---

## 🧪 Phase 1 검증 방법

### 검증 체크리스트
- [ ] **성수동 테스트**: 광주 이벤트(300km) 추천 안 됨
- [ ] **거리 제한 확인**: 각 섹션의 최대 거리가 설정값 준수
- [ ] **buzz_score = 0 정렬**: 마감임박/신규 그룹 우선 정렬
- [ ] **도시권 필터**: 부산에서 서울 이벤트 안 뜸 (지금 떠오르는)

### 테스트 API 호출 예시

1. **오늘의 추천 (성수동)**:
```bash
curl -X GET "http://localhost:5001/api/recommendations/v2/today?lat=37.5444&lng=127.0557&userId=test-user"

# 기대 결과: 성수동/강남구/광진구 등 10km 이내 이벤트
# ❌ 실패 케이스: "광주 아트센터" (300km)
# ✅ 성공 케이스: "성수 팝업스토어" (2km)
```

2. **내 주변 (서울역)**:
```bash
curl -X GET "http://localhost:5001/api/recommendations/nearby?lat=37.5547&lng=126.9707&limit=10"

# 기대 결과: 5km 이내 이벤트 (용산구, 중구, 종로구)
# ❌ 실패 케이스: 10번째가 인천(30km)
# ✅ 성공 케이스: 모든 이벤트 < 5km
```

3. **지금 떠오르는 (부산 해운대)**:
```bash
curl -X GET "http://localhost:5001/api/recommendations/v2/trending?lat=35.1796&lng=129.0756&limit=10"

# 기대 결과: 부산/울산/경남 이벤트 (도시권 내)
# ❌ 실패 케이스: 서울 이벤트 (350km)
# ✅ 성공 케이스: "부산 영화제", "울산 전시" 등
```

4. **이번 주말 (대전)**:
```bash
curl -X GET "http://localhost:5001/api/recommendations/weekend?lat=36.3504&lng=127.3845&limit=10"

# 기대 결과: 20km 이내 주말 이벤트
# ❌ 실패 케이스: 서울 이벤트 (150km)
# ✅ 성공 케이스: 대전/세종 이벤트
```

### SQL 직접 검증 (psql)

```sql
-- 1. 성수동 10km 이내 이벤트 개수 확인
SELECT COUNT(*) 
FROM canonical_events
WHERE end_at >= NOW() 
  AND is_deleted = false
  AND (6371 * acos(
    cos(radians(37.5444)) * cos(radians(lat)) * 
    cos(radians(lng) - radians(127.0557)) + 
    sin(radians(37.5444)) * sin(radians(lat))
  )) <= 10;

-- 예상 결과: 50~200개 (서울 중심부이므로 충분함)
-- 0개면: 데이터 부족 (테스트 데이터 추가 필요)

-- 2. 가장 먼 이벤트 거리 확인
SELECT title, address,
  (6371 * acos(...)) AS distance_km
FROM canonical_events
WHERE end_at >= NOW() AND lat IS NOT NULL
ORDER BY distance_km DESC
LIMIT 5;

-- 예상 결과: 가장 먼 이벤트가 500km+ (제주도 등)
```

---

## 📝 개발 노트 (새로운 세션 시작 시 체크)

### 필수 확인 사항
1. **백엔드 서버 실행 중인지 확인**:
   ```bash
   cd /Users/kimsungtae/toss/fairpick-app/backend
   npm run start
   # 포트: 5001
   ```

2. **프론트엔드 개발 서버 확인**:
   ```bash
   cd /Users/kimsungtae/toss/fairpick-app
   npm run dev
   # Granite Dev 서버 (Metro)
   ```

3. **데이터베이스 연결 확인**:
   ```bash
   psql -h localhost -U kimsungtae -d fairpick -c "SELECT COUNT(*) FROM canonical_events;"
   # 예상: 1000+ 이벤트
   ```

4. **Node.js 버전 확인** (중요!):
   ```bash
   node -v
   # 필수: v20.19.6 (nvm use 20)
   # ❌ v24.x는 Metro와 호환 문제 있음
   ```

### 자주 발생하는 문제 해결

| 문제 | 원인 | 해결 방법 |
|------|------|----------|
| `EMFILE: too many open files` | Metro 파일 감시 | `metro.config.js` 설정 확인 + Watchman 사용 |
| `Cannot find module 'metro-cache-key'` | Granite 의존성 문제 | `node_modules/@granite-js/mpack` 내부 복사 필요 |
| `buzz_updated_at` 컬럼 없음 | 마이그레이션 미실행 | `ts-node migrations/run-migration.ts 20260120_...` |
| Backend API 500 에러 | `buzz_score` 스키마 불일치 | `canonical_events` 테이블 사용 확인 |
| 이미지 안 뜸 | `image_url` ↔ `thumbnail_url` | `mapEventForFrontend` 함수 확인 |

### 작업 전 체크리스트
- [ ] `PROJECT_STATUS.md` 최신 내용 읽음
- [ ] `PHASE1_PROMPT.md` 읽음 (Phase 1 작업 시)
- [ ] 백엔드/프론트엔드 서버 정상 실행 확인
- [ ] `recommender.ts` 파일 읽음
- [ ] 테스트 계정으로 앱 접속 확인 (실기기/시뮬레이터)

---

## 📅 3-5일 개발 계획

> **목표**: 추천 시스템 MVP 완성 및 기본 UI 구현

### ✅ Day 1: 백엔드 추천 시스템 (완료)
- [x] 데이터베이스 스키마 설계
- [x] 추천 알고리즘 구현 (recommender.ts)
- [x] 추천 API 엔드포인트 6개
- [x] 사용자 행동 로그 API
- [x] 이벤트 상세 API

### ✅ Day 2: 프론트엔드 API 연동 (완료)
- [x] 익명 사용자 관리 (anonymousUser.ts)
- [x] API 서비스 레이어 (recommendationService, userEventService)
- [x] API Base URL 설정 (로컬 IP)

### ✅ Day 3: 기본 UI 컴포넌트 (완료)
- [x] BottomTabBar 구현
- [x] EventCard 구현 (4 variants)
- [x] 홈 화면 (추천) 구현
- [x] 이벤트 상세 페이지 구현

### 🔄 Day 4-5: UI 완성 및 개선 (진행 예정)
- [ ] **발견 페이지** 구현
  - 카테고리별 탐색 (팝업, 전시, 공연, 축제, 행사)
  - 필터링 (지역, 기간, 가격)
  - 검색 기능
- [ ] **MY 페이지** 구현
  - 저장한 이벤트 목록
  - 로그인/로그아웃
  - 최근 본 이벤트
- [ ] **로그인 기능** 구현
  - Toss Authentication 연동
  - 익명 → 로그인 전환 플로우
  - "더 정확한 추천을 위해 로그인" 유도
- [ ] **UI 폴리싱**
  - 로딩 스켈레톤
  - 애니메이션
  - 에러 메시지 개선

---

## 🚦 현재 상태 (2026-02-04 업데이트)

### 개발 환경
- ✅ **Node.js**: v20.19.6 (호환성 문제 해결)
- ✅ **Watchman**: 설치 및 활성화 (EMFILE 에러 해결)
- ✅ **Metro Bundler**: `metro.config.js` 설정 완료 (backend 디렉토리 제외)
- ✅ **Database 마이그레이션**: `buzz_updated_at` 컬럼 추가 완료

### 백엔드 (Backend)
- ✅ **서버 실행 중**: `http://0.0.0.0:5001` (네트워크 접근 가능)
- ✅ **데이터베이스 연결**: PostgreSQL (fairpick DB, user: kimsungtae)
- ✅ **API 엔드포인트**: 12개 (추천 6개 + 사용자 이벤트 3개 + 이벤트 상세 1개 + 지오코딩 1개 + 탐색 1개)
- ✅ **로컬 IP 접근**: `http://172.20.10.4:5001`
- ✅ **위치 기반 추천**: `canonical_events` 사용, `lat`/`lng` 기반 거리 계산
- ✅ **행정동 매핑**: 법정동 → 행정동 변환 테이블 (서울 50+ 지역)
- ⚠️ **거리 제한 미구현**: 섹션별 거리 하드 컷 필요 (Phase 1 작업 예정)
- ⚠️ **buzz_score 업데이트**: 수동 (백그라운드 스케줄러 미구현)

### 프론트엔드 (Frontend)
- ✅ **Dev 서버 실행 중**: `http://0.0.0.0:8081` (Granite)
- ✅ **API 연결**: `http://172.20.10.4:5001`로 정상 연결
- ✅ **구현 완료 (위치 기반 추천 UI)**:
  - 홈 화면 (추천) - 6개 섹션
    - 오늘의 추천 (1개, Top 3 논의 중)
    - 지금 떠오르는 (10개)
    - 내 주변 이벤트 (10개)
    - 이번 주말 (10개)
    - 새로 올라왔어요 (10개)
    - 당신만을 위한 추천 🔒 (티저)
  - 위치 권한 요청 (Toss SDK `getCurrentLocation`)
  - 현재 위치 표시 (행정동 이름)
  - 거리 + 이동 시간 표시 (예: "1.2km · 도보 18분")
  - 새로고침 버튼 (위치 재획득)
  - 이벤트 상세 페이지 (저장, 공유 기능)
  - 하단 탭 바 (3-tab: 추천, 발견, MY)
  - 이벤트 카드 컴포넌트 (4 variants)
  - 익명 사용자 관리
- ✅ **발견 페이지**: 이미 구현됨 (카테고리/지역 필터, 검색, 페이지네이션)
- ⏳ **미구현 (추가 작업 필요)**:
  - MY 페이지 (저장한 이벤트, 최근 본 이벤트)
  - 로그인 기능 (Toss Authentication)
  - UI 폴리싱 (로딩 스켈레톤, 애니메이션, 에러 메시지 개선)
  - **Phase 1~3 추천 시스템 개선** (거리 제한, 자동 확대, 도시권 정의)

### 데이터베이스
- ✅ **스키마**: `users`, `user_events`, `user_preferences`, `events`, `canonical_events`
- ✅ **buzz_score 인프라**: `buzz_score`, `buzz_updated_at`, `buzz_components` 컬럼 추가 완료
- ✅ **canonical_events**: `lat`, `lng`, `address` 컬럼 포함 (위치 기반 추천 가능)
- ⚠️ **데이터**: 수동 수집된 이벤트만 존재 (자동 수집기 미구현)
- ⚠️ **buzz_score**: 모두 0 (사용자 행동 데이터 없음) → Cold Start 전략 사용 중

### 추천 시스템 전략
- ✅ **정체성 확립**: "내 주변 이벤트 큐레이션 (시간성 포함)"
- ✅ **3개 AI 답변 비교 완료**: Gemini, Perplexity, GPT
- ✅ **최종 전략 수립**: 섹션별 거리 기준, 도시권 정의, 폴백 단순화
- ⏳ **구현 대기**: Phase 1~3 (거리 제한, 자동 확대, 도시권 정의)

---

## 🔥 Hot Score 시스템 구현 (최우선 작업)

> **작업 시작일**: 2026-02-05  
> **예상 소요**: 8시간 (1일)  
> **담당**: 새로운 AI 세션  
> **가이드**: `HOT_SCORE_IMPLEMENTATION_GUIDE.md` ⭐

### 배경

**문제**: 초기 사용자 데이터 없음 → `buzz_score` 모두 0 → "요즘 핫한 이벤트" 추천 불가

**초기 시도 (실패)**:
- 네이버 블로그 API `total` 값 사용
- Percentile 정규화 (0~100)
- **결과**: 정확도 25% (Sampling 테스트) → **폐기**

**최종 전략 (3개 AI 합의)**:
- **KOPIS** (공연): 박스오피스 순위 활용
- **Consensus** (전시/축제/행사): 다중 쿼리 합의 점수
- **Structural** (전체): 메타데이터 기반 점수 (장소 규모, 기간, 소스 신뢰도)
- **Admin Discovery** (팝업): 자동 후보 생성 + 수동 검증

### 핵심 결정사항

| 결정 | 근거 (AI) | 내용 |
|------|----------|------|
| **기존 시스템 확장** | GPT | `buzz_score` + `buzz_components` 재활용 (중복 방지) |
| **컴포넌트 분리** | GPT | JSONB에 모든 컴포넌트 저장 (디버깅/튜닝) |
| **즉시 라이트 계산** | GPT | Admin 수동 입력 시 즉시 계산 + 다음 날 재계산 |
| **팝업 재정의** | GPT | "hot_score" → "candidate_score" (후보점수) |
| **전시 후기 페널티** | GPT | -30 → -10으로 완화 |
| **종료 임박 부스트** | Gemini | D-7 이내 1.2배 부스트 |
| **백화점 필수** | Gemini | 더현대, 롯데 잠실, 신세계 강남 등 |

### 구현 계획 (8시간)

| Phase | 작업 내용 | 시간 |
|-------|----------|------|
| 1 | DB Migration + 라이브러리 생성 | 2h |
| 2 | updateBuzzScore.ts 확장 | 2h |
| 3 | Admin 즉시 계산 | 1h |
| 4 | Admin Discovery | 2h |
| 5 | 검증 및 테스트 | 1h |

**상세 가이드**: `HOT_SCORE_IMPLEMENTATION_GUIDE.md` 참고

---

## 🎯 다음 단계 (Hot Score 이후)

### 📍 우선순위 0: 추천 시스템 개선 (Phase 1~3 구현 예정)

> **목표**: 거리 기반 추천 고도화 및 네이버 플레이스와 차별화

#### Phase 1: 핵심 로직 개선 (이번 주 완료 목표)

##### Task 1: 거리 하드 제한 파이프라인 구현 ⭐
- **파일**: `backend/src/lib/recommender.ts`
- **목표**: SQL WHERE 절에 거리 제한 추가
- **작업 내용**:
  1. **헬퍼 함수 생성**:
     ```typescript
     /**
      * 거리 필터 SQL 조건 생성
      * @param maxDistanceKm - 최대 거리 (km)
      * @returns SQL WHERE 절 문자열
      */
     function buildDistanceFilter(maxDistanceKm: number): string {
       return `AND (6371 * acos(
         cos(radians($1)) * cos(radians(lat)) * 
         cos(radians(lng) - radians($2)) + 
         sin(radians($1)) * sin(radians(lat))
       )) <= ${maxDistanceKm}`;
     }
     ```
  
  2. **거리 제한 상수 정의**:
     ```typescript
     export const DISTANCE_LIMITS = {
       NEARBY: 5,      // 내 주변: 5km
       TODAY: 10,      // 오늘의 추천: 10km
       WEEKEND: 20,    // 이번 주말: 20km
       LATEST: 20,     // 새로 올라왔어요: 20km
       TRENDING: null, // 지금 떠오르는: 도시권 (Task 3)
     };
     ```
  
  3. **기존 쿼리 수정 예시** (`getTodaysPick`):
     ```typescript
     // 기존 (거리 제한 없음)
     const nearbyQuery = `
       SELECT *, (6371 * acos(...)) AS distance_km
       FROM canonical_events
       WHERE end_at >= NOW() AND is_deleted = false
       ORDER BY distance_km ASC
       LIMIT 100
     `;
     
     // 개선 (10km 제한)
     const nearbyQuery = `
       SELECT *, (6371 * acos(...)) AS distance_km
       FROM canonical_events
       WHERE end_at >= NOW() 
         AND is_deleted = false
         AND lat IS NOT NULL AND lng IS NOT NULL
         AND (6371 * acos(...)) <= ${DISTANCE_LIMITS.TODAY}
       ORDER BY distance_km ASC
       LIMIT 100
     `;
     ```

- **주의사항**:
  - Phase 1에서는 **자동 확대 구현 안 함** (Phase 2에서)
  - 결과가 0개여도 빈 배열 반환 (에러 아님)
  - `location` 없으면 거리 필터 적용 안 함

---

##### Task 2: 섹션별 거리 기준 적용
- **파일**: `backend/src/lib/recommender.ts`
- **작업 내용**:
  
  | 함수 | 현재 | 변경 후 | 적용 범위 |
  |------|------|---------|----------|
  | `getTodaysPick` | 제한 없음 | **10km** | nearbyQuery + popularFreshQuery |
  | `getNearby` | 제한 없음 | **5km** | 메인 쿼리 |
  | `getWeekend` | 거리 무관 | **20km** | location 있을 때만 |
  | `getLatest` | 거리 무관 | **20km** | location 있을 때만 |
  
- **구현 체크리스트**:
  - [ ] `getTodaysPick`: nearbyQuery에 10km 제한
  - [ ] `getTodaysPick`: popularFreshQuery에도 10km 제한 추가 (location 있을 때)
  - [ ] `getNearby`: 5km 제한
  - [ ] `getWeekend`: location 파라미터 추가 + 20km 제한
  - [ ] `getLatest`: location 파라미터 추가 + 20km 제한

---

##### Task 3: "지금 떠오르는" 도시권 제한
- **새 파일 생성**: `backend/src/lib/cityZones.ts`
  ```typescript
  export const CITY_ZONES: Record<string, string[]> = {
    '수도권': ['서울', '인천', '경기'],
    '부울경': ['부산', '울산', '경남'],
    '대경권': ['대구', '경북'],
    '호남권': ['광주', '전남', '전북'],
    '충청권': ['대전', '세종', '충남', '충북'],
    '강원권': ['강원'],
    '제주권': ['제주'],
  };

  /**
   * 주소에서 도시권 판별
   * @param address - "서울 성동구 성수동..." 형식
   * @returns 도시권 지역 배열 (예: ['서울', '인천', '경기'])
   */
  export function getCityZone(address: string): string[] {
    for (const [zoneName, regions] of Object.entries(CITY_ZONES)) {
      if (regions.some(region => address.includes(region))) {
        return regions;
      }
    }
    return []; // 매핑 안 되면 빈 배열 (전국으로 처리)
  }
  ```

- **`getTrending` 함수 수정**:
  ```typescript
  export async function getTrending(
    pool: Pool,
    location?: Location,  // ⭐ 파라미터 추가
    excludeIds: Set<string> = new Set(),
    limit: number = 10
  ): Promise<ScoredEvent[]> {
    
    // location 있으면 도시권 필터링
    let regionFilter = '';
    if (location) {
      // 1. Reverse Geocoding (기존 /geo/reverse 활용)
      const response = await fetch(
        `http://localhost:5001/geo/reverse?lat=${location.lat}&lng=${location.lng}`
      );
      const data = await response.json();
      const address = data.label || '';
      
      // 2. 도시권 판별
      const cityZone = getCityZone(address);
      
      // 3. SQL WHERE 조건
      if (cityZone.length > 0) {
        const conditions = cityZone.map(r => `address LIKE '%${r}%'`).join(' OR ');
        regionFilter = `AND (${conditions})`;
      }
    }
    
    const query = `
      SELECT * FROM canonical_events
      WHERE end_at >= NOW() AND is_deleted = false
        ${regionFilter}
      ORDER BY buzz_score DESC NULLS LAST, id ASC
      LIMIT ${limit}
    `;
    // ...
  }
  ```

- **주의사항**:
  - Reverse Geocoding은 **내부 API 호출** (`http://localhost:5001/geo/reverse`)
  - location 없으면 전국 조회 (기존 동작 유지)

---

##### Task 4: 폴백 2단계 단순화
- **파일**: `backend/src/lib/recommender.ts`
- **목표**: buzz_score = 0일 때 복잡한 점수 계산 제거
- **작업 내용**:
  
  ```typescript
  // 기존 (복잡함) - 제거
  CASE 
    WHEN buzz_score > 0 THEN buzz_score
    WHEN buzz_score = 0 AND (end_at - NOW()) <= INTERVAL '7 days'
    THEN 500 + (7 - EXTRACT(DAY FROM (end_at - NOW()))) * 50
    // ...
  END AS trend_score
  
  // 개선 (단순함) - 적용
  // 1단계: buzz_score > 0
  const buzzQuery = `
    SELECT * FROM canonical_events
    WHERE buzz_score > 0 ${regionFilter}
    ORDER BY buzz_score DESC, id ASC
    LIMIT ${limit}
  `;
  
  // 2단계: buzz_score = 0 (부족하면)
  const fallbackQuery = `
    SELECT *,
      CASE
        WHEN (end_at - NOW()) <= INTERVAL '3 days' THEN 'deadline'
        WHEN (NOW() - created_at) <= INTERVAL '3 days' THEN 'fresh'
        ELSE 'normal'
      END AS fallback_group
    FROM canonical_events
    WHERE buzz_score = 0 ${regionFilter}
    ORDER BY
      CASE fallback_group
        WHEN 'deadline' THEN 1
        WHEN 'fresh' THEN 2
        ELSE 3
      END,
      end_at ASC,
      created_at DESC,
      id ASC
    LIMIT ${limit}
  `;
  ```

- **reason 라벨**:
  - buzz_score > 0: `['인기 급상승']`
  - deadline: `['마감 임박', 'D-3']`
  - fresh: `['새로 등록']`
  - normal: `['추천']`

---

#### Phase 2: 자동 거리 확대 및 UI 개선 (다음 주)

##### Task 5: 자동 거리 확대 로직
- **파일**: `backend/src/lib/recommender.ts`
- **로직**:
  ```typescript
  async function fetchWithDistanceExpansion(
    initialDistance: number,
    maxDistance: number,
    minResults: number = 10
  ) {
    let currentDistance = initialDistance;
    let results = [];
    
    while (results.length < minResults && currentDistance <= maxDistance) {
      // SQL 쿼리 실행 (currentDistance 사용)
      results = await pool.query(query, [lat, lng, currentDistance]);
      
      if (results.length >= minResults) break;
      
      // 거리 2배 확대
      currentDistance = Math.min(currentDistance * 2, maxDistance);
    }
    
    return results;
  }
  ```

- **확대 단계**:
  - 내 주변: 5 → 10 → 20 → 50km (상한)
  - 오늘의 추천: 10 → 20 → 50 → 100km (상한)
  - 이번 주말: 20 → 50 → 100km (상한)

##### Task 6: UI 확장 라벨 표시
- **파일**: `src/pages/index.tsx`
- **내용**: 섹션 헤더에 확장 표시
  ```tsx
  {expandedDistance > baseDistance && (
    <Text style={styles.expandLabel}>
      현재 반경 {expandedDistance}km까지 확장했어요
    </Text>
  )}
  ```

##### Task 7: 섹션별 가중치 미세 조정
- **파일**: `backend/src/lib/recommender.ts`
  ```typescript
  const WEIGHTS_BY_SECTION = {
    TODAY: { distance: 0.30, buzz: 0.30, time: 0.20, category: 0.15, freshness: 0.05 },
    NEARBY: { distance: 0.40, buzz: 0.25, time: 0.15, category: 0.15, freshness: 0.05 },
    WEEKEND: { distance: 0.20, buzz: 0.25, time: 0.30, category: 0.15, freshness: 0.10 },
    LATEST: { distance: 0.20, buzz: 0.20, time: 0.15, category: 0.15, freshness: 0.30 },
  };
  ```

---

#### Phase 3: UX 완성 및 발견 탭 연계 (그 다음 주)

##### Task 8: 지방 유저 "여행 제안 카드" (Gemini 제안)
- **파일**: `src/pages/index.tsx`
- **조건**: 자동 확대 후에도 결과 < 3개
- **UI**:
  ```tsx
  <View style={styles.travelProposal}>
    <Text style={styles.proposalTitle}>
      💡 내 주변엔 이벤트가 많지 않아요
    </Text>
    <Pressable 
      style={styles.proposalButton}
      onPress={() => navigation.navigate('/explore', { region: '서울', sort: 'popular' })}
    >
      <Text style={styles.proposalButtonText}>
        🚗 이번 주말, [서울] 나들이 어때요?
      </Text>
      <Text style={styles.proposalSubtext}>
        서울 핫한 이벤트 보러가기 →
      </Text>
    </Pressable>
  </View>
  ```

##### Task 9: 도시권 정의 완성
- cityZones.ts의 CITY_ZONES 확장
- 주요 도시 권역 세밀화

##### Task 10: "전국 핫 TOP 3" 미리보기
- **파일**: `src/pages/index.tsx`
- **위치**: 추천 탭 하단
- **UI**:
  ```tsx
  <View style={styles.nationalPreview}>
    <Text style={styles.previewTitle}>🌏 전국에서 뜨는 중</Text>
    {nationalTop3.map(event => (
      <EventCard key={event.id} event={event} variant="small" />
    ))}
    <Pressable onPress={() => navigation.navigate('/explore', { sort: 'trending' })}>
      <Text style={styles.moreLink}>더보기 →</Text>
    </Pressable>
  </View>
  ```

---

### 우선순위 1: MY 페이지 구현
1. **저장한 이벤트**
   - 사용자가 저장한 이벤트 목록 표시
   - `GET /api/user-events/saved/:userId` (신규 엔드포인트 필요)
2. **최근 본 이벤트**
   - 최근 `view` 로그 기반
   - `GET /api/user-events/recent/:userId` (신규 엔드포인트 필요)
3. **로그인/로그아웃**
   - Toss Authentication 연동
   - 로그인 상태 표시

### 우선순위 2: 로그인 기능
1. **Toss Authentication 연동**
   - `@apps-in-toss/framework`의 `login()` 사용
   - `tossUserKey` 획득
2. **익명 → 로그인 전환**
   - 저장/좋아요 시 로그인 유도 모달
   - `POST /api/user-events/link-anonymous` 호출
3. **로그인 상태 유지**
   - Storage에 `tossUserKey` 저장
   - 앱 재시작 시 자동 로그인

### 우선순위 3: UI 개선
1. **로딩 스켈레톤**
   - 홈 화면 로딩 중 스켈레톤 표시
   - 이벤트 카드 스켈레톤
2. **애니메이션**
   - 카드 진입 애니메이션
   - 탭 전환 애니메이션
3. **에러 상태**
   - 네트워크 에러 시 재시도 UI
   - 빈 상태 (이벤트 없음) UI

### 참고: 발견 페이지 (이미 구현됨 ✅)
- **파일**: `src/pages/explore.tsx`
- **기능**:
  - 카테고리 필터 (팝업, 전시, 공연, 축제, 행사)
  - 지역 필터 (전국, 서울, 부산, 경기 등)
  - 검색 기능 (텍스트 입력)
  - 페이지네이션
  - 중복 제거 로직

---

## 📁 주요 파일 구조

```
fairpick-app/
├── backend/                          # 백엔드 서버
│   ├── src/
│   │   ├── index.ts                  # Express 서버 진입점
│   │   ├── lib/
│   │   │   ├── recommender.ts        # 추천 알고리즘 ⭐
│   │   │   ├── aiExtractor.ts        # AI 데이터 추출
│   │   │   ├── naverApi.ts           # Naver Search API
│   │   │   └── suggestionBuilder.ts  # AI 제안 빌더
│   │   ├── routes/
│   │   │   ├── recommendations.ts    # 추천 API 라우터 ⭐
│   │   │   └── userEvents.ts         # 사용자 이벤트 라우터 ⭐
│   │   └── migrations/
│   │       └── 20260203_add_recommendation_schema.sql  # DB 스키마 ⭐
│   └── .env                          # 환경 변수 (DB, API 키)
│
├── src/                              # 프론트엔드 (Toss MiniApp)
│   ├── pages/
│   │   ├── home.tsx                  # 홈 화면 (추천) ⭐
│   │   ├── event-detail.tsx          # 이벤트 상세 ⭐
│   │   ├── explore.tsx               # 발견 (미구현)
│   │   └── mypage.tsx                # MY (미구현)
│   ├── components/
│   │   ├── BottomTabBar.tsx          # 하단 탭 바 ⭐
│   │   └── EventCard.tsx             # 이벤트 카드 ⭐
│   ├── services/
│   │   ├── recommendationService.ts  # 추천 API 서비스 ⭐
│   │   └── userEventService.ts       # 사용자 이벤트 서비스 ⭐
│   ├── utils/
│   │   └── anonymousUser.ts          # 익명 사용자 관리 ⭐
│   ├── config/
│   │   └── api.ts                    # API 설정 (Base URL) ⭐
│   └── types/
│       └── recommendation.ts         # 타입 정의
│
└── PROJECT_STATUS.md                 # 이 문서 ⭐
```

⭐ = 핵심 파일

---

## 🗄️ 데이터베이스 스키마

### `users` 테이블
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_id TEXT UNIQUE,           -- 익명 사용자 ID (UUID)
  toss_user_key BIGINT UNIQUE,        -- Toss 로그인 사용자 키
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```
**특징**:
- 익명 사용자와 로그인 사용자 통합 관리
- `anonymous_id`만 있으면 익명, `toss_user_key`가 있으면 로그인

### `user_events` 테이블
```sql
CREATE TABLE user_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,          -- 'view', 'save', 'unsave', 'share', 'click'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_events_user_id ON user_events(user_id);
CREATE INDEX idx_user_events_event_id ON user_events(event_id);
CREATE INDEX idx_user_events_action_type ON user_events(action_type);
CREATE INDEX idx_user_events_created_at ON user_events(created_at);
```
**특징**:
- 모든 사용자 행동 기록
- buzz_score 계산의 기반 데이터

### `events` 테이블 (추가 컬럼)
```sql
ALTER TABLE events ADD COLUMN view_count INTEGER DEFAULT 0;
ALTER TABLE events ADD COLUMN save_count INTEGER DEFAULT 0;
ALTER TABLE events ADD COLUMN share_count INTEGER DEFAULT 0;
ALTER TABLE events ADD COLUMN buzz_score FLOAT DEFAULT 0;
ALTER TABLE events ADD COLUMN last_buzz_updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX idx_events_buzz_score ON events(buzz_score DESC);
CREATE INDEX idx_events_view_count ON events(view_count DESC);
```
**특징**:
- 인게이지먼트 카운터 (실시간 집계)
- `buzz_score`: 시간 가중 인기도 점수 (0-100)

### `user_preferences` 테이블 (향후 사용)
```sql
CREATE TABLE user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preferred_categories TEXT[],        -- ['팝업', '전시']
  preferred_regions TEXT[],           -- ['서울 강남구', '서울 성동구']
  home_location_lat FLOAT,            -- 집 위치
  home_location_lng FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 🌐 API 엔드포인트

### 추천 API (Recommendations)

#### `GET /api/recommendations/v2/today`
**오늘의 추천 (1개)**

**쿼리 파라미터**:
- `userId` (optional): 사용자 ID
- `lat`, `lng` (optional): 위치 좌표
- `excludeIds` (optional): 제외할 이벤트 ID (콤마 구분)

**응답 예시**:
```json
{
  "success": true,
  "event": {
    "id": "event-123",
    "title": "로와이드 팝업",
    "category": "팝업",
    "thumbnail_image_url": "https://...",
    "start_date": "2026-02-10",
    "end_date": "2026-02-28",
    "venue": "성수동",
    "score": 85.5,
    "distance_km": 2.3,
    "reason": ["10분 거리", "지금 떠오르는", "새로 등록"]
  }
}
```

#### `GET /api/recommendations/v2/trending`
**지금 떠오르는 (인기 급상승)**

**쿼리 파라미터**:
- `limit` (default: 10): 결과 개수
- `excludeIds` (optional)

**응답 예시**:
```json
{
  "success": true,
  "count": 5,
  "events": [...]
}
```

#### `GET /api/recommendations/v2/nearby`
**내 주변 이벤트**

**쿼리 파라미터** (필수):
- `lat`, `lng`: 위치 좌표
- `limit` (default: 10)
- `radius` (default: 10km)

#### `GET /api/recommendations/v2/personalized`
**취향 저격 (로그인 사용자 전용)**

**쿼리 파라미터** (필수):
- `userId`: 로그인 사용자 ID

#### `GET /api/recommendations/v2/weekend`
**이번 주말 추천**

#### `GET /api/recommendations/v2/latest`
**새로 올라왔어요**

---

### 사용자 이벤트 API (User Events)

#### `POST /api/user-events`
**사용자 행동 로그 기록**

**요청 바디**:
```json
{
  "userId": "anonymous-123" | "toss-456",
  "eventId": "event-123",
  "actionType": "view" | "save" | "unsave" | "share" | "click"
}
```

**응답 예시**:
```json
{
  "success": true,
  "message": "User event logged successfully"
}
```

**특징**:
- `userId`가 없으면 새로운 익명 사용자 자동 생성
- 이벤트 없으면 404 에러

#### `POST /api/user-events/link-anonymous`
**익명 사용자를 로그인 계정에 연결**

**요청 바디**:
```json
{
  "anonymousId": "anonymous-123",
  "tossUserKey": 456
}
```

**응답 예시**:
```json
{
  "success": true,
  "message": "Anonymous user linked to logged-in account successfully",
  "userId": "uuid-..."
}
```

**동작 방식**:
- 케이스 1: `tossUserKey`가 없음 → 익명 사용자에 `tossUserKey` 추가
- 케이스 2: `tossUserKey`가 이미 존재 → 익명 사용자의 로그를 기존 로그인 사용자에게 이전

#### `GET /api/user-events/stats/:userId`
**사용자 통계 조회**

**응답 예시**:
```json
{
  "success": true,
  "stats": [
    { "action_type": "view", "count": 15 },
    { "action_type": "save", "count": 3 },
    { "action_type": "share", "count": 1 }
  ],
  "recentEvents": [
    { "event_id": "event-123", "action_type": "view", "created_at": "2026-02-03T10:30:00Z" }
  ]
}
```

---

### 이벤트 API (Events)

#### `GET /api/events/:id`
**이벤트 상세 정보 조회**

**응답 예시**:
```json
{
  "success": true,
  "data": {
    "id": "event-123",
    "title": "로와이드 팝업",
    "main_category": "팝업",
    "sub_category": "F&B",
    "thumbnail_image_url": "https://...",
    "start_at": "2026-02-10T00:00:00Z",
    "end_at": "2026-02-28T23:59:59Z",
    "venue": "성수동",
    "address": "서울 성동구 성수동1가 123",
    "lat": 37.5444,
    "lng": 127.0557,
    "description": "로와이드 팝업 스토어...",
    "price_info": "무료",
    "external_links": {
      "ticket": "https://...",
      "homepage": "https://...",
      "instagram": "https://..."
    },
    "metadata": {
      "display": {
        "popup": {
          "fnb_items": { ... },
          "collab_description": "...",
          "waiting_hint": { ... }
        }
      }
    },
    "view_count": 150,
    "save_count": 23,
    "share_count": 5,
    "buzz_score": 78.5
  }
}
```

---

## ⚙️ 환경 설정

### 백엔드 환경 변수 (`.env`)
```bash
# 데이터베이스
DB_HOST=localhost
DB_PORT=5432
DB_USER=kimsungtae
DB_PASSWORD=
DB_NAME=fairpick

# API 키
TOUR_API_KEY=your_tour_api_key
KAKAO_REST_API_KEY=your_kakao_key
GEMINI_API_KEY=your_gemini_key
OPENAI_API_KEY=your_openai_key
NAVER_CLIENT_ID=your_naver_client_id
NAVER_CLIENT_SECRET=your_naver_client_secret

# S3/R2
S3_ENDPOINT=https://...
S3_ACCESS_KEY=your_access_key
S3_SECRET_KEY=your_secret_key
S3_BUCKET=fairpick
CDN_BASE_URL=https://cdn.fairpick.kr
```

### 프론트엔드 API 설정 (`src/config/api.ts`)
```typescript
export const API_BASE_URL = __DEV__ 
  ? 'http://172.20.10.4:5001'  // ⚠️ 로컬 IP 사용 (localhost 불가)
  : 'https://api.fairpick.app';
```

**중요**: 
- React Native에서는 `localhost` 사용 불가
- 개발 시 컴퓨터의 로컬 IP 주소 사용
- 로컬 IP 확인: `ipconfig getifaddr en0`

---

## 🚨 트러블슈팅

### 문제 0: Granite Dev 서버 문제 (✅ 해결됨)

#### 0-1. `metro-cache-key` 모듈 에러

**증상**:
```
Error: Cannot find module 'metro-cache-key'
```

**원인**:
- `@granite-js/mpack` 패키지 내부에서 `metro-cache-key` 모듈 경로 참조 오류
- Granite 프레임워크의 vendor 디렉토리 구조 문제

**해결 방법** ✅:
1. **`patch-granite.js` 스크립트 생성**:
   ```javascript
   // node_modules/@granite-js/mpack/dist/vendors/metro/src/DeltaBundler/getTransformCacheKey.js 패치
   const fs = require('fs');
   const path = require('path');
   
   const targetFile = path.join(__dirname, 'node_modules/@granite-js/mpack/dist/vendors/metro/src/DeltaBundler/getTransformCacheKey.js');
   
   if (fs.existsSync(targetFile)) {
     let content = fs.readFileSync(targetFile, 'utf8');
     content = content.replace(/require\([\"']\.*(\/\.\.)*\/node_modules\/metro-cache-key[\"']\)/g, 'require(\"../../../../../node_modules/metro-cache-key\")');
     content = content.replace(/require\([\"']metro-cache-key[\"']\)/g, 'require(\"../../../../../node_modules/metro-cache-key\")');
     fs.writeFileSync(targetFile, content, 'utf8');
     console.log('✅ Patched getTransformCacheKey.js');
   }
   ```

2. **`package.json`에 postinstall 추가**:
   ```json
   {
     "scripts": {
       "postinstall": "node patch-granite.js"
     }
   }
   ```

3. **재설치**:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

#### 0-2. `EMFILE: too many open files` 에러

**증상**:
```
Error: EMFILE: too many open files, watch
```

**원인**:
- Metro bundler가 너무 많은 파일을 감시하려고 함
- Node.js v24 버전과 React Native/Granite 호환성 문제
- 기본 NodeWatcher의 한계

**해결 방법** ✅:
1. **Node.js 버전 다운그레이드**:
   ```bash
   nvm use 20.19.6
   ```

2. **Watchman 설치 및 활성화**:
   ```bash
   brew install watchman
   echo '{}' > .watchmanconfig
   ```

3. **`metro.config.js` 생성**:
   ```javascript
   const { getDefaultConfig } = require('@react-native/metro-config');
   
   module.exports = (async () => {
     const defaultConfig = await getDefaultConfig(__dirname);
   
     return {
       ...defaultConfig,
       watchFolders: [__dirname],
       resolver: {
         ...defaultConfig.resolver,
         blockList: [
           /backend\/.*/,
           /backend$/,
         ],
       },
       watcher: {
         healthCheck: {
           enabled: true,
         },
         watchman: {
           deferStates: ['hg.update'],
         },
       },
     };
   })();
   ```

4. **`node_modules` 완전 재설치**:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

#### 0-3. `buzz_updated_at` 컬럼 에러

**증상**:
```
error: column "buzz_updated_at" does not exist
```

**원인**:
- Database 마이그레이션이 완료되지 않음
- Backend pool connection이 오래된 스키마 캐시

**해결 방법** ✅:
1. **마이그레이션 실행**:
   ```bash
   cd backend
   ts-node migrations/run-migration.ts 20260120_add_buzz_score_infrastructure.sql
   ```

2. **Backend 완전 재시작**:
   ```bash
   # Ctrl+C로 종료 후
   sleep 5
   npm run start
   ```

3. **검증**:
   ```bash
   PGPASSWORD=7475 psql -h localhost -U kimsungtae -d fairpick -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'canonical_events' AND column_name = 'buzz_updated_at';"
   ```

---

### 문제 1: "시스템에 잠깐 문제가 생겼어요" (Toss MiniApp 에러)

**원인**:
- JavaScript 타입 에러
- 네트워크 연결 실패 (API URL 문제)
- Storage API 권한 문제

**해결 방법**:
1. **앱 완전 재시작**:
   ```bash
   # Metro bundler 종료
   lsof -ti:8081 | xargs kill -9
   
   # 앱 재시작
   cd /Users/kimsungtae/toss/fairpick-app
   npm run dev
   ```

2. **API URL 확인**:
   - `src/config/api.ts`에서 로컬 IP 확인
   - 백엔드 서버 실행 확인: `curl http://172.20.10.4:5001/health`

3. **개발자 도구로 로그 확인**:
   - Toss 앱에서 미니앱 실행
   - 개발자 메뉴 열기 (흔들기 or 3손가락 탭)
   - "Console 보기" 선택

---

### 문제 2: npm install 실패 (EPERM 에러)

**원인**:
- macOS 파일 시스템 권한 문제
- extended attributes 문제

**해결 방법**:
```bash
# node_modules 완전 삭제
rm -rf node_modules

# 샌드박스 밖에서 재설치
npm install

# 특정 패키지 수동 설치 (필요 시)
npm install @babel/code-frame --save-dev
```

---

### 문제 3: Granite dev 서버 MODULE_NOT_FOUND 에러

**원인**:
- `@babel/code-frame` 등 의존성 누락

**해결 방법**:
```bash
npm install @babel/code-frame --save-dev
npm run dev
```

---

### 문제 4: 백엔드 서버 연결 실패

**확인 사항**:
1. 백엔드 서버 실행 중인지 확인:
   ```bash
   lsof -ti:5001
   # 출력 있으면 실행 중
   ```

2. 로그 확인:
   ```bash
   tail -50 /tmp/backend_success.log
   ```

3. 수동 재시작:
   ```bash
   cd /Users/kimsungtae/toss/fairpick-app/backend
   DB_USER=kimsungtae npm run start
   ```

---

## 📝 개발 시 주의사항

### Toss MiniApp 환경 제약
1. **Storage API 사용 필수**:
   - ❌ `localStorage`, `sessionStorage`
   - ✅ `Storage.getItem()`, `Storage.setItem()`

2. **네트워크 요청**:
   - `fetch()` 사용 가능
   - 타임아웃 설정 권장 (10초)

3. **로컬 IP 사용**:
   - iOS 시뮬레이터: `localhost` 가능
   - Android 에뮬레이터: `10.0.2.2`
   - 실제 기기: 컴퓨터의 로컬 IP (예: `172.20.10.4`)

---

## 🎯 성공 지표

### 단기 목표 (1주)
- [ ] 홈 화면 완성도 90%
- [ ] 발견 페이지 완성
- [ ] MY 페이지 완성
- [ ] 로그인 기능 구현
- [ ] 10명 베타 테스트

### 중기 목표 (1개월)
- [ ] buzz_score 자동 업데이트 (배치 작업)
- [ ] 추천 알고리즘 A/B 테스트
- [ ] 사용자 선호도 학습 (user_preferences 활용)
- [ ] 푸시 알림 (주말 추천)

---

## 📞 문의 및 이슈

**작업 재개 시 확인할 것**:
1. 백엔드 서버 실행 중인지 확인
2. 프론트엔드 dev 서버 실행 중인지 확인
3. API Base URL이 올바른지 확인 (로컬 IP)
4. 최근 커밋 메시지 확인

**주요 명령어**:
```bash
# 백엔드 서버 시작
cd backend && npm run start

# 프론트엔드 dev 서버 시작
cd fairpick-app && npm run dev

# 로컬 IP 확인
ipconfig getifaddr en0

# 백엔드 헬스체크
curl http://172.20.10.4:5001/health

# 추천 API 테스트
curl http://172.20.10.4:5001/api/recommendations/v2/latest?limit=1
```

---

**마지막 업데이트**: 2026-02-04  
**다음 작업**: Phase 1~3 추천 시스템 개선 (거리 제한, 섹션별 거리 기준, 폴백 단순화)

