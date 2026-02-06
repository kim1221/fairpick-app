# Fairpick 빠른 시작 가이드

> **새 세션에서 작업을 재개할 때 이 문서를 먼저 읽으세요!**

---

## ⚡ 60초 요약

### 프로젝트 현황
- **플랫폼**: Toss MiniApp (React Native)
- **목표**: 추천 중심의 이벤트 발견 서비스
- **현재 단계**: Phase 1 완료 (추천 시스템 백엔드 + 기본 UI)

### 완료된 것 ✅
- 추천 알고리즘 (6개 섹션: 오늘의 추천, 지금 떠오르는, 내 주변, 취향 저격, 이번 주말, 새로 올라왔어요)
- 사용자 행동 로그 시스템 (view, save, share, click)
- 익명 사용자 관리
- 홈 화면 (추천)
- 이벤트 상세 페이지

### 해야 할 것 ⏳
- 발견 페이지 (카테고리별 탐색)
- MY 페이지 (저장한 이벤트, 최근 본 이벤트)
- 로그인 기능 (Toss Authentication)

---

## 🚀 서버 시작하기

### 1. 백엔드 서버
```bash
cd /Users/kimsungtae/toss/fairpick-app/backend
DB_USER=kimsungtae npm run start

# 확인
curl http://localhost:5001/health
# 출력: {"status":"ok"}
```

### 2. 프론트엔드 Dev 서버
```bash
cd /Users/kimsungtae/toss/fairpick-app
npm run dev

# 확인
lsof -ti:8081
# 출력: PID (숫자) → 실행 중
```

### 3. 로컬 IP 확인 (중요!)
```bash
ipconfig getifaddr en0
# 출력: 172.20.10.4 (예시)

# src/config/api.ts에 이 IP를 설정해야 함!
```

---

## 📁 핵심 파일 위치

### 백엔드
- `backend/src/lib/recommender.ts` - **추천 알고리즘**
- `backend/src/routes/recommendations.ts` - **추천 API (6개)**
- `backend/src/routes/userEvents.ts` - **사용자 이벤트 API (3개)**

### 프론트엔드
- `src/pages/home.tsx` - **홈 화면 (추천)**
- `src/pages/event-detail.tsx` - **이벤트 상세**
- `src/components/EventCard.tsx` - **이벤트 카드 (4 variants)**
- `src/components/BottomTabBar.tsx` - **하단 탭 바 (3-tab)**
- `src/utils/anonymousUser.ts` - **익명 사용자 관리**
- `src/services/recommendationService.ts` - **추천 API 호출**
- `src/config/api.ts` - **API 설정 (로컬 IP 여기!)**

---

## 🎯 다음에 할 일

### 우선순위 1: 발견 페이지
```bash
# 새 파일 생성
touch src/pages/explore.tsx

# 구현 내용:
# - 카테고리 필터 (팝업, 전시, 공연, 축제, 행사)
# - 이벤트 그리드/리스트
# - 필터링 (지역, 기간, 가격)
```

### 우선순위 2: MY 페이지
```bash
# 새 파일 생성
touch src/pages/mypage.tsx

# 구현 내용:
# - 저장한 이벤트 목록
# - 최근 본 이벤트
# - 로그인/로그아웃
```

---

## 🐛 문제 해결

### ⚠️ 개발 환경 설정 (처음 시작 시)

#### 1. Node.js 버전 확인 및 변경
```bash
# 현재 버전 확인
node -v

# v24.x 이상이면 v20으로 변경 (필수!)
nvm install 20.19.6
nvm use 20.19.6

# 확인
node -v  # v20.19.6
```

**이유**: Node.js v24는 React Native/Granite와 호환성 문제 있음

#### 2. Watchman 설치 및 활성화
```bash
# Watchman 설치 (Metro bundler 파일 감시용)
brew install watchman

# 프로젝트 루트에 .watchmanconfig 생성
cd /Users/kimsungtae/toss/fairpick-app
echo '{}' > .watchmanconfig
```

**이유**: `EMFILE: too many open files` 에러 방지

#### 3. Backend 디렉토리 제외 (metro.config.js)
프로젝트 루트에 `metro.config.js`가 있는지 확인:
```bash
cat metro.config.js
```

