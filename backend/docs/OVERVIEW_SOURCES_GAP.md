# Overview 소스 갭 분석 보고서

## 1. 현재 상태 요약

### 1.1 Canonical Events Overview 커버리지 (2026-01-20 기준)

| 소스 | 전체 이벤트 | Overview 있음 | 커버리지 |
|------|------------|--------------|----------|
| KOPIS | 1,677 | 3 | **0.18%** |
| Culture | 253 | 10 | **3.95%** |
| Tour | 25 | 17 | 68.00% |
| **총합** | **1,955** | **30** | **1.53%** |

### 1.2 Raw Payload에서의 Overview 필드 가용성

| 소스 | Raw 테이블 | 필드명 | 전체 레코드 | 필드 존재 | 가용률 |
|------|-----------|--------|------------|----------|--------|
| KOPIS | raw_kopis_events | `sty` | 3,647 | 413 | 11.3% |
| Culture | raw_culture_events | `contents1` | 1,110 | 105 | 9.5% |
| Tour | raw_tour_events | `overview` | 54 | 54 | 100% |

---

## 2. 문제 원인 분석

### 2.1 핵심 문제: `overviewBackfill.ts`의 `extractOverviewFromPayload()` 함수

```typescript
// src/jobs/overviewBackfill.ts (LINE 82-96)
function extractOverviewFromPayload(
  payload: Record<string, unknown>,
  source: string,
): string | null {
  if (!payload) return null;

  // KOPIS: overview 관련 필드 없음  ← 🚨 잘못된 가정!
  if (source === 'kopis') {
    return null;  // sty 필드가 있지만 사용하지 않음
  }

  // Culture: overview 관련 필드 거의 없음  ← 🚨 잘못된 가정!
  if (source === 'culture') {
    return null;  // contents1 필드가 있지만 사용하지 않음
  }

  // Tour만 처리됨 (overview, detailText 필드)
  if (source === 'tour') {
    // ... Tour만 구현됨
  }

  return null;
}
```

**결론**: Raw payload에 데이터가 있어도 KOPIS/Culture는 무조건 `null` 반환

### 2.2 소스별 필드 매핑

| 소스 | Raw Table | Overview 필드 | 데이터 형태 |
|------|-----------|---------------|-------------|
| KOPIS | raw_kopis_events | `payload.sty` | 줄거리/프로그램 정보 |
| Culture | raw_culture_events | `payload.contents1` | 행사/공연 소개 |
| Tour | raw_tour_events | `payload.overview` | 관광지/행사 소개 |

### 2.3 코드 근거

#### KOPIS Collector (`src/collectors/kopisCollector.ts`)
```typescript
// LINE 335: 상세 API에서 sty 필드 수집
sty: db.sty?.[0] || ''

// LINE 503-504: events 테이블 저장 시 사용
const overview = detailItem.sty || '';
```

#### Culture Collector (`src/collectors/cultureCollector.ts`)
```typescript
// LINE 248: 상세 API에서 contents1 필드 수집
contents1: item.contents1?.[0] || ''

// LINE 539: events 테이블 저장 시 사용
overview: detailItem.contents1 || ''
```

---

## 3. 잠재적 채울 수 있는 이벤트 분석

### 3.1 Sources 배열 전체 검사 결과

| 소스 | 채울 수 있는 이벤트 수 |
|------|----------------------|
| KOPIS | **1,709** |
| Culture | **16** |

**총 잠재적 개선: ~1,725개 이벤트 (전체의 88%)**

### 3.2 Sources 구조 특이점

`canonical_events`의 `source_priority_winner`와 실제 `rawTable`이 다른 경우:

| source_priority_winner | first_raw_table | 건수 |
|-----------------------|-----------------|------|
| culture | raw_culture_events | 202 |
| culture | raw_kopis_events | 41 |
| culture | raw_tour_events | 10 |
| kopis | raw_kopis_events | 1,672 |
| kopis | raw_tour_events | 3 |
| kopis | raw_culture_events | 2 |
| tour | raw_tour_events | 17 |
| tour | raw_kopis_events | 8 |

→ **sources 배열의 모든 소스를 순회하며 overview를 추출해야 함**

---

## 4. Raw Payload 샘플

### 4.1 KOPIS `sty` 필드 예시
```
[PROGRAM]
L. v. Beethoven (1770-1827) Piano Trio in D Major, Op.70 No.1 "Ghost"
루드비히 반 베토벤 피아노 트리오 라 장조, 작품번호 70-1, "유령"
I. Allegro vivace e con brio
II. Largo assai ed espressivo
III. Presto
```

### 4.2 Culture `contents1` 필드 예시
```
다양하게 축적된 아시아 문화의 가치를 융복합 예술 콘텐츠로 확장하는
국립아시아문화전당은 지난 10년의 여정을 되돌아보며, 기관의 첫걸음을
함께했던 료지 이케다와 다시 만납니다...
```

---

## 5. 해결 방안

### 5.1 `extractOverviewFromPayload()` 수정

```typescript
function extractOverviewFromPayload(
  payload: Record<string, unknown>,
  source: string,
): string | null {
  if (!payload) return null;

  // KOPIS: sty (줄거리) 필드에서 추출
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

  // Culture: contents1 필드에서 추출
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

  // Tour: 기존 로직 유지
  if (source === 'tour') {
    // ... 기존 코드
  }

  return null;
}
```

### 5.2 예상 개선 효과

| 소스 | 현재 커버리지 | 예상 커버리지 | 증가분 |
|------|--------------|--------------|--------|
| KOPIS | 0.18% | ~10% | +164 이벤트 |
| Culture | 3.95% | ~10% | +16 이벤트 |
| Tour | 68% | 68% (유지) | - |
| **총합** | **1.53%** | **~10%** | **~180 이벤트** |

---

## 6. 다음 단계

1. ✅ 진단 완료
2. ⏳ `overviewBackfill.ts` 수정
3. ⏳ dry-run 실행 및 검증
4. ⏳ real-run 실행
5. ⏳ 결과 문서화

---

## 7. 한계점

1. **KOPIS `sty` 가용률 11.3%**: 모든 공연에 줄거리가 있는 것은 아님
2. **Culture `contents1` 가용률 9.5%**: 일부 이벤트만 상세 설명 제공
3. **HTML/특수문자 정제 필요**: raw 데이터에 HTML 태그 포함 가능
4. **품질 편차**: 일부 데이터는 너무 짧거나 의미 없는 내용일 수 있음

---

*작성일: 2026-01-20*
