# Granite App

## Admin API

### Authentication

**보안 설정 (필수)**

1. `.env` 파일에 강력한 Admin Key 설정:
```bash
# backend/.env
ADMIN_KEY=your_secure_random_key_here

# 강력한 키 생성 방법:
openssl rand -hex 32
```

2. 모든 Admin API 요청에 `x-admin-key` 헤더 포함:
```bash
export ADMIN_KEY="your-secret-key"
```

**보안 정책:**
- ✅ 모든 `/admin/*` 엔드포인트는 인증 필수
- ✅ 인증 실패 시 401 Unauthorized 반환
- ✅ Admin Key는 환경변수로 관리 (하드코딩 금지)
- ✅ 일반 사용자 API와 완전 분리

### GET /admin/featured

Featured 이벤트 목록 조회 (is_featured = true)

```bash
curl -X GET http://localhost:4000/admin/featured \
  -H "x-admin-key: ${ADMIN_KEY}"
```

**Response:**
```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "이벤트 제목",
      "startAt": "2025-01-01",
      "endAt": "2025-01-31",
      "region": "서울",
      "mainCategory": "공연",
      "subCategory": "뮤지컬",
      "imageUrl": "https://example.com/image.jpg",
      "isFeatured": true,
      "featuredOrder": 1,
      "featuredAt": "2025-12-26T18:00:00.000Z"
    }
  ],
  "totalCount": 1
}
```

### PATCH /admin/events/:id/featured

Featured 상태 업데이트

**Featured 활성화 (order 1로 설정):**
```bash
curl -X PATCH http://localhost:4000/admin/events/550e8400-e29b-41d4-a716-446655440000/featured \
  -H "x-admin-key: ${ADMIN_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "is_featured": true,
    "featured_order": 1
  }'
```

**Featured order만 변경:**
```bash
curl -X PATCH http://localhost:4000/admin/events/550e8400-e29b-41d4-a716-446655440000/featured \
  -H "x-admin-key: ${ADMIN_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "featured_order": 5
  }'
```

**Featured 비활성화:**
```bash
curl -X PATCH http://localhost:4000/admin/events/550e8400-e29b-41d4-a716-446655440000/featured \
  -H "x-admin-key: ${ADMIN_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "is_featured": false
  }'
```

**Response:**
```json
{
  "success": true,
  "event": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "이벤트 제목",
    "is_featured": true,
    "featured_order": 1,
    "featured_at": "2025-12-26T18:00:00.000Z"
  }
}
```

**Validation Rules:**
- `id`: UUID 형식
- `is_featured`: boolean (optional)
- `featured_order`: 1 이상의 정수 또는 null (optional)
- `is_featured: false → true`: featured_at = now() 자동 설정
- `is_featured: true → false`: featured_order, featured_at = null 자동 설정

---

## Phase 4: 추천 고도화 로드맵 (설계 완료)

**현재 상태:** Phase 3 완료 (Featured 수동 큐레이션)

**Phase 4 확장 방향:**
1. ✅ **Featured** - 수동 큐레이션 (완료)
2. 🔄 **Hot** - 인기 이벤트 (view_count 기반) → DB 마이그레이션 필요
3. 🔄 **Trending** - 급상승 이벤트 (증가율 기반) → 집계 로직 필요
4. 🔄 **Personalized** - 개인화 추천 → 회원 시스템 필요

### Phase 4-1: Hot (인기 이벤트) - 구현 대기

**요구사항:**
```sql
-- DB 마이그레이션 필요
ALTER TABLE canonical_events ADD COLUMN view_count INT DEFAULT 0;
CREATE INDEX idx_events_view_count ON canonical_events(view_count DESC);
```

**API 설계:**
```
GET /events/hot
- 정렬: view_count DESC, quality_score DESC
- 필터: end_at >= CURRENT_DATE
- 최대: 10개
```

### Phase 4-2: Trending (급상승) - 구현 대기

**요구사항:**
- event_views 테이블 활용 (이미 존재)
- 증가율 계산 배치 or Materialized View

**API 설계:**
```
GET /events/trending
- 정렬: trend_ratio DESC (최근 3일 / 이전 7일)
- 배지: "🔥 급상승"
- 최대: 10개
```

### Phase 4-3: 추천 섹션 다각화 - 장기

**Frontend 변경:**
- 메인 화면에 여러 추천 섹션 배치
- Featured / Hot / Trending / New 섹션별 UI

---

## Featured 자동 해제 정책

**배치 스케줄:** 매일 자정 실행 권장

**자동 해제 조건:**
1. ✅ 종료된 이벤트: `end_at < CURRENT_DATE`
2. ✅ 장기 Featured: `featured_at < CURRENT_DATE - 30일`

**수동 실행:**
```bash
cd backend
npm run job:auto-unfeature
```

**운영 환경 설정 (cron):**
```bash
# 매일 자정 실행
0 0 * * * cd /path/to/backend && npm run job:auto-unfeature >> /var/log/auto-unfeature.log 2>&1
```

**로그 확인:**
```bash
[AutoUnfeature] Found 3 events to unfeature:
  1. [ended] abc123... - 크리스마스 마켓 (end: 2024-12-25, featured: 2024-12-01)
  2. [expired] def456... - 연극 햄릿 (end: 2025-02-28, featured: 2024-11-15)
[AutoUnfeature] Successfully unfeatured 2 events.
```
