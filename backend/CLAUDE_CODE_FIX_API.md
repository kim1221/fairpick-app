# 🐛 Backend API 204 No Content 에러 해결 요청

## 📋 **문제 요약**

`GET /admin/hot-suggestions?status=pending` API가 **204 No Content**를 반환합니다.

- DB에는 102개의 `ai_popup` 데이터가 존재함 ✅ (확인 완료)
- API 요청은 성공 (200/204 응답) ✅
- **하지만 응답 본문(body)이 비어있음** ❌

---

## 🔍 **현재 상황**

### ✅ **DB 데이터 확인 (정상)**
```sql
SELECT source, status, COUNT(*) 
FROM admin_hot_suggestions
WHERE status = 'pending'
GROUP BY source, status;

-- 결과:
-- ai_popup  | pending | 102개
-- blog      | pending | 22개
-- 총 124개 존재
```

### ❌ **API 응답 (문제)**
```bash
curl -H "X-Admin-Key: testkey123" \
  "http://localhost:5001/admin/hot-suggestions?status=pending"

# 응답: 204 No Content (빈 응답)
# 예상: {"success": true, "total": 124, "items": [...]}
```

### 🌐 **브라우저 Network 탭**
```
Request URL: http://localhost:5001/admin/hot-suggestions?status=pending
Status Code: 204 No Content
Content-Length: 0
```

---

## 📁 **관련 파일**

### 1. `src/index.ts` (문제 파일)
**라인 5286-5321 부근:**

```typescript
/**
 * GET /admin/hot-suggestions
 * Hot Discovery로 발굴된 이벤트 후보 목록 조회
 */
app.get('/admin/hot-suggestions', requireAdminAuth, async (req, res) => {
  try {
    const { status = 'pending' } = req.query;

    const result = await pool.query(
      `SELECT 
        id, title, venue, region, link, description, 
        source, postdate, candidate_score, status,
        created_at, reviewed_at, reviewed_by
       FROM admin_hot_suggestions
       WHERE status = $1
       ORDER BY candidate_score DESC, created_at DESC
       LIMIT 100`,
      [status]
    );

    console.log(`[Admin] [HotSuggestions] Retrieved ${result.rowCount} suggestions (status=${status})`);

    res.json({
      success: true,
      total: result.rowCount,
      items: result.rows,
    });

  } catch (error: any) {
    console.error('[Admin] [HotSuggestions] Query failed:', error);
    res.status(500).json({
      success: false,
      error: 'Hot Suggestions 조회 중 오류가 발생했습니다.',
      message: error.message,
    });
  }
});
```

**문제점:**
- 코드는 정상적으로 보임
- `res.json()`을 호출하는데 204가 반환됨
- `console.log`가 실행되는지 확인 필요
- 혹시 **다른 미들웨어**나 **중복된 라우트**가 먼저 응답을 가로채는지 확인 필요

---

## 🎯 **요청사항**

### **문제를 찾아서 수정해주세요:**

1. **왜 API가 204 No Content를 반환하는가?**
   - `res.json()`이 실행되지 않는 이유?
   - 다른 미들웨어가 응답을 가로채는가?
   - 라우트가 중복 정의되어 있는가?

2. **requireAdminAuth 미들웨어가 문제인가?**
   - 인증은 통과하는데 응답이 비어있는 경우?
   - 미들웨어에서 `res.send()` 또는 `res.end()`를 호출하는가?

3. **데이터베이스 쿼리가 실제로 실행되는가?**
   - `console.log`가 Backend 로그에 출력되는가?
   - `result.rowCount`가 실제로 124인가?

4. **해결 방법:**
   - API 엔드포인트 로직 수정
   - 중복 라우트 제거
   - 미들웨어 순서 조정
   - 명시적인 응답 보장

---

## 📝 **재현 방법**

### 1. Backend 서버 실행 확인
```bash
ps aux | grep "ts-node.*index.ts" | grep -v grep
# 결과: PID 16800 실행 중 (포트 5001)
```

