# PR: 이벤트 상세 이동 + user-events 404 해결

## Why

**문제 1: Navigation 에러**
- 현상: 홈 화면에서 이벤트 클릭 시 "The action 'NAVIGATE' with payload { name: '/events/<uuid>' } was not handled by any navigator." 에러 발생
- 원인: Granite 라우터의 올바른 호출 방식(`navigation.navigate('/events/:id', { id })`)이 아닌 literal path(`navigation.navigate(\`/events/${id}\`)`) 사용

**문제 2: UserEventService 404**
- 현상: `POST /api/user-events` 호출 시 "HTTP 404 Event not found" 에러 발생
- 원인:
  - 프론트엔드는 `canonical_events`의 ID 전달
  - 백엔드는 `events` 테이블에서 검증 시도
  - 두 테이블은 완전히 다른 ID 공간 (shared_ids = 0)

## What

### 1. Navigation 수정 (src/pages/index.tsx:298)

```diff
- navigation.navigate(`/events/${eventId}`);
+ navigation.navigate('/events/:id', { id: eventId });
```

**근거:**
- Granite 라우터 등록: `src/router.gen.ts:15` - `/events/:id`
- 다른 11개 파일이 동일한 패턴 사용 (hot.tsx, nearby.tsx, mypage.tsx 등)

### 2. UserEvents 테이블명 수정 (backend/src/routes/userEvents.ts)

**Line 132: 이벤트 검증**
```diff
- const eventCheck = await pool.query('SELECT id FROM events WHERE id = $1', [eventId]);
+ const eventCheck = await pool.query('SELECT id FROM canonical_events WHERE id = $1', [eventId]);
```

**Line 78: view_count 증가**
```diff
- UPDATE events SET view_count = view_count + 1 WHERE id = $1
+ UPDATE canonical_events SET view_count = view_count + 1 WHERE id = $1
```

**Line 82-96: save/share 액션 제거**
```diff
- } else if (actionType === 'save') {
-   UPDATE events SET save_count = save_count + 1 ...
- } else if (actionType === 'share') {
-   UPDATE events SET share_count = share_count + 1 ...
+ // TODO: save_count, share_count를 canonical_events에 추가하거나 별도 테이블로 관리 필요
```

**Line 305: stats API JOIN**
```diff
- JOIN events e ON ue.event_id = e.id
+ JOIN canonical_events e ON ue.event_id = e.id
```

## Impact

**프론트엔드:**
- 홈 화면 이벤트 클릭 → 상세 페이지 정상 이동 ✅
- 다른 페이지는 이미 올바른 패턴 사용 중 (변경 없음)

**백엔드:**
- `POST /api/user-events` 200 응답 ✅
- `view_count` 실시간 증가 작동 ✅
- `save_count`, `share_count`는 TODO (canonical_events에 컬럼 없음)

**데이터베이스:**
- FK constraint 상태: 이미 제거됨 (`user_events_event_id_fkey` 없음)
- 신규 로그는 canonical_events ID 사용
- 기존 로그 유지 (orphaned 가능, 정리 불필요)

## Rollback

**코드 롤백:**
```bash
# 프론트엔드
git checkout HEAD -- src/pages/index.tsx

# 백엔드
git checkout HEAD -- backend/src/routes/userEvents.ts

# 재시작
pkill -f "node.*backend"
cd backend && npm start
```

**DB 롤백 (필요시):**
```sql
-- FK 복원 (주의: canonical_events ID 로그는 실패)
ALTER TABLE user_events
  ADD CONSTRAINT user_events_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
```

## Validation

### 1. Navigation 패턴 검증

```bash
# From repo root
cd "$(git rev-parse --show-toplevel)"

# 현재 코드 확인
grep -n "navigation.navigate" src/pages/index.tsx | grep events

# Expected: Line 298 with pattern '/events/:id', { id: eventId }
```

### 2. UserEventService API 테스트

