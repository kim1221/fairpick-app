# Phase 3: 카테고리별 디스플레이 필드 구현 계획

**목표**: 사용자에게 보여줄 카테고리별 상세 정보를 자동으로 추출하여 `metadata.display`에 저장

---

## 📊 1. 현재 데이터 소스 분석

### 사용 가능한 데이터

```sql
-- 1. Raw 테이블 (원본 API payload)
raw_kopis_events.payload     -- KOPIS (공연/전시)
raw_culture_events.payload   -- 서울문화포털 (전시/행사)
raw_tour_events.payload      -- 한국관광공사 (축제/관광)

-- 2. Canonical 테이블
canonical_events.sources      -- 모든 원본 소스 참조 (rawTable, rawId)
canonical_events.overview     -- AI가 추출한 설명
canonical_events.derived_tags -- AI가 추출한 태그
canonical_events.external_links -- AI가 추출한 링크
```

### 데이터 접근 방법

```typescript
// overviewBackfill.ts에서 사용하는 패턴
async function getRawEventPayload(rawTable: string, rawId: string) {
  const result = await pool.query(
    `SELECT payload FROM ${rawTable} WHERE id = $1`,
    [rawId]
  );
  return result.rows[0]?.payload || null;
}
```

---

## 🎯 2. 카테고리별 추출 필드 정의

### 2-1. 전시 (Exhibition)

#### 우선순위 A (핵심 필드)
```typescript
metadata.display.exhibition = {
  // 작가/아티스트
  artists: string[];              // 예: ["팀랩", "구사마 야요이"]
  
  // 장르
  art_genre: string[];            // 예: ["미디어아트", "현대미술", "사진"]
  
  // 전시 유형
  exhibition_type: string;        // 예: "기획전", "특별전", "상설전", "순회전"
  
  // 관람 시간
  avg_duration_minutes: number;   // 예: 60 (권장 관람 시간)
  
  // 편의 시설
  facilities: {
    photo_zone: boolean;          // 포토존 있음
    audio_guide: boolean;         // 오디오 가이드 제공
    goods_shop: boolean;          // 굿즈샵 있음
    cafe: boolean;                // 카페 있음
  };
}
```

#### 우선순위 B (부가 정보)
```typescript
{
  // 도슨트 투어
  docent_tour: string | null;     // 예: "매일 14:00, 16:00" 또는 null
  
  // 특별 프로그램
  special_programs: string[];     // 예: ["작가와의 대화", "어린이 체험"]
  
  // 연령 제한
  age_recommendation: string;     // 예: "전체관람가", "12세 이상"
}
```

#### 데이터 추출 전략
```typescript
// 1. API payload에서 추출
artists: 
  - KOPIS: payload.prfcast (출연진 → 작가로 해석)
  - Culture: payload.ORG_NAME (주최기관 → 작가로 해석)
  
art_genre:
  - KOPIS: payload.genrenm (장르명)
  - derived_tags에서 "미디어아트", "현대미술" 등 추출
  
exhibition_type:
  - sub_category 매핑 (특별전, 기획전, 상설전 등)
  
// 2. AI 분석 (overview, external_links 크롤링)
facilities:
  - overview에서 "포토존", "오디오가이드", "굿즈샵" 키워드 검색
  - 없으면 null

docent_tour:
  - overview에서 "도슨트", "해설", "가이드 투어" 패턴 매칭
  - 시간 정보 추출 (정규식)
```

---

### 2-2. 공연 (Performance)

#### 우선순위 A
```typescript
metadata.display.performance = {
  // 출연진
  cast: string[];                 // 예: ["김광석", "이승환", "싸이"]
  
  // 장르
  genre: string[];                // 예: ["뮤지컬", "콘서트", "발라드"]
  
  // 공연 시간
  duration_minutes: number;       // 예: 120 (공연 시간)
  
  // 인터미션
  intermission: boolean;          // 중간 휴식 있음
  
  // 연령 제한
  age_limit: string;              // 예: "전체관람가", "만 7세 이상"
  
  // 공연 횟수
  showtimes: string[];            // 예: ["평일 19:30", "주말 14:00, 18:00"]
}
```

#### 우선순위 B
```typescript
{
  // 런타임
  runtime: string;                // 예: "2시간 30분 (인터미션 20분 포함)"
  
  // 제작진
  crew: {
    director: string | null;      // 연출
    writer: string | null;        // 작가
    composer: string | null;      // 작곡
  };
  
  // 특별 혜택
  discounts: string[];            // 예: ["조기예매 30%", "학생 50%"]
}
```

