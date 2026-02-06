# 🐛 AI 팝업 발굴 DB 저장 에러 해결 요청

## 📋 문제 요약

`src/scripts/ai-popup-discovery.ts` 스크립트가 Gemini API로 팝업 데이터를 **성공적으로 가져오지만**, `admin_hot_suggestions` 테이블에 저장할 때 **"could not determine data type of parameter $2"** 에러가 **모든 레코드에서 반복 발생**합니다.

---

## 🔍 현재 상황

### ✅ 잘 작동하는 부분
1. Gemini API 호출 성공 (55-76개 팝업 수집)
2. 데이터 파싱 성공 (title, venue, region, description 모두 존재)
3. 수동 INSERT 테스트 성공:
```sql
INSERT INTO admin_hot_suggestions (
  id, title, venue, region, link, description,
  source, candidate_score, evidence_links, evidence_count,
  status, created_at, metadata
) VALUES (
  gen_random_uuid(),
  '테스트 팝업', '테스트 장소', '서울 강남구', '', '설명',
  'test_source', 50, ARRAY[]::text[], 0,
  'pending', NOW(), '{}'::jsonb
);
-- ✅ 성공!
```

### ❌ 문제 발생 부분
```
[PopupDiscovery] Save error for "Salon de R.LUX 팝업": could not determine data type of parameter $2
[PopupDiscovery] Debug - venue: "연무장11길 11 1층", region: "서울 성동구", description length: 70
[PopupDiscovery] Stack:     at /Users/kimsungtae/toss/fairpick-app/backend/node_modules/pg-pool/index.js:45:11
```

- **모든** 팝업에서 동일한 에러 발생
- `venue`, `region`, `description` 값이 모두 존재함에도 에러
- 에러 메시지: `could not determine data type of parameter $2`
- `$2`는 `venue` 파라미터 (두 번째 파라미터)

---

## 📁 관련 파일

### 1. `src/scripts/ai-popup-discovery.ts` (문제 파일)
**라인 230-280 부근 (저장 로직):**
```typescript
for (const [_, popup] of allPopups) {
  try {
    // 1. canonical_events에 이미 있는지 체크
    let existsInDB = false;
    try {
      existsInDB = await isAlreadyInDB(popup.title, popup.venue); // ⚠️ 여기서 에러?
    } catch (dbCheckError: any) {
      console.error(`[PopupDiscovery] DB check error for "${popup.title}":`, dbCheckError.message);
      continue;
    }
    
    if (existsInDB) {
      console.log(`[PopupDiscovery] ⏭️  Skipped (already in DB): ${popup.title}`);
      skippedExisting++;
      continue;
    }

    // 2. admin_hot_suggestions에 이미 있는지 체크
    let alreadySuggested = false;
    try {
      alreadySuggested = await isAlreadySuggested(popup.title); // ⚠️ 또는 여기?
    } catch (suggestCheckError: any) {
      console.error(`[PopupDiscovery] Suggestion check error for "${popup.title}":`, suggestCheckError.message);
      continue;
    }
    
    if (alreadySuggested) {
      console.log(`[PopupDiscovery] ⏭️  Skipped (already suggested): ${popup.title}`);
      skippedSuggested++;
      continue;
    }

    // 3. 새로운 팝업이면 저장
    const params = [
      popup.title,
      popup.venue || null,
      popup.region || null,
      popup.description || null,
      popup.hotness_score || 50,
      JSON.stringify({
        category: popup.category || null,
        start_date: popup.start_date || null,
        end_date: popup.end_date || null,
        hotness_score: popup.hotness_score || null,
        ai_generated: true,
      })
    ];

    await pool.query(`
      INSERT INTO admin_hot_suggestions (
        id, title, venue, region, link, description,
        source, candidate_score, evidence_links, evidence_count,
        status, created_at, metadata
      ) VALUES (
        gen_random_uuid(),
        $1, $2, $3, '', $4,
        'ai_popup',
        $5,
        ARRAY[]::text[],
        0,
        'pending',
        NOW(),
        $6::jsonb
      )
    `, params);
    
    console.log(`[PopupDiscovery] ✅ Saved: ${popup.title} (score: ${popup.hotness_score})`);
    savedCount++;

  } catch (error: any) {
    console.error(`[PopupDiscovery] Save error for "${popup.title}":`, error.message);
    console.error(`[PopupDiscovery] Debug - venue: "${popup.venue}", region: "${popup.region}", description length: ${popup.description?.length || 0}`);
    console.error(`[PopupDiscovery] Stack:`, error.stack?.split('\n')[1]);
  }
}
```

