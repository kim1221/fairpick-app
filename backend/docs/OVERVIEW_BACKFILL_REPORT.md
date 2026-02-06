# Overview Backfill 작업 보고서

**최종 업데이트**: 2026-01-20
**작업자**: Claude (AI Assistant)
**목표**: canonical_events.overview 컬럼 커버리지 향상 (KOPIS/Culture 소스 추가)

---

## 📊 최종 결과 요약 (2026-01-20)

### 실행 전후 비교

| 지표 | 실행 전 | 실행 후 | 변화 |
|------|--------|--------|------|
| 전체 이벤트 | 1,955 | 1,955 | - |
| **Overview 있음** | **30** | **210** | **+180** |
| **커버리지** | **1.53%** | **10.74%** | **+9.21pp** |

### 소스별 상세 변화

| 소스 | 전체 | 실행 전 | 실행 후 | 추가된 건수 | 커버리지 변화 |
|------|------|--------|--------|-----------|--------------|
| **KOPIS** | 1,677 | 3 (0.18%) | **157 (9.36%)** | **+154** | +9.18pp |
| **Culture** | 253 | 10 (3.95%) | **35 (13.83%)** | **+25** | +9.88pp |
| Tour | 25 | 17 (68%) | 18 (72%) | +1 | +4pp |

---

## 🔧 이번 작업 내용 (2026-01-20)

### 문제 발견

`extractOverviewFromPayload()` 함수에서 KOPIS와 Culture 소스에 대해 `return null`을 반환하고 있어 raw payload에 데이터가 있어도 추출하지 못함:

```typescript
// 수정 전 (문제 코드)
if (source === 'kopis') {
  return null;  // KOPIS의 sty 필드를 사용하지 않음!
}

if (source === 'culture') {
  return null;  // Culture의 contents1 필드를 사용하지 않음!
}
```

### 해결책

KOPIS와 Culture 소스에 대한 overview 추출 로직 구현:

```typescript
// 수정 후
if (source === 'kopis') {
  const sty = payload.sty as string;
  if (sty && sty.trim()) {
    const cleaned = cleanOverviewText(sty);
    if (cleaned.length >= CONFIG.MIN_OVERVIEW_LENGTH) {
      return cleaned;
    }
  }
  return null;
}

if (source === 'culture') {
  const contents1 = payload.contents1 as string;
  if (contents1 && contents1.trim()) {
    const cleaned = cleanOverviewText(contents1);
    if (cleaned.length >= CONFIG.MIN_OVERVIEW_LENGTH) {
      return cleaned;
    }
  }
  return null;
}
```

### 소스별 필드 매핑

| 소스 | Raw Table | Overview 필드 | 설명 |
|------|-----------|---------------|------|
| KOPIS | raw_kopis_events | `payload.sty` | 줄거리/프로그램 정보 |
| Culture | raw_culture_events | `payload.contents1` | 행사/공연 소개 |
| Tour | raw_tour_events | `payload.overview` | 관광지/행사 소개 |

### 추가 개선: HTML 정제 강화