#### 데이터 추출 전략
```typescript
// 1. API payload (KOPIS 중심)
cast:
  - KOPIS: payload.prfcast (출연진, 쉼표로 분리)
  
genre:
  - KOPIS: payload.genrenm
  - sub_category
  
duration_minutes:
  - KOPIS: payload.prfruntime ("120분" → 120)
  - 정규식: /(\d+)분/
  
age_limit:
  - KOPIS: payload.prfage
  
showtimes:
  - KOPIS: payload.dtguidance (공연시간 안내)
  - 정규식으로 시간 추출

// 2. AI 분석
intermission:
  - overview에서 "인터미션", "중간 휴식" 키워드
  
crew:
  - overview에서 "연출:", "작가:", "작곡:" 패턴 매칭
```

---

### 2-3. 팝업 (Popup)

#### 우선순위 A
```typescript
metadata.display.popup = {
  // 브랜드
  brand: string;                  // 예: "무신사", "나이키"
  
  // 콜라보레이션
  collaboration: string | null;   // 예: "나이키 x 무신사" 또는 null
  
  // 팝업 유형
  popup_type: string;             // 예: "패션", "F&B", "캐릭터", "전시형"
  
  // 특징
  features: {
    limited_goods: boolean;       // 한정 굿즈 판매
    photo_zone: boolean;          // 포토존
    experience: boolean;          // 체험 프로그램
    reservation_required: boolean;// 사전 예약 필요
  };
  
  // 입장료
  entrance_fee: string;           // 예: "무료", "5,000원 (음료 쿠폰 포함)"
}
```

#### 우선순위 B
```typescript
{
  // 특별 이벤트
  special_events: string[];       // 예: ["오픈 기념 사은품", "인스타 인증 이벤트"]
  
  // 운영 방식
  operation_style: string;        // 예: "선착순 입장", "사전 예약제", "자유 관람"
}
```

#### 데이터 추출 전략
```typescript
// 1. 제목/Overview 분석
brand:
  - title에서 브랜드명 추출
  - 예: "무신사 팝업스토어" → "무신사"
  - 정규식 또는 AI 분석

collaboration:
  - title/overview에서 "x", "×", "콜라보" 키워드
  - 예: "나이키 x 무신사" → "나이키 x 무신사"

popup_type:
  - derived_tags, sub_category 기반 분류
  - 예: ["패션", "F&B"] → "패션"

// 2. AI 분석 (overview, external_links)
features:
  - "한정 굿즈", "포토존", "체험", "예약 필수" 키워드

entrance_fee:
  - price_info 또는 overview에서 추출
  - 예: "무료 입장", "입장료 5,000원"
```

---

### 2-4. 축제 (Festival)

#### 우선순위 A
```typescript
metadata.display.festival = {
  // 축제 유형
  festival_type: string;          // 예: "음악", "문화", "음식", "지역축제"
  
  // 규모
  scale: string;                  // 예: "대규모", "중규모", "소규모"
  
  // 주요 프로그램
  main_programs: string[];        // 예: ["개막 공연", "불꽃놀이", "먹거리장터"]
  
  // 편의시설
  facilities: {
    parking: boolean;             // 주차장
    food_court: boolean;          // 먹거리장터
    kids_zone: boolean;           // 어린이 놀이터
    rest_area: boolean;           // 휴게소
  };
  
  // 날씨 영향
  weather_dependent: boolean;     // 야외 축제 여부
}
```

#### 데이터 추출 전략
```typescript
// 1. API payload (TourAPI 중심)
festival_type:
  - TourAPI: payload.eventstartdate, payload.eventenddate
  - sub_category 매핑

main_programs:
  - overview에서 "프로그램:", "일정:" 섹션 파싱
  - AI 분석

// 2. 위치 기반 분석
weather_dependent:
  - 주소에 "야외", "광장", "공원" 키워드
  - venue 분석
  
facilities:
  - overview에서 키워드 검색
  - 예: "주차장 운영", "먹거리부스", "키즈존"
```

---

### 2-5. 행사 (Event)

