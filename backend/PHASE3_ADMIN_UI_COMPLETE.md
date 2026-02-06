# Phase 3: Admin UI 카테고리별 특화 필드 구현 완료

## 📋 개요

Admin UI에서 전시/공연 카테고리별 특화 필드를 편집할 수 있도록 구현했습니다.

---

## ✅ 구현 내용

### 1️⃣ Frontend 타입 정의 추가

**파일**: `backend/admin-web/src/types/index.ts`

```typescript
// 전시 (Exhibition)
export interface ExhibitionDisplay {
  artists: string[];
  genre: string[];
  type: string;  // "기획전", "특별전", "상설전"
  duration_minutes: number | null;
  facilities: {
    photo_zone: boolean;
    audio_guide: boolean;
    goods_shop: boolean;
    cafe: boolean;
  };
  docent_tour: string | null;
  special_programs: string[];
  age_recommendation: string | null;
  photography_allowed: boolean | 'partial' | null;
  last_admission: string | null;
}

// 공연 (Performance)
export interface PerformanceDisplay {
  cast: string[];
  genre: string[];
  duration_minutes: number | null;
  intermission: boolean;
  age_limit: string;
  showtimes: {
    weekday?: string[];
    weekend?: string[];
    holiday?: string[];
    notes?: string;
  };
  runtime: string | null;
  crew: {
    director: string | null;
    writer: string | null;
    composer: string | null;
  };
  discounts: string[];
  last_admission: string | null;
}

// metadata 구조
export interface EventMetadata {
  display?: {
    exhibition?: ExhibitionDisplay;
    performance?: PerformanceDisplay;
  };
  internal?: {
    companions?: string[];
    time_availability?: string[];
    location_insights?: string[];
  };
}

// Event 타입에 metadata 추가
export interface Event {
  // ... 기존 필드 ...
  metadata: EventMetadata; // 🆕 구조화된 metadata
}
```

---

### 2️⃣ Admin UI 필드 추가

**파일**: `backend/admin-web/src/pages/EventsPage.tsx`

#### 전시 특화 필드 (main_category === '전시')

```typescript
{selectedEvent.main_category === '전시' && (
  <section>
    <h4>🎨 전시 특화 정보</h4>
    {/* 작가/아티스트 */}
    {/* 장르 */}
    {/* 전시 유형 */}
    {/* 권장 관람 시간 */}
    {/* 편의시설 (포토존, 오디오 가이드, 굿즈샵, 카페) */}
    {/* 도슨트 투어 */}
  </section>
)}
```

**입력 필드**:
- 작가/아티스트 (쉼표로 구분)
- 장르 (쉼표로 구분)
- 전시 유형 (기획전, 특별전, 상설전, 순회전)
- 권장 관람 시간 (분)
- 편의시설 (체크박스):
  - 📸 포토존
  - 🎧 오디오 가이드
  - 🛍️ 굿즈샵
  - ☕ 카페
- 도슨트 투어 (시간 정보)

#### 공연 특화 필드 (main_category === '공연')

```typescript
{selectedEvent.main_category === '공연' && (
  <section>
    <h4>🎭 공연 특화 정보</h4>
    {/* 출연진 */}
    {/* 장르 */}
    {/* 공연 시간 */}
    {/* 인터미션 */}
    {/* 연령 제한 */}
    {/* 할인 정보 */}
  </section>
)}
```

**입력 필드**:
- 출연진 (쉼표로 구분)
- 장르 (쉼표로 구분)
- 공연 시간 (분)
- 인터미션 (체크박스)
- 연령 제한
- 할인 정보 (쉼표로 구분)

---

### 3️⃣ 저장 로직 업데이트

**파일**: `backend/admin-web/src/pages/EventsPage.tsx`

```typescript
await adminApi.updateEvent(selectedEvent.id, {
  // ... 기존 필드 ...
  // 🆕 Phase 3: metadata (카테고리별 특화 필드)
  metadata: selectedEvent.metadata,
});
```

---

## 🖼️ UI 구조

### 전시 이벤트 상세 페이지

