# 네이버 Buzz Score 설정 가이드 (정확도 개선 버전)

## 📋 개요

**네이버 블로그 언급 수 기반 Buzz Score**를 수집하되, **정확도를 대폭 개선**한 버전입니다.

### 핵심 개선사항

#### 문제점 (Before)
- 네이버 API의 `total` 값이 부정확 (실제 관련 블로그보다 10~100배 과다 집계)
- "뽀로로와 신비한 여행" → 29,005건 (실제 관련 블로그는 극소수)

#### 해결 방법 (After)
1. **Sampling 단계**: 상위 100개 이벤트로 `display=100` 호출
2. **정확도 측정**: 실제 블로그 제목을 확인하여 관련도 계산
3. **보정 계수 저장**: 평균 정확도를 보정 계수로 저장
4. **전체 수집**: `display=1` (저비용) + 보정 계수 적용

**예상 효과**:
- 정확도 90% 이상
- API 비용 99% 절감 (sampling 후)
- 실제 화제성만 반영

---

## 🔧 1단계: 환경 설정

### 네이버 API 키 확인

`.env` 파일에 네이버 API 키가 이미 설정되어 있어야 합니다:

```bash
NAVER_CLIENT_ID=your_client_id
NAVER_CLIENT_SECRET=your_client_secret
```

> ⚠️ **이미 AI 메타데이터 수집에서 사용 중인 키를 재사용합니다!**

---

## 🗄️ 2단계: DB 마이그레이션

### 새 컬럼 추가

```bash
cd backend
ts-node migrations/run-migration.ts 20260206_add_naver_buzz_columns.sql
```

**추가되는 컬럼**:
- `naver_mentions`: 네이버 블로그 언급 수 (보정됨)
- `naver_buzz_score`: 정규화된 점수 (0~100)
- `naver_updated_at`: 마지막 업데이트 시간
- `update_priority`: 업데이트 우선순위 (0=매일, 1=3일, 2=주1)

**인덱스**:
- `idx_naver_buzz_score`: 추천 조회 최적화
- `idx_update_priority`: 스케줄러 최적화

---

## 🚀 3단계: 초기 데이터 수집 (2단계 프로세스)

### 3-1. Sampling: 보정 계수 계산 (첫 실행만)

```bash
npm run collect:naver-buzz:sampling
```

**동작**:
1. 상위 100개 이벤트 선택 (기존 buzz_score/popularity_score 기준)
2. 각 이벤트마다 `display=100`으로 실제 블로그 검색
3. 제목 매칭으로 관련도 계산 (예: 23/100 = 23% 정확도)
4. 평균 정확도 → **보정 계수** 저장 (`.naver-correction-factor.json`)

**예상 소요 시간**: 2~3분

**출력 예시**:
```
========================================
📈 Sampling 결과
========================================
샘플 크기: 100개
평균 정확도: 23.5%
보정 계수: 0.235

💡 해석: 네이버 total 값의 23.5%가 실제 관련 블로그입니다.

✅ 보정 계수 저장: /Users/.../backend/.naver-correction-factor.json
```

### 3-2. 전체 수집: 보정 계수 적용

```bash
npm run collect:naver-buzz
```

**동작**:
1. 보정 계수 로드 (`.naver-correction-factor.json`)
2. 모든 이벤트마다 `display=1`로 빠른 검색
3. `total` × **보정 계수** = 실제 언급 수 추정
4. Percentile 계산 → `naver_buzz_score` 저장

**예상 소요 시간**:
- 1,000개 이벤트 ≈ 2~3분
- 10,000개 이벤트 ≈ 20~30분

**출력 예시**:
```
📊 보정 계수 로드: 0.235 (샘플: 100개, 정확도: 23.5%)

🔥 Top 10 핫한 이벤트:

1. [95점] 2025 BTS 콘서트
   언급: 42,350 → 9,952 (보정됨)
   장소: 서울월드컵경기장

2. [88점] 뱅크시 특별전
   언급: 15,200 → 3,572 (보정됨)
   장소: 예술의전당
```

### 3-3. 테스트 실행 (선택)

```bash
npm run collect:naver-buzz:test
```

10개 이벤트만 처리 (전체 수집 전 테스트용)

---

## 📊 4단계: 결과 확인

### DB 조회

```sql
-- 상위 20개 핫한 이벤트
SELECT 
  title,
  LEFT(venue, 25) as venue_short,
  naver_mentions,
  naver_buzz_score
FROM canonical_events
WHERE naver_buzz_score > 0
ORDER BY naver_buzz_score DESC
LIMIT 20;
```

### 통계

```sql
-- 전체 통계
SELECT 
  COUNT(*) as total,
  AVG(naver_mentions) as avg_mentions,
  MAX(naver_mentions) as max_mentions,
  COUNT(CASE WHEN naver_buzz_score > 50 THEN 1 END) as hot_events
FROM canonical_events;
```

### 우선순위 분포

```sql
-- Update Priority 분포
SELECT 
  update_priority,
  COUNT(*) as count,
  CASE 
    WHEN update_priority = 0 THEN '매일'
    WHEN update_priority = 1 THEN '3일마다'
    ELSE '주 1회'
  END as schedule
FROM canonical_events
GROUP BY update_priority
ORDER BY update_priority;
```