#### 우선순위 A
```typescript
metadata.display.event = {
  // 행사 유형
  event_type: string;             // 예: "컨퍼런스", "워크샵", "박람회", "세미나"
  
  // 대상
  target_audience: string[];      // 예: ["일반인", "전문가", "학생"]
  
  // 주최
  organizer: string;              // 예: "서울시", "문화체육관광부"
  
  // 참가 방식
  participation: {
    registration_required: boolean; // 사전 등록 필요
    capacity: number | null;        // 수용 인원
    on_site_ok: boolean;            // 현장 등록 가능
  };
}
```

---

## 🏗️ 3. 파일 구조 및 설계

### 3-1. 디렉토리 구조
```
backend/src/
├── jobs/
│   ├── enrichInternalFields.ts         ✅ Phase 2
│   └── enrichDisplayFields.ts          🆕 Phase 3 메인
│
├── lib/
│   ├── internalFieldsGenerator.ts      ✅ Phase 2
│   └── displayFieldsGenerator/         🆕 Phase 3
│       ├── index.ts                    (메인 엔트리)
│       ├── types.ts                    (타입 정의)
│       ├── extractors/
│       │   ├── exhibitionExtractor.ts  (전시)
│       │   ├── performanceExtractor.ts (공연)
│       │   ├── popupExtractor.ts       (팝업)
│       │   ├── festivalExtractor.ts    (축제)
│       │   └── eventExtractor.ts       (행사)
│       └── utils/
│           ├── payloadReader.ts        (payload 조회)
│           ├── textAnalyzer.ts         (텍스트 패턴 매칭)
│           └── aiAnalyzer.ts           (AI 분석, 선택)
│
└── scripts/
    └── run-phase3-enrichment.ts        🆕 Phase 3 실행 스크립트
```

---

### 3-2. 타입 정의

```typescript
// lib/displayFieldsGenerator/types.ts

// 전시
export interface ExhibitionDisplay {
  artists: string[];
  art_genre: string[];
  exhibition_type: string;
  avg_duration_minutes: number | null;
  facilities: {
    photo_zone: boolean;
    audio_guide: boolean;
    goods_shop: boolean;
    cafe: boolean;
  };
  docent_tour: string | null;
  special_programs: string[];
  age_recommendation: string | null;
}

// 공연
export interface PerformanceDisplay {
  cast: string[];
  genre: string[];
  duration_minutes: number | null;
  intermission: boolean;
  age_limit: string;
  showtimes: string[];
  runtime: string | null;
  crew: {
    director: string | null;
    writer: string | null;
    composer: string | null;
  };
  discounts: string[];
}

// 팝업
export interface PopupDisplay {
  brand: string;
  collaboration: string | null;
  popup_type: string;
  features: {
    limited_goods: boolean;
    photo_zone: boolean;
    experience: boolean;
    reservation_required: boolean;
  };
  entrance_fee: string;
  special_events: string[];
  operation_style: string | null;
}

// 축제
export interface FestivalDisplay {
  festival_type: string;
  scale: string;
  main_programs: string[];
  facilities: {
    parking: boolean;
    food_court: boolean;
    kids_zone: boolean;
    rest_area: boolean;
  };
  weather_dependent: boolean;
}

// 행사
export interface EventDisplay {
  event_type: string;
  target_audience: string[];
  organizer: string;
  participation: {
    registration_required: boolean;
    capacity: number | null;
    on_site_ok: boolean;
  };
}

// 통합
export type DisplayFields = 
  | { exhibition: ExhibitionDisplay }
  | { performance: PerformanceDisplay }
  | { popup: PopupDisplay }
  | { festival: FestivalDisplay }
  | { event: EventDisplay };

// Job 입력 데이터
export interface EventDataForDisplay {
  id: string;
  title: string;
  main_category: string;
  sub_category: string | null;
  overview: string | null;
  derived_tags: string[];
  external_links: Record<string, string | null>;
  sources: Array<{
    source: string;
    rawTable: string;
    rawId: string;
  }>;
  venue: string | null;
  address: string | null;
  price_info: string | null;
}
```

---

### 3-3. 메인 Generator

