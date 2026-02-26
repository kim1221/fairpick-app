# Admin API Reference

> **Fairpick Backend Admin API 완전 참조 문서**
> 
> 모든 Admin API 엔드포인트의 Request/Response 스키마, 인증, Side Effects 문서화

**Version**: 1.0  
**Last Updated**: 2026-02-09  
**Base URL**: `http://localhost:5001` (개발), `https://api.fairpick.com` (프로덕션, 추정)

---

## 📚 Table of Contents

1. [개요](#개요)
2. [공통 규칙](#공통-규칙)
3. [엔드포인트 카테고리](#엔드포인트-카테고리)
4. [전체 엔드포인트 인덱스](#전체-엔드포인트-인덱스)
5. [고위험 엔드포인트](#고위험-엔드포인트)
6. [Source of Truth](#source-of-truth)

---

## 개요

### 인증 방식

**모든 Admin API는 `x-admin-key` 헤더 인증 필요** (단, `/admin/verify`, `/admin/metrics` 제외)

#### 인증 미들웨어: `requireAdminAuth`

```typescript
function requireAdminAuth(req, res, next) {
  const adminKey = req.headers['x-admin-key'] as string;
  const expectedKey = process.env.ADMIN_KEY || 'fairpick-admin-2024';
  
  if (!adminKey || adminKey !== expectedKey) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  
  next();
}
```

#### 환경 변수
- **Key**: `process.env.ADMIN_KEY`
- **기본값**: `'fairpick-admin-2024'`

#### 실패 응답
- **HTTP Status**: `401 Unauthorized`
- **Body**:
  ```json
  {
    "success": false,
    "message": "Unauthorized"
  }
  ```

---

## 공통 규칙

### Pagination (이벤트 목록)

**Query Parameters**:
- `page` (number, 기본값: `1`) - 페이지 번호 (1-based)
- `size` (number, 기본값: `20`) - 페이지 크기

**Response**:
```json
{
  "items": [...],
  "total": 100,
  "page": 1,
  "size": 20
}
```

### Filtering (이벤트 목록)

**Query Parameters**:
- `q` (string) - 제목 검색 (ILIKE)
- `category` (string) - 메인 카테고리 필터
- `isFeatured` (boolean) - Featured 여부
- `hasImage` (boolean) - 실제 이미지 존재 여부
- `isDeleted` (boolean) - 삭제 여부
- `recentlyCollected` (enum: `'24h'`, `'7d'`, `'30d'`) - 최근 수집 필터

### Error Format

**5xx Errors**:
```json
{
  "message": "Failed to ...",
  "error": "Error details (optional)"
}
```

**4xx Errors**:
```json
{
  "error": "Error description",
  "message": "User-friendly message (optional)"
}
```

---

## 엔드포인트 카테고리

### 1. Auth

#### POST /admin/verify

**Purpose**: Admin Key 검증

**Auth**: **인증 미들웨어 없음** (직접 검증)

**Request**:
- **Headers**:
  - `x-admin-key` (required): Admin API Key

**Response**:
- **Success (200)**:
  ```json
  {
    "valid": true
  }
  ```
- **Failure (401)**:
  ```json
  {
    "valid": false
  }
  ```

**Side Effects**: 없음

**Key Functions**: 없음

---

### 2. Events CRUD

#### GET /admin/events

**Purpose**: 이벤트 목록 조회 (페이징, 필터링)

**Auth**: `requireAdminAuth`

**Request**:
- **Headers**:
  - `x-admin-key` (required)
- **Query**:
  - `page` (number, optional, default: `1`)
  - `size` (number, optional, default: `20`)
  - `q` (string, optional) - 제목 검색
  - `category` (string, optional) - 메인 카테고리
  - `isFeatured` (boolean, optional)
  - `hasImage` (boolean, optional)
  - `isDeleted` (boolean, optional)
  - `recentlyCollected` (enum, optional: `'24h'` | `'7d'` | `'30d'`)

**Response**:
- **Success (200)**:
  ```json
  {
    "items": [
      {
        "id": "uuid",
        "title": "string",
        "main_category": "string",
        "start_at_str": "YYYY-MM-DD",
        "end_at_str": "YYYY-MM-DD",
        "image_url": "string",
        "is_featured": boolean,
        "is_deleted": boolean,
        "created_at": "timestamp",
        "updated_at": "timestamp"
      }
    ],
    "total": number,
    "page": number,
    "size": number
  }
  ```
- **Failure (500)**:
  ```json
  {
    "message": "Failed to load events"
  }
  ```

**Side Effects**:
- DB SELECT (`canonical_events`)

**Key Functions**: 없음 (직접 쿼리)

---

#### GET /admin/events/:id

**Purpose**: 이벤트 상세 조회

**Auth**: `requireAdminAuth`

**Request**:
- **Headers**:
  - `x-admin-key` (required)
- **Params**:
  - `id` (uuid, required)

**Response**:
- **Success (200)**:
  ```json
  {
    "id": "uuid",
    "title": "string",
    "main_category": "string",
    "sub_category": "string",
    "start_at": "date",
    "end_at": "date",
    "start_at_str": "YYYY-MM-DD",
    "end_at_str": "YYYY-MM-DD",
    "venue": "string",
    "address": "string",
    "image_url": "string",
    "overview": "string",
    "overview_raw": "string",
    "derived_tags": "jsonb",
    "opening_hours": "jsonb",
    "external_links": "jsonb",
    "price_min": number,
    "price_max": number,
    "is_featured": boolean,
    "is_deleted": boolean,
    "ai_suggestions": "jsonb",
    "manually_edited_fields": "jsonb",
    "field_sources": "jsonb",
    "metadata": "jsonb"
  }
  ```
- **Failure (404)**:
  ```json
  {
    "message": "Event not found"
  }
  ```
- **Failure (500)**:
  ```json
  {
    "message": "Failed to load event"
  }
  ```

**Side Effects**:
- DB SELECT (`canonical_events`)

**Key Functions**: 없음

---

#### PATCH /admin/events/:id

**Purpose**: 이벤트 수정 + 수동 편집 필드 자동 마킹

**Auth**: `requireAdminAuth`

**Request**:
- **Headers**:
  - `x-admin-key` (required)
- **Params**:
  - `id` (uuid, required)
- **Body** (모든 필드 optional):
  ```json
  {
    "title": "string",
    "display_title": "string",
    "main_category": "string",
    "sub_category": "string",
    "start_at": "YYYY-MM-DD",
    "end_at": "YYYY-MM-DD",
    "venue": "string",
    "address": "string",
    "lat": number,
    "lng": number,
    "image_url": "string",
    "overview": "string",
    "overview_raw": "string",
    "derived_tags": ["string"],
    "opening_hours": {
      "weekday": "string",
      "weekend": "string",
      "closed": "string",
      "notes": "string"
    },
    "external_links": {
      "official": "string",
      "ticket": "string",
      "reservation": "string"
    },
    "price_min": number,
    "price_max": number,
    "price_info": "string",
    "is_free": boolean,
    "is_featured": boolean,
    "is_deleted": boolean
  }
  ```

**Response**:
- **Success (200)**:
  ```json
  {
    "success": true,
    "item": { /* updated event */ }
  }
  ```
- **Failure (404)**:
  ```json
  {
    "message": "Event not found"
  }
  ```
- **Failure (500)**:
  ```json
  {
    "message": "Failed to update event",
    "error": "string"
  }
  ```

**Side Effects**:
- **DB UPDATE** (`canonical_events`)
  - 변경된 필드 → `manually_edited_fields` JSONB에 자동 마킹
  - `updated_at` 갱신
- **Async**: `enrichSingleEvent(eventId)` 호출 (위경도 변경 시)

**Key Functions**:
- `enrichSingleEvent()` (비동기, 응답 속도 유지)

**Notes**:
- 수동 편집된 필드는 이후 AI Enrichment에서 보호됨
- 위경도 변경 시 Phase 2 recalculation 트리거

---

#### POST /admin/events

**Purpose**: 범용 이벤트 생성 (수동 입력)

**Auth**: `requireAdminAuth`

**Request**:
- **Headers**:
  - `x-admin-key` (required)
- **Body**:
  ```json
  {
    "main_category": "string (required)",
    "title": "string (required)",
    "start_at": "YYYY-MM-DD (required)",
    "end_at": "YYYY-MM-DD (required)",
    "venue": "string (required)",
    "display_title": "string (optional)",
    "address": "string (optional)",
    "image_url": "string (optional)",
    "overview": "string (optional)",
    "is_free": boolean (optional, default: true),
    "price_info": "string (optional, default: '입장 무료')",
    "image_storage": "string (optional: 'cdn' | 'external')",
    "image_origin": "string (optional)",
    "image_source_page_url": "string (optional)",
    "image_key": "string (optional)",
    "image_metadata": "object (optional)",
    "external_links": "object (optional)",
    "price_min": number (optional),
    "price_max": number (optional),
    "source_tags": "string[] (optional)",
    "derived_tags": "string[] (optional)",
    "opening_hours": "object (optional)"
  }
  ```

**Response**:
- **Success (200)**:
  ```json
  {
    "success": true,
    "message": "이벤트가 생성되었습니다",
    "id": "uuid",
    "item": { /* created event */ }
  }
  ```
- **Failure (400)**:
  ```json
  {
    "message": "Missing required field: ..."
  }
  ```
  ```json
  {
    "message": "Invalid date format. Required: YYYY-MM-DD",
    "provided": { "start_at": "...", "end_at": "..." }
  }
  ```
- **Failure (500)**:
  ```json
  {
    "message": "Failed to create event"
  }
  ```

**Side Effects**:
- **DB INSERT** (`canonical_events`)
- **Kakao Geocoding API** (주소 → 위경도)
- **Async**: `enrichSingleEvent(eventId)` 호출

**Key Functions**:
- `geocodeBestEffort()` (Kakao API)
- `enrichSingleEvent()` (비동기)

**Notes**:
- `content_key` 자동 생성 (SHA-256 해시)
- `status` 자동 계산 (`scheduled` | `ongoing` | `ended`)
- `is_ending_soon` 자동 계산 (종료일 7일 이내)
- Instagram CDN URL 차단 (24시간 만료 방지)

---

#### POST /admin/events/popup

**Purpose**: 팝업 이벤트 생성 (특화)

**Auth**: `requireAdminAuth`

**Request**:
- **Headers**:
  - `x-admin-key` (required)
- **Body**:
  ```json
  {
    "title": "string (required)",
    "displayTitle": "string (optional)",
    "startAt": "YYYY-MM-DD (required)",
    "endAt": "YYYY-MM-DD (required)",
    "venue": "string (required)",
    "address": "string (optional)",
    "imageUrl": "string (optional)",
    "overview": "string (optional)",
    "instagramUrl": "string (optional)",
    "imageStorage": "string (optional)",
    "imageOrigin": "string (optional)",
    "imageSourcePageUrl": "string (optional)",
    "imageKey": "string (optional)",
    "imageMetadata": "object (optional)"
  }
  ```

**Response**:
- **Success (200)**:
  ```json
  {
    "success": true,
    "message": "팝업 이벤트가 생성되었습니다",
    "id": "uuid"
  }
  ```
- **Failure (400)**:
  ```json
  {
    "message": "⚠️ Instagram CDN URL(scontent)은 24시간 후 만료됩니다. 이미지를 직접 업로드해주세요.",
    "code": "INSTAGRAM_CDN_NOT_ALLOWED"
  }
  ```
- **Failure (500)**:
  ```json
  {
    "message": "Failed to create popup event"
  }
  ```

**Side Effects**:
- **DB INSERT** (`canonical_events`)
- **Kakao Geocoding API**
- **Async**: `enrichSingleEvent(eventId)`

**Key Functions**:
- `geocodeBestEffort()`
- `enrichSingleEvent()`

**Notes**:
- `main_category` 고정: `'팝업'`
- Instagram CDN URL 차단 (`scontent`, `cdninstagram`)

---

### 3. AI Enrichment & Suggestions

#### POST /admin/events/enrich-preview

**Purpose**: 이벤트 생성 전 AI 자동 채우기 (CreateEventPage용)

**Auth**: `requireAdminAuth`

**Request**:
- **Headers**:
  - `x-admin-key` (required)
- **Body**:
  ```json
  {
    "title": "string (required)",
    "venue": "string (optional)",
    "main_category": "string (optional)",
    "overview": "string (optional)",
    "start_at": "YYYY-MM-DD (optional)",
    "end_at": "YYYY-MM-DD (optional)",
    "aiOnly": boolean (optional, default: false),
    "selectedFields": ["string"] (optional, aiOnly=true일 때만 사용)
  }
  ```

**분기 1: `aiOnly=true && selectedFields` 존재**

**Flow**:
1. `extractEventInfoEnhanced()` - Google Search Grounding (네이버 검색 건너뛰기)
2. `validateExtractedData()` - 과거 연도 URL 제거
3. `buildSuggestionsFromAI()` - AI 결과를 제안으로 변환

**Response (aiOnly=true 성공)**:
```json
{
  "success": true,
  "message": "✅ AI로 ${count}개 제안 생성 완료",
  "suggestions": {
    "field_name": {
      "value": "...",
      "confidence": number,
      "source": "string",
      "sourceDetail": "string"
    }
  }
}
```

**Response (aiOnly=true 실패)**:
```json
{
  "success": false,
  "message": "AI 분석에 실패했습니다."
}
```

**분기 2: `aiOnly=false` (기본)**

**Flow**:
1. `searchEventInfoEnhanced()` - 네이버 검색 (블로그/웹/플레이스)
2. `filterSearchResults()` - 방어 필터링
3. `scoreSearchResults()` - 스코어링
4. `capResultsByDomain()` - 도메인별 제한
5. `groupResultsBySection()` - 섹션별 그룹화
6. `extractEventInfoEnhanced()` - AI 정보 추출
7. `validateExtractedData()` - 검증
8. `buildSuggestionsFromAI()` - 제안 변환

**Response (aiOnly=false 성공)**:
```json
{
  "success": true,
  "message": "✅ ${count}개 제안 생성 완료",
  "suggestions": { /* ... */ },
  "rawCount": number,
  "filteredCount": number,
  "scoredCount": number,
  "cappedCount": number
}
```

**Response (aiOnly=false 실패, 검색 결과 없음)**:
```json
{
  "success": false,
  "message": "검색 결과가 없습니다.",
  "enriched": null
}
```

**Side Effects**:
- **Naver API** (블로그/웹/플레이스 검색, aiOnly=false일 때만)
- **Google Gemini AI** (정보 추출)

**Key Functions**:
- `extractEventInfoEnhanced()`
- `validateExtractedData()`
- `buildSuggestionsFromAI()`
- `searchEventInfoEnhanced()` (aiOnly=false일 때만)
- `filterSearchResults()`
- `scoreSearchResults()`
- `capResultsByDomain()`
- `groupResultsBySection()`

**Notes**:
- `aiOnly=true`: 비용 절감, 네이버 API Rate Limit 회피
- 과거 연도 URL 자동 제거 (티켓/예약 링크)

---

#### POST /admin/events/:id/enrich

**Purpose**: 기존 이벤트 AI 재생성

**Auth**: `requireAdminAuth`

**Request**:
- **Headers**:
  - `x-admin-key` (required)
- **Params**:
  - `id` (uuid, required)
- **Body**:
  ```json
  {
    "forceFields": ["string"] (optional, default: []),
    "aiOnly": boolean (optional, default: false)
  }
  ```
  - `forceFields=[]`: 빈 필드만 채우기
  - `forceFields=['overview', 'derived_tags']`: 선택한 필드만 재생성
  - `forceFields=['*']`: 모든 필드 강제 재생성

**Response**:
- **Success (200)**:
  ```json
  {
    "success": true,
    "message": "AI enrichment completed",
    "updated": { /* event */ }
  }
  ```
- **Failure (404)**:
  ```json
  {
    "error": "Event not found"
  }
  ```
- **Failure (500)**:
  ```json
  {
    "error": "AI enrichment failed",
    "message": "string"
  }
  ```

**Side Effects**:
- **DB UPDATE** (`canonical_events`)
- **Naver API** (aiOnly=false일 때)
- **Google Gemini AI**

**Key Functions**:
- `searchEventInfo()` (aiOnly=false일 때)
- `extractEventInfo()`
- Manual Edit Protection 로직 (enrichmentPolicy)

**Notes**:
- `forceFields`에 포함된 필드는 `manually_edited_fields` 무시
- `aiOnly=true`: 네이버 검색 건너뛰기

---

#### POST /admin/events/:id/enrich-ai-direct

**Purpose**: AI만으로 필드 보완 (네이버 검색 없이)

**Auth**: `requireAdminAuth`

**Request**:
- **Headers**:
  - `x-admin-key` (required)
- **Params**:
  - `id` (uuid, required)
- **Body**:
  ```json
  {
    "selectedFields": ["string"] (optional, default: [])
  }
  ```

**Response**:
- **Success (200)**:
  ```json
  {
    "success": true,
    "message": "✅ ${count}개의 AI 제안이 생성되었습니다.\n\n아래 \"AI 제안\" 섹션에서 확인하세요.",
    "suggestions": {
      "field_name": {
        "value": "...",
        "confidence": number,
        "source": "string"
      }
    },
    "sources": ["string"]
  }
  ```
- **Failure (404)**:
  ```json
  {
    "error": "Event not found"
  }
  ```
- **Failure (500)**:
  ```json
  {
    "success": false,
    "error": "AI 분석 중 오류가 발생했습니다.",
    "message": "string"
  }
  ```

**Side Effects**:
- **DB UPDATE** (`canonical_events.ai_suggestions`)
- **Google Gemini AI**

**Key Functions**:
- `extractEventInfoEnhanced()`
- `buildSuggestionsFromAIDirect()`

**Notes**:
- 네이버 검색 없이 Google Search Grounding만 사용
- 비용 절감, Rate Limit 회피

---

#### POST /admin/events/:id/apply-suggestion

**Purpose**: AI 제안을 실제 필드에 적용

**Auth**: `requireAdminAuth`

**Request**:
- **Headers**:
  - `x-admin-key` (required)
- **Params**:
  - `id` (uuid, required)
- **Body**:
  ```json
  {
    "fieldName": "string (required)"
  }
  ```
  - 예: `"overview"`, `"derived_tags"`, `"external_links.ticket"`, `"metadata.display.exhibition.artists"`

**Response**:
- **Success (200)**:
  ```json
  {
    "success": true,
    "message": "제안이 적용되었습니다.",
    "updated": { /* event */ }
  }
  ```
- **Failure (400)**:
  ```json
  {
    "error": "fieldName is required"
  }
  ```
  ```json
  {
    "error": "Unsupported field: ${fieldName}"
  }
  ```
- **Failure (404)**:
  ```json
  {
    "error": "Event not found"
  }
  ```
  ```json
  {
    "error": "No suggestion found for field: ${fieldName}"
  }
  ```
- **Failure (500)**:
  ```json
  {
    "error": "제안 적용 중 오류가 발생했습니다.",
    "message": "string"
  }
  ```

**Side Effects**:
- **DB UPDATE** (`canonical_events`)
  - 해당 필드에 값 적용
  - `ai_suggestions`에서 제안 제거
  - `field_sources` 업데이트 (출처 기록)
  - `manually_edited_fields`에서 제거 (AI 제안 적용이므로)
  - `updated_at` 갱신

**Key Functions**: 없음

**Notes**:
- 지원 필드: `overview`, `overview_raw`, `start_at`, `end_at`, `venue`, `address`, `price_min`, `price_max`, `derived_tags`, `opening_hours`, `external_links.*`, `metadata.display.*`
- 적용 후 해당 필드는 더 이상 수동 편집으로 마킹되지 않음

---

#### POST /admin/events/:id/dismiss-suggestion

**Purpose**: AI 제안 무시/삭제

**Auth**: `requireAdminAuth`

**Request**:
- **Headers**:
  - `x-admin-key` (required)
- **Params**:
  - `id` (uuid, required)
- **Body**:
  ```json
  {
    "fieldName": "string (required)"
  }
  ```

**Response**:
- **Success (200)**:
  ```json
  {
    "success": true,
    "message": "제안이 무시되었습니다."
  }
  ```
- **Failure (400)**:
  ```json
  {
    "error": "fieldName is required"
  }
  ```
- **Failure (404)**:
  ```json
  {
    "error": "Event not found"
  }
  ```
  ```json
  {
    "error": "No suggestion found for field: ${fieldName}"
  }
  ```
- **Failure (500)**:
  ```json
  {
    "error": "제안 무시 중 오류가 발생했습니다.",
    "message": "string"
  }
  ```

**Side Effects**:
- **DB UPDATE** (`canonical_events.ai_suggestions`)
  - 해당 제안만 제거
  - `updated_at` 갱신

**Key Functions**: 없음

---

### 4. Image Upload & DMCA

#### POST /admin/uploads/image

**Purpose**: 이미지 업로드 (S3/R2)

**Auth**: `requireAdminAuth` + `uploadLimiter` (Rate Limit)

**Request**:
- **Headers**:
  - `x-admin-key` (required)
  - `Content-Type: multipart/form-data`
- **Body** (multipart):
  - `image` (file, required) - 최대 5MB, 이미지 파일만

**Response**:
- **Success (200)**:
  ```json
  {
    "success": true,
    "url": "string (CDN URL)",
    "key": "string (S3 key)",
    "size": number (bytes),
    "width": number,
    "height": number,
    "format": "string (jpeg/png/webp)"
  }
  ```
- **Failure (400)**:
  ```json
  {
    "success": false,
    "error": "파일이 업로드되지 않았습니다",
    "code": "NO_FILE"
  }
  ```
- **Failure (500)**:
  ```json
  {
    "success": false,
    "error": "CDN 설정이 올바르지 않습니다",
    "details": ["string"]
  }
  ```
  ```json
  {
    "success": false,
    "error": "이미지 업로드에 실패했습니다",
    "code": "UPLOAD_FAIL"
  }
  ```

**Side Effects**:
- **S3/R2 업로드** (이미지 최적화 포함)
- S3 설정 환경 변수 필요: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET`

**Key Functions**:
- `validateS3Config()`
- `uploadEventImage()`

**Notes**:
- Rate Limit 적용 (`uploadLimiter`)
- 이미지 최적화 (크기 조정, 포맷 변환)
- 중복 체크 skip (MVP)

---

#### POST /admin/dmca/approve

**Purpose**: DMCA Takedown 승인 (이미지 삭제)

**Auth**: `requireAdminAuth`

**Request**:
- **Headers**:
  - `x-admin-key` (required)
- **Body**:
  ```json
  {
    "reportId": "number (optional)",
    "eventId": "uuid (required)",
    "adminNote": "string (optional)"
  }
  ```

**Response**:
- **Success (200)**:
  ```json
  {
    "success": true,
    "message": "이미지가 삭제되었습니다",
    "eventId": "uuid",
    "removedImageUrl": "string"
  }
  ```
- **Failure (400)**:
  ```json
  {
    "error": "eventId는 필수입니다"
  }
  ```
- **Failure (404)**:
  ```json
  {
    "error": "이벤트를 찾을 수 없습니다"
  }
  ```
- **Failure (500)**:
  ```json
  {
    "error": "삭제 처리에 실패했습니다"
  }
  ```

**Side Effects**:
- **DB UPDATE** (`canonical_events`)
  - `image_url`, `image_key` → NULL
  - `image_metadata.dmca_takedown` 기록
- **DB INSERT/UPDATE** (`image_audit_log`)
- **S3/R2 삭제** (CDN 이미지인 경우)

**Key Functions**:
- `deleteEventImage()`

**Notes**:
- `reportId` 없이 직접 삭제 가능 (Admin 직접 발견 케이스)
- CDN 삭제 실패해도 DB는 처리됨

---

### 5. Hot Suggestions

#### GET /admin/hot-suggestions

**Purpose**: Hot Discovery로 발굴된 이벤트 후보 목록 조회

**Auth**: `requireAdminAuth`

**Request**:
- **Headers**:
  - `x-admin-key` (required)
- **Query**:
  - `status` (string, optional: `'pending'` | `'approved'` | `'rejected'`)

**Response**:
- **Success (200)**:
  ```json
  {
    "items": [
      {
        "id": "uuid",
        "title": "string",
        "venue": "string",
        "region": "string",
        "link": "string",
        "description": "string",
        "source": "string (blog/web/cafe)",
        "candidate_score": number,
        "evidence_links": ["string"],
        "evidence_count": number,
        "status": "string",
        "metadata": "jsonb",
        "created_at": "timestamp",
        "reviewed_at": "timestamp",
        "reviewed_by": "string"
      }
    ]
  }
  ```
- **Failure (500)**:
  ```json
  {
    "error": "Failed to fetch hot suggestions"
  }
  ```

**Side Effects**:
- DB SELECT (`admin_hot_suggestions`)

**Key Functions**: 없음

---

#### POST /admin/hot-suggestions/:id/approve

**Purpose**: Hot Suggestion 승인 → canonical_events 생성

**Auth**: `requireAdminAuth`

**Request**:
- **Headers**:
  - `x-admin-key` (required)
- **Params**:
  - `id` (uuid, required)
- **Body**:
  ```json
  {
    "title": "string (required)",
    "venue": "string (required)",
    "address": "string (optional)",
    "main_category": "string (required)",
    "start_at": "YYYY-MM-DD (required)",
    "end_at": "YYYY-MM-DD (required)",
    "overview": "string (optional)",
    "image_url": "string (optional)"
  }
  ```

**Response**:
- **Success (200)**:
  ```json
  {
    "success": true,
    "message": "이벤트가 생성되었습니다.",
    "event_id": "uuid"
  }
  ```
- **Failure (400)**:
  ```json
  {
    "error": "Missing required fields: ..."
  }
  ```
- **Failure (404)**:
  ```json
  {
    "error": "Hot Suggestion을 찾을 수 없습니다."
  }
  ```
- **Failure (500)**:
  ```json
  {
    "success": false,
    "error": "Hot Suggestion 승인 중 오류가 발생했습니다.",
    "message": "string"
  }
  ```

**Side Effects**:
- **DB INSERT** (`canonical_events`)
- **DB UPDATE** (`admin_hot_suggestions.status = 'approved'`)
- **Kakao Geocoding API**
- **Async**: Light Buzz Score 계산 (Consensus + Structural)

**Key Functions**:
- `geocodeBestEffort()`
- `calculateConsensusLight()`
- `calculateStructuralScore()`

**Notes**:
- Hot Suggestion 메타데이터가 이벤트에 포함됨
- Light Buzz Score 자동 계산 (비동기)

---

#### POST /admin/hot-suggestions/:id/reject

**Purpose**: Hot Suggestion 거부

**Auth**: `requireAdminAuth`

**Request**:
- **Headers**:
  - `x-admin-key` (required)
- **Params**:
  - `id` (uuid, required)

**Response**:
- **Success (200)**:
  ```json
  {
    "success": true,
    "message": "Hot Suggestion이 거부되었습니다."
  }
  ```
- **Failure (404)**:
  ```json
  {
    "error": "Hot Suggestion을 찾을 수 없습니다."
  }
  ```
- **Failure (500)**:
  ```json
  {
    "success": false,
    "error": "Hot Suggestion 거부 중 오류가 발생했습니다.",
    "message": "string"
  }
  ```

**Side Effects**:
- **DB UPDATE** (`admin_hot_suggestions.status = 'rejected'`)

**Key Functions**: 없음

---

#### POST /admin/hot-suggestions/:id/approve-simple

**Purpose**: Hot Suggestion 간단 승인 (이벤트 생성 완료 후 status만 업데이트)

**Auth**: `requireAdminAuth`

**Request**:
- **Headers**:
  - `x-admin-key` (required)
- **Params**:
  - `id` (uuid, required)

**Response**:
- **Success (200)**:
  ```json
  {
    "success": true,
    "message": "승인되었습니다."
  }
  ```
- **Failure (404)**:
  ```json
  {
    "error": "Hot Suggestion을 찾을 수 없습니다."
  }
  ```
- **Failure (500)**:
  ```json
  {
    "error": "string"
  }
  ```

**Side Effects**:
- **DB UPDATE** (`admin_hot_suggestions.status = 'approved'`)

**Key Functions**: 없음

**Notes**:
- 이벤트 생성은 별도로 수행해야 함
- Status 업데이트만 수행

---

### 6. Dashboard & Stats

#### GET /admin/dashboard

**Purpose**: 대시보드 통계 조회

**Auth**: `requireAdminAuth`

**Request**:
- **Headers**:
  - `x-admin-key` (required)

**Response**:
- **Success (200)**:
  ```json
  {
    "totalEvents": number,
    "featuredCount": number,
    "recentUpdatedCount": number (24시간 이내),
    "recentNewCount": number (24시간 이내),
    "recentLogs": [
      {
        "id": number,
        "source": "string",
        "type": "string",
        "status": "string",
        "started_at": "timestamp",
        "completed_at": "timestamp",
        "items_count": number,
        "success_count": number,
        "failed_count": number
      }
    ]
  }
  ```
- **Failure (500)**:
  ```json
  {
    "message": "Failed to load dashboard"
  }
  ```

**Side Effects**:
- DB SELECT (`canonical_events`, `collection_logs`)

**Key Functions**: 없음

---

#### GET /admin/image-stats

**Purpose**: 이미지 통계 조회 (디버깅용)

**Auth**: `requireAdminAuth`

**Request**:
- **Headers**:
  - `x-admin-key` (required)

**Response**:
- **Success (200)**:
  ```json
  {
    "stats": {
      "total": number,
      "null_images": number,
      "placeholder_images": number,
      "real_images": number
    },
    "placeholderSamples": [
      {
        "id": "uuid",
        "title": "string",
        "image_url": "string",
        "main_category": "string"
      }
    ],
    "realImageSamples": [...]
  }
  ```
- **Failure (500)**:
  ```json
  {
    "error": "Failed to get image stats"
  }
  ```

**Side Effects**:
- DB SELECT (`canonical_events`)

**Key Functions**: 없음

---

#### GET /admin/metrics

**Purpose**: 최근 수집 로그 조회

**Auth**: **인증 미들웨어 없음**

**Request**: 없음

**Response**:
- **Success (200)**:
  ```json
  {
    "lastCollection": {
      "source": "string",
      "type": "string",
      "status": "string",
      "startedAt": "timestamp",
      "completedAt": "timestamp"
    }
  }
  ```
  - `lastCollection`이 없으면 `null`
- **Failure (500)**:
  ```json
  {
    "message": "Failed to load admin metrics."
  }
  ```

**Side Effects**:
- DB SELECT (`collection_logs`)

**Key Functions**: 없음

---

## 전체 엔드포인트 인덱스

| Method | Path | Auth | Brief |
|--------|------|------|-------|
| **POST** | `/admin/verify` | ❌ None | Admin Key 검증 |
| **GET** | `/admin/dashboard` | ✅ Required | 대시보드 통계 |
| **GET** | `/admin/image-stats` | ✅ Required | 이미지 통계 (디버깅) |
| **GET** | `/admin/metrics` | ❌ None | 최근 수집 로그 |
| **GET** | `/admin/events` | ✅ Required | 이벤트 목록 (페이징/필터) |
| **GET** | `/admin/events/:id` | ✅ Required | 이벤트 상세 조회 |
| **PATCH** | `/admin/events/:id` | ✅ Required | 이벤트 수정 + 수동 편집 마킹 |
| **POST** | `/admin/events` | ✅ Required | 범용 이벤트 생성 |
| **POST** | `/admin/events/popup` | ✅ Required | 팝업 이벤트 생성 |
| **POST** | `/admin/events/enrich-preview` | ✅ Required | 이벤트 생성 전 AI 자동 채우기 |
| **POST** | `/admin/events/:id/enrich` | ✅ Required | 기존 이벤트 AI 재생성 |
| **POST** | `/admin/events/:id/enrich-ai-direct` | ✅ Required | AI만으로 필드 보완 |
| **POST** | `/admin/events/:id/apply-suggestion` | ✅ Required | AI 제안 적용 |
| **POST** | `/admin/events/:id/dismiss-suggestion` | ✅ Required | AI 제안 무시 |
| **POST** | `/admin/uploads/image` | ✅ Required + Rate Limit | 이미지 업로드 (S3) |
| **POST** | `/admin/dmca/approve` | ✅ Required | DMCA Takedown 승인 |
| **GET** | `/admin/hot-suggestions` | ✅ Required | Hot Suggestions 목록 |
| **POST** | `/admin/hot-suggestions/:id/approve` | ✅ Required | Hot Suggestion 승인 → 이벤트 생성 |
| **POST** | `/admin/hot-suggestions/:id/reject` | ✅ Required | Hot Suggestion 거부 |
| **POST** | `/admin/hot-suggestions/:id/approve-simple` | ✅ Required | Hot Suggestion 간단 승인 |

**총 20개 엔드포인트**

---

## 고위험 엔드포인트

다음 엔드포인트는 **DB 대량 변경** 또는 **외부 API 대량 호출** 가능성이 있어 주의 필요:

### 🔴 HIGH Risk

| Endpoint | Risk Reason | Mitigation |
|----------|-------------|------------|
| `POST /admin/events/:id/enrich` | Gemini AI 호출 (비용), 네이버 API 호출 (Rate Limit) | `aiOnly=true` 옵션 사용, `forceFields` 최소화 |
| `POST /admin/events/enrich-preview` | 동일 (AI + Naver API) | `aiOnly=true` 옵션 사용 |
| `POST /admin/events/:id/enrich-ai-direct` | Gemini AI 호출 (비용) | `selectedFields` 최소화 |
| `POST /admin/hot-suggestions/:id/approve` | DB INSERT + Geocoding API + Async Buzz Score 계산 | 단일 이벤트만 생성, 비동기 안전 |

### 🟡 MEDIUM Risk

| Endpoint | Risk Reason | Mitigation |
|----------|-------------|------------|
| `PATCH /admin/events/:id` | DB UPDATE + Async Phase 2 recalculation | 단일 이벤트만 수정, 비동기 안전 |
| `POST /admin/events` | DB INSERT + Geocoding API + Async enrichment | 단일 이벤트만 생성, 비동기 안전 |
| `POST /admin/events/popup` | 동일 | 동일 |
| `POST /admin/dmca/approve` | DB UPDATE + S3 삭제 | 단일 이미지만 삭제 |

### 🟢 LOW Risk

- 모든 GET 엔드포인트 (Read-only)
- `POST /admin/verify`
- `POST /admin/events/:id/apply-suggestion` (단일 필드 업데이트)
- `POST /admin/events/:id/dismiss-suggestion` (단일 제안 제거)
- `POST /admin/hot-suggestions/:id/reject` (Status 업데이트만)
- `POST /admin/hot-suggestions/:id/approve-simple` (Status 업데이트만)

---

## Source of Truth

이 문서는 다음 파일을 기반으로 작성되었습니다:

### Backend Source Code
- **`backend/src/index.ts`** (Lines 1-6014) - 모든 Admin API 라우트 정의
- **`backend/src/db.ts`** - PostgreSQL 연결 풀, 테이블 스키마
- **`backend/src/config.ts`** - 환경 변수 정의

### Libraries
- **`backend/src/lib/aiExtractor.ts`** - Google Gemini AI 정보 추출
- **`backend/src/lib/naverApi.ts`** - 네이버 검색 API 클라이언트
- **`backend/src/lib/searchScoring.ts`** - 검색 결과 스코어링/필터링
- **`backend/src/lib/suggestionBuilder.ts`** - AI 제안 빌더
- **`backend/src/lib/enrichmentPolicy.ts`** - 데이터 보호 정책
- **`backend/src/lib/geocode.ts`** - Kakao Geocoding API
- **`backend/src/lib/imageUpload.ts`** - S3 이미지 업로드
- **`backend/src/lib/hotScoreCalculator.ts`** - Hot Score 계산

### Jobs
- **`backend/src/jobs/enrichInternalFields.ts`** - Internal fields 생성
- **`backend/src/jobs/aiEnrichmentBackfill.ts`** - AI 자동 보완 Job

### Tests
- **`backend/tests/integration/admin-api/`** - Admin API 통합 테스트
- **`backend/tests/integration/data-protection/`** - Data Protection 테스트

---

**Last Updated**: 2026-02-09  
**Maintainer**: Fairpick Backend Team  
**Document Version**: 1.0


