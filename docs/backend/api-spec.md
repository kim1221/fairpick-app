# API 사양 (초안)

## 1. 공통 데이터 스키마

| 필드 | 타입 | 설명 | 필수 | 비고 |
| --- | --- | --- | --- | --- |
| `id` | string | 행사 고유 ID | ✅ | `source` + `externalId` 조합 |
| `title` | string | 행사명 | ✅ | 최대 60자, HTML 제거 |
| `description` | string | 한 줄 소개 | ✅ | 줄바꿈 제거 |
| `periodText` | string | `YYYY.MM.DD ~ YYYY.MM.DD` | ✅ | 시작/종료일 기반 |
| `startDate` | string (ISO) | 시작일 | ✅ | 정렬용 |
| `endDate` | string (ISO) | 종료일 | ✅ | 정렬용 |
| `region` | enum | 서울/경기/… (전국 제외) | ✅ | 매핑 규칙 문서화 필요 |
| `category` | enum | 전시/공연/박람회 | ✅ | `cat3` 등 매핑 |
| `tags` | string[] | 키워드 | ⛔️ | 최대 5개 |
| `thumbnailUrl` | string | 리스트 썸네일 | ✅ | HTTPS만 허용 |
| `detailImageUrl` | string | 상세 대표 이미지 | ✅ | 없으면 썸네일 재사용 |
| `detailLink` | string | 자세히 보기 URL | ✅ | 인앱 웹뷰/외부 브라우저 |
| `source` | enum | KTO/SeoulOpenAPI/LotteWorld 등 | ✅ | 데이터 출처 |
| `updatedAt` | string (ISO) | 데이터 최신화 시각 | ✅ | 캐시 무효화용 |

## 2. REST 엔드포인트

### `GET /events`

- 설명: 필터링된 행사 목록 조회
- 쿼리 파라미터
  - `category` (optional): `전시 | 공연 | 박람회`
  - `region` (optional): `서울 | 경기 | …`
  - `page` (optional, default 1)
  - `size` (optional, default 20)
- 응답 예시
```json
{
  "items": [
    {
      "id": "kto-1234",
      "title": "빛의 축제, 윈터 뮤지엄",
      "description": "천장의 미디어 캔버스로 겨울의 빛을 만나는 전시.",
      "periodText": "2025.12.01 ~ 2026.02.28",
      "startDate": "2025-12-01",
      "endDate": "2026-02-28",
      "region": "서울",
      "category": "전시",
      "tags": ["서울", "크리스마스"],
      "thumbnailUrl": "https://.../thumb.png",
      "detailImageUrl": "https://.../hero.png",
      "detailLink": "https://example.com/events/abc",
      "source": "KTO",
      "updatedAt": "2025-11-30T12:00:00Z"
    }
  ],
  "pageInfo": {
    "page": 1,
    "size": 20,
    "total": 123
  }
}
```
- 에러 예시
```json
{ "code": "INVALID_PARAM", "message": "category must be one of 전시, 공연, 박람회" }
```

### `GET /events/:id`

- 설명: 단일 행사 상세 조회
- 경로 파라미터: `id` (string)
- 응답: 공통 데이터 스키마와 동일
- 404 예시
```json
{ "code": "NOT_FOUND", "message": "Event not found" }
```

## 3. 인증 / 보안

- (초안) 내부용이므로 인증 미적용. 외부 노출 시 API Key/Bearer Token 필요
- HTTPS 필수

## 4. 에러 포맷

```json
{
  "code": "ERROR_CODE",
  "message": "사람이 읽을 수 있는 설명",
  "details": {}
}
```

## 5. TODO

- [ ] 페이지네이션/정렬 규칙 확정
- [ ] 태그 정의, 필터링 전략
- [ ] 인증/레이트 리밋 정책 결정
- [ ] 공식 API 응답 → 공통 스키마 매핑 문서 링크 추가

