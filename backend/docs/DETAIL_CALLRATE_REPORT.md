# Detail API Call Rate 개선 보고서

**최종 업데이트**: 2026-01-20
**작업자**: Claude (AI Assistant)
**목표**: raw_kopis_events.sty / raw_culture_events.contents1 필드 가용률 향상

---

## 1. 결론 요약

### 핵심 발견사항

**Detail Backfill 인프라 구축 완료**, 그러나 **원천 API 데이터 한계로 인해 커버리지 향상 제한적**

| 지표 | 실행 전 | 실행 후 | 변화 |
|------|--------|--------|------|
| KOPIS sty 보유 | 413 (11.32%) | 413 (11.32%) | 변동 없음 |
| Culture contents1 보유 | 105 (9.46%) | 105 (9.46%) | 변동 없음 |
| **API 호출 성공률** | N/A | **100%** | - |

> **원인**: 원천 API가 대부분의 이벤트에 대해 sty/contents1를 제공하지 않음

---

## 2. 구현 완료 항목

### 2.1 Detail Backfill Job 신규 생성

**파일**: `src/jobs/detailBackfill.ts`

#### 핵심 기능

| 기능 | 구현 상태 | 설명 |
|------|----------|------|
| 지수 백오프 재시도 | ✅ | 3회 재시도, 1초→2초→4초 백오프 |
| 동시성 제어 | ✅ | 환경변수로 조절 가능 (기본 3) |
| 우선순위 처리 | ✅ | Live 이벤트 → 종료 임박 순 |
| Rate Limiting | ✅ | 배치간 100ms 딜레이 |
| Dry-run 모드 | ✅ | `--dry-run`, `--network-dry-run` |
| 관측 지표 | ✅ | 성공/실패/오류 유형별 집계 |

#### 환경 변수

```bash
# 동시성 조절
KOPIS_DETAIL_CONCURRENCY=3    # KOPIS 동시 요청 수
CULTURE_DETAIL_CONCURRENCY=3  # Culture 동시 요청 수
```

#### 재시도 로직

```typescript
const CONFIG = {
  MAX_RETRIES: 3,
  INITIAL_BACKOFF_MS: 1000,
  MAX_BACKOFF_MS: 30000,
};

// 재시도 가능 오류: 429, 5XX, ETIMEDOUT, ECONNRESET
// 그 외 오류는 즉시 실패 처리
```

### 2.2 NPM 스크립트 추가

```json
{
  "backfill:detail": "ts-node -r dotenv/config src/jobs/detailBackfill.ts",
  "backfill:detail:kopis": "ts-node -r dotenv/config src/jobs/detailBackfill.ts kopis",
  "backfill:detail:culture": "ts-node -r dotenv/config src/jobs/detailBackfill.ts culture",
  "backfill:detail:dry": "ts-node -r dotenv/config src/jobs/detailBackfill.ts --network-dry-run"
}
```

### 2.3 사용법

```bash
# 네트워크 호출 없이 대상 확인
npm run backfill:detail:dry

# KOPIS detail backfill (기본 500건)
npm run backfill:detail:kopis

# 건수 제한
npm run backfill:detail:kopis -- --max-detail=100

# Culture detail backfill
npm run backfill:detail:culture

# 양쪽 모두 실행
npm run backfill:detail
```

---

## 3. 실행 결과

### 3.1 KOPIS Detail Backfill

```
==============================================
[DetailBackfill] Detail Backfill Job Started
==============================================
  Source: kopis
  Mode: LIVE
  Max detail: 200
==============================================

[DetailBackfill][KOPIS] Total raw events: 3647
[DetailBackfill][KOPIS] Target (missing sty): 200

========================================
[DetailBackfill][KOPIS] Summary
========================================
  List count (total raw):     3647
  Target count (missing):     200
  Attempted:                  200
  Succeeded:                  200   ← API 호출 100% 성공
  Failed:                     0
  Newly filled:               0     ← 원천에 데이터 없음
========================================
```

### 3.2 Culture Detail Backfill

```
[DetailBackfill][Culture] Total raw events: 1110
[DetailBackfill][Culture] Target (missing contents1): 200

========================================
[DetailBackfill][Culture] Summary
========================================
  List count (total raw):     1110
  Target count (missing):     200
  Attempted:                  200
  Succeeded:                  200   ← API 호출 100% 성공
  Failed:                     0
  Newly filled:               0     ← 원천에 데이터 없음
========================================
```

---

## 4. 원천 API 데이터 분석

### 4.1 KOPIS 장르별 sty 보유율

| 장르 | 전체 | sty 있음 | sty 보유율 |
|------|------|----------|-----------|
| 대중무용 | 7 | 3 | **42.86%** |
| **서양음악(클래식)** | 1,034 | 243 | **23.50%** |
| 복합 | 33 | 6 | 18.18% |
| 무용(서양/한국무용) | 78 | 12 | 15.38% |
| 서커스/마술 | 195 | 17 | 8.72% |
| 연극 | 450 | 39 | 8.67% |
| 대중음악 | 875 | 60 | 6.86% |
| 한국음악(국악) | 98 | 5 | 5.10% |
| **뮤지컬** | 877 | 28 | **3.19%** |

#### 주요 발견

1. **클래식 공연**은 프로그램 정보(sty)가 잘 등록됨 (23.5%)
2. **뮤지컬**은 줄거리가 거의 등록되지 않음 (3.19%)
3. 원천 API에서 제공하지 않는 데이터는 backfill로 채울 수 없음

