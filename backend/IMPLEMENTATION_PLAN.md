# Hot Score 구현 계획 (기존 시스템 통합)

## 📋 기존 시스템 현황 분석

### ✅ 이미 존재하는 것들

#### 1. DB 스키마
```sql
-- canonical_events 테이블
buzz_score FLOAT                 -- 사용자 행동 기반 (이미 존재)
buzz_updated_at TIMESTAMP
buzz_components JSONB
popularity_score INTEGER
view_count INTEGER

-- 네이버 buzz 관련 (이미 존재!)
naver_mentions INTEGER
naver_buzz_score FLOAT
naver_updated_at TIMESTAMP
update_priority INTEGER
```

#### 2. 기존 Job/Script
- **`updateBuzzScore.ts`** ✅
  - 사용자 행동 기반 buzz_score 계산
  - 7일간 views, likes, shares, ticket_clicks 집계
  - buzz_components JSONB 저장 (이미 컴포넌트 분리!)
  
- **`collect-naver-buzz.ts`** ✅
  - 네이버 블로그 언급 수 수집
  - naver_buzz_score 계산 (Percentile)
  - update_priority 자동 설정

#### 3. 기존 라이브러리
- **`recommender.ts`** ✅
  - Phase 1 룰 기반 추천 엔진
  - buzz_score 활용 중
  - calcBuzzScore() 함수 존재
  
- **`naverApi.ts`** ✅
  - 네이버 검색 API 연동
  - getNaverBlogMentions() 함수 존재

#### 4. 기존 스케줄러
- **`scheduler.ts`** ✅
  - updateBuzzScore job 이미 등록되어 있을 가능성

---

## 🎯 구현 전략: 기존 시스템 확장

### ❌ 하지 말아야 할 것
1. 새로운 `hot_score` 컬럼 추가 (buzz_score 재활용)
2. 새로운 `updateHotScore.ts` 파일 생성 (updateBuzzScore.ts 확장)
3. 독립적인 스케줄러 작성 (기존 scheduler.ts에 추가)
4. naverApi.ts 중복 코드 작성

### ✅ 해야 할 것
1. **`updateBuzzScore.ts` 확장**
   - 기존 내부 buzz_score 계산 유지
   - KOPIS/Consensus/Structural 컴포넌트 추가
   - buzz_components에 모든 컴포넌트 저장
   
2. **DB 스키마 최소 변경**
   - `is_featured` 컬럼만 추가
   - 나머지는 기존 buzz_components JSONB 활용
   
3. **`naverApi.ts` 확장**
   - Consensus 로직 추가
   - event-like 판별 함수 추가
   
4. **`recommender.ts` 업데이트**
   - buzz_score 활용 로직 유지
   - is_featured 우선순위 추가

---

## 📝 구체적 구현 계획

### Phase 1: DB 스키마 최소 변경
```sql
-- 20260207_add_hot_score_extensions.sql
ALTER TABLE canonical_events 
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_featured 
ON canonical_events(is_featured) 
WHERE is_featured = true;

COMMENT ON COLUMN canonical_events.is_featured IS 'Admin이 수동으로 "핫함" 지정한 이벤트';
```

**이유**: 
- buzz_components JSONB로 모든 컴포넌트 저장 가능
- hot_score_total은 buzz_score 재활용
- GPT가 제안한 컴포넌트 분리는 이미 구현됨!

---

### Phase 2: `updateBuzzScore.ts` 확장

#### 2-1. 파일 구조 (기존 유지 + 확장)
```typescript
// ============ 기존 코드 (유지) ============
// CONFIG, calculateBuzzScore(), 집계 쿼리 등

// ============ 새로 추가할 함수들 ============
import { getKopisBoxOffice } from '../lib/kopisApi';  // 새로 생성
import { calculateConsensusScore, calculateStructuralScore } from '../lib/hotScoreCalculator';  // 새로 생성

// KOPIS 박스오피스 점수 계산 (공연만)
async function calculateKopisScore(event: Event): Promise<number> {
  if (event.main_category !== '공연' || !event.kopis_id) return 0;
  return await getKopisBoxOffice(event.kopis_id);
}

// Consensus 점수 계산 (전시/축제/행사)
async function calculateConsensus(event: Event): Promise<number> {
  if (event.main_category === '공연') return 0;  // 공연은 KOPIS 사용
  return await calculateConsensusScore(event);
}

// Structural 점수 계산 (모든 카테고리)
function calculateStructural(event: Event): number {
  return calculateStructuralScore(event);
}

// ============ 메인 로직 수정 ============
async function updateBuzzScore() {
  // ... 기존 코드 (사용자 행동 집계) ...
  
  for (const event of aggregatedData.rows) {
    // 1. 기존: 내부 buzz_score (사용자 행동)
    const { score: internalBuzz, components: internalComponents } = calculateBuzzScore(event);
    
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
      finalScore = internalBuzz * 0.4 + kopisScore * 0.4 + structuralScore * 0.2;
      hotComponents.formula = 'performance';
    } else if (['전시', '축제'].includes(event.main_category)) {
      finalScore = internalBuzz * 0.3 + consensusScore * 0.4 + structuralScore * 0.3;
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

**장점**:
- ✅ 기존 buzz_score 로직 유지
- ✅ 기존 buzz_components 활용 (컴포넌트 분리 이미 구현됨!)
- ✅ 단계적 확장 가능
- ✅ 롤백 쉬움

---

### Phase 3: 새 라이브러리 파일 생성

#### 3-1. `lib/kopisApi.ts` (새로 생성)
```typescript
/**
 * KOPIS 박스오피스 API 연동
 */
