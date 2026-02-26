---
Source: Repo-verified by Claude Code
Purpose: Event Detail UI redesign (Gemini input)
Route: /events/:id
---

# Event Detail UI + Data Contract Document

**목적:** 이벤트 상세 페이지 UI 재설계를 위한 현재 상태 및 데이터 계약 문서
**대상:** Gemini AI (UI 설계 요청용)
**원칙:** Repo-verified 정보만 포함. 추측 금지. 데이터 품질 판단 금지.

---

## 1️⃣ 라우트 식별

**파일:** `src/pages/events/[id].tsx`

**라우트 패턴:**
- Granite 라우팅: `/events/:id`
- 등록 위치: `src/router.gen.ts:15`

**진입점:**
- 홈 화면: `src/pages/index.tsx:298` - `navigation.navigate('/events/:id', { id: eventId })`
- 핫 페이지: `src/pages/hot.tsx:262` - `navigation.navigate('/events/:id', { id: eventId })`
- 근처 페이지: `src/pages/nearby.tsx:240` - `navigation.navigate('/events/:id', { id: eventId })`
- 검색 페이지: `src/pages/search.tsx:250` - `navigation.navigate('/events/:id', { id: eventId })`

---

## 2️⃣ 현재 UI 구조 (src/pages/events/[id].tsx)

### 2.1 데이터 로딩
- **Line 29:** `const event = await eventService.getEventById(id);`
- **Line 30-36:** 에러 처리 (404 → 에러 페이지 렌더링)

### 2.2 UI 섹션 (상단 → 하단 순서)

| 섹션 | Line | 컴포넌트 | 사용 필드 |
|------|------|----------|-----------|
| **Hero Image** | 95-103 | `EventImage` | `event.detailImageUrl` |
| **Badges** | 107-111 | `Badge` | `event.category`, `event.region` |
| **Title** | 113-114 | `Post.H1` | `event.title` |
| **기간** | 116-124 | `View`, `Icon`, `Txt` | `event.periodText` |
| **장소** | 126-136 | `View`, `Icon`, `Txt` | `event.venue` |
| **설명** | 138-148 | `Post.Paragraph` | `event.description` |
| **Overview** | 150-160 | `Post.Paragraph` | `event.overview` (현재 항상 빈 문자열) |
| **주소 정보** | 162-172 | `Icon`, `Txt` | `event.address` (옵셔널) |
| **지도 열기 버튼** | 174-191 | `TossButton` | `event.lat`, `event.lng` |
| **길찾기 버튼** | 193-210 | `TossButton` | `event.lat`, `event.lng` |
| **공유 버튼** | 212-223 | `TossButton` | - |

### 2.3 조건부 렌더링
- **지도 관련 UI (Line 173-211):** `event.lat && event.lng`가 존재할 때만 표시
- **주소 (Line 162-172):** `event.address`가 존재할 때만 표시

---

## 3️⃣ 컴포넌트 트리 (간략)

```
View (Container, Line 91)
├─ View (Header 80px, Line 93)
├─ ScrollView (Line 94)
│  ├─ EventImage (Hero, Line 95-103)
│  ├─ View (Padding container, Line 105)
│  │  ├─ View (Badges, Line 107)
│  │  │  ├─ Badge (category)
│  │  │  └─ Badge (region)
│  │  ├─ Post.H1 (Title, Line 113)
│  │  ├─ View (기간, Line 116)
│  │  │  ├─ Icon (calendar)
│  │  │  └─ Txt (periodText)
│  │  ├─ View (장소, Line 126)
│  │  │  ├─ Icon (map-pin)
│  │  │  └─ Txt (venue)
│  │  ├─ Post.Paragraph (description, Line 138)
│  │  ├─ Post.Paragraph (overview, Line 150)
│  │  ├─ Conditional: event.address (Line 162)
│  │  │  ├─ Icon (map-pin)
│  │  │  └─ Txt (address)
│  │  ├─ Conditional: event.lat && event.lng (Line 173)
│  │  │  ├─ TossButton (지도 열기)
│  │  │  └─ TossButton (길찾기)
│  │  └─ TossButton (공유, Line 212)
```

---

## 4️⃣ 데이터베이스: canonical_events 테이블 전체 컬럼

**테이블:** `canonical_events`
**총 컬럼 수:** 60개