**라인 58-73 (isAlreadyInDB 함수):**
```typescript
async function isAlreadyInDB(title: string, venue?: string): Promise<boolean> {
  const normalizedTitle = title.toLowerCase().replace(/\s+/g, '');
  
  const result = await pool.query(`
    SELECT id FROM canonical_events
    WHERE 
      LOWER(REPLACE(title, ' ', '')) = $1
      OR (
        $2 IS NOT NULL 
        AND LOWER(REPLACE(venue, ' ', '')) LIKE '%' || LOWER(REPLACE($2, ' ', '')) || '%'
      )
    LIMIT 1
  `, [normalizedTitle, venue || null]); // ⚠️ 여기서 parameter $2 에러?

  return result.rowCount! > 0;
}
```

**라인 78-89 (isAlreadySuggested 함수):**
```typescript
async function isAlreadySuggested(title: string): Promise<boolean> {
  const normalizedTitle = title.toLowerCase().replace(/\s+/g, '');
  
  const result = await pool.query(`
    SELECT id FROM admin_hot_suggestions
    WHERE LOWER(REPLACE(title, ' ', '')) = $1
    AND status = 'pending'
    LIMIT 1
  `, [normalizedTitle]);

  return result.rowCount! > 0;
}
```

### 2. DB 테이블 구조 (`admin_hot_suggestions`)
```
id                   uuid                      NULL? NO
title                text                      NULL? NO
venue                text                      NULL? YES
region               text                      NULL? YES
link                 text                      NULL? YES
description          text                      NULL? YES
postdate             text                      NULL? YES
source               text                      NULL? YES
candidate_score      integer                   NULL? YES
evidence_links       ARRAY (udt_name: _text)   NULL? YES
evidence_count       integer                   NULL? YES
status               text                      NULL? YES
created_at           timestamp without time zone NULL? YES
reviewed_at          timestamp without time zone NULL? YES
reviewed_by          text                      NULL? YES
metadata             jsonb                     NULL? YES
```

---

## 🎯 **요청사항**

### **문제를 찾아서 수정해주세요:**

1. **왜 `parameter $2` (venue) 타입을 PostgreSQL이 추론하지 못하는가?**
   - 수동 INSERT는 성공하는데, 코드에서는 왜 실패하는가?
   - `isAlreadyInDB` 함수의 쿼리가 문제인가?
   - INSERT 쿼리 자체가 문제인가?

2. **실제 에러가 발생하는 정확한 위치는 어디인가?**
   - `isAlreadyInDB` 함수?
   - `isAlreadySuggested` 함수?
   - INSERT 쿼리?

3. **해결 방법:**
   - PostgreSQL 타입 캐스팅 명시 필요?
   - 파라미터 전달 방식 변경 필요?
   - 쿼리 구조 변경 필요?

---

## 📝 재현 방법

```bash
cd /Users/kimsungtae/toss/fairpick-app/backend
npx ts-node --transpile-only src/scripts/ai-popup-discovery.ts
```

**예상 결과:**
```
[PopupDiscovery] Found 55 popups
[PopupDiscovery] ✅ Saved: Salon de R.LUX 팝업 (score: 85)
[PopupDiscovery] ✅ Saved: 프리미엄 가나 취향위크 팝업 (score: 80)
...
```

**실제 결과:**
```
[PopupDiscovery] Found 55 popups
[PopupDiscovery] Save error for "Salon de R.LUX 팝업": could not determine data type of parameter $2
[PopupDiscovery] Save error for "프리미엄 가나 취향위크 팝업": could not determine data type of parameter $2
...
```

---

## 💡 시도한 해결책 (실패)

1. ✅ `undefined` → `null` 변환 추가
2. ✅ 파라미터 배열 분리
3. ✅ 타입 캐스팅 `ARRAY[]::text[]` 사용
4. ✅ `evidence_links` 타입 수정
5. ❌ 여전히 동일한 에러 발생

---

## 🎯 **최종 목표**

`ai-popup-discovery.ts` 스크립트가 **에러 없이** Gemini API에서 가져온 팝업 데이터를 `admin_hot_suggestions` 테이블에 **성공적으로 저장**하도록 수정해주세요.

---

## 📌 참고

- DB 연결: `src/db.ts` (`pool` 객체 사용)
- PostgreSQL 버전: (확인 필요)
- Node.js: v20.19.6
- TypeScript 컴파일 없이 `ts-node --transpile-only` 사용