```typescript
// lib/displayFieldsGenerator/index.ts

import { EventDataForDisplay, DisplayFields } from './types';
import { extractExhibitionDisplay } from './extractors/exhibitionExtractor';
import { extractPerformanceDisplay } from './extractors/performanceExtractor';
import { extractPopupDisplay } from './extractors/popupExtractor';
import { extractFestivalDisplay } from './extractors/festivalExtractor';
import { extractEventDisplay } from './extractors/eventExtractor';

export async function generateDisplayFields(
  event: EventDataForDisplay
): Promise<DisplayFields | null> {
  const category = event.main_category?.toLowerCase();

  switch (category) {
    case '전시':
      return { exhibition: await extractExhibitionDisplay(event) };
    
    case '공연':
      return { performance: await extractPerformanceDisplay(event) };
    
    case '팝업':
      return { popup: await extractPopupDisplay(event) };
    
    case '축제':
      return { festival: await extractFestivalDisplay(event) };
    
    case '행사':
      return { event: await extractEventDisplay(event) };
    
    default:
      console.warn(`[Phase 3] Unknown category: ${event.main_category}`);
      return null;
  }
}
```

---

### 3-4. Extractor 예시 (전시)

```typescript
// lib/displayFieldsGenerator/extractors/exhibitionExtractor.ts

import { EventDataForDisplay, ExhibitionDisplay } from '../types';
import { getPayloadFromSources } from '../utils/payloadReader';
import { extractKeywords, extractTime } from '../utils/textAnalyzer';

export async function extractExhibitionDisplay(
  event: EventDataForDisplay
): Promise<ExhibitionDisplay> {
  
  // 1. API payload 가져오기
  const payloads = await getPayloadFromSources(event.sources);
  const primaryPayload = payloads[0]; // 우선순위 높은 소스
  
  // 2. 작가 추출
  const artists = extractArtists(primaryPayload, event);
  
  // 3. 장르 추출
  const art_genre = extractArtGenre(primaryPayload, event.derived_tags);
  
  // 4. 전시 유형
  const exhibition_type = mapExhibitionType(event.sub_category);
  
  // 5. 관람 시간 (기본값 60분)
  const avg_duration_minutes = 60;
  
  // 6. 편의시설 (overview 키워드 검색)
  const facilities = extractFacilities(event.overview);
  
  // 7. 도슨트 투어
  const docent_tour = extractDocentTour(event.overview);
  
  // 8. 특별 프로그램
  const special_programs = extractSpecialPrograms(event.overview);
  
  // 9. 연령 추천
  const age_recommendation = extractAgeRecommendation(
    primaryPayload,
    event.derived_tags
  );
  
  return {
    artists,
    art_genre,
    exhibition_type,
    avg_duration_minutes,
    facilities,
    docent_tour,
    special_programs,
    age_recommendation,
  };
}

// ========== 헬퍼 함수들 ==========

function extractArtists(payload: any, event: EventDataForDisplay): string[] {
  const artists: string[] = [];
  
  // KOPIS: prfcast
  if (payload?.prfcast) {
    const cast = payload.prfcast.split(',').map((s: string) => s.trim());
    artists.push(...cast);
  }
  
  // Culture: ORG_NAME
  if (payload?.ORG_NAME) {
    artists.push(payload.ORG_NAME);
  }
  
  // overview에서 "작가:" 패턴
  if (event.overview) {
    const match = event.overview.match(/작가[:\s]+([가-힣a-zA-Z,\s]+)/);
    if (match) {
      const names = match[1].split(',').map((s: string) => s.trim());
      artists.push(...names);
    }
  }
  
  // 중복 제거
  return [...new Set(artists)].slice(0, 5);
}

function extractArtGenre(payload: any, tags: string[]): string[] {
  const genres: string[] = [];
  
  // KOPIS: genrenm
  if (payload?.genrenm) {
    genres.push(payload.genrenm);
  }
  
  // derived_tags에서 장르 태그 추출
  const genreTags = ['미디어아트', '현대미술', '사진', '조각', '회화'];
  const matchedGenres = tags.filter(tag => genreTags.includes(tag));
  genres.push(...matchedGenres);
  
  return [...new Set(genres)];
}

function mapExhibitionType(sub_category: string | null): string {
  if (!sub_category) return '전시';
  
  const mapping: Record<string, string> = {
    '특별전': '특별전',
    '기획전': '기획전',
    '상설전': '상설전',
    '순회전': '순회전',
  };
  
  return mapping[sub_category] || '전시';
}

function extractFacilities(overview: string | null): ExhibitionDisplay['facilities'] {
  if (!overview) {
    return {
      photo_zone: false,
      audio_guide: false,
      goods_shop: false,
      cafe: false,
    };
  }
  
  const text = overview.toLowerCase();
  
  return {
    photo_zone: /포토존|포토 존|photo zone|사진 촬영/.test(text),
    audio_guide: /오디오가이드|오디오 가이드|audio guide/.test(text),
    goods_shop: /굿즈샵|굿즈 샵|기념품샵|뮤지엄샵/.test(text),
    cafe: /카페|커피|cafe|휴게/.test(text),
  };
}

function extractDocentTour(overview: string | null): string | null {
  if (!overview) return null;
  
  // "도슨트: 매일 14:00, 16:00" 패턴
  const match = overview.match(/도슨트[:\s]+(.+?)(?:\n|$)/i);
  if (match) {
    return match[1].trim();
  }
  
  return null;
}

function extractSpecialPrograms(overview: string | null): string[] {
  if (!overview) return [];
  
  const programs: string[] = [];
  const keywords = ['작가와의 대화', '워크샵', '체험', '교육 프로그램'];
  
  for (const keyword of keywords) {
    if (overview.includes(keyword)) {
      programs.push(keyword);
    }
  }
  
  return programs;
}

function extractAgeRecommendation(
  payload: any,
  tags: string[]
): string | null {
  // KOPIS: prfage
  if (payload?.prfage) {
    return payload.prfage;
  }
  
  // tags에서 추론
  if (tags.includes('어린이') || tags.includes('아이와함께')) {
    return '전체관람가';
  }
  
  return null;
}
```