### 4.1 공통 컬럼 (모든 카테고리)

#### 기본 식별/메타데이터
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `id` | uuid | Primary Key |
| `created_at` | timestamp | 생성 시각 |
| `updated_at` | timestamp | 수정 시각 |
| `content_key` | text | KOPIS API 콘텐츠 고유키 |

#### 제목/카테고리
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `title` | text | 원본 제목 |
| `display_title` | text | 표시용 제목 (AI 정제) |
| `main_category` | text | 주 카테고리 (공연/전시/축제/행사/팝업) |
| `sub_category` | text | 하위 카테고리 (연극/뮤지컬/콘서트/전시회/...) |

#### 기간/시간
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `start_at` | date | 시작일 |
| `end_at` | date | 종료일 |
| `is_ending_soon` | boolean | 종료 임박 여부 (7일 이내) |
| `opening_hours` | text | 운영 시간 정보 |

#### 장소/지리
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `venue` | text | 장소명 (극장/갤러리/공원/...) |
| `region` | text | 지역 (서울/경기/부산/...) |
| `address` | text | 상세 주소 |
| `lat` | numeric | 위도 (WGS84) |
| `lng` | numeric | 경도 (WGS84) |

#### 이미지/시각 자료
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `image_url` | text | 대표 이미지 URL |
| `poster_urls` | text[] | 포스터 이미지 배열 (KOPIS) |
| `thumbnail_url` | text | 썸네일 URL |

#### 설명/내용
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `overview` | text | 상세 설명 (AI 생성 또는 KOPIS) |

#### 가격/입장료
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `price_info` | text | 가격 정보 원문 |
| `price_min` | integer | 최저 가격 (원) |
| `price_max` | integer | 최고 가격 (원) |
| `is_free` | boolean | 무료 여부 |

#### 통계/지표
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `view_count` | integer | 조회수 |
| `popularity_score` | numeric | 인기도 점수 (0.0~1.0) |
| `buzz_score` | integer | 핫함 점수 (Hot Score) |

#### 외부 링크
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `external_links` | jsonb | 외부 링크 모음 (공식 사이트/예매 링크/...) |
| `booking_link` | text | 예매 링크 |

#### 데이터 소스/관리
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `source_priority_winner` | text | 우선순위 데이터 소스 (kopis/seoul_api/...) |
| `sources` | jsonb | 수집된 원본 데이터 맵 (key: 소스명, value: 원본 JSON) |
| `manually_edited_fields` | text[] | 수동 수정된 필드 목록 |
| `ai_suggestions` | jsonb | AI 제안 내용 |

#### 상태/플래그
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `is_featured` | boolean | 추천 이벤트 여부 |
| `is_deleted` | boolean | 소프트 삭제 여부 |
| `is_published` | boolean | 게시 여부 |

### 4.2 카테고리별 특수 컬럼

#### 공연 (main_category = '공연')
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `runtime` | text | 러닝타임 (예: "120분") |
| `age_limit` | text | 관람 연령 (예: "8세 이상") |
| `cast` | text | 출연진 |
| `crew` | text | 제작진 |
| `producer` | text | 제작사 |
| `host` | text | 주최 |
| `sponsor` | text | 후원 |
| `schedule` | text | 공연 일정 정보 |
| `intermission` | text | 인터미션 정보 |
| `genre_detail` | text | 장르 상세 (예: "드라마", "코미디") |

#### 전시 (main_category = '전시')
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `artist` | text | 작가/아티스트 |
| `curator` | text | 큐레이터 |
| `organizer` | text | 주관 기관 |
| `art_style` | text | 예술 스타일 |

#### 축제 (main_category = '축제')
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `program` | text | 프로그램 정보 |
| `facilities` | text | 편의시설 정보 |
| `festival_type` | text | 축제 유형 |

#### 행사 (main_category = '행사')
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `organizer` | text | 주관 기관 |
| `participants` | text | 참여자 정보 |
| `registration_info` | text | 등록/신청 정보 |

#### 팝업 (main_category = '팝업')
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `brand` | text | 브랜드명 |
| `theme` | text | 팝업 테마 |
| `reservation_required` | boolean | 사전 예약 필요 여부 |