없으면 생성:
```javascript
const { getDefaultConfig } = require('@react-native/metro-config');

module.exports = (async () => {
  const defaultConfig = await getDefaultConfig(__dirname);

  return {
    ...defaultConfig,
    watchFolders: [__dirname],
    resolver: {
      ...defaultConfig.resolver,
      blockList: [
        /backend\/.*/,
        /backend$/,
      ],
    },
    watcher: {
      healthCheck: {
        enabled: true,
      },
      watchman: {
        deferStates: ['hg.update'],
      },
    },
  };
})();
```

#### 4. 의존성 재설치
```bash
# Frontend
cd /Users/kimsungtae/toss/fairpick-app
rm -rf node_modules package-lock.json
npm install

# Backend
cd /Users/kimsungtae/toss/fairpick-app/backend
rm -rf node_modules package-lock.json
npm install
```

---

### "시스템에 잠깐 문제가 생겼어요" (Toss MiniApp)
1. **Metro bundler 재시작**:
   ```bash
   lsof -ti:8081 | xargs kill -9
   npm run dev
   ```

2. **API URL 확인**:
   - `src/config/api.ts` 열기
   - `API_BASE_URL`이 `http://172.20.10.4:5001` (로컬 IP)인지 확인
   - ❌ `localhost` 사용 불가!

3. **백엔드 서버 확인**:
   ```bash
   curl http://172.20.10.4:5001/health
   ```

### npm install 실패
```bash
rm -rf node_modules
npm install
```

---

## 📊 데이터베이스 (PostgreSQL)

### 주요 테이블
- `users`: 익명 + 로그인 사용자
- `user_events`: 행동 로그 (view, save, share, click)
- `events`: 이벤트 인게이지먼트 (view_count, save_count, buzz_score)
- `canonical_events`: 이벤트 원본 데이터

### DB 접속
```bash
psql -U kimsungtae -d fairpick
```

---

## 🌐 API 엔드포인트 (10개)

### 추천 API (6개)
- `GET /api/recommendations/v2/today` - 오늘의 추천
- `GET /api/recommendations/v2/trending` - 지금 떠오르는
- `GET /api/recommendations/v2/nearby` - 내 주변
- `GET /api/recommendations/v2/personalized` - 취향 저격
- `GET /api/recommendations/v2/weekend` - 이번 주말
- `GET /api/recommendations/v2/latest` - 새로 올라왔어요

### 사용자 이벤트 API (3개)
- `POST /api/user-events` - 행동 로그 기록
- `POST /api/user-events/link-anonymous` - 익명 → 로그인 전환
- `GET /api/user-events/stats/:userId` - 사용자 통계

### 이벤트 API (1개)
- `GET /api/events/:id` - 이벤트 상세

---

## 📅 3-5일 계획

| Day | 작업 | 상태 |
|-----|------|------|
| 1 | 백엔드 추천 시스템 | ✅ 완료 |
| 2 | 프론트엔드 API 연동 | ✅ 완료 |
| 3 | 기본 UI 컴포넌트 | ✅ 완료 |
| 4-5 | UI 완성 (발견, MY, 로그인) | ⏳ 진행 예정 |

---

## ⚠️ 주의사항

1. **Toss MiniApp 환경**:
   - ❌ `localStorage`, `sessionStorage` 사용 불가
   - ✅ `Storage.getItem()`, `Storage.setItem()` 사용

2. **로컬 IP 사용**:
   - ❌ `http://localhost:5001` (작동 안 함)
   - ✅ `http://172.20.10.4:5001` (작동)

3. **타입 안전성**:
   - TypeScript 타입 체크: `npx tsc --noEmit`

---

## 📖 상세 문서

더 자세한 정보는 **[PROJECT_STATUS.md](./PROJECT_STATUS.md)** 참고

---

**빠른 명령어**:
```bash
# 백엔드 시작
cd backend && npm run start

# 프론트엔드 시작
npm run dev

# 로컬 IP 확인
ipconfig getifaddr en0

# API 테스트
curl http://172.20.10.4:5001/api/recommendations/v2/latest?limit=1
```