---

### 3-5. Payload Reader Utility

```typescript
// lib/displayFieldsGenerator/utils/payloadReader.ts

import { pool } from '../../../db';

export async function getPayloadFromSources(
  sources: Array<{ source: string; rawTable: string; rawId: string }>
): Promise<any[]> {
  const payloads: any[] = [];
  
  for (const source of sources) {
    try {
      const result = await pool.query(
        `SELECT payload FROM ${source.rawTable} WHERE id = $1`,
        [source.rawId]
      );
      
      if (result.rows[0]?.payload) {
        payloads.push(result.rows[0].payload);
      }
    } catch (error) {
      console.error(`[PayloadReader] Failed to fetch from ${source.rawTable}:`, error);
    }
  }
  
  return payloads;
}
```

---

### 3-6. Job 구현

```typescript
// jobs/enrichDisplayFields.ts

import { pool } from '../db';
import { generateDisplayFields } from '../lib/displayFieldsGenerator';
import type { EventDataForDisplay } from '../lib/displayFieldsGenerator/types';

interface CanonicalEventRow {
  id: string;
  title: string;
  main_category: string;
  sub_category: string | null;
  overview: string | null;
  derived_tags: string[] | null;
  external_links: any;
  sources: any;
  venue: string | null;
  address: string | null;
  price_info: string | null;
}

/**
 * 단일 이벤트의 display fields 재계산
 */
export async function enrichSingleDisplayFields(eventId: string): Promise<boolean> {
  try {
    console.log(`[Phase 3] Enriching display fields for event: ${eventId}`);
    
    const result = await pool.query<CanonicalEventRow>(`
      SELECT 
        id, title, main_category, sub_category,
        overview, derived_tags, external_links,
        sources, venue, address, price_info
      FROM canonical_events
      WHERE id = $1
    `, [eventId]);

    if (result.rows.length === 0) {
      console.warn(`[Phase 3] Event not found: ${eventId}`);
      return false;
    }

    const event = result.rows[0];
    
    // Display fields 생성
    const eventData: EventDataForDisplay = {
      id: event.id,
      title: event.title,
      main_category: event.main_category,
      sub_category: event.sub_category,
      overview: event.overview,
      derived_tags: event.derived_tags || [],
      external_links: event.external_links || {},
      sources: event.sources || [],
      venue: event.venue,
      address: event.address,
      price_info: event.price_info,
    };
    
    const displayFields = await generateDisplayFields(eventData);
    
    if (!displayFields) {
      console.warn(`[Phase 3] No display fields generated for ${eventId}`);
      return false;
    }
    
    // metadata.display 업데이트
    await pool.query(`
      UPDATE canonical_events
      SET metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{display}',
        $1::jsonb
      )
      WHERE id = $2
    `, [JSON.stringify(displayFields), eventId]);
    
    console.log(`[Phase 3] ✅ Event ${eventId} display fields updated`);
    return true;
  } catch (error) {
    console.error(`[Phase 3] ❌ Error enriching event ${eventId}:`, error);
    return false;
  }
}

/**
 * 전체 이벤트의 display fields 생성
 */
export async function enrichDisplayFields() {
  console.log('[Phase 3] Starting enrichDisplayFields job...');
  
  const startTime = Date.now();
  let processedCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  try {
    const result = await pool.query<CanonicalEventRow>(`
      SELECT 
        id, title, main_category, sub_category,
        overview, derived_tags, external_links,
        sources, venue, address, price_info
      FROM canonical_events
      WHERE is_deleted = false
        AND end_at >= CURRENT_DATE
      ORDER BY created_at DESC
    `);

    console.log(`[Phase 3] Found ${result.rows.length} live events`);

    for (const event of result.rows) {
      processedCount++;
      
      try {
        const eventData: EventDataForDisplay = {
          id: event.id,
          title: event.title,
          main_category: event.main_category,
          sub_category: event.sub_category,
          overview: event.overview,
          derived_tags: event.derived_tags || [],
          external_links: event.external_links || {},
          sources: event.sources || [],
          venue: event.venue,
          address: event.address,
          price_info: event.price_info,
        };
        
        const displayFields = await generateDisplayFields(eventData);
        
        if (displayFields) {
          await pool.query(`
            UPDATE canonical_events
            SET metadata = jsonb_set(
              COALESCE(metadata, '{}'::jsonb),
              '{display}',
              $1::jsonb
            )
            WHERE id = $2
          `, [JSON.stringify(displayFields), event.id]);
          
          updatedCount++;
        }
        
        if (processedCount % 100 === 0) {
          console.log(`[Phase 3] Processed ${processedCount}/${result.rows.length} events...`);
        }
      } catch (error) {
        errorCount++;
        console.error(`[Phase 3] Error processing event ${event.id}:`, error);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`[Phase 3] Enrichment completed!`);
    console.log(`  - Total events: ${result.rows.length}`);
    console.log(`  - Processed: ${processedCount}`);
    console.log(`  - Updated: ${updatedCount}`);
    console.log(`  - Errors: ${errorCount}`);
    console.log(`  - Duration: ${duration}s`);
    
  } catch (error) {
    console.error('[Phase 3] Job failed:', error);
    throw error;
  }
}
```