### 4.3 AI/내부 처리 필드
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `ai_enriched_at` | timestamp | AI 보강 작업 완료 시각 |
| `ai_enrichment_status` | text | AI 처리 상태 (pending/completed/failed) |
| `ai_title_quality` | text | AI 판단 제목 품질 (good/needs_improvement) |
| `should_auto_recommend` | boolean | 자동 추천 대상 여부 |
| `geo_accuracy` | text | 좌표 정확도 (exact/approximate/unknown) |
| `data_completeness_score` | numeric | 데이터 완성도 점수 (0.0~1.0) |

### 4.4 시스템 관리 필드
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| `last_synced_at` | timestamp | 마지막 동기화 시각 |
| `sync_error` | text | 동기화 에러 메시지 |
| `collection_log_id` | bigint | 수집 로그 FK (collection_logs 테이블) |

---

## 5️⃣ API 응답 → 상세 UI 데이터 계약

### 5.1 API 엔드포인트

**엔드포인트:** `GET /events/:id`
**파일:** `backend/src/index.ts:4235-4294`

**요청:**
```
GET http://localhost:5001/events/{eventId}
```

**응답 상태 코드:**
- `200`: 성공 (이벤트 존재, end_at >= CURRENT_DATE)
- `404`: 이벤트 없음 (삭제됨 또는 종료됨)

### 5.2 Backend 응답 JSON 구조

**쿼리:** `canonical_events` 테이블에서 16개 필드 SELECT

```json
{
  "id": "uuid",
  "title": "string",
  "displayTitle": "string | null",
  "contentKey": "string | null",
  "venue": "string (COALESCE fallback '')",
  "startAt": "string (ISO date)",
  "endAt": "string (ISO date)",
  "region": "string",
  "mainCategory": "string",
  "subCategory": "string",
  "imageUrl": "string (COALESCE fallback PLACEHOLDER_IMAGE)",
  "sourcePriorityWinner": "string",
  "sources": "object (jsonb)",
  "address": "string | null",
  "lat": "number | null",
  "lng": "number | null"
}
```

**참고:**
- `PLACEHOLDER_IMAGE = 'https://via.placeholder.com/800x400?text=No+Image'`
- `sources` 필드는 jsonb 타입으로 원본 수집 데이터 포함

### 5.3 Frontend 데이터 매핑

**파일:** `src/services/eventService.ts:411-472`
**함수:** `mapEventResponse(event: EventResponse): EventCardData`

**매핑 테이블:**

| EventCardData 필드 | 소스 | 계산 로직 |
|-------------------|------|----------|
| `id` | `event.id` | 직접 사용 |
| `title` | `event.displayTitle`, `event.title` | `displayTitle?.trim() \|\| title` |
| `displayTitle` | `event.displayTitle`, `event.title` | `displayTitle?.trim() \|\| title` |
| `contentKey` | `event.contentKey` | 직접 사용 |
| `description` | `event.subCategory`, `category` | `subCategory \|\| category` |
| `overview` | - | 하드코딩 `''` (빈 문자열) |
| `mainCategory` | `event.mainCategory` | 직접 사용 |
| `subCategory` | `event.subCategory` | 직접 사용 |
| `venue` | `event.venue` | `venue ?? ''` |
| `periodText` | `event.startAt`, `event.endAt` | `formatPeriodText()` 함수 호출 |
| `startAt` | `event.startAt` | 직접 사용 |
| `endAt` | `event.endAt` | 직접 사용 |
| `tags` | `event.subCategory` | `[subCategory].filter(Boolean)` |
| `thumbnailUrl` | `event.imageUrl` | 직접 사용 |
| `detailImageUrl` | `event.imageUrl` | 직접 사용 |
| `detailLink` | - | 하드코딩 `''` (빈 문자열) |
| `region` | `event.region` | `normalizeRegion()` 함수 호출 |
| `category` | `event.mainCategory`, `event.subCategory` | `resolveCategory()` 함수 호출 |
| `popularityScore` | `event.popularityScore` | 직접 사용 (옵셔널) |
| `isEndingSoon` | `event.isEndingSoon` | 직접 사용 (옵셔널) |
| `isFree` | `event.isFree` | 직접 사용 (옵셔널) |
| `address` | `event.address` | 직접 사용 (옵셔널) |
| `lat` | `event.lat` | 직접 사용 (옵셔널) |
| `lng` | `event.lng` | 직접 사용 (옵셔널) |

