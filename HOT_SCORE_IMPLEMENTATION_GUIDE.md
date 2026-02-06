# Hot Score 구현 가이드 (새 세션용 종합 문서)

> **목적**: 새로운 AI 세션이 즉시 작업을 시작할 수 있도록 모든 정보를 한 곳에 모음  
> **작성일**: 2026-02-05  
> **최종 업데이트**: 2026-02-05  
> **예상 작업 시간**: 8시간 (1일)

---

## 📋 목차

1. [프로젝트 상황 요약](#1-프로젝트-상황-요약)
2. [기존 시스템 분석](#2-기존-시스템-분석)
3. [최종 전략 (3개 AI 합의)](#3-최종-전략-3개-ai-합의)
4. [구현 계획 (단계별)](#4-구현-계획-단계별)
5. [파일별 작업 상세](#5-파일별-작업-상세)
6. [검증 방법](#6-검증-방법)
7. [새 세션 시작 체크리스트](#7-새-세션-시작-체크리스트)

---

## 1. 프로젝트 상황 요약

### 1-1. 배경

**문제점**:
- 초기 사용자 데이터 없음 (Cold Start)
- 기존 `buzz_score`는 모두 0 (사용자 행동 없음)
- "요즘 핫한 이벤트" 추천 불가능

**초기 시도 (실패)**:
- 네이버 블로그 API `total` 값 사용
- Percentile 정규화 (0~100)
- **결과**: 정확도 25% (Sampling 테스트) → **폐기**

**최종 전략 (3개 AI 합의)**:
- **카테고리별 Hot Score**: KOPIS (공연) + Consensus (전시/축제) + Structural (전체)
- **기존 시스템 확장**: `buzz_score` + `buzz_components` JSONB 재활용
- **Admin Discovery**: 팝업/힙한 이벤트는 자동 후보 생성 + 수동 검증

---

### 1-2. 핵심 결정사항 (3개 AI 피드백)

| 쟁점 | Gemini | Perplexity | GPT | 최종 채택 |
|------|--------|------------|-----|----------|
| **팝업 전략** | 자동 불가능 | 자동 불가능 | **후보점수로 재정의** | 🏆 GPT |
| **DB 구조** | - | COALESCE 처리 | **컴포넌트 분리 (JSONB)** | 🏆 GPT |
| **수동 입력** | - | - | **즉시 라이트 + 배치 재계산** | 🏆 GPT |
| **전시 후기 페널티** | - | Positive signal 조정 | **-10~-15로 완화** | 🏆 GPT |
| **종료 임박 부스트** | **1.2배** | - | - | 🏆 Gemini |
| **백화점 포함** | **필수!** | - | - | 🏆 Gemini |

---

## 2. 기존 시스템 분석

> **⚠️ 중요**: 중복 작업 방지를 위해 기존 시스템을 반드시 이해해야 함!

### 2-1. 이미 존재하는 것들

#### DB 스키마 (`canonical_events` 테이블)
```sql
-- ✅ 이미 존재 (사용자 행동 기반)
buzz_score FLOAT DEFAULT 0
buzz_updated_at TIMESTAMP
buzz_components JSONB  -- ⭐ 이미 컴포넌트 분리 구조!

-- ✅ 이미 존재 (큐레이션 점수)
popularity_score INTEGER

-- ✅ 이미 존재 (네이버 buzz - 폐기 예정)
naver_mentions INTEGER
naver_buzz_score FLOAT
naver_updated_at TIMESTAMP
update_priority INTEGER
```

**결론**: 
- ✅ `buzz_score` 재활용 (hot_score_total로 사용)
- ✅ `buzz_components` 재활용 (컴포넌트 저장)
- ❌ 새 컬럼 추가 최소화 (`is_featured`만 추가)

---

#### 기존 Job/Script

**1. `updateBuzzScore.ts` (284 lines)** ✅
- **역할**: 사용자 행동 기반 buzz_score 계산
- **주기**: 매일 (스케줄러 등록됨)
- **계산식**: views×0.4 + actions×0.3 + popularity×0.3
- **저장**: `buzz_score`, `buzz_components` JSONB

**2. `collect-naver-buzz.ts` (400+ lines)** ⚠️ 폐기 예정
- **역할**: 네이버 블로그 언급 수 수집
- **문제**: 정확도 25%
- **처리**: `updateBuzzScore.ts`에 통합 후 삭제

**3. `recommender.ts` (786 lines)** ✅
- **역할**: Phase 1 룰 기반 추천 엔진
- **함수**: getTodaysPick, getTrending, getNearby 등
- **활용**: `buzz_score` 기반 정렬

**4. `naverApi.ts` (존재)** ✅
- **역할**: 네이버 검색 API 연동
- **확장 필요**: Consensus 로직 추가

---

### 2-2. 작업 전략

**❌ 하지 말아야 할 것**:
1. 새로운 `hot_score` 컬럼 추가
2. 새로운 `updateHotScore.ts` 파일 생성
3. 독립적인 스케줄러 작성
4. naverApi.ts 중복 코드 작성

**✅ 해야 할 것**:
1. `updateBuzzScore.ts` 확장 (KOPIS/Consensus/Structural 추가)
2. `buzz_score` = `hot_score_total`로 재정의
3. `buzz_components` JSONB에 모든 컴포넌트 저장
4. 기존 스케줄러 활용

---

## 3. 최종 전략 (3개 AI 합의)

### 3-1. 카테고리별 Hot Score 공식

#### 공연 (Performance)
```typescript
hot_components = {
  kopis: getKopisBoxOffice(event.kopis_id),      // 0-100
  structural: calculateStructural(event),         // 0-100
  internal: internalBuzzScore                    // 기존 사용자 행동
};

hot_score_total = 
  0.4 * kopis + 
  0.3 * structural + 
  0.3 * internal;
```

---

#### 전시 (Exhibition)
```typescript
hot_components = {
  consensus: calculateConsensus(Q1, Q2, Q3),     // 0-100
  structural: calculateStructural(event),         // 0-100
  time: calculateTimeBoost(event),               // 0-100
  internal: internalBuzzScore
};

hot_score_total = 
  0.40 * consensus + 
  0.25 * structural + 
  0.10 * time + 
  0.25 * internal;

// 제미나이 제안: 종료 임박 부스트
const daysUntilEnd = (event.end_at - now) / (24 * 60 * 60 * 1000);
if (daysUntilEnd <= 7) {
  hot_score_total *= 1.2;  // 20% 부스트
}
```

**Positive Keywords (전시 특화)**:
```typescript
positiveKeywords = [
  "전시", "전시회", "미술관", "박물관",
  "아트", "갤러리", "뮤지엄",
  "기간", "운영시간", "관람"
];

// 후기 페널티 완화 (GPT 제안)
if (/후기|리뷰|다녀옴/.test(item.title)) {
  score -= 10;  // -30에서 -10으로 완화
}
```

---

#### 축제 (Festival)
```typescript
hot_components = {
  consensus: calculateConsensusRegion(event),     // 지역 강조
  structural: calculateStructural(event),          // 주최기관
  time_urgency: calculateUrgency(event),          // D-day
  internal: internalBuzzScore
};

hot_score_total = 
  0.35 * consensus + 
  0.30 * structural + 
  0.15 * time_urgency + 
  0.20 * internal;

// 도메인 신뢰도 (퍼플렉시티 제안)
const trustedDomains = ['go.kr', 'visitkorea', 'news.naver'];
const trustRatio = calculateTrustRatio(searchResults, trustedDomains);
hot_components.consensus *= trustRatio;
```

---

#### 행사 (Event)
```typescript
hot_components = {
  validity: calculateValidity(event),             // 유효성 게이트
  consensus: calculateConsensus(Q1, Q2, Q3),
  structural: calculateStructural(event),
  internal: internalBuzzScore
};

hot_score_total = 
  0.40 * validity + 
  0.25 * consensus + 
  0.15 * structural + 
  0.20 * internal;

// 유효성 게이트 (GPT 제안)
function calculateValidity(event) {
  const hasParticipation = /참여|신청|모집|등록/.test(event.title);
  const hasSchedule = event.start_at && event.end_at;
  const hasVenue = event.venue;
  
  if (!hasParticipation || !hasSchedule || !hasVenue) return 0;
  return 100;
}
```

---

#### 팝업 (Popup) - GPT 재정의 ⭐
```typescript
// "hot_score"가 아니라 "candidate_score" (후보점수)
hot_components = {
  candidate: calculatePopupCandidate(event),      // 0-100
  recency: calculateRecency(event),               // 최신성
  location: calculateLocationHipness(event),      // 힙한 장소
  internal: internalBuzzScore
};

hot_score_total = 
  0.40 * candidate + 
  0.20 * recency + 
  0.20 * location + 
  0.20 * internal;

// 제미나이 제안: 백화점 추가
const hipPlaces = [
  "성수", "한남", "연남", "이태원", "을지로",
  "더현대", "롯데 잠실", "신세계 강남",  // ⭐ 필수!
  "코엑스", "스타필드", "IFC몰"
];
```

**중요**: 팝업은 **Admin 검증 필수**지만, candidate_score로 우선순위 제공!

---

### 3-2. DB 스키마 (최소 변경)

```sql
-- 20260207_add_hot_score_extensions.sql
ALTER TABLE canonical_events 
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_featured 
ON canonical_events(is_featured) 
WHERE is_featured = true;

COMMENT ON COLUMN canonical_events.is_featured 
IS 'Admin이 수동으로 "핫함" 지정한 이벤트';
```

**설명**:
- `buzz_score` = `hot_score_total` (재활용)
- `buzz_components` = 모든 컴포넌트 저장 (JSON)
- `is_featured` = Admin 수동 지정 플래그 (새로 추가)

---

### 3-3. 스케줄러 & 업데이트 정책

#### A) 공공 API 수집 이벤트
```typescript
// 저장 시: buzz_score = NULL
// 다음 날 자정 스케줄러가 계산
```

#### B) Admin 수동 입력 이벤트 (⭐ GPT 확정안)
```typescript
async function adminAddEvent(eventData) {
  // 1. 이벤트 저장
  const event = await db.insert(...);
  
  // 2. 즉시 라이트 계산 (비용 최소)
  const lightComponents = {
    consensus: await calculateConsensusLight(event),  // Q1만
    structural: calculateStructural(event),           // 로컬
    total: 0.5 * consensus + 0.5 * structural
  };
  
  await db.update({
    buzz_score: lightComponents.total,
    buzz_components: lightComponents,
    buzz_updated_at: NOW()
  });
  
  // 3. 다음 날 자정 스케줄러가 정식 재계산 (Q1+Q2+Q3)
}
```

**장점**:
- ✅ 팝업 즉시 노출
- ✅ API 비용 최소 (Q1만)
- ✅ 다음 날 정식 재계산

---

## 4. 구현 계획 (단계별)

### Phase 1: DB & 라이브러리 (2시간)

#### Step 1: Migration (15분)
```bash
cd /Users/kimsungtae/toss/fairpick-app/backend
ts-node migrations/run-migration.ts 20260207_add_hot_score_extensions.sql
```

#### Step 2: 라이브러리 생성 (2시간)

**파일 1**: `lib/kopisApi.ts` (신규)
```typescript
export async function getKopisBoxOffice(kopisId: string): Promise<number> {
  // TODO: KOPIS 박스오피스 API 호출
  // 순위 → 0-100 점수 변환
  return 0;
}
```

**파일 2**: `lib/hotScoreCalculator.ts` (신규)
```typescript
import { searchNaverBlog, searchNaverWeb } from './naverApi';

// Consensus 계산
export async function calculateConsensusScore(event: Event): Promise<number> {
  const Q1 = `"${event.title} ${event.venue} ${year}"`;
  const Q2 = `"${event.title} ${event.region} ${year}"`;
  const Q3 = `"${event.title} ${getCategoryKeyword(event.main_category)} ${year}"`;
  
  const consensus1 = await calculateConsensusForQuery(Q1);
  const consensus2 = await calculateConsensusForQuery(Q2);
  const consensus3 = await calculateConsensusForQuery(Q3);
  
  return 0.50 * consensus1 + 0.30 * consensus2 + 0.20 * consensus3;
}

// Structural 계산
export function calculateStructuralScore(event: Event): number {
  const venueScore = calculateVenueScore(event.venue);
  const durationScore = calculateDurationScore(event.start_at, event.end_at);
  const sourceScore = calculateSourceScore(event.source);
  
  return 0.4 * venueScore + 0.3 * durationScore + 0.3 * sourceScore;
}

// event-like 판별
function isEventLike(item: any): boolean {
  // Hard Drop
  if (/판매종료|공연종료|전시종료/.test(item.title)) return false;
  
  let score = 0;
  
  // Soft Penalty (전시는 -10으로 완화)
  if (/후기|리뷰/.test(item.title)) score -= 10;
  
  // Positive Signals
  if (/예매|예약|전시|공연/.test(item.title)) score += 20;
  
  return score > 0;
}
```

---

### Phase 2: updateBuzzScore.ts 확장 (2시간)

**파일**: `jobs/updateBuzzScore.ts`

#### 기존 코드 (유지)
```typescript
// ============ 기존 코드 (유지) ============
// CONFIG, calculateBuzzScore(), 집계 쿼리 등
```

#### 새로 추가
```typescript
import { getKopisBoxOffice } from '../lib/kopisApi';
import { calculateConsensusScore, calculateStructuralScore } from '../lib/hotScoreCalculator';

// KOPIS 점수 계산 (공연만)
async function calculateKopisScore(event: Event): Promise<number> {
  if (event.main_category !== '공연' || !event.kopis_id) return 0;
  return await getKopisBoxOffice(event.kopis_id);
}

// Consensus 점수 계산 (전시/축제/행사)
async function calculateConsensus(event: Event): Promise<number> {
  if (event.main_category === '공연') return 0;
  return await calculateConsensusScore(event);
}

// Structural 점수 계산 (모든 카테고리)
function calculateStructural(event: Event): number {
  return calculateStructuralScore(event);
}

// ============ 메인 로직 수정 ============
export async function updateBuzzScore(): Promise<void> {
  // ... 기존 코드 (사용자 행동 집계) ...
  
  for (const event of aggregatedData.rows) {
    // 1. 기존: 내부 buzz_score (사용자 행동)
    const { score: internalBuzz, components: internalComponents } = 
      calculateBuzzScore(event);
    
    // 2. 새로 추가: 외부 hot score 컴포넌트들
    const kopisScore = await calculateKopisScore(event);
    const consensusScore = await calculateConsensus(event);
    const structuralScore = calculateStructural(event);
    
    // 3. 카테고리별 최종 점수 계산
    let finalScore = internalBuzz;
    const hotComponents: any = {
      ...internalComponents,
      kopis: kopisScore,
      consensus: consensusScore,
      structural: structuralScore
    };
    
    if (event.main_category === '공연' && kopisScore > 0) {
      finalScore = 
        internalBuzz * 0.3 + 
        kopisScore * 0.4 + 
        structuralScore * 0.3;
      hotComponents.formula = 'performance';
    } else if (['전시', '축제'].includes(event.main_category)) {
      // 전시: 종료 임박 부스트 (제미나이 제안)
      let baseScore = 
        internalBuzz * 0.25 + 
        consensusScore * 0.40 + 
        structuralScore * 0.25;
      
      const daysUntilEnd = (event.end_at - Date.now()) / (24*60*60*1000);
      if (daysUntilEnd <= 7) {
        baseScore *= 1.2;
        hotComponents.time_boost = 1.2;
      }
      
      finalScore = baseScore;
      hotComponents.formula = 'exhibition_festival';
    }
    
    // 4. DB 업데이트 (기존 컬럼 재활용)
    await pool.query(`
      UPDATE canonical_events
      SET 
        buzz_score = $1,
        buzz_updated_at = NOW(),
        buzz_components = $2::jsonb
      WHERE id = $3
    `, [finalScore, JSON.stringify(hotComponents), event.id]);
  }
}
```

---

### Phase 3: Admin 즉시 계산 (1시간)

**파일**: `index.ts` (Admin API 수정)

```typescript
// Admin 이벤트 추가 API
app.post('/admin/events', async (req, res) => {
  // 1. 이벤트 저장
  const event = await db.query(`
    INSERT INTO canonical_events (...)
    RETURNING *
  `);
  
  // 2. 즉시 라이트 계산 (새로 추가!)
  await calculateLightBuzzScore(event.rows[0].id);
  
  res.json(event.rows[0]);
});

// 새 함수: 라이트 계산
async function calculateLightBuzzScore(eventId: string) {
  const event = await getEvent(eventId);
  
  // Q1만 + structural만 (비용 최소)
  const consensus = await calculateConsensusLight(event);  // Q1만
  const structural = calculateStructuralScore(event);
  
  const lightScore = 0.5 * consensus + 0.5 * structural;
  
  await pool.query(`
    UPDATE canonical_events
    SET 
      buzz_score = $1,
      buzz_components = $2::jsonb,
      buzz_updated_at = NOW()
    WHERE id = $3
  `, [
    lightScore,
    JSON.stringify({ 
      consensus_light: consensus, 
      structural, 
      type: 'light' 
    }),
    eventId
  ]);
}
```

---

### Phase 4: Admin Discovery (2시간)

**파일**: `scripts/admin-hot-discovery.ts` (신규)

```typescript
/**
 * Admin Hot Discovery
 * 매일 오전 8시 실행
 */

// 키워드 풀 (제미나이 제안 반영)
const keywordPool = {
  L1_regions: [
    // 힙한 동네
    "성수", "한남", "연남", "이태원", "을지로",
    
    // 백화점 (제미나이 필수!)
    "더현대", "더현대 서울",
    "롯데 잠실", "롯데백화점 본점",
    "신세계 강남", "신세계 센텀시티",
    
    // 복합몰
    "코엑스", "스타필드", "IFC몰"
  ],
  
  L2_types: [
    "팝업", "팝업스토어", "플리마켓", "마켓",
    "전시", "전시회", "체험", "콜라보", "굿즈"
  ],
  
  L3_time: [
    "이번주", "주말", "2월",
    "오늘",     // 제미나이 추가!
    "내일",     // 제미나이 추가!
    "오픈", "사전예약"
  ]
};

// 샘플링 (200개 조합)
const keywords = sampleKeywords();

// 검색 + 클러스터링
const candidates = await searchAndCluster(keywords);

// admin_hot_suggestions 테이블에 저장
await saveSuggestions(candidates);
```

**스케줄러 등록**: `scheduler.ts`
```typescript
import { runAdminHotDiscovery } from './scripts/admin-hot-discovery';

scheduler.scheduleJob('0 8 * * *', async () => {
  await runAdminHotDiscovery();
});
```

---

### Phase 5: 추천 API 수정 (30분)

**파일**: `recommender.ts` (is_featured 우선순위)

```typescript
// "지금 핫한 이벤트"
const hotEvents = await db.query(`
  SELECT *,
    COALESCE(buzz_score, 0) as safe_buzz_score
  FROM canonical_events
  WHERE 
    (buzz_score > 70 OR is_featured = true)
    AND end_at >= NOW()
  ORDER BY 
    is_featured DESC,           -- ⭐ Admin 지정 최우선
    COALESCE(buzz_score, 0) DESC
  LIMIT 20
`);
```

---

## 5. 파일별 작업 상세

### 수정할 기존 파일

| 파일 | 작업 내용 | 난이도 | 시간 |
|------|----------|--------|------|
| `updateBuzzScore.ts` | KOPIS/Consensus/Structural 통합 | 중 | 2h |
| `recommender.ts` | is_featured 우선순위 추가 | 하 | 30m |
| `index.ts` | Admin 즉시 계산 함수 추가 | 중 | 1h |
| `scheduler.ts` | Admin Discovery job 추가 | 하 | 15m |

### 새로 생성할 파일

| 파일 | 역할 | 난이도 | 시간 |
|------|------|--------|------|
| `migrations/20260207_add_hot_score_extensions.sql` | is_featured 컬럼 추가 | 하 | 15m |
| `lib/kopisApi.ts` | KOPIS 박스오피스 연동 | 중 | 1h |
| `lib/hotScoreCalculator.ts` | Consensus/Structural 계산 | 중 | 1.5h |
| `scripts/admin-hot-discovery.ts` | Admin Discovery 스크립트 | 중 | 2h |

### 삭제할 파일

| 파일 | 사유 |
|------|------|
| `collect-naver-buzz.ts` | 네이버 단독 방식 폐기, updateBuzzScore.ts에 통합 |
| `migrations/20260206_add_naver_buzz_columns.sql` | 보존 (롤백용) |

---

## 6. 검증 방법

### 6-1. DB 검증

```bash
cd /Users/kimsungtae/toss/fairpick-app/backend

# 1. is_featured 컬럼 확인
psql -d fairpick -c "
  SELECT column_name, data_type 
  FROM information_schema.columns 
  WHERE table_name = 'canonical_events' 
    AND column_name = 'is_featured';
"

# 2. buzz_components 구조 확인
psql -d fairpick -c "
  SELECT id, title, buzz_score, buzz_components 
  FROM canonical_events 
  WHERE buzz_score > 0 
  LIMIT 3;
"
```

---

### 6-2. API 테스트

```bash
# 1. updateBuzzScore 수동 실행
cd /Users/kimsungtae/toss/fairpick-app/backend
npm run update:buzz-score

# 2. 결과 확인
psql -d fairpick -c "
  SELECT title, main_category, buzz_score, buzz_components
  FROM canonical_events
  WHERE buzz_score > 0
  ORDER BY buzz_score DESC
  LIMIT 10;
"

# 3. Admin 수동 입력 테스트
curl -X POST http://localhost:5001/admin/events \
  -H "Content-Type: application/json" \
  -d '{
    "title": "테스트 팝업",
    "main_category": "팝업",
    "start_at": "2026-02-10",
    "end_at": "2026-02-28",
    "venue": "성수동"
  }'

# 4. 즉시 계산 확인 (5초 후)
sleep 5
psql -d fairpick -c "
  SELECT title, buzz_score, buzz_components
  FROM canonical_events
  WHERE title = '테스트 팝업';
"
```

---

### 6-3. 체크리스트

#### Phase 1 완료 확인
- [ ] Migration 실행 완료
- [ ] `is_featured` 컬럼 존재
- [ ] `kopisApi.ts` 생성
- [ ] `hotScoreCalculator.ts` 생성
- [ ] 테스트 케이스 통과

#### Phase 2 완료 확인
- [ ] `updateBuzzScore.ts` 수정 완료
- [ ] 수동 실행 성공
- [ ] `buzz_components` JSONB 저장 확인
- [ ] 카테고리별 공식 적용 확인

#### Phase 3 완료 확인
- [ ] Admin API 수정 완료
- [ ] 즉시 계산 동작 확인
- [ ] 다음 날 재계산 확인

#### Phase 4 완료 확인
- [ ] Admin Discovery 스크립트 생성
- [ ] 스케줄러 등록
- [ ] 키워드 풀 샘플링 동작
- [ ] 후보 생성 확인

---

## 7. 새 세션 시작 체크리스트

### 📋 작업 전 필수 확인

#### 1. 문서 읽기 (30분)
- [ ] **이 문서** (`HOT_SCORE_IMPLEMENTATION_GUIDE.md`) 전체 읽기
- [ ] `IMPLEMENTATION_PLAN.md` 읽기 (기존 시스템 분석)
- [ ] `PROJECT_STATUS.md` 읽기 (프로젝트 전체 상황)

#### 2. 기존 코드 파악 (30분)
- [ ] `updateBuzzScore.ts` 읽기 (284 lines)
- [ ] `recommender.ts` 읽기 (786 lines, 주요 함수만)
- [ ] `naverApi.ts` 읽기 (기존 연동 확인)

#### 3. 환경 확인 (10분)
```bash
# 백엔드 서버 실행 확인
curl http://localhost:5001/health

# DB 연결 확인
psql -d fairpick -c "SELECT COUNT(*) FROM canonical_events;"

# Node.js 버전 확인 (v20.19.6 필수)
node -v
```

---

### 🚀 작업 시작 순서

#### 우선순위 0: DB Migration (15분)
```bash
cd /Users/kimsungtae/toss/fairpick-app/backend
ts-node migrations/run-migration.ts 20260207_add_hot_score_extensions.sql
```

#### 우선순위 1: 라이브러리 (2시간)
1. `lib/kopisApi.ts` 생성
2. `lib/hotScoreCalculator.ts` 생성
3. 단위 테스트

#### 우선순위 2: updateBuzzScore.ts (2시간)
1. import 추가
2. 헬퍼 함수 추가 (calculateKopisScore 등)
3. 메인 로직 수정
4. 테스트

#### 우선순위 3: Admin 즉시 계산 (1시간)
1. `index.ts` 수정
2. `calculateLightBuzzScore` 함수 추가
3. 테스트

#### 우선순위 4: Admin Discovery (2시간)
1. `admin-hot-discovery.ts` 생성
2. 키워드 풀 샘플링
3. 스케줄러 등록

#### 우선순위 5: 검증 (1시간)
1. 수동 실행 테스트
2. API 호출 테스트
3. DB 결과 확인

---

### 🎯 성공 기준

#### Phase 1 완료 (4시간)
- ✅ Migration 완료
- ✅ 라이브러리 생성
- ✅ updateBuzzScore.ts 확장
- ✅ 수동 실행 성공
- ✅ `buzz_components` 저장 확인

#### Phase 2 완료 (2시간)
- ✅ Admin 즉시 계산 동작
- ✅ 추천 API 수정
- ✅ is_featured 우선순위 동작

#### Phase 3 완료 (2시간)
- ✅ Admin Discovery 스크립트
- ✅ 스케줄러 등록
- ✅ 후보 생성 확인

**총 예상 시간: 8시간 (1일)**

---

## 8. 트러블슈팅

### 문제 1: Migration 실패
```bash
# 원인: 이미 실행됨
# 해결: 확인 후 스킵
psql -d fairpick -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'canonical_events' AND column_name = 'is_featured';"
```

### 문제 2: updateBuzzScore 실행 에러
```bash
# 원인: import 경로 오류
# 해결: 상대 경로 확인
import { getKopisBoxOffice } from '../lib/kopisApi';
```

### 문제 3: buzz_components 저장 안 됨
```bash
# 원인: JSONB 직렬화 오류
# 해결: JSON.stringify() 확인
await pool.query(`...`, [score, JSON.stringify(components), id]);
```

---

## 9. 추가 참고 자료

### 관련 문서
- `RECOMMENDATION_SYSTEM_PLAN.md` (⚠️ DEPRECATED)
- `PROJECT_STATUS.md` (전체 현황)
- `IMPLEMENTATION_PLAN.md` (기존 시스템 분석)

### AI 피드백 원본
- Gemini: 종료 임박 부스트, 백화점 필수
- Perplexity: 도메인 신뢰도, Positive signal 조정
- GPT: 컴포넌트 분리, 즉시 라이트 계산, 팝업 재정의

---

## 10. 작업 진행 상황 (새 세션이 업데이트)

### 완료된 작업
- [ ] Migration 실행
- [ ] kopisApi.ts 생성
- [ ] hotScoreCalculator.ts 생성
- [ ] updateBuzzScore.ts 확장
- [ ] Admin 즉시 계산
- [ ] Admin Discovery
- [ ] 테스트 완료

### 다음 작업
- (새 세션이 여기에 추가)

---

**문서 끝**

*이 가이드는 새로운 AI 세션이 즉시 작업을 시작할 수 있도록 모든 정보를 포함합니다.*