### 2. API 직접 호출
```bash
curl -v -H "X-Admin-Key: testkey123" \
  "http://localhost:5001/admin/hot-suggestions?status=pending"
```

**예상 출력:**
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "success": true,
  "total": 124,
  "items": [
    {
      "id": "...",
      "title": "SK텔레콤 T Factory Seongsu",
      "source": "ai_popup",
      "candidate_score": 70,
      ...
    }
  ]
}
```

**실제 출력:**
```http
HTTP/1.1 204 No Content
Content-Length: 0

(빈 응답)
```

### 3. Backend 로그 확인
```bash
tail -f /tmp/backend*.log | grep "HotSuggestions"
```

**예상:** `[Admin] [HotSuggestions] Retrieved 124 suggestions (status=pending)`
**실제:** 로그가 출력되지 않을 수 있음 (라우트 실행 안됨?)

---

## 🔍 **체크리스트**

### 의심되는 원인들:

1. ✅ **다른 라우트가 먼저 응답**
   - `app.get('/admin/*', ...)` 같은 와일드카드 라우트?
   - 순서가 잘못되어 `/admin/hot-suggestions`가 실행 안됨?

2. ✅ **requireAdminAuth 미들웨어 문제**
   - 인증 실패 시 `res.status(401).send()` 대신 `res.status(204)`?
   - 미들웨어에서 `next()`를 호출하지 않음?

3. ✅ **응답 전송 후 다시 응답 시도**
   - 어딘가에서 이미 응답을 보낸 후 `res.json()` 재호출?
   - Express는 중복 응답 시 204를 반환할 수 있음

4. ✅ **데이터베이스 연결 문제**
   - Pool이 연결되지 않음?
   - 쿼리 타임아웃?

5. ✅ **TypeScript 컴파일 문제**
   - 코드 변경이 반영되지 않음?
   - `dist/` 폴더가 오래된 버전?

---

## 💡 **디버깅 제안**

### 1. 로그 추가
```typescript
app.get('/admin/hot-suggestions', requireAdminAuth, async (req, res) => {
  console.log('[DEBUG] /admin/hot-suggestions called'); // ← 추가
  console.log('[DEBUG] Query params:', req.query); // ← 추가
  
  try {
    const { status = 'pending' } = req.query;
    console.log('[DEBUG] Status:', status); // ← 추가

    const result = await pool.query(...);
    console.log('[DEBUG] Query result rowCount:', result.rowCount); // ← 추가
    console.log('[DEBUG] Sending response...'); // ← 추가

    res.json({
      success: true,
      total: result.rowCount,
      items: result.rows,
    });
    
    console.log('[DEBUG] Response sent'); // ← 추가
  } catch (error: any) {
    console.error('[DEBUG] Error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

### 2. requireAdminAuth 확인
```typescript
// requireAdminAuth가 어떻게 정의되어 있는지 확인
// next()를 제대로 호출하는지 확인
```

### 3. 라우트 순서 확인
```typescript
// /admin/hot-suggestions 라우트가 
// 다른 와일드카드 라우트보다 먼저 정의되어 있는지 확인
```

---

## 🎯 **최종 목표**

`GET /admin/hot-suggestions?status=pending` API가 **정상적으로 JSON 응답**을 반환하도록 수정해주세요:

```json
{
  "success": true,
  "total": 124,
  "items": [
    {
      "id": "...",
      "title": "SK텔레콤 T Factory Seongsu",
      "source": "ai_popup",
      "candidate_score": 70,
      "status": "pending",
      "created_at": "2026-02-06T03:28:07..."
    },
    ...
  ]
}
```

---

## 📌 **참고 정보**

- Backend 서버 포트: **5001**
- DB 테이블: `admin_hot_suggestions`
- 실행 중인 프로세스: PID 16800 (`ts-node src/index.ts`)
- Node.js 버전: v20.19.6
- PostgreSQL: localhost:5432

---

## 🚨 **긴급도**

**높음** - Admin UI가 완전히 작동하지 않음. DB에는 데이터가 있지만 UI에 표시되지 않음.

