# AI Enrichment 신뢰도 기반 자동화 정책

## 📋 개요

AI가 생성한 데이터를 **신뢰도에 따라** 자동 적용 또는 제안 생성하는 시스템입니다.

### 주요 개선 사항

1. **신뢰도 기반 자동화**: 높은 신뢰도(80% 이상)는 자동 적용, 중간 신뢰도(60-80%)는 운영자 검토
2. **필드별 중요도 구분**: Critical 필드(가격, 주소)는 무조건 제안 방식, Low 필드(태그)는 자동 적용
3. **통계 추적**: 자동 적용 vs 제안 생성 비율을 모니터링

---

## 🎯 신뢰도 설정

### 출처별 기본 신뢰도

| 출처 | 기본 신뢰도 | 설명 |
|------|------------|------|
| `PUBLIC_API` | 95% | KOPIS, Culture, TourAPI (가장 신뢰) |
| `NAVER_API` | 85% | Naver Place, Blog 등 (상향↑) |
| `AI` | **75%** | Gemini AI 추출 (**65% → 75%로 상향↑**) |
| `MANUAL` | 100% | 관리자 수동 입력 |
| `CALCULATED` | 90% | 내부 로직 계산 |

### 필드별 신뢰도 조정

AI 기본 신뢰도(75%)에서 필드 특성에 따라 조정됩니다:

| 필드 | 신뢰도 | 이유 |
|------|--------|------|
| `derived_tags` | **85%** | 틀려도 큰 문제 없음 |
| `opening_hours` | **80%** | 중간 정도의 중요도 |
| `price_min/max` | **75%** | 중요 필드, 보수적으로 |
| `overview` | **75%** | 기본 신뢰도 |

---

## 🔄 자동화 정책

### 기본 정책 (DEFAULT_POLICY)

```typescript
{
  autoApplyThreshold: 80,   // 80% 이상이면 자동 적용
  suggestionThreshold: 60,  // 60% 이상이면 제안 생성
}
```

### 필드별 중요도

#### 🔴 Critical (항상 제안 방식)
- **가격**: `price_min`, `price_max`
- **위치**: `venue`, `address`
- **일정**: `start_at`, `end_at`

→ **운영자가 반드시 검토**해야 하는 중요 정보

#### 🟡 Normal (신뢰도 기반)
- **설명**: `overview`
- **링크**: `external_links`
- **운영 시간**: `opening_hours`
- **특화 정보**: `metadata.display.performance/exhibition`

→ 신뢰도 80% 이상이면 자동, 60-80%면 제안

#### 🟢 Low (항상 자동 적용)
- **태그**: `derived_tags`
- **내부 메타데이터**: `metadata.internal`

→ 틀려도 큰 문제가 없으므로 자동 적용

---

## 📊 작동 흐름

### 1. 스케줄러가 AI Enrichment 실행 (매일 04:00 KST)

```
신규 이벤트 수집
↓
공공 API로 채울 수 있는 필드 채움
↓
빈 필드 발견
↓
Naver 검색 + Gemini AI 분석
↓
신뢰도 계산
↓
정책 기반 결정
```

### 2. 자동 적용 vs 제안 생성

#### Case 1: 자동 적용 (Auto-apply)
```typescript
if (confidence >= 80 && priority === 'low' || priority === 'normal') {
  // DB에 직접 저장
  // field_sources = { source: 'AI', confidence: 85, ... }
}
```

**예시**: `derived_tags` (신뢰도 85%, Low 우선순위)
- ✅ **즉시 DB에 저장**
- 운영자 개입 불필요

#### Case 2: 제안 생성 (Suggestion)
```typescript
if (confidence >= 60 && priority === 'critical') {
  // ai_suggestions에 저장 (운영자 검토 대기)
}
```

**예시**: `price_min` (신뢰도 75%, Critical 우선순위)
- 💡 **ai_suggestions 컬럼에 저장**
- 운영자가 Admin UI에서 "적용" 버튼 클릭 필요

#### Case 3: 스킵
```typescript
if (confidence < 60 || hasExisting || manuallyEdited) {
  // 아무것도 안 함
}
```

---

## 🖥️ Admin UI 동작

### "AI로 빈 필드 보완" 버튼

**스케줄러와 다른 점**:
1. **실시간**: 즉시 AI 분석 실행
2. **전체 제안 방식**: 모든 필드를 `ai_suggestions`에 저장 (자동 적용 없음)
3. **수동 적용**: 운영자가 각 제안을 검토 후 "적용" 클릭

→ **개별 이벤트 관리용**, 운영자가 완전히 제어

---

## 📈 통계 및 모니터링

### 실행 후 출력 예시

```
📊 Confidence-based Automation Stats:
   - Auto-applied: 42 (신뢰도 ≥ 80%)
   - Suggestions: 15 (60-80%, 운영자 검토 필요)
   - Skipped: 8

📋 By Field:
   derived_tags:
     ✅ Auto: 38 (90.5%)
     💡 Suggestion: 0 (0.0%)
     ⏭️  Skip: 4 (9.5%)
   
   opening_hours:
     ✅ Auto: 4 (57.1%)
     💡 Suggestion: 3 (42.9%)
     ⏭️  Skip: 0 (0.0%)
   
   price_min:
     ✅ Auto: 0 (0.0%)
     💡 Suggestion: 12 (100.0%)
     ⏭️  Skip: 0 (0.0%)
```

### 모니터링 포인트

1. **자동 적용 비율**: 너무 낮으면 신뢰도 threshold 조정 필요
2. **제안 수락률**: 운영자가 제안을 거의 수락하면 자동 적용해도 됨
3. **필드별 정확도**: 특정 필드의 AI 성능 추적

---

## 🎛️ 정책 변경하기

### 공격적 자동화 (서비스 초기)

```typescript
import { AGGRESSIVE_POLICY } from './enrichmentPolicy';

const decision = decideFieldAction(
  'opening_hours',
  value,
  confidence,
  { policy: AGGRESSIVE_POLICY }  // 70% 이상이면 자동
);
```

### 보수적 자동화 (품질 중시)

```typescript
import { CONSERVATIVE_POLICY } from './enrichmentPolicy';

const decision = decideFieldAction(
  'price_min',
  value,
  confidence,
  { policy: CONSERVATIVE_POLICY }  // 90% 이상만 자동
);
```

---

## 🔧 구현 파일

| 파일 | 역할 |
|------|------|
| `lib/confidenceCalculator.ts` | 신뢰도 계산 로직 |
| `lib/enrichmentPolicy.ts` | 정책 정의 (threshold, 필드 우선순위) |
| `lib/enrichmentHelper.ts` | 자동 적용 vs 제안 결정 헬퍼 |
| `jobs/aiEnrichmentBackfill.ts` | 실제 AI Enrichment 실행 |

---

## ✅ 결론

### 이전 방식
- **무조건 자동 적용**: 모든 빈 필드를 AI가 자동으로 채움
- **문제점**: 가격, 주소 같은 중요 필드도 검증 없이 저장

### 현재 방식 (개선)
- **신뢰도 기반 자동화**: 80% 이상만 자동
- **필드별 중요도**: Critical 필드는 무조건 제안
- **통계 추적**: 자동화 효율성 모니터링

### 추후 개선 방향
1. **실제 정확도 추적**: 운영자가 제안을 수락/거부한 비율로 신뢰도 재조정
2. **사용자 신고 연동**: 사용자가 틀린 정보를 신고하면 AI 신뢰도 하향
3. **A/B 테스트**: 다양한 threshold 실험