```bash
# From repo root
cd "$(git rev-parse --show-toplevel)/backend"

# 1. 테스트 이벤트 ID 가져오기
EVENT_ID=$(node -e "
require('dotenv').config();
const { execSync } = require('child_process');
const id = execSync('psql \"\$DATABASE_URL\" -t -c \"SELECT id FROM canonical_events WHERE is_deleted = false LIMIT 1\"', {encoding:'utf8'}).trim();
console.log(id);
")

echo "Event ID: ${EVENT_ID}"

# 2. API 호출 테스트
USER_ID=$(uuidgen)
curl -sw "\nHTTP: %{http_code}\n" \
  -X POST http://localhost:5001/api/user-events \
  -H "Content-Type: application/json" \
  -d '{"userId":"'"${USER_ID}"'","eventId":"'"${EVENT_ID}"'","actionType":"click"}'

# Expected: {"success":true,...} HTTP: 200
```

### 3. view_count 증가 확인

```bash
# From repo root
cd "$(git rev-parse --show-toplevel)/backend"

# 1. 테스트 이벤트 ID
EVENT_ID=$(node -e "
require('dotenv').config();
const { execSync } = require('child_process');
const id = execSync('psql \"\$DATABASE_URL\" -t -c \"SELECT id FROM canonical_events LIMIT 1\"', {encoding:'utf8'}).trim();
console.log(id);
")

# 2. Before view_count
BEFORE=$(node -e "
require('dotenv').config();
const { execSync } = require('child_process');
const count = execSync('psql \"\$DATABASE_URL\" -t -c \"SELECT view_count FROM canonical_events WHERE id='"'"'${EVENT_ID}'"'"'\"', {encoding:'utf8'}).trim();
console.log(count);
")
echo "Before: ${BEFORE}"

# 3. Send view event
USER_ID=$(uuidgen)
curl -s -X POST http://localhost:5001/api/user-events \
  -H "Content-Type: application/json" \
  -d '{"userId":"'"${USER_ID}"'","eventId":"'"${EVENT_ID}"'","actionType":"view"}' >/dev/null

sleep 1

# 4. After view_count
AFTER=$(node -e "
require('dotenv').config();
const { execSync } = require('child_process');
const count = execSync('psql \"\$DATABASE_URL\" -t -c \"SELECT view_count FROM canonical_events WHERE id='"'"'${EVENT_ID}'"'"'\"', {encoding:'utf8'}).trim();
console.log(count);
")
echo "After: ${AFTER}"
echo "Incremented: $((AFTER - BEFORE))"
```

## Operational Notes (DB)

### 운영 적용 전 체크

**FK 존재 여부 확인:**
```bash
# From repo root
cd "$(git rev-parse --show-toplevel)/backend"

node -e "
require('dotenv').config();
const { execSync } = require('child_process');
const result = execSync('psql \"\$DATABASE_URL\" -c \"SELECT conname FROM pg_constraint WHERE conrelid='"'"'user_events'"'"'::regclass AND conname='"'"'user_events_event_id_fkey'"'"'\"', {encoding:'utf8'});
console.log(result);
console.log(result.includes('0 rows') ? '✓ Safe to deploy' : '⚠️ Remove FK first');
"
```

**FK 제거 (필요시):**
```sql
-- 현재 상태에서는 이미 제거됨
-- 만약 존재한다면:
ALTER TABLE user_events DROP CONSTRAINT user_events_event_id_fkey;
```

**FK 없이 운영하는 이유:**
1. `events`와 `canonical_events`는 완전히 다른 ID 공간 (shared_ids = 0)
2. 프론트엔드는 `canonical_events` ID만 전달
3. FK를 `canonical_events`로 변경 시 기존 `events` ID 참조 레코드가 orphan됨
4. 참조 무결성보다 기능 복구 우선 (이벤트 삭제 드물어 orphan 리스크 낮음)

### 후속 계획 (Optional)

**save_count/share_count 지원:**
```sql
-- canonical_events에 컬럼 추가
ALTER TABLE canonical_events
  ADD COLUMN IF NOT EXISTS save_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0;

-- 기존 user_events에서 집계
UPDATE canonical_events ce
SET
  save_count = COALESCE((
    SELECT COUNT(*) FROM user_events
    WHERE event_id = ce.id AND action_type = 'save'
  ), 0),
  share_count = COALESCE((
    SELECT COUNT(*) FROM user_events
    WHERE event_id = ce.id AND action_type = 'share'
  ), 0);
```

그 후 `backend/src/routes/userEvents.ts:82-96`의 TODO 주석 해제.

---

**파일:** `backend/PR_NOTES/event-detail-and-user-events.md`