`cleanOverviewText()` 함수에 다음 개선 적용:
- style/script 태그 전체 제거
- br/p/div 태그를 줄바꿈으로 변환
- 숫자 코드 HTML 엔티티 처리 (&#39; 등)
- 의미 없는 문자열 필터링 (준비중, 내용없음 등)

---

## 📝 샘플 레코드 (2026-01-20 업데이트)

| # | 제목 | 소스 | 길이 | 미리보기 |
|---|------|------|------|---------|
| 1 | Eloquent Cosmopolitan | kopis | 443 | [공연소개] 'Eloquent Cosmopolitans'은 다른 나라와 시기에서 태어난 세 작곡가의... |
| 2 | Wisp 내한공연 | kopis | 108 | [공연소개] 슈게이즈가 아니라, 누게이즈입니다만- 우리 시대 록스타는 어떻게... |
| 3 | 오브제음악극, 동물농장 [제주] | kopis | 157 | [공연소개] 조지오웰 원작 '동물농장'이 다움의 색깔로 탄생된 오브제 음악극... |
| 4 | 우리들의 사랑 기억법 [대구] | culture | 229 | [공연소개] 우리들의 사랑기억법 당신의 사랑 이야기를 깨우는... |
| 5 | 오승윤: 풍수의 색, 생명의 선율 | culture | 90 | 오승윤 (1939~2006) 평생에 걸쳐 자연과 인간의 조화를 탐구하며... |
| 6 | 신유민 피아노 독주회 | kopis | 149 | [PROGRAM] Johann Sebastian Bach, Robert Schumann Kreisleriana... |
| 7 | 아르텔 필하모닉 오케스트라 정기연주회 | kopis | 752 | [공연소개] 아르텔 필하모닉 오케스트라 창단 7주년 기념... |
| 8 | 낙동아트센터 개관 페스티벌 | kopis | 524 | [PROGRAM] Heeyoung Yang Restoration, C. Debussy... |
| 9 | 한낮의 유U;콘서트 (1월) | kopis | 316 | [PROGRAM] Travel, Quizas, Love, I've Got a Crush on You... |
| 10 | 제24회 이 베아띠 정기연주회 | kopis | 767 | [프로그램] 백유미 Ensemble Festive Mass, C. Gounod... |

---

## 🔬 증거 쿼리

### 전체/소스별 커버리지 확인

```sql
-- 전체 통계
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN overview IS NOT NULL AND TRIM(overview) != '' THEN 1 END) as has_overview,
  ROUND(COUNT(CASE WHEN overview IS NOT NULL AND TRIM(overview) != '' THEN 1 END) * 100.0 / COUNT(*), 2) as coverage_pct
FROM canonical_events
WHERE is_deleted = false;

-- 소스별 통계
SELECT
  source_priority_winner as source,
  COUNT(*) as total,
  COUNT(CASE WHEN overview IS NOT NULL AND TRIM(overview) != '' THEN 1 END) as has_overview,
  ROUND(COUNT(CASE WHEN overview IS NOT NULL AND TRIM(overview) != '' THEN 1 END) * 100.0 / COUNT(*), 2) as coverage_pct
FROM canonical_events
WHERE is_deleted = false
GROUP BY source_priority_winner
ORDER BY source_priority_winner;
```

### 최근 업데이트 확인

```sql
SELECT
  id, title, source_priority_winner,
  LEFT(overview, 100) as overview_preview,
  LENGTH(overview) as overview_length,
  updated_at
FROM canonical_events
WHERE is_deleted = false
  AND overview IS NOT NULL
  AND TRIM(overview) != ''
ORDER BY updated_at DESC
LIMIT 10;
```

---

## 🎯 실행 방법

### Dry-run (업데이트 없이 미리보기)
```bash
cd backend
npx ts-node src/jobs/overviewBackfill.ts --dry-run

# Limit 옵션 (처음 N개만 처리)
npx ts-node src/jobs/overviewBackfill.ts --dry-run --limit=20
```

### 실제 업데이트
```bash
cd backend
npx ts-node src/jobs/overviewBackfill.ts

# Limit 옵션
npx ts-node src/jobs/overviewBackfill.ts --limit=100
```

---

## ⚠️ 한계 및 다음 단계

### 현재 한계

1. **Raw 데이터 부재**: 많은 이벤트의 raw payload에 overview 필드가 비어있음
   - KOPIS `sty` 가용률: 11.3% (3,647개 중 413개)
   - Culture `contents1` 가용률: 9.5% (1,110개 중 105개)

2. **일부 HTML 태그 잔존**: 일부 Culture 데이터에서 복잡한 HTML 구조가 완전히 제거되지 않음

### 추가 개선 방안

1. **수집기 개선**: Collector 단계에서 상세 API 호출을 늘려 raw payload에 overview가 더 많이 포함되도록 개선

2. **HTML 정제 강화**: 복잡한 HTML 구조(style 속성 포함 태그 등)에 대한 정제 로직 추가

3. **품질 점수 도입**: overview 품질(길이, 노이즈, 정보성)에 따른 점수 체계 도입

4. **크롤링/스크래핑**: 원천 API에서 overview를 제공하지 않는 경우, 상세 페이지 스크래핑 고려

---

## 📦 변경된 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `src/jobs/overviewBackfill.ts` | KOPIS/Culture overview 추출 로직 추가, HTML 정제 개선 |
| `docs/OVERVIEW_SOURCES_GAP.md` | 진단 결과 문서 (신규) |
| `docs/OVERVIEW_BACKFILL_REPORT.md` | 실행 결과 보고서 (업데이트) |

---

## 📊 작업 이력

### 2026-01-20: KOPIS/Culture 소스 추가
- KOPIS `sty` 필드 추출 로직 구현 → **+154개** 이벤트
- Culture `contents1` 필드 추출 로직 구현 → **+25개** 이벤트
- HTML 정제 로직 강화
- 커버리지 1.53% → **10.74%**

### 2026-01-19: 초기 구현
- Overview 컬럼 추가 migration
- Tour 소스 overview 추출 구현
- 커버리지 0% → 1.53% (30개)

---

**최종 작업 완료일**: 2026-01-20
**검증 완료**: ✅