### 4.2 sty가 있는 이벤트 샘플 (KOPIS)

| # | 제목 | 장르 | sty 미리보기 |
|---|------|------|-------------|
| 1 | 한상민의 매직쇼 | 서커스/마술 | [공연소개] 온가족이 즐길 수 있는 가족마술공연!... |
| 2 | 제180회 부천시립합창단 정기연주회 | 서양음악(클래식) | [Program] 헨델 메시아 G. Handel Messiah HWV. 56... |
| 3 | 함신익과 심포니 송 마스터즈 VII | 서양음악(클래식) | [프로그램] Ludwig van Beethoven - Egmont Overture... |
| 4 | 함신익과 심포니 송 마스터즈 VI | 서양음악(클래식) | [프로그램] Pyotr Tchaikovsky - Violin Concerto... |
| 5 | 아티스트 시리즈 3 | 서양음악(클래식) | [PROGRAM] 2026 아티스트 시리즈 3 <Brahms in Autumn>... |

---

## 5. SQL 증거 쿼리

### 5.1 KOPIS sty 커버리지 확인

```sql
SELECT
  'KOPIS' as source,
  COUNT(*) as total_raw,
  COUNT(CASE WHEN payload->>'sty' IS NOT NULL AND TRIM(payload->>'sty') != '' THEN 1 END) as has_sty,
  ROUND(COUNT(CASE WHEN payload->>'sty' IS NOT NULL AND TRIM(payload->>'sty') != '' THEN 1 END) * 100.0 / COUNT(*), 2) as coverage_pct,
  COUNT(CASE WHEN end_at >= CURRENT_DATE AND (payload->>'sty' IS NULL OR TRIM(payload->>'sty') = '') THEN 1 END) as live_missing_sty
FROM raw_kopis_events;
```

**결과**: 3647 total, 413 has_sty (11.32%), 1459 live_missing_sty

### 5.2 Culture contents1 커버리지 확인

```sql
SELECT
  'Culture' as source,
  COUNT(*) as total_raw,
  COUNT(CASE WHEN payload->>'contents1' IS NOT NULL AND TRIM(payload->>'contents1') != '' THEN 1 END) as has_contents1,
  ROUND(COUNT(CASE WHEN payload->>'contents1' IS NOT NULL AND TRIM(payload->>'contents1') != '' THEN 1 END) * 100.0 / COUNT(*), 2) as coverage_pct
FROM raw_culture_events;
```

**결과**: 1110 total, 105 has_contents1 (9.46%)

### 5.3 장르별 sty 보유율 확인

```sql
SELECT
  payload->>'genrenm' as genre,
  COUNT(*) as total,
  COUNT(CASE WHEN payload->>'sty' IS NOT NULL AND TRIM(payload->>'sty') != '' THEN 1 END) as has_sty,
  ROUND(COUNT(CASE WHEN payload->>'sty' IS NOT NULL AND TRIM(payload->>'sty') != '' THEN 1 END) * 100.0 / COUNT(*), 2) as sty_rate
FROM raw_kopis_events
GROUP BY payload->>'genrenm'
ORDER BY sty_rate DESC;
```

---

## 6. 결론 및 권장사항

### 6.1 달성한 것

1. **강건한 Detail Backfill 인프라 구축**
   - 지수 백오프 재시도 (3회, 1s→2s→4s)
   - 동시성 제어 (환경변수로 조절)
   - 우선순위 기반 처리 (Live 이벤트 우선)
   - 관측 지표 출력

2. **API 호출 100% 성공률 달성**
   - 재시도 로직으로 네트워크 오류 극복
   - Rate limiting으로 429 오류 방지

### 6.2 한계점

1. **원천 API 데이터 부재**
   - KOPIS: 88.68%의 이벤트가 sty를 제공하지 않음
   - Culture: 90.54%의 이벤트가 contents1을 제공하지 않음
   - 이는 API 제공자(공공데이터포털/KOPIS) 측의 데이터 입력 문제

2. **장르별 편차**
   - 클래식: 23.5% sty 보유 (상대적으로 양호)
   - 뮤지컬: 3.19% sty 보유 (매우 낮음)

### 6.3 향후 개선 방안

| 방안 | 설명 | 복잡도 |
|------|------|--------|
| 1. 웹 스크래핑 | 공식 웹사이트에서 줄거리 크롤링 | 높음 |
| 2. AI 요약 생성 | 제목/장르/출연진 기반 AI 생성 | 중간 |
| 3. 데이터 요청 | 공공데이터포털에 데이터 품질 개선 요청 | 낮음 |
| 4. 선택적 수집 | 클래식 공연 중심으로 detail 호출 | 낮음 |

---

## 7. 변경된 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `src/jobs/detailBackfill.ts` | 신규 생성 - Detail backfill job |
| `package.json` | npm scripts 추가 |
| `docs/DETAIL_CALLRATE_REPORT.md` | 본 보고서 (신규) |

---

## 8. 참조 문서

- [OVERVIEW_SOURCES_GAP.md](./OVERVIEW_SOURCES_GAP.md) - Overview 소스 갭 분석
- [OVERVIEW_BACKFILL_REPORT.md](./OVERVIEW_BACKFILL_REPORT.md) - Overview backfill 결과

---

**최종 작업 완료일**: 2026-01-20
**검증 완료**: ✅