---

## 🔄 4. 스케줄러 연동

```typescript
// src/scheduler.ts

import { enrichDisplayFields } from './jobs/enrichDisplayFields';

// 매일 04:20 KST - Phase 3: Display Fields 생성 (Phase 2 직후)
cron.schedule('20 4 * * *', async () => {
  await runJobSafely('phase3-display-fields', enrichDisplayFields);
}, {
  timezone: 'Asia/Seoul'
});
console.log('[Scheduler] registered: Phase 3 Display Fields @ 04:20 KST');
```

---

## 🔄 5. Admin 수정 시 자동 재계산

```typescript
// src/index.ts

import { enrichSingleDisplayFields } from './jobs/enrichDisplayFields';

app.patch('/admin/events/:id', requireAdminAuth, async (req, res) => {
  // ... DB UPDATE ...
  
  // Phase 2 재계산 (기존)
  const shouldRecalcPhase2 = 
    req.body.derived_tags !== undefined ||
    req.body.opening_hours !== undefined ||
    req.body.lat !== undefined ||
    req.body.lng !== undefined;
  
  if (shouldRecalcPhase2) {
    enrichSingleEvent(req.params.id);
  }
  
  // Phase 3 재계산 (신규)
  const shouldRecalcPhase3 = 
    req.body.overview !== undefined ||        // 설명 변경
    req.body.derived_tags !== undefined ||    // 태그 변경
    req.body.external_links !== undefined ||  // 링크 변경
    req.body.main_category !== undefined ||   // 카테고리 변경
    req.body.sub_category !== undefined ||    // 서브 카테고리 변경
    req.body.price_info !== undefined;        // 가격 정보 변경
  
  if (shouldRecalcPhase3) {
    console.log('[Admin] Triggering Phase 3 recalculation for event:', req.params.id);
    enrichSingleDisplayFields(req.params.id).catch(error => {
      console.error('[Admin] Phase 3 recalculation failed:', error);
    });
  }
  
  res.json({ success: true });
});
```

---

## 📊 6. 우선순위 및 단계별 구현

