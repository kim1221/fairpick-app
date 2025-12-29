# 데이터 수집 & 저장 파이프라인 (초안)

## 1. 아키텍처 개요

```
[공식 API / 크롤러] → [Collector] → [Mapper] → [events 테이블(DB)] → [REST API]
```

- **Collector**: 각 소스(한국관광공사, 서울시, 제휴 API, 크롤링 대상)에서 원본 데이터를 받아오는 스크립트/서비스
- **Mapper**: 원본 필드를 공통 스키마(Event) 형태로 변환
- **DB**: `events` 테이블에 저장 (중복/업데이트 처리)
- **REST API**: 프론트엔드가 호출하는 `/events`, `/events/:id`

## 2. Collector 설계

| 소스 | 언어/라이브러리 | 실행 방식 | 출력 |
| --- | --- | --- | --- |
| 한국관광공사 TourAPI | Node.js (axios) | cron (매시간) | JSON 배열 |
| 서울시 공공데이터 | Node.js (axios) | cron (하루 1회) | JSON 배열 |
| 롯데월드/코엑스 API | Node.js (axios) | cron (30분마다) | JSON 배열 |
| 크롤링 대상 (네이버, 코엑스 등) | Node.js + Cheerio/Playwright | cron (1~2회/일) | JSON 배열 (공통 스키마) |

- Collector 실행 순서
  1. 환경변수/API 키 로드
  2. HTTP 요청 또는 HTML 파싱
  3. 원본 JSON을 `mapper()`에 전달
  4. 결과를 DB에 upsert
  5. 로그/알림 (성공, 실패)

## 3. Mapper 규칙

```ts
interface RawEvent { /* 소스별 */ }
interface Event { /* 공통 스키마 */ }

function mapToEvent(raw: RawEvent, source: string): Event | null {
  // 필수 필드 검증, 지역/카테고리 매핑, HTML 제거, 태그 제한
}
```

- 공통 검증:
  - 필수 필드 누락 → `null` 반환 후 실패 로그에 기록
  - 날짜 포맷: `YYYY-MM-DD` / `YYYY.MM.DD`
  - 이미지 URL: HTTPS 확인
  - tags: 최대 5개

## 4. DB 스키마 초안

```
Table: events
Columns:
  id (PK, UUID)
  source VARCHAR(50)
  external_id VARCHAR(100)
  title VARCHAR(120)
  description TEXT
  period_text VARCHAR(50)
  start_date DATE
  end_date DATE
  region VARCHAR(20)
  category VARCHAR(20)
  tags JSONB / TEXT[]
  thumbnail_url TEXT
  detail_image_url TEXT
  detail_link TEXT
  updated_at TIMESTAMP
  created_at TIMESTAMP DEFAULT NOW()
Indexes:
  UNIQUE (source, external_id)
  INDEX (region, category, start_date)
```

## 5. 스케줄 & 모니터링

| 소스 | 주기 | 도구 | 알림 |
| --- | --- | --- | --- |
| TourAPI | 1시간 | cron / Cloud Scheduler | Slack (성공/실패 요약) |
| 서울시 | 매일 00:30 | cron | Slack |
| 제휴 API | 30분 | cron | Slack |
| 크롤링 | 1일 2회 | cron | Slack |

- 실패 시 재시도: 지수 백오프 3회
- 실패 로그 저장: `failed_imports` 테이블 (source, payload, error)

## 6. 운영 체크리스트

- [ ] Collector에 API Key/Secret 환경변수 적용
- [ ] robots.txt 준수 여부 확인
- [ ] DB 백업 스케줄 설정 (일 1회)
- [ ] API 서버에서 최신 데이터 확인용 `/events/latest` 디버그 엔드포인트