**헬퍼 함수:**
1. **`formatPeriodText(startAt, endAt)`:** ISO date → "YYYY.MM.DD - YYYY.MM.DD" 형식
2. **`normalizeRegion(region)`:** 지역명 정규화 (15개 지역값으로 매핑)
3. **`resolveCategory(mainCategory, subCategory)`:** 카테고리 해석 (공연/전시/축제/행사/팝업)

### 5.4 상세 UI에서 접근 가능한 필드

**데이터 인터페이스:** `EventCardData` (src/data/events.ts:24-49)

**실제 사용 현황 (src/pages/events/[id].tsx):**

| 필드 | 사용 위치 | 목적 |
|------|----------|------|
| `detailImageUrl` | Line 95 | Hero 이미지 표시 |
| `category` | Line 108 | 카테고리 뱃지 |
| `region` | Line 109 | 지역 뱃지 |
| `title` | Line 113 | 이벤트 제목 |
| `periodText` | Line 121 | 기간 표시 |
| `venue` | Line 133 | 장소 표시 |
| `description` | Line 143 | 설명 (subCategory 기반) |
| `overview` | Line 155 | 상세 설명 (현재 빈 문자열) |
| `address` | Line 167 | 주소 표시 (옵셔널) |
| `lat`, `lng` | Line 174-210 | 지도 열기/길찾기 버튼 |

**미사용 필드 (현재 UI에서 활용 안 함):**
- `id` (라우팅 파라미터로만 사용)
- `displayTitle` (title과 동일값)
- `contentKey`
- `mainCategory`, `subCategory` (category로 통합됨)
- `startAt`, `endAt` (periodText로 통합됨)
- `tags`
- `thumbnailUrl`
- `detailLink`
- `popularityScore`
- `isEndingSoon`
- `isFree`

---

## 6️⃣ 추가 가능한 데이터 필드

**Database에 존재하지만 API에서 제공하지 않는 필드 (44개):**

### 공통 추가 가능 필드
- `overview` (상세 설명 - 현재 API에서 반환 안 함)
- `poster_urls` (포스터 이미지 배열)
- `thumbnail_url`
- `price_info`, `price_min`, `price_max`, `is_free` (가격 정보)
- `view_count`, `popularity_score`, `buzz_score` (통계)
- `opening_hours` (운영 시간)
- `booking_link` (예매 링크)
- `external_links` (외부 링크 jsonb)
- `is_ending_soon` (종료 임박 여부)
- `is_featured` (추천 이벤트 여부)

### 카테고리별 추가 가능 필드
**공연:**
- `runtime`, `age_limit`, `cast`, `crew`, `producer`, `host`, `sponsor`, `schedule`, `intermission`, `genre_detail`

**전시:**
- `artist`, `curator`, `organizer`, `art_style`

**축제:**
- `program`, `facilities`, `festival_type`

**행사:**
- `organizer`, `participants`, `registration_info`

**팝업:**
- `brand`, `theme`, `reservation_required`

### AI/관리 필드
- `ai_suggestions`, `ai_enrichment_status`, `ai_title_quality`
- `should_auto_recommend`, `geo_accuracy`, `data_completeness_score`
- `manually_edited_fields`

---

## 7️⃣ 데이터 계약 요약

### 현재 계약 (GET /events/:id → EventCardData)

**Backend 제공 필드:** 16개
**Frontend 매핑 필드:** 24개 (일부 계산/변환 필드 포함)
**UI 실제 사용 필드:** 11개

### 확장 가능한 계약

**Database 보유 컬럼:** 60개
**현재 미제공 컬럼:** 44개

**확장 시 고려사항:**
1. 가격 정보 (`price_info`, `price_min`, `price_max`, `is_free`)
2. 상세 설명 (`overview`)
3. 카테고리별 특수 필드 (공연: `cast`, 전시: `artist`, 등)
4. 외부 링크 (`booking_link`, `external_links`)
5. 통계 지표 (`buzz_score`, `view_count`)
6. 운영 정보 (`opening_hours`)
7. 포스터 이미지 (`poster_urls`)

---

**문서 생성 시각:** 2026-02-10
**문서 버전:** 1.0
**검증 방법:** Repo-verified (모든 파일 경로, 라인 번호, 필드명 확인 완료)