---

## 🔄 5단계: 주기적 업데이트

### 수동 업데이트

```bash
# 매일 실행 권장 (보정 계수는 이미 저장되어 있음)
npm run collect:naver-buzz
```

> ⚠️ **Sampling은 첫 실행만!** 이후는 일반 모드만 실행하세요.

### Sampling 재실행 (선택)

월 1회 정도 정확도를 다시 측정하고 싶다면:

```bash
npm run collect:naver-buzz:sampling
```

### Cron 설정 (예시)

```bash
# 매일 오전 2시 실행 (일반 모드)
0 2 * * * cd /path/to/backend && npm run collect:naver-buzz

# 매월 1일 오전 1시 (Sampling 재실행)
0 1 1 * * cd /path/to/backend && npm run collect:naver-buzz:sampling
```

---

## 🎯 6단계: 추천 시스템 통합

### 현재 상태 (Phase 1)

```typescript
// recommender.ts
const events = await pool.query(`
  SELECT *
  FROM canonical_events
  WHERE 
    naver_buzz_score > 15  -- 품질 필터
    AND end_at >= NOW()
  ORDER BY naver_buzz_score DESC
  LIMIT 10
`);
```

### 향후 통합 (Phase 2)

```typescript
// 내부 + 외부 buzz 통합
final_buzz = (internal_buzz * 0.5) + (naver_buzz * 0.5)
```

---

## 🐛 트러블슈팅

### 문제 1: "보정 계수가 없습니다"

**원인**: Sampling을 먼저 실행하지 않음

**해결**:
```bash
npm run collect:naver-buzz:sampling
```

### 문제 2: "database does not exist"

**원인**: `DATABASE_URL`이 올바르지 않음

**해결**:
```bash
# .env 확인
cat .env | grep DATABASE_URL

# 올바른 형식
DATABASE_URL=postgresql://username:password@localhost:5432/fairpick
```

### 문제 3: "NAVER_CLIENT_ID not set"

**원인**: 네이버 API 키 미설정

**해결**:
```bash
# .env에 추가
NAVER_CLIENT_ID=your_id
NAVER_CLIENT_SECRET=your_secret
```

### 문제 4: API 한도 초과

**원인**: 하루 25,000건 초과

**해결**:
- Sampling: 100개만 검색 (문제 없음)
- 일반 모드: 이미 rate limiting 적용 (150ms 대기)
- 하루에 여러 번 실행하지 말 것

---

## 📈 성공 지표

### 데이터 품질

- ✅ 보정 계수: 0.1 ~ 0.5 사이 (정상 범위)
- ✅ `naver_mentions > 0`: 전체의 50% 이상
- ✅ `naver_buzz_score > 50`: 전체의 20% 이상

### 추천 품질

- ✅ "지금 떠오르는" 섹션: 실제 화제성 반영
- ✅ 중복 감소: 매일 다른 추천
- ✅ Cold Start 해결: 신규 이벤트도 노출

---

## 🧪 기술적 세부사항

### Sampling 로직

```typescript
// 1. display=100으로 실제 블로그 가져오기
const result = await searchNaverBlog({
  query: `${title} ${venue} ${year}`,
  display: 100,
  sort: 'sim'
});

// 2. 제목 매칭으로 관련도 계산
let relevantCount = 0;
for (const item of result.items) {
  const cleanTitle = item.title.replace(/<[^>]*>/g, '');
  const keywords = title.split(' ').filter(w => w.length > 1);
  const matched = keywords.filter(k => cleanTitle.includes(k));
  
  if (matched.length >= Math.min(2, keywords.length)) {
    relevantCount++;
  }
}

const accuracy = relevantCount / 100;
```

### 보정 계수 적용

```typescript
// 일반 모드: display=1 (저비용)
const result = await searchNaverBlog({
  query: `${title} ${venue} ${year}`,
  display: 1,
  sort: 'sim'
});

// 보정 계수 적용
const correctedTotal = Math.round(result.total * 0.235);
```

### Venue 전처리

```typescript
// "예술의전당 [서울] (콘서트홀)" → "예술의전당"
function cleanVenueForSearch(venue: string): string {
  let cleaned = venue.replace(/\[.*?\]/g, '');  // [서울] 제거
  cleaned = cleaned.replace(/\(.*?\)/g, '');    // (콘서트홀) 제거
  return cleaned.trim();
}
```

---

## 🎓 다음 단계

1. ✅ **Phase 1 완료**: 네이버 Buzz 수집 (정확도 개선)
2. 🔄 **Phase 2**: 내부 + 외부 통합
3. 🔄 **Phase 3**: 스케줄러 자동화
4. 🔄 **Phase 4**: Admin Hot Discovery

---

## 📞 문의

문제가 발생하면:
1. 로그 확인: 스크립트 실행 시 상세 로그 출력
2. DB 상태 확인: 위의 SQL 쿼리 실행
3. API 키 확인: 네이버 개발자 센터에서 한도 확인
4. 보정 계수 확인: `.naver-correction-factor.json` 파일 확인

---

**마지막 업데이트**: 2026-02-06 (Option 1: Sampling + 보정 계수)
