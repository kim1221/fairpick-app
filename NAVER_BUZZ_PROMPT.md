# 네이버 Buzz Score 수집 완료 작업

## 🎯 목표
네이버 블로그 언급 수 기반 Buzz Score 수집을 완료하고 실행 가능하게 만들기

## ✅ 이미 완료된 작업
1. **DB 마이그레이션 완료**: `naver_mentions`, `naver_buzz_score`, `naver_updated_at`, `update_priority` 컬럼 추가됨
2. **naverApi.ts**: `getNaverBlogMentions()` 함수 추가됨
3. **collect-naver-buzz.ts**: 수집 스크립트 작성됨
4. **package.json**: `collect:naver-buzz:test` 스크립트 추가됨

## ⚠️ 현재 문제
**스크립트 실행 시 네이버 API 키를 못 읽음**

### 증상
```
[NaverAPI] Naver credentials not set. Returning 0.
[dotenv@17.2.3] injecting env (0) from .env  ← 0개 로드됨!
```

### 원인
`backend/src/scripts/collect-naver-buzz.ts` 파일에서 dotenv를 중복 로드하고 있음:
```typescript
// ❌ 문제: 다른 모듈이 이미 import된 후 실행됨
import * as dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import { getNaverBlogMentions } from '../lib/naverApi';
```

### 이미 확인된 사실
- ✅ `.env` 파일에 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` 정상적으로 있음
- ✅ 다른 스크립트들(`backfill:detail` 등)은 같은 `.env`로 네이버 API 잘 작동함
- ✅ `DATABASE_URL`도 `.env`에 있지만 스크립트는 못 읽음 (현재 package.json에서 직접 전달 중)

## 🔧 해결 방법

### Option 1: 스크립트에서 dotenv 제거 (권장)
`backend/src/scripts/collect-naver-buzz.ts` 파일 수정:

```typescript
/**
 * 네이버 블로그 언급 수 수집 및 Buzz Score 계산
 * 
 * 사용법:
 * - 전체 수집: npm run collect:naver-buzz
 * - 테스트 (10개): npm run collect:naver-buzz:test
 */

// ❌ 이 부분 제거
// import * as dotenv from 'dotenv';
// dotenv.config();

// ✅ 바로 시작
import { Pool } from 'pg';
import { getNaverBlogMentions } from '../lib/naverApi';

// ... 나머지 코드는 그대로
```

**이유**: `ts-node -r dotenv/config`로 실행하면 모든 모듈보다 먼저 dotenv가 로드됩니다.

### Option 2: naverApi.ts에서 환경 변수를 함수 내부에서 읽기
`backend/src/lib/naverApi.ts` 파일 수정:

```typescript
// ❌ 기존: 모듈 로드 시점에 읽음
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || '';
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || '';

// ✅ 수정: 함수 내부에서 읽음
function getNaverCredentials() {
  return {
    clientId: process.env.NAVER_CLIENT_ID || '',
    clientSecret: process.env.NAVER_CLIENT_SECRET || ''
  };
}

// 그리고 각 함수에서:
export async function searchNaverBlog(...) {
  const { clientId, clientSecret } = getNaverCredentials();
  if (!clientId || !clientSecret) {
    console.warn('[NaverAPI] Naver credentials not set.');
    return { /* ... */ };
  }
  // ... 나머지 코드에서 NAVER_CLIENT_ID 대신 clientId 사용
}
```

### Option 3: package.json에서 환경 변수 명시적 전달
`backend/package.json` 수정 (이미 DATABASE_URL은 이렇게 하고 있음):

```json
"collect:naver-buzz": "NAVER_CLIENT_ID=$NAVER_CLIENT_ID NAVER_CLIENT_SECRET=$NAVER_CLIENT_SECRET DATABASE_URL=postgresql://kimsungtae@localhost:5432/fairpick ts-node -r dotenv/config src/scripts/collect-naver-buzz.ts",
```

하지만 이건 우아하지 않고, 다른 스크립트들은 이렇게 안 해도 잘 작동하므로 권장하지 않음.

## ✅ 테스트 방법

수정 후:
```bash
cd /Users/kimsungtae/toss/fairpick-app/backend
npm run collect:naver-buzz:test
```

**기대 결과**:
```
🔍 네이버 블로그 언급 수 수집 중...
   진행: 10/10 (100%)
✅ 네이버 언급 수 수집 완료

📊 수집 통계:
   전체 이벤트: 10개
   평균 언급 수: 127        ← 0이 아닌 실제 숫자!
   최대 언급 수: 450
   
샘플 결과 (상위 5개):
   - 모네 전시 서울: 450건 → 점수 85 (P0)
   ...
```

## 🎓 참고: 다른 스크립트들이 작동하는 이유

`backend/src/jobs/detailBackfill.ts` 등은:
1. 스크립트 내부에서 dotenv를 로드하지 않음
2. `ts-node -r dotenv/config`로 실행되면 자동으로 환경 변수 로드됨
3. `naverApi.ts`를 import할 때 이미 환경 변수가 로드되어 있음

## 📝 최종 확인 사항

수정 후 다음 명령어로 확인:
```bash
# 1. 테스트 (10개)
npm run collect:naver-buzz:test

# 2. 전체 실행 (신중히!)
npm run collect:naver-buzz

# 3. DB 확인
psql -d fairpick -c "SELECT title, naver_mentions, naver_buzz_score FROM canonical_events WHERE naver_buzz_score > 0 ORDER BY naver_buzz_score DESC LIMIT 10;"
```

---

**권장**: Option 1 (스크립트에서 dotenv 제거)이 가장 간단하고 다른 스크립트들과 일관성 있음.

