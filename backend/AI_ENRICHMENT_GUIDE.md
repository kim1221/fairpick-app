# 🤖 AI Enrichment 가이드

네이버 검색 API와 OpenAI를 활용하여 이벤트 정보를 자동으로 보강하는 파이프라인입니다.

---

## 📋 목차
1. [환경 설정](#환경-설정)
2. [기능 개요](#기능-개요)
3. [사용 방법](#사용-방법)
4. [비용 및 제한사항](#비용-및-제한사항)
5. [트러블슈팅](#트러블슈팅)

---

## 🔧 환경 설정

### 1. 네이버 API 키 발급

1. [네이버 개발자센터](https://developers.naver.com/apps/#/register) 접속
2. 애플리케이션 등록
   - 이름: Fairpick (원하는 이름)
   - 사용 API: **검색** 선택
3. **Client ID**와 **Client Secret** 복사

### 2. OpenAI API 키 발급

1. [OpenAI Platform](https://platform.openai.com/api-keys) 접속
2. "Create new secret key" 클릭
3. API 키 복사 (다시 볼 수 없으므로 안전하게 저장!)

### 3. `.env` 파일에 추가

`backend/.env` 파일을 열고 다음 내용을 추가하세요:

```bash
# 네이버 Search API
NAVER_CLIENT_ID=your_naver_client_id_here
NAVER_CLIENT_SECRET=your_naver_client_secret_here

# OpenAI API
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-4o-mini  # 기본값 (빠르고 저렴)
```

**중요**: API 키는 절대 GitHub에 커밋하지 마세요!

---

## 🎯 기능 개요

### 자동 추출되는 정보

| 필드 | 설명 | 데이터 소스 |
|------|------|------------|
| **derived_tags** | 추천 태그 (데이트, 가족, 힙한 등) | AI 추론 |
| **opening_hours** | 운영/관람 시간 | 네이버 검색 + AI |
| **price_min / price_max** | 가격 범위 | 네이버 검색 + AI |
| **reservation_required** | 예약 필수 여부 | 네이버 검색 + AI |
| **age_restriction** | 연령 제한 | 네이버 검색 + AI |
| **parking_info** | 주차 정보 | 네이버 검색 + AI |
| **public_transport_info** | 대중교통 정보 | 네이버 검색 + AI |
| **accessibility_info** | 장애인 편의시설 | 네이버 검색 + AI |

### 처리 흐름

```
1. canonical_events에서 이벤트 조회
   ↓
2. 네이버 블로그/웹 검색 (제목 + 장소)
   ↓
3. OpenAI로 정보 추출 (비정형 → 구조화)
   ↓
4. DB 업데이트
```

---

## 🚀 사용 방법

### 1. 테스트 실행 (10개만)

```bash
cd backend
npm run backfill:ai-enrich:test
```

**권장**: 처음 실행할 때는 항상 테스트 모드로 시작하여 결과를 확인하세요.

### 2. 전체 실행

```bash
npm run backfill:ai-enrich
```

**주의**: 이벤트가 많으면 시간과 비용이 많이 듭니다!

### 3. 특정 개수만 실행

```bash
npm run backfill:ai-enrich -- --limit=50
```

### 4. Tags만 추출 (네이버 검색 없이)

```bash
npm run backfill:ai-enrich:tags
```

**장점**: 
- 빠름 (네이버 API 호출 없음)
- 저렴 (OpenAI API만 사용)
- 네이버 API 키 없이도 실행 가능

---

## 💰 비용 및 제한사항

### 네이버 Search API
- **무료 사용량**: 일 25,000건
- **초과 시**: 유료 (1,000건당 약 100원)
- **Rate Limit**: 초당 10회

### OpenAI API (gpt-4o-mini)
- **입력**: $0.15 / 1M 토큰
- **출력**: $0.60 / 1M 토큰
- **이벤트당 예상**: 약 500 토큰 (입력 300 + 출력 200)
- **1,000개 처리 시**: 약 $0.50 (약 650원)

### 예상 시간
- **10개 테스트**: 약 30초
- **100개**: 약 5분
- **1,000개**: 약 40분

**Rate Limiting**: 네이버 API 보호를 위해 이벤트당 2초 대기합니다.

---

## 📊 실행 결과 예시

```
========================================
🤖 AI Enrichment Backfill
========================================
Options: { limit: 10, testMode: true, useNaverSearch: true }
========================================

📊 Total events to process: 10

[Enrich] Processing (1/10): 스노우 잠실 롯데월드몰 팝업
[NaverAPI] Searching event info: { eventTitle: '스노우 잠실 롯데월드몰 팝업', venue: '롯데월드몰' }
[AI] Extracting info for: 스노우 잠실 롯데월드몰 팝업
[AI] Extraction success: { hasOpeningHours: true, hasPrice: true, tagCount: 4 }
[Enrich] ✅ Updated 5 fields

...

========================================
📊 Enrichment Complete
========================================
⏱️  Duration: 28.3s
✅ Success: 9
❌ Failed: 1
⏭️  Skipped: 0
📈 Total: 10 / 10

📝 Updated Fields:
   - opening_hours: 7
   - price: 8
   - reservation: 3
   - age_restriction: 2
   - derived_tags: 9
   - parking: 2
   - transport: 4
   - accessibility: 1
========================================
```

---

## 🔍 결과 확인

### Admin UI에서 확인
1. `http://localhost:5173` 접속
2. **이벤트 관리** 클릭
3. 업데이트된 이벤트 열기
4. 새로 추가된 필드들 확인:
   - 💰 가격 (price_min, price_max)
   - 🏷️ 태그 (derived_tags)
   - 🕐 운영시간 (opening_hours)

### SQL로 확인

```sql
-- derived_tags가 추가된 이벤트 수
SELECT COUNT(*) 
FROM canonical_events 
WHERE derived_tags IS NOT NULL AND jsonb_array_length(derived_tags) > 0;

-- opening_hours가 추가된 이벤트 수
SELECT COUNT(*) 
FROM canonical_events 
WHERE opening_hours IS NOT NULL;

-- 샘플 확인
SELECT title, derived_tags, opening_hours, price_min, price_max
FROM canonical_events
WHERE derived_tags IS NOT NULL
LIMIT 5;
```

---

## 🐛 트러블슈팅

### 1. "NAVER_CLIENT_ID not set" 경고

**원인**: 네이버 API 키가 `.env`에 없음

**해결**:
```bash
# .env 파일에 추가
NAVER_CLIENT_ID=your_client_id
NAVER_CLIENT_SECRET=your_client_secret
```

### 2. "OPENAI_API_KEY not set" 경고

**원인**: OpenAI API 키가 `.env`에 없음

**해결**:
```bash
# .env 파일에 추가
OPENAI_API_KEY=sk-proj-xxxxx
```

### 3. "Rate limit exceeded" 에러

**원인**: API 호출 제한 초과

**해결**:
- 네이버: 일일 25,000건 제한 확인
- OpenAI: 분당 요청 수 제한 확인
- `--limit` 옵션으로 처리 개수 줄이기

### 4. 비용이 너무 많이 나올 것 같아요

**해결**:
1. 먼저 `--test` 모드로 10개만 실행
2. 비용 확인 후 `--limit`으로 점진적으로 증가
3. Tags만 필요하면 `--tags-only` 사용 (네이버 API 없이)

```bash
# Tags만 추출 (저렴함)
npm run backfill:ai-enrich:tags

# 50개씩 나눠서 실행
npm run backfill:ai-enrich -- --limit=50
```

### 5. "No search results" 메시지가 많이 나와요

**원인**: 
- 네이버에 검색 결과가 없는 이벤트
- 제목이나 장소명이 너무 특이함

**해결**: 정상입니다. 이 경우 자동으로 Tags만 추출합니다.

---

## 🎓 고급 사용법

### 스케줄러에 통합

매일 자동으로 실행하려면:

```typescript
// src/jobs/scheduler.ts

import { runBackfill } from './aiEnrichmentBackfill';

// 매일 새벽 4시에 최근 100개 이벤트 처리
cron.schedule('0 4 * * *', async () => {
  console.log('[Scheduler] Running AI enrichment...');
  await runBackfill({ limit: 100, useNaverSearch: true });
});
```

### 특정 조건만 처리

```typescript
// 예: 팝업 이벤트만 처리
const result = await query(`
  SELECT * FROM canonical_events
  WHERE main_category = '행사'
    AND sub_category = '팝업'
    AND derived_tags IS NULL
  LIMIT 50
`);

for (const event of result.rows) {
  await enrichSingleEvent(event, true, stats);
}
```

---

## 📚 관련 파일

- `src/lib/naverApi.ts` - 네이버 Search API 클라이언트
- `src/lib/aiExtractor.ts` - OpenAI API 프롬프트 및 파싱
- `src/jobs/aiEnrichmentBackfill.ts` - Backfill Job 메인 로직
- `backend/AI_ENRICHMENT_GUIDE.md` - 본 가이드

---

## ❓ FAQ

### Q: 네이버 API 없이도 사용할 수 있나요?
A: 네! `--tags-only` 옵션을 사용하면 derived_tags만 추출합니다.

### Q: OpenAI 대신 Claude를 사용할 수 있나요?
A: 가능합니다. `src/lib/aiExtractor.ts`에서 Anthropic SDK로 교체하면 됩니다.

### Q: 이미 처리된 이벤트는 다시 처리되나요?
A: 아니요. `needsEnrichment()` 함수가 이미 충분한 정보가 있는 이벤트는 자동으로 스킵합니다.

### Q: 추출 품질이 좋지 않아요
A: `src/lib/aiExtractor.ts`의 프롬프트를 수정하거나, `OPENAI_MODEL`을 `gpt-4o`로 변경해보세요 (비용 증가).

---

**작성일**: 2026-01-26  
**버전**: 1.0.0  
**문의**: GitHub Issues