```
┌──────────────────────────────────────────┐
│ 이벤트 상세                          ✕  │
├──────────────────────────────────────────┤
│ [AI 보완 버튼들...]                     │
│                                          │
│ 📝 기본 정보                            │
│ ├─ 제목                                 │
│ ├─ 표시 제목                            │
│ └─ 개요                                 │
│                                          │
│ 🏷️ 카테고리                             │
│ ├─ 메인 카테고리: [전시 ▼]             │
│ └─ 서브 카테고리                        │
│                                          │
│ 🎨 전시 특화 정보 ◄─ 🆕               │
│ ├─ 작가/아티스트: [팀랩, 구사마 야요이]│
│ ├─ 장르: [미디어아트, 현대미술]        │
│ ├─ 전시 유형: [기획전 ▼]               │
│ ├─ 권장 관람 시간: [60] 분             │
│ ├─ 편의시설:                           │
│ │  ☑ 📸 포토존                         │
│ │  ☑ 🎧 오디오 가이드                  │
│ │  ☑ 🛍️ 굿즈샵                         │
│ │  ☐ ☕ 카페                            │
│ └─ 도슨트 투어: [매일 14:00, 16:00]   │
│                                          │
│ 📅 일정                                 │
│ 📍 위치                                 │
│ ... (기존 필드들) ...                   │
│                                          │
│ [💾 변경사항 저장]                      │
└──────────────────────────────────────────┘
```

### 공연 이벤트 상세 페이지

```
┌──────────────────────────────────────────┐
│ 이벤트 상세                          ✕  │
├──────────────────────────────────────────┤
│ [AI 보완 버튼들...]                     │
│                                          │
│ 📝 기본 정보                            │
│ 🏷️ 카테고리                             │
│ ├─ 메인 카테고리: [공연 ▼]             │
│ └─ 서브 카테고리                        │
│                                          │
│ 🎭 공연 특화 정보 ◄─ 🆕               │
│ ├─ 출연진: [조승우, 홍광호]            │
│ ├─ 장르: [뮤지컬, 창작]                │
│ ├─ 공연 시간: [120] 분                 │
│ ├─ 인터미션: ☑ 중간 휴식 있음          │
│ ├─ 연령 제한: [만 7세 이상]            │
│ └─ 할인 정보: [조기예매 20%, 청소년 30%]│
│                                          │
│ 📅 일정                                 │
│ 📍 위치                                 │
│ ... (기존 필드들) ...                   │
│                                          │
│ [💾 변경사항 저장]                      │
└──────────────────────────────────────────┘
```

---

## 🔄 데이터 흐름

### 1️⃣ 이벤트 조회 시

```
GET /admin/events/:id
  ↓
{
  id: "evt_123",
  title: "팀랩 미디어아트 전시",
  main_category: "전시",
  metadata: {
    display: {
      exhibition: {
        artists: ["팀랩"],
        genre: ["미디어아트"],
        type: "기획전",
        duration_minutes: 60,
        facilities: {
          photo_zone: true,
          audio_guide: true,
          goods_shop: true,
          cafe: false
        },
        docent_tour: "매일 14:00, 16:00",
        ...
      }
    }
  }
}
  ↓
Admin UI에서 전시 특화 필드 표시
```

### 2️⃣ 필드 수정 및 저장 시

```
Admin UI에서 "작가/아티스트" 수정
  ↓
setState로 selectedEvent.metadata.display.exhibition.artists 업데이트
  ↓
"변경사항 저장" 클릭
  ↓
PATCH /admin/events/:id
{
  metadata: {
    display: {
      exhibition: {
        artists: ["팀랩", "구사마 야요이"],  // 수정됨
        genre: ["미디어아트"],
        ...
      }
    }
  }
}
  ↓
Backend: metadata JSONB 컬럼 업데이트
  ↓
manually_edited_fields['metadata.display.exhibition'] = true (자동 마킹)
```

### 3️⃣ AI 보완 시

```
"AI로 정보 보완" 클릭
  ↓
POST /admin/events/:id/enrich
{
  forceFields: []  // 빈 필드만 채우기
}
  ↓
Backend: Naver API + Gemini AI
  ↓
extractedInfo.exhibition_display = {
  artists: ["팀랩"],
  genre: ["미디어아트", "현대미술"],
  facilities: {
    photo_zone: true,
    audio_guide: true,
    goods_shop: true,
    cafe: true
  },
  ...
}
  ↓
metadata.display.exhibition에 저장
  ↓
Admin UI에서 자동으로 반영
```

---

## 🧪 테스트 시나리오

### 시나리오 1: 전시 이벤트 편집

