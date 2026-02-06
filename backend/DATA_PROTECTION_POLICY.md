# 🛡️ 데이터 보호 정책 (Data Protection Policy)

**작성일**: 2026-01-30  
**원칙**: 공공 API 데이터 우선, AI는 보조

---

## 📋 데이터 우선순위

### 1️⃣ 공공 API 데이터 (최우선)

**출처**: KOPIS, Culture, TourAPI  
**신뢰도**: ⭐⭐⭐⭐⭐ (공식 데이터)  
**보호**: ✅ **절대 덮어쓰지 않음**

| 필드 | 수집 시점 | 설명 |
|-----|----------|------|
| `title` | 03:00 수집 | 이벤트 제목 |
| `venue` | 03:00 수집 | 장소명 |
| `start_at`, `end_at` | 03:00 수집 | 시작/종료일 |
| `address`, `lat`, `lng` | 03:00 수집 + 지오코딩 | 위치 정보 |
| `price_min`, `price_max` | 03:30 priceInfoBackfill | API payload에서 추출 |

**⚠️ 중요**: 이 필드들은 **AI가 절대 수정할 수 없음**

---

### 2️⃣ AI 보완 데이터 (보조)

**출처**: 네이버 API + Gemini AI  
**신뢰도**: ⭐⭐⭐ (블로그/웹 기반)  
**역할**: ✅ **빈 필드만 채움**

| 필드 | 수집 시점 | 조건 |
|-----|----------|------|
| `opening_hours` | 04:00 AI Enrichment | 기존 값 없을 때만 |
| `derived_tags` | 04:00 AI Enrichment | 기존 값 없을 때만 (스케줄러) |
| `external_links` | 04:00 AI Enrichment | 병합 (덮어쓰기 없음) |
| `metadata.display` | 04:00 AI Enrichment | Phase 3 전용 |

**✅ 원칙**: 이미 값이 있으면 **스킵**, 비어있을 때만 **채움**

---

## 🔄 데이터 파이프라인

```
03:00 ──────────────────────────────────────────────
  📥 공공 API 수집 (runGeoRefreshPipeline)
     → canonical_events에 기본 데이터 저장
     ✅ title, venue, start_at, end_at, address 등

03:30 ──────────────────────────────────────────────
  💰 Price Info 백필 (priceInfoBackfill)
     → API payload에서 가격 추출
     ✅ price_min, price_max 저장

04:00 ──────────────────────────────────────────────
  🤖 AI Enrichment (aiEnrichmentBackfill)
     → 네이버 API + Gemini AI
     
     보호 로직:
     ✅ price_min 있으면 → SKIP (공공 API 보호)
     ✅ price_max 있으면 → SKIP (공공 API 보호)
     ✅ opening_hours 있으면 → SKIP (공공 API 보호)
     
     ✅ derived_tags 없으면 → 채우기
     ✅ metadata.display 없으면 → 채우기 (Phase 3)
```

---

## 💻 구현 코드

### Before (문제 있음)

```typescript
// ❌ 무조건 덮어쓰기
if (extractedInfo.price_min !== undefined && extractedInfo.price_min !== null) {
  updateFields.push(`price_min = $${paramIndex++}`);
  updateValues.push(extractedInfo.price_min);
  // 공공 API 데이터도 덮어씀!
}
```

### After (보호 적용)

```typescript
// ✅ 기존 값이 없을 때만 업데이트
if (extractedInfo.price_min !== undefined && extractedInfo.price_min !== null) {
  if (event.price_min === null || event.price_min === undefined) {
    updateFields.push(`price_min = $${paramIndex++}`);
    updateValues.push(extractedInfo.price_min);
    console.log('[Enrich] ✅ price_min added (was empty)');
  } else {
    console.log(`[Enrich] ⏭️  price_min skipped (already exists: ${event.price_min})`);
  }
}
```

---

## 🧪 테스트 케이스

### 테스트 1: 공공 API 데이터 보호

