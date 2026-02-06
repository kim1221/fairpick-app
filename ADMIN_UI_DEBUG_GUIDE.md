# 🐛 Admin UI Hot Suggestions 디버깅 가이드

## 📋 **현재 상황**
- DB에는 102개의 `ai_popup` 항목이 저장되어 있음 ✅
- Admin UI에는 여전히 이전 항목들만 보임 ❌

---

## 🔍 **디버깅 단계**

### 1️⃣ **브라우저 개발자 도구 열기**
```
Mac: Cmd + Option + I
Windows: F12
```

### 2️⃣ **Network 탭 확인**
1. Network 탭 클릭
2. "Preserve log" 체크
3. "Disable cache" 체크
4. 페이지 새로고침 (Cmd+R)

### 3️⃣ **API 요청 찾기**
검색 필터에 입력: `hot-suggestions`

### 4️⃣ **응답 확인**
`/admin/hot-suggestions?status=pending` 요청을 클릭하고:

**Response 탭에서 확인할 내용:**
```json
{
  "success": true,
  "total": ???,  // <- 이게 102여야 함
  "items": [
    {
      "title": "...",
      "source": "...",  // <- "ai_popup"이어야 함
      "candidate_score": ...,
      "created_at": "..."
    }
  ]
}
```

**Headers 탭에서 확인할 내용:**
```
Request URL: http://localhost:5001/admin/hot-suggestions?status=pending
Status Code: 200 OK (또는 401 Unauthorized)
```

---

## 🎯 **예상 문제 & 해결책**

### 문제 1: `401 Unauthorized`
```json
{"message": "Unauthorized"}
```

**원인:** localStorage에 adminKey가 없음

**해결:**
1. Console 탭으로 이동
2. 입력:
```javascript
localStorage.setItem('adminKey', 'your-admin-key-here')
```
3. 페이지 새로고침

---

### 문제 2: `total: 22` (적은 개수)
```json
{
  "total": 22,  // <- 102가 아님!
  "items": [...]
}
```

**원인:** API가 `source='blog'`만 반환하고 있음

**해결:** Backend API 쿼리 확인 필요

---

### 문제 3: Network 요청이 없음
Admin UI가 API를 호출하지 않음

**원인:** React Query 캐시 문제

**해결:**
Console에서 입력:
```javascript
localStorage.clear()
location.reload(true)
```

---

## 📸 **스크린샷 예시**

### ✅ 정상 응답
```json
{
  "success": true,
  "total": 102,
  "items": [
    {
      "title": "SK텔레콤 T Factory Seongsu",
      "source": "ai_popup",  // <- 중요!
      "candidate_score": 70,
      "created_at": "2026-02-06T03:28:07...."
    },
    {
      "title": "맥켈란 위스키 X 티 테이스팅 체험",
      "source": "ai_popup",
      "candidate_score": 85,
      ...
    }
  ]
}
```

### ❌ 잘못된 응답
```json
{
  "total": 22,
  "items": [
    {
      "title": "주라지",
      "source": "blog",  // <- ai_popup이 아님!
      ...
    }
  ]
}
```

---

## 🛠️ **추가 디버깅 명령어**

### Backend 로그 확인
```bash
cd /Users/kimsungtae/toss/fairpick-app/backend
tail -f /tmp/backend*.log | grep "HotSuggestions"
```

### DB에서 직접 확인
```bash
node -e "
const { pool } = require('./dist/db');
(async () => {
  const result = await pool.query('SELECT source, COUNT(*) FROM admin_hot_suggestions WHERE status = \\'pending\\' GROUP BY source');
  console.table(result.rows);
  process.exit(0);
})();
"
```

---

## 💡 **해결 못하면...**

다음 정보를 캡처해서 공유:
1. Network 탭의 `hot-suggestions` 요청 응답
2. Console 탭의 에러 메시지
3. `localStorage.getItem('adminKey')` 결과