export async function getKopisBoxOffice(kopisId: string): Promise<number> {
  // TODO: KOPIS 박스오피스 API 호출
  // 순위를 0-100 점수로 변환
  return 0;
}
```

#### 3-2. `lib/hotScoreCalculator.ts` (새로 생성)
```typescript
/**
 * Hot Score 계산 로직 모음
 */
import { searchNaverBlog, searchNaverWeb } from './naverApi';

// Consensus Score 계산
export async function calculateConsensusScore(event: Event): Promise<number> {
  const Q1 = `"${event.title} ${event.venue} ${year}"`;
  const Q2 = `"${event.title} ${event.region} ${year}"`;
  const Q3 = `"${event.title} ${getCategoryKeyword(event.main_category)} ${year}"`;
  
  const consensus1 = await calculateConsensusForQuery(Q1);
  const consensus2 = await calculateConsensusForQuery(Q2);
  const consensus3 = await calculateConsensusForQuery(Q3);
  
  return 50 * consensus1 + 30 * consensus2 + 20 * consensus3;
}

// Structural Score 계산
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
  
  // Soft Penalty
  if (/후기|리뷰/.test(item.title)) score -= 10;
  
  // Positive Signals
  if (/예매|예약|전시|공연/.test(item.title)) score += 20;
  
  return score > 0;
}
```

---

### Phase 4: Admin 수동 입력 즉시 계산

#### 4-1. `index.ts` (Admin API) 수정
```typescript
// 기존: Admin 이벤트 추가 API
app.post('/admin/events', async (req, res) => {
  // 1. 이벤트 저장
  const event = await db.query(`INSERT INTO canonical_events (...) RETURNING *`);
  
  // 2. 즉시 라이트 계산 (새로 추가!)
  await calculateLightBuzzScore(event.id);
  
  res.json(event);
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
    JSON.stringify({ consensus_light: consensus, structural, type: 'light' }),
    eventId
  ]);
}
```

---

### Phase 5: Admin Discovery (별도 스크립트)

#### 5-1. `scripts/admin-hot-discovery.ts` (새로 생성)
```typescript
/**
 * Admin Hot Discovery
 * 매일 오전 8시 실행
 */

// 키워드 풀 샘플링
const keywords = sampleKeywords();

// 검색 + 클러스터링
const candidates = await searchAndCluster(keywords);

// admin_hot_suggestions 테이블에 저장
await saveSuggestions(candidates);
```

#### 5-2. `scheduler.ts` 수정
```typescript
// 기존 스케줄러에 추가
import { runAdminHotDiscovery } from './scripts/admin-hot-discovery';

scheduler.scheduleJob('0 8 * * *', async () => {
  await runAdminHotDiscovery();
});
```

---

## 🗂️ 파일 변경 요약

### 수정할 기존 파일
1. ✏️ `updateBuzzScore.ts` - 확장 (KOPIS/Consensus/Structural 추가)
2. ✏️ `scheduler.ts` - Admin Discovery job 추가
3. ✏️ `recommender.ts` - is_featured 우선순위 추가
4. ✏️ `index.ts` - Admin 수동 입력 시 즉시 계산

### 새로 생성할 파일
1. ➕ `migrations/20260207_add_hot_score_extensions.sql`
2. ➕ `lib/kopisApi.ts`
3. ➕ `lib/hotScoreCalculator.ts`
4. ➕ `scripts/admin-hot-discovery.ts`

### 삭제할 파일
- ❌ `collect-naver-buzz.ts` (naver 단독 방식 폐기, updateBuzzScore.ts에 통합)

---

## ✅ 체크리스트

### Phase 1: DB (15분)
- [ ] Migration 파일 작성
- [ ] Migration 실행

### Phase 2: 라이브러리 (2시간)
- [ ] `kopisApi.ts` 생성
- [ ] `hotScoreCalculator.ts` 생성
  - [ ] Consensus 로직
  - [ ] Structural 로직
  - [ ] event-like 판별

### Phase 3: updateBuzzScore.ts 확장 (2시간)
- [ ] KOPIS 통합
- [ ] Consensus 통합
- [ ] Structural 통합
- [ ] 카테고리별 공식 적용

### Phase 4: Admin 즉시 계산 (1시간)
- [ ] calculateLightBuzzScore() 함수
- [ ] Admin API 수정

### Phase 5: Admin Discovery (2시간)
- [ ] admin-hot-discovery.ts 스크립트
- [ ] 키워드 풀 샘플링
- [ ] 클러스터링 로직
- [ ] scheduler.ts 등록

### Phase 6: 테스트 (1시간)
- [ ] updateBuzzScore 실행 테스트
- [ ] Admin 수동 입력 테스트
- [ ] Admin Discovery 테스트

**총 예상 시간: 8시간**

---

## 🚀 시작 순서

1. **Migration 먼저** (안전)
2. **라이브러리 생성** (독립적)
3. **updateBuzzScore.ts 확장** (핵심)
4. **Admin 수정** (사용성)
5. **Admin Discovery** (보너스)

**지금 바로 시작할까요?** 🎉