```
이벤트: 레드북 [용인]

입력:
  price_min: 60000 (priceInfoBackfill에서 추출)
  price_max: 130000 (priceInfoBackfill에서 추출)
  opening_hours: null

AI 분석:
  price_min: 60000
  price_max: 130000
  opening_hours: { weekday: "19:30" }

결과:
  price_min: 60000 ✅ (기존 값 유지)
  price_max: 130000 ✅ (기존 값 유지)
  opening_hours: { weekday: "19:30" } ✅ (비어있어서 채움)
```

### 테스트 2: 빈 필드 채우기

```
이벤트: 새로 수집된 전시

입력:
  price_min: null
  price_max: null
  opening_hours: null

AI 분석:
  price_min: 15000
  price_max: 20000
  opening_hours: { weekday: "10:00-18:00" }

결과:
  price_min: 15000 ✅ (AI가 채움)
  price_max: 20000 ✅ (AI가 채움)
  opening_hours: { weekday: "10:00-18:00" } ✅ (AI가 채움)
```

---

## 🔧 스케줄러 옵션

### 자동 실행 (매일 04:00 KST)

```typescript
aiEnrichmentBackfill({
  limit: null,
  testMode: false,
  useNaverSearch: true,
  onlyMissingTags: true,   // derived_tags 없는 이벤트만
  onlyRecent: true,         // 최근 24시간 이벤트만
});
```

**특징**:
- `onlyMissingTags: true` → 이미 AI 보완된 이벤트는 **스킵**
- `onlyRecent: true` → 최근 24시간 생성/업데이트된 이벤트만
- **신규 이벤트만 효율적으로 처리**

### Admin UI 수동 실행

```typescript
aiEnrichmentBackfill({
  limit: 1,                 // 선택한 이벤트 1개만
  testMode: false,
  useNaverSearch: true,
  onlyMissingTags: false,   // 강제 재분석
  onlyRecent: false,        // 모든 이벤트
});
```

**특징**:
- 선택한 이벤트 **강제 재분석**
- `derived_tags` **재생성** (사용자가 원하는 경우)
- **하지만**: `price_min/max`, `opening_hours`는 **여전히 보호됨**

---

## 📊 보호 vs 덮어쓰기 정책

| 필드 | 공공 API | AI 보완 | 정책 |
|-----|---------|---------|------|
| `title` | ✅ | - | 🛡️ 보호 (절대 수정 안 함) |
| `venue` | ✅ | - | 🛡️ 보호 (절대 수정 안 함) |
| `start_at`, `end_at` | ✅ | - | 🛡️ 보호 (절대 수정 안 함) |
| `address`, `lat`, `lng` | ✅ | - | 🛡️ 보호 (절대 수정 안 함) |
| `price_min`, `price_max` | ✅ | ✅ | 🛡️ 기존 값 있으면 보호 |
| `opening_hours` | 🔄 | ✅ | 🛡️ 기존 값 있으면 보호 |
| `derived_tags` | - | ✅ | 🔄 덮어쓰기 가능 (AI 전용) |
| `metadata.display` | - | ✅ | 🔄 덮어쓰기 가능 (AI 전용) |
| `overview` | - | ✅ | 🔄 덮어쓰기 가능 (AI 전용) |

**범례**:
- 🛡️ 보호: 기존 값 유지, AI가 수정할 수 없음
- 🔄 덮어쓰기: AI가 재분석 시 업데이트 가능

---

## 🎯 원칙 요약

1. **공공 API 우선** 📡
   - 공식 데이터는 절대 덮어쓰지 않음
   - priceInfoBackfill에서 추출한 가격 정보 보호

2. **AI는 보조** 🤖
   - 빈 필드만 채움
   - 이미 값이 있으면 스킵

3. **AI 전용 필드는 재분석 가능** 🔄
   - `derived_tags`, `metadata.display`, `overview`
   - 사용자가 원하면 재생성 가능

4. **투명성** 📝
   - 모든 업데이트/스킵을 로그로 기록
   - "[Enrich] ✅ added" vs "[Enrich] ⏭️ skipped"

---

## 🧪 테스트 방법

```bash
# 데이터 보호 테스트
ts-node -r dotenv/config src/scripts/test-data-protection.ts

# 10개 이벤트로 실제 테스트
npm run backfill:ai-enrich -- --limit=10
```

---

**마지막 업데이트**: 2026-01-30  
**작성자**: Fairpick AI Agent  
**버전**: 1.0.0