### 6-1. MVP (1주차)

**목표**: 전시, 공연 카테고리만 구현

```
✅ 전시 (Exhibition)
  - artists, art_genre, exhibition_type
  - facilities (기본)
  
✅ 공연 (Performance)
  - cast, genre, duration_minutes
  - age_limit
```

**구현 범위**:
- `exhibitionExtractor.ts` (우선순위 A만)
- `performanceExtractor.ts` (우선순위 A만)
- `enrichDisplayFields.ts` (Job)
- `payloadReader.ts` (Utility)

---

### 6-2. Phase 1 (2주차)

**목표**: 전시, 공연 확장 + 팝업 추가

```
✅ 전시 우선순위 B 추가
  - docent_tour, special_programs
  
✅ 공연 우선순위 B 추가
  - runtime, crew, discounts
  
✅ 팝업 추가
  - brand, collaboration, popup_type
  - features
```

---

### 6-3. Phase 2 (3주차)

**목표**: 축제, 행사 추가

```
✅ 축제 (Festival)
✅ 행사 (Event)
```

---

## 🧪 7. 테스트 계획

### 7-1. 단위 테스트

```bash
# lib/displayFieldsGenerator/extractors/exhibitionExtractor.test.ts

describe('exhibitionExtractor', () => {
  it('should extract artists from KOPIS payload', async () => {
    const event = {
      // ... mock data
    };
    
    const result = await extractExhibitionDisplay(event);
    expect(result.artists).toEqual(['팀랩', '구사마 야요이']);
  });
  
  it('should detect photo zone from overview', async () => {
    const event = {
      overview: '전시에는 포토존이 마련되어 있습니다.',
      // ...
    };
    
    const result = await extractExhibitionDisplay(event);
    expect(result.facilities.photo_zone).toBe(true);
  });
});
```

---

### 7-2. 통합 테스트

```bash
# scripts/test-phase3.sh

#!/bin/bash

# 1. 단일 이벤트 테스트
echo "Testing single event enrichment..."
curl -X POST http://localhost:5001/admin/events/abc-123/enrich-display \
  -H "x-admin-key: $ADMIN_KEY"

# 2. 결과 확인
psql -d fairpick -c "
  SELECT 
    id, title, main_category,
    metadata->'display' as display_fields
  FROM canonical_events
  WHERE id = 'abc-123'
"

# 3. API 테스트
curl http://localhost:5001/events/abc-123 | jq '.display'
```

---

## 📈 8. 성능 예상

```
전체 이벤트: 2,000개
카테고리별:
  - 전시: 600개
  - 공연: 800개
  - 팝업: 300개
  - 축제: 200개
  - 행사: 100개

이벤트당 처리 시간:
  - Payload 조회: 10ms
  - 추출 로직: 20ms
  - DB 업데이트: 10ms
  총: 40ms/이벤트

전체 소요 시간: 2,000 × 40ms = 80초 (1.3분)
```

---

## 🎯 9. 성공 기준

### 데이터 품질
- ✅ 전시 80% 이상 작가 정보 추출
- ✅ 공연 90% 이상 출연진 정보 추출
- ✅ 팝업 70% 이상 브랜드 정보 추출

### 성능
- ✅ 전체 Job 완료: 2분 이내
- ✅ 단일 이벤트 재계산: 100ms 이내

### 안정성
- ✅ 에러율 5% 이하
- ✅ Null 처리 완벽

---

## ✅ 다음 단계

**작업 진행 여부 확인 후**:

1. **MVP 구현 시작** (전시, 공연만)
   - `lib/displayFieldsGenerator/types.ts`
   - `lib/displayFieldsGenerator/extractors/exhibitionExtractor.ts`
   - `lib/displayFieldsGenerator/extractors/performanceExtractor.ts`
   - `lib/displayFieldsGenerator/utils/payloadReader.ts`
   - `lib/displayFieldsGenerator/index.ts`
   - `jobs/enrichDisplayFields.ts`

2. **테스트 스크립트 작성**
   - `scripts/run-phase3-enrichment.ts`
   - `scripts/test-phase3.sh`

3. **실행 및 검증**
   - 샘플 이벤트로 테스트
   - 전체 Job 실행
   - 결과 검증

---

**준비 완료! 🚀**

이 계획으로 진행하면 Phase 3를 체계적으로 구현할 수 있습니다.
구현을 시작할까요?

