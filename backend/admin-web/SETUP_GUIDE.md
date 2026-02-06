# Fairpick Admin Web - 설정 가이드

## 🎉 프로젝트 완성!

Modern Admin 페이지가 성공적으로 생성되었습니다.

---

## 📁 프로젝트 구조

```
backend/admin-web/
├── src/
│   ├── pages/
│   │   ├── LoginPage.tsx          # 로그인 페이지
│   │   ├── DashboardPage.tsx      # 대시보드 (통계, 로그)
│   │   ├── EventsPage.tsx         # 이벤트 관리
│   │   └── CreatePopupPage.tsx    # 팝업 추가 (핵심 기능!)
│   ├── layouts/
│   │   └── AdminLayout.tsx        # 레이아웃 (사이드바, 헤더)
│   ├── services/
│   │   └── api.ts                 # API 클라이언트
│   ├── types/
│   │   └── index.ts               # TypeScript 타입
│   ├── App.tsx                    # 메인 앱 + 라우팅
│   ├── main.tsx                   # 진입점
│   └── index.css                  # TailwindCSS 스타일
├── tailwind.config.js             # TailwindCSS 설정
├── postcss.config.js              # PostCSS 설정
└── package.json
```

---

## 🚀 실행 방법

### 1. Admin 웹 서버 시작

```bash
cd backend/admin-web
npm run dev
```

서버 주소: http://localhost:5173

### 2. Backend API 서버 시작 (다른 터미널)

```bash
cd backend
npm run dev
```

서버 주소: http://localhost:4000

### 3. 로그인

1. 브라우저에서 http://localhost:5173 접속
2. Admin Key 입력 (`.env`에 설정된 `ADMIN_KEY`)
3. 로그인 완료!

---

## 🎨 주요 기능

### 1. 대시보드 (`/`)

- 📊 실시간 통계 (전체 이벤트, Featured, 신규, 업데이트)
- 📈 최근 수집 로그 테이블
- 한눈에 보는 운영 현황

### 2. 이벤트 관리 (`/events`)

- 🔍 검색 및 필터링 (제목, 카테고리, Featured)
- 📋 이벤트 목록 테이블
- ✏️ 이벤트 상세보기 및 수정
  - Featured 상태 변경
  - Featured Order 설정
- 📄 페이지네이션

### 3. 팝업 추가 (`/popup/create`) ⭐ **핵심 기능**

#### Step 1: Instagram URL 자동 채우기
```
Instagram URL 입력 → [🤖 자동 채우기] 버튼 클릭
↓
AI가 자동으로 추출:
- 제목
- 브랜드
- 시작일/종료일
- 장소
- 주소 (지오코딩)
- 이미지 (OG 이미지)
- 설명
```

#### Step 2: 정보 확인 및 수정
```
자동으로 채워진 정보 확인
↓
필요시 수동 수정
↓
[💾 저장하기] 클릭
```

**자동 채우기 표시:**
- 🤖 AI가 자동으로 추출했어요 (AI 생성)
- 📍 Naver에서 자동 검색 (API 연동)
- 🗺️ 지오코딩 완료 (좌표 자동 추출)
- 🔗 OG 이미지 자동 추출

---

## 🎨 디자인 특징

### Modern & Intuitive

- ✨ **Toss 스타일** 브랜드 컬러 (Primary Blue)
- 🎯 **직관적인 UI/UX**
- 📱 **반응형 디자인** (모바일 지원)
- 🎨 **깔끔한 카드 레이아웃**
- 🔥 **부드러운 애니메이션**

### TailwindCSS 커스텀 클래스

```css
.card           - 깔끔한 카드 스타일
.btn-primary    - Primary 버튼
.btn-secondary  - Secondary 버튼
.input          - 입력 필드
.badge          - 상태 배지 (green, blue, purple, red, gray)
```

---

## 🔐 보안

- ✅ Admin Key 기반 인증
- ✅ localStorage에 키 저장
- ✅ 401 에러 시 자동 로그아웃
- ✅ Protected Route 적용

---

## 🌐 API 연동

### Backend API 엔드포인트

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/admin/verify` | Admin Key 검증 |
| GET | `/admin/dashboard` | 대시보드 통계 |
| GET | `/admin/events` | 이벤트 목록 |
| GET | `/admin/events/:id` | 이벤트 상세 |
| PATCH | `/admin/events/:id` | 이벤트 수정 |
| POST | `/admin/events/popup` | 팝업 생성 (향후 구현) |

---

## 🚧 향후 작업 (Backend 연동)

1. **팝업 생성 API 구현**
   ```typescript
   POST /admin/events/popup
   - Instagram URL 파싱
   - AI 데이터 추출 (Gemini)
   - Naver API 연동
   - 지오코딩
   - DB 저장
   ```

2. **자동 채우기 API 구현**
   ```typescript
   POST /admin/popup/auto-fill
   - Instagram 크롤링/OG 파싱
   - AI 구조화
   - Naver 검색
   - 응답 반환
   ```

---

## 💡 사용 팁

### 팝업 추가 워크플로우

1. Instagram에서 팝업 게시물 찾기
2. URL 복사
3. Admin 페이지 → "팝업 추가" 메뉴
4. URL 붙여넣기 → "자동 채우기" 클릭
5. AI가 자동으로 정보 추출 (2초 소요)
6. 정보 확인 및 수정
7. 저장!

### 이벤트 Featured 설정

1. "이벤트 관리" 메뉴
2. 이벤트 클릭
3. "Featured" 체크박스 활성화
4. "Featured Order" 입력 (낮을수록 우선순위 높음)
5. 저장!

---

## 🎓 기술 스택 요약

| 카테고리 | 기술 |
|----------|------|
| 프레임워크 | React 18 + TypeScript |
| 빌드 | Vite |
| 스타일 | TailwindCSS + Pretendard 폰트 |
| 라우팅 | React Router v6 |
| 상태관리 | TanStack Query (React Query) |
| HTTP | Axios |
| 저장소 | localStorage (제약 없음) |

---

## ✅ 완료된 작업

- ✅ Vite + React + TypeScript 프로젝트 세팅
- ✅ TailwindCSS 설정 및 커스텀 스타일
- ✅ 라우팅 및 레이아웃 구조
- ✅ 로그인 페이지
- ✅ 대시보드 페이지
- ✅ 이벤트 관리 페이지
- ✅ 팝업 추가 페이지 (자동 채우기 UI)
- ✅ API 클라이언트 설정
- ✅ Protected Route
- ✅ 반응형 디자인

---

## 🎉 완성!

Modern Admin 페이지가 완성되었습니다!

**특징:**
- 🎨 이쁘고 직관적인 UI/UX
- 🤖 Instagram URL 자동 채우기 (시뮬레이션)
- 📊 실시간 대시보드
- ✏️ 이벤트 편집 기능
- 🚀 빠른 개발 환경 (Vite)

**다음 단계:**
Backend API 연동 (자동 채우기 로직 구현)