1. Admin UI 접속 (http://localhost:5173)
2. 이벤트 목록에서 **전시** 카테고리 이벤트 클릭
3. **"🎨 전시 특화 정보"** 섹션 확인
4. 필드 입력:
   - 작가/아티스트: `팀랩, 구사마 야요이`
   - 장르: `미디어아트, 현대미술`
   - 전시 유형: `기획전`
   - 권장 관람 시간: `60` 분
   - 포토존, 오디오 가이드, 굿즈샵 체크
   - 도슨트 투어: `매일 14:00, 16:00`
5. "변경사항 저장" 클릭
6. 저장 성공 메시지 확인
7. 이벤트 다시 조회해서 데이터 확인

### 시나리오 2: 공연 이벤트 편집

1. 이벤트 목록에서 **공연** 카테고리 이벤트 클릭
2. **"🎭 공연 특화 정보"** 섹션 확인
3. 필드 입력:
   - 출연진: `조승우, 홍광호`
   - 장르: `뮤지컬, 창작`
   - 공연 시간: `120` 분
   - 인터미션 체크
   - 연령 제한: `만 7세 이상`
   - 할인 정보: `조기예매 20%, 청소년 30%`
4. "변경사항 저장" 클릭
5. 저장 성공 메시지 확인

### 시나리오 3: AI 보완으로 자동 채우기

1. 전시 이벤트 클릭
2. 전시 특화 필드가 비어있음
3. "빈 필드만 AI 보완" 클릭
4. AI 분석 완료
5. **전시 특화 필드가 자동으로 채워짐** ✅
   - 작가/아티스트
   - 장르
   - 편의시설
   - 도슨트 투어
6. "변경사항 저장" 클릭

### 시나리오 4: 카테고리 변경 시 필드 전환

1. 공연 이벤트 클릭
2. 공연 특화 필드 확인
3. 메인 카테고리를 **"공연" → "전시"**로 변경
4. **공연 특화 필드 숨김, 전시 특화 필드 표시** ✅
5. 다시 **"전시" → "공연"**로 변경
6. **전시 특화 필드 숨김, 공연 특화 필드 표시** ✅

---

## 📊 구현 상태

### Core Data 필드 (기존)
- ✅ 제목, 개요, 카테고리
- ✅ 일정, 위치, 이미지
- ✅ 가격, 태그, 운영시간
- ✅ 외부 링크, 품질 플래그

### Phase 3: 카테고리별 특화 필드 (신규)

#### 전시 (Exhibition)
- ✅ 작가/아티스트 (입력)
- ✅ 장르 (입력)
- ✅ 전시 유형 (드롭다운)
- ✅ 권장 관람 시간 (숫자)
- ✅ 편의시설 (체크박스 4개)
- ✅ 도슨트 투어 (입력)
- ⏳ 특별 프로그램 (TODO)
- ⏳ 연령 추천 (TODO)
- ⏳ 촬영 가능 여부 (TODO)
- ⏳ 입장 마감 시간 (TODO)

#### 공연 (Performance)
- ✅ 출연진 (입력)
- ✅ 장르 (입력)
- ✅ 공연 시간 (숫자)
- ✅ 인터미션 (체크박스)
- ✅ 연령 제한 (입력)
- ✅ 할인 정보 (입력)
- ⏳ 공연 시간대 (TODO: 구조화)
- ⏳ 런타임 설명 (TODO)
- ⏳ 제작진 (TODO: 연출, 작가, 작곡)
- ⏳ 입장 마감 시간 (TODO)

---

## 🔧 향후 개선 사항

### 1️⃣ 코드 리팩토링
- Helper 함수로 반복 코드 제거
- Custom Hook으로 metadata 상태 관리

### 2️⃣ 추가 필드 구현
- 전시: 특별 프로그램, 연령 추천, 촬영 가능 여부
- 공연: 공연 시간대 (구조화), 제작진 (세부)

### 3️⃣ 유효성 검사
- 필수 필드 체크
- 형식 검증 (시간, 가격 등)

### 4️⃣ UX 개선
- 자동 저장 (Debounce)
- 필드 안내 툴팁
- 에러 메시지 표시

---

## 🎉 완료!

**Admin UI에서 전시/공연 카테고리별 특화 필드를 편집할 수 있습니다!**

- ✅ Frontend 타입 정의
- ✅ Admin UI 필드 추가 (조건부 렌더링)
- ✅ 저장 로직 업데이트
- ✅ AI 보완 통합

**테스트 가능**: http://localhost:5173

**다음 단계**: 축제, 팝업, 행사 카테고리 특화 필드 추가 (Phase 3.2)

