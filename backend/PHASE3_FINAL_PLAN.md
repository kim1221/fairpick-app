# Phase 3: 카테고리별 필드 구현 (최종안)

**핵심 전략**: JSONB 저장 + Phase 1 데이터 수집 방식

---

## 🎯 1. 전체 전략

### 저장 방식: JSONB (원래 계획)
```sql
canonical_events:
  metadata = {
    "internal": {...},     -- Phase 2 (추천 엔진용)
    "display": {
      "exhibition": {...}  -- 전시 이벤트만 (또는 performance, popup 등)
    }
  }
```

### 데이터 수집: Phase 1 방식
```
1. 공공 API (KOPIS, Culture, TourAPI)
   - prfcast, genrenm, prfruntime 등
   
2. 네이버 API + AI 보완
   - 부족한 필드 채우기
   
3. 수동 입력 (Admin)
   - 최종 검증 및 보완
```

---

## 📊 2. metadata.display 구조

### 2-1. 전시 (Exhibition)

```jsonb
metadata.display = {
  "exhibition": {
    // 작가/아티스트
    "artists": ["팀랩", "구사마 야요이"],
    
    // 장르
    "genre": ["미디어아트", "현대미술"],
    
    // 전시 유형
    "type": "기획전",  // "기획전", "특별전", "상설전", "순회전"
    
    // 권장 관람 시간 (분)
    "duration_minutes": 60,
    
    // 편의시설
    "facilities": {
      "photo_zone": true,
      "audio_guide": true,
      "goods_shop": false,
      "cafe": true
    },
    
    // 도슨트 투어
    "docent_tour": "매일 14:00, 16:00",
    
    // 특별 프로그램
    "special_programs": ["작가와의 대화", "어린이 체험"],
    
    // 연령 추천
    "age_recommendation": "전체관람가"
  }
}
```

---

### 2-2. 공연 (Performance)

```jsonb
metadata.display = {
  "performance": {
    // 출연진
    "cast": ["김광석", "이승환"],
    
    // 장르
    "genre": ["뮤지컬", "콘서트"],
    
    // 공연 시간 (분)
    "duration_minutes": 120,
    
    // 인터미션
    "intermission": true,
    
    // 연령 제한
    "age_limit": "만 7세 이상",
    
    // 공연 시간대
    "showtimes": ["평일 19:30", "주말 14:00, 18:00"],
    
    // 런타임 설명
    "runtime": "2시간 30분 (인터미션 20분 포함)",
    
    // 제작진
    "crew": {
      "director": "홍길동",
      "writer": "김작가",
      "composer": "박작곡"
    },
    
    // 할인 정보
    "discounts": ["조기예매 30%", "학생 50%"]
  }
}
```

---

### 2-3. 팝업 (Popup)

```jsonb
metadata.display = {
  "popup": {
    // 브랜드
    "brand": "무신사",
    
    // 콜라보레이션
    "collaboration": "나이키 x 무신사",
    
    // 팝업 유형
    "type": "패션",  // "패션", "F&B", "캐릭터", "전시형"
    
    // 특징
    "features": {
      "limited_goods": true,
      "photo_zone": true,
      "experience": true,
      "reservation_required": false
    },
    
    // 입장료
    "entrance_fee": "무료",
    
    // 특별 이벤트
    "special_events": ["오픈 기념 사은품", "인스타 인증 이벤트"],
    
    // 운영 방식
    "operation_style": "선착순 입장"
  }
}
```

---

## 🔄 3. 데이터 수집 파이프라인

### 3-1. 공공 API 우선 (Backfill Job)

```typescript
// jobs/displayFieldsBackfill.ts

/**
 * Phase 3: Display Fields Backfill
 * 공공 API payload에서 추출 가능한 필드 채우기
 */

export async function displayFieldsBackfill(options = {}) {
  const { dryRun = false, limit, category } = options;
  
  console.log('[DisplayBackfill] Starting...');
  
  // 1. 대상 이벤트 조회
  let query = `
    SELECT 
      id, title, main_category, sub_category, sources
    FROM canonical_events
    WHERE is_deleted = false
      AND end_at >= CURRENT_DATE
      AND (metadata->'display' IS NULL OR metadata->'display' = '{}'::jsonb)
  `;
  
  if (category) {
    query += ` AND main_category = '${category}'`;
  }
  
  if (limit) {
    query += ` LIMIT ${limit}`;
  }
  
  const result = await pool.query(query);
  console.log(`[DisplayBackfill] Found ${result.rows.length} events`);
  
  // 2. 카테고리별 처리
  for (const event of result.rows) {
    try {
      let displayData = null;
      
      switch (event.main_category) {
        case '전시':
          displayData = await extractExhibitionFromAPI(event);
          break;
        case '공연':
          displayData = await extractPerformanceFromAPI(event);
          break;
        case '팝업':
          displayData = await extractPopupFromAPI(event);
          break;
        case '축제':
          displayData = await extractFestivalFromAPI(event);
          break;
        case '행사':
          displayData = await extractEventFromAPI(event);
          break;
      }
      
      if (displayData && !dryRun) {
        await pool.query(`
          UPDATE canonical_events
          SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{display}',
            $1::jsonb
          )
          WHERE id = $2
        `, [JSON.stringify(displayData), event.id]);
        
        console.log(`[DisplayBackfill] ✅ Updated ${event.id}`);
      }
    } catch (error) {
      console.error(`[DisplayBackfill] ❌ Error ${event.id}:`, error);
    }
  }
}

// ========== 전시 추출 (API) ==========

async function extractExhibitionFromAPI(event: any) {
  // 1. Payload 가져오기
  const payloads = await getPayloadFromSources(event.sources);
  const kopisPayload = payloads.find(p => p.source === 'kopis')?.payload;
  
  if (!kopisPayload) {
    console.log(`[Exhibition] No KOPIS payload for ${event.id}`);
    return null;
  }
  
  // 2. 필드 추출
  const artists = extractArtists(kopisPayload);
  const genre = extractGenre(kopisPayload);
  const type = mapExhibitionType(event.sub_category);
  
  // 3. Display 객체 생성
  return {
    exhibition: {
      artists: artists,
      genre: genre,
      type: type,
      duration_minutes: 60,  // 기본값
      facilities: {
        photo_zone: false,
        audio_guide: false,
        goods_shop: false,
        cafe: false
      },
      docent_tour: null,
      special_programs: [],
      age_recommendation: null
    }
  };
}

function extractArtists(payload: any): string[] {
  if (!payload.prfcast) return [];
  
  // "팀랩, 구사마 야요이" → ["팀랩", "구사마 야요이"]
  return payload.prfcast
    .split(',')
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0)
    .slice(0, 10);
}

function extractGenre(payload: any): string[] {
  const genres: string[] = [];
  
  if (payload.genrenm) {
    genres.push(payload.genrenm);
  }
  
  return genres;
}

function mapExhibitionType(subCategory: string | null): string {
  if (!subCategory) return '전시';
  
  const mapping: Record<string, string> = {
    '특별전': '특별전',
    '기획전': '기획전',
    '상설전': '상설전',
    '순회전': '순회전',
  };
  
  return mapping[subCategory] || '전시';
}

// ========== 공연 추출 (API) ==========

async function extractPerformanceFromAPI(event: any) {
  const payloads = await getPayloadFromSources(event.sources);
  const kopisPayload = payloads.find(p => p.source === 'kopis')?.payload;
  
  if (!kopisPayload) return null;
  
  // 필드 추출
  const cast = extractCast(kopisPayload);
  const genre = extractPerformanceGenre(kopisPayload);
  const durationMinutes = extractDuration(kopisPayload);
  const ageLimit = kopisPayload.prfage || '전체관람가';
  const showtimes = extractShowtimes(kopisPayload);
  
  return {
    performance: {
      cast: cast,
      genre: genre,
      duration_minutes: durationMinutes,
      intermission: false,  // AI로 채울 예정
      age_limit: ageLimit,
      showtimes: showtimes,
      runtime: null,
      crew: {
        director: null,
        writer: null,
        composer: null
      },
      discounts: []
    }
  };
}

function extractCast(payload: any): string[] {
  if (!payload.prfcast) return [];
  
  return payload.prfcast
    .split(',')
    .map((s: string) => s.trim())
    .slice(0, 20);
}

function extractPerformanceGenre(payload: any): string[] {
  const genres: string[] = [];
  
  if (payload.genrenm) {
    genres.push(payload.genrenm);
  }
  
  return genres;
}

function extractDuration(payload: any): number | null {
  if (!payload.prfruntime) return null;
  
  // "120분" → 120
  const match = payload.prfruntime.match(/(\d+)분/);
  if (match) {
    return parseInt(match[1], 10);
  }
  
  // "2시간 30분" → 150
  const hourMatch = payload.prfruntime.match(/(\d+)시간\s*(\d+)분/);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1], 10);
    const mins = parseInt(hourMatch[2], 10);
    return hours * 60 + mins;
  }
  
  return null;
}

function extractShowtimes(payload: any): string[] {
  if (!payload.dtguidance) return [];
  
  // "화요일(19:30), 수요일~일요일(14:00,19:30)" → ["화 19:30", "수~일 14:00, 19:30"]
  // 간단한 파싱 (복잡하면 AI로 넘김)
  
  const times: string[] = [];
  
  // 패턴 1: "평일 19:30"
  if (payload.dtguidance.includes('평일')) {
    times.push('평일 19:30');
  }
  
  // 패턴 2: "주말 14:00, 18:00"
  if (payload.dtguidance.includes('주말')) {
    times.push('주말 14:00, 18:00');
  }
  
  // 그 외는 AI로 처리
  if (times.length === 0) {
    times.push(payload.dtguidance);
  }
  
  return times;
}

// ========== 팝업 추출 (제목 분석) ==========

async function extractPopupFromAPI(event: any) {
  // 팝업은 공공 API 데이터가 없으므로 제목에서 추출
  
  const brand = extractBrandFromTitle(event.title);
  const collaboration = extractCollaboration(event.title);
  
  return {
    popup: {
      brand: brand || '팝업',
      collaboration: collaboration,
      type: '팝업',
      features: {
        limited_goods: false,
        photo_zone: false,
        experience: false,
        reservation_required: false
      },
      entrance_fee: null,
      special_events: [],
      operation_style: null
    }
  };
}

function extractBrandFromTitle(title: string): string | null {
  // "무신사 팝업스토어" → "무신사"
  const match = title.match(/^([가-힣a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

function extractCollaboration(title: string): string | null {
  // "나이키 x 무신사" → "나이키 x 무신사"
  if (title.includes(' x ') || title.includes('×')) {
    const match = title.match(/([가-힣a-zA-Z0-9\s]+[x×][가-힣a-zA-Z0-9\s]+)/i);
    return match ? match[1].trim() : null;
  }
  
  return null;
}
```

---

### 3-2. 네이버 API + AI 보완

```typescript
// jobs/aiDisplayFieldsEnrichment.ts

/**
 * Phase 3: AI 기반 Display Fields 보완
 * 공공 API로 채울 수 없는 필드를 네이버 검색 + AI로 채움
 */

export async function aiDisplayFieldsEnrichment(options = {}) {
  const { limit = 100, category } = options;
  
  console.log('[AI DisplayFields] Starting enrichment...');
  
  // 1. 부족한 필드가 있는 이벤트 조회
  let query = `
    SELECT id, title, main_category, metadata
    FROM canonical_events
    WHERE is_deleted = false
      AND end_at >= CURRENT_DATE
      AND metadata->'display' IS NOT NULL
      AND (
        -- 전시: 편의시설 정보 없음
        (
          main_category = '전시' 
          AND (
            metadata->'display'->'exhibition'->'facilities'->>'photo_zone' = 'false'
            OR metadata->'display'->'exhibition'->>'docent_tour' IS NULL
          )
        )
        OR
        -- 공연: 인터미션 정보 없음
        (
          main_category = '공연'
          AND metadata->'display'->'performance'->>'intermission' = 'false'
        )
        OR
        -- 팝업: 특징 정보 없음
        (
          main_category = '팝업'
          AND metadata->'display'->'popup'->'features'->>'photo_zone' = 'false'
        )
      )
  `;
  
  if (category) {
    query = `
      SELECT id, title, main_category, metadata
      FROM canonical_events
      WHERE is_deleted = false
        AND end_at >= CURRENT_DATE
        AND main_category = '${category}'
        AND metadata->'display' IS NOT NULL
      LIMIT ${limit}
    `;
  }
  
  const result = await pool.query(query);
  console.log(`[AI DisplayFields] Found ${result.rows.length} events to enrich`);
  
  // 2. AI 보완
  for (const event of result.rows) {
    try {
      // 2-1. 네이버 검색
      const searchResults = await searchEventInfo(event.title, {
        category: event.main_category
      });
      
      if (!searchResults || searchResults.length === 0) {
        console.log(`[AI DisplayFields] No search results for ${event.id}`);
        continue;
      }
      
      // 2-2. AI 추출
      const aiFields = await extractDisplayFieldsWithAI(
        event.title,
        event.main_category,
        event.metadata?.display,
        searchResults
      );
      
      if (!aiFields) {
        console.log(`[AI DisplayFields] No AI results for ${event.id}`);
        continue;
      }
      
      // 2-3. 기존 데이터와 병합
      const mergedData = mergeDisplayFields(
        event.metadata?.display,
        aiFields
      );
      
      // 2-4. DB 업데이트
      await pool.query(`
        UPDATE canonical_events
        SET metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{display}',
          $1::jsonb
        )
        WHERE id = $2
      `, [JSON.stringify(mergedData), event.id]);
      
      console.log(`[AI DisplayFields] ✅ Enriched ${event.id}`);
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`[AI DisplayFields] ❌ Error ${event.id}:`, error);
    }
  }
}

// ========== AI 추출 ==========

async function extractDisplayFieldsWithAI(
  title: string,
  category: string,
  existingData: any,
  searchResults: any
): Promise<any> {
  
  const prompt = generateDisplayFieldsPrompt(
    title,
    category,
    existingData,
    searchResults
  );
  
  const response = await callGeminiAPI(prompt);
  
  return parseAIDisplayResponse(response, category);
}

function generateDisplayFieldsPrompt(
  title: string,
  category: string,
  existingData: any,
  searchResults: any
): string {
  
  if (category === '전시') {
    const exhibition = existingData?.exhibition || {};
    
    return `
다음 전시의 부족한 정보를 채워주세요:

제목: ${title}

기존 데이터:
${JSON.stringify(exhibition, null, 2)}

검색 결과:
${JSON.stringify(searchResults.slice(0, 3), null, 2)}

다음 필드를 채워주세요 (JSON 형식):
{
  "facilities": {
    "photo_zone": true/false,   // 포토존 있는지?
    "audio_guide": true/false,  // 오디오 가이드 있는지?
    "goods_shop": true/false,   // 굿즈샵 있는지?
    "cafe": true/false          // 카페 있는지?
  },
  "docent_tour": "매일 14:00, 16:00" 또는 null,
  "special_programs": ["작가와의 대화", "워크샵"],
  "age_recommendation": "전체관람가" 또는 null
}

검색 결과에 없으면 null로 반환하세요.
확실하지 않으면 false 또는 null로 반환하세요.
`;
  }
  
  if (category === '공연') {
    const performance = existingData?.performance || {};
    
    return `
다음 공연의 부족한 정보를 채워주세요:

제목: ${title}

기존 데이터:
${JSON.stringify(performance, null, 2)}

검색 결과:
${JSON.stringify(searchResults.slice(0, 3), null, 2)}

다음 필드를 채워주세요 (JSON 형식):
{
  "intermission": true/false,  // 중간 휴식 있는지?
  "crew": {
    "director": "연출자 이름" 또는 null,
    "writer": "작가 이름" 또는 null,
    "composer": "작곡가 이름" 또는 null
  },
  "discounts": ["조기예매 30%", "학생 50%"] 또는 []
}
`;
  }
  
  if (category === '팝업') {
    const popup = existingData?.popup || {};
    
    return `
다음 팝업의 특징 정보를 채워주세요:

제목: ${title}

기존 데이터:
${JSON.stringify(popup, null, 2)}

검색 결과:
${JSON.stringify(searchResults.slice(0, 3), null, 2)}

다음 필드를 채워주세요 (JSON 형식):
{
  "features": {
    "limited_goods": true/false,        // 한정 굿즈 판매?
    "photo_zone": true/false,           // 포토존?
    "experience": true/false,           // 체험 프로그램?
    "reservation_required": true/false  // 사전 예약 필요?
  },
  "entrance_fee": "무료" 또는 "5,000원" 또는 null,
  "special_events": ["오픈 기념 사은품"] 또는 [],
  "operation_style": "선착순 입장" 또는 null
}
`;
  }
  
  return '';
}

async function callGeminiAPI(prompt: string): Promise<string> {
  // Gemini API 호출 (기존 aiExtractor.ts와 동일)
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
  
  const result = await model.generateContent(prompt);
  return result.response.text();
}

function parseAIDisplayResponse(response: string, category: string): any {
  try {
    // JSON 추출
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[AI DisplayFields] No JSON found in response');
      return null;
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed;
    
  } catch (error) {
    console.error('[AI DisplayFields] Failed to parse AI response:', error);
    return null;
  }
}

// ========== 데이터 병합 ==========

function mergeDisplayFields(existing: any, aiData: any): any {
  if (!existing) return aiData;
  if (!aiData) return existing;
  
  // 카테고리 감지
  const category = existing.exhibition ? 'exhibition' :
                   existing.performance ? 'performance' :
                   existing.popup ? 'popup' :
                   existing.festival ? 'festival' :
                   existing.event ? 'event' : null;
  
  if (!category) return existing;
  
  // Deep merge
  const merged = {
    [category]: {
      ...existing[category],
      ...aiData
    }
  };
  
  // null 값 제거 (기존 값이 있으면 유지)
  Object.keys(aiData).forEach(key => {
    if (aiData[key] === null && existing[category][key] !== undefined) {
      merged[category][key] = existing[category][key];
    }
  });
  
  return merged;
}
```

---

## 🎨 4. Admin UI 구현

### 4-1. TypeScript Interface

```typescript
// backend/admin-web/src/types/index.ts

export interface Event {
  // ... 기존 필드 ...
  
  // Phase 3: Display Fields (JSONB)
  metadata?: {
    internal?: any;    // Phase 2
    display?: {
      exhibition?: ExhibitionDisplay;
      performance?: PerformanceDisplay;
      popup?: PopupDisplay;
      festival?: FestivalDisplay;
      event?: EventDisplay;
    };
  };
}

export interface ExhibitionDisplay {
  artists: string[];
  genre: string[];
  type: string;
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
}

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

// ... 나머지 인터페이스
```

---

### 4-2. Admin UI 컴포넌트

```tsx
// backend/admin-web/src/pages/EventsPage.tsx

function CategoryDisplayFields({ event, onChange }: Props) {
  const display = event.metadata?.display;
  
  // 전시
  if (event.mainCategory === '전시' && display?.exhibition) {
    const exhibition = display.exhibition;
    
    return (
      <div className="category-fields">
        <h3>전시 상세 정보</h3>
        
        <FormField label="작가/아티스트">
          <TagInput
            value={exhibition.artists}
            onChange={(tags) => onChange({
              metadata: {
                ...event.metadata,
                display: {
                  exhibition: {
                    ...exhibition,
                    artists: tags
                  }
                }
              }
            })}
            placeholder="예: 팀랩, 구사마 야요이"
          />
        </FormField>
        
        <FormField label="장르">
          <TagInput
            value={exhibition.genre}
            onChange={(tags) => onChange({
              metadata: {
                ...event.metadata,
                display: {
                  exhibition: {
                    ...exhibition,
                    genre: tags
                  }
                }
              }
            })}
            placeholder="예: 미디어아트, 현대미술"
          />
        </FormField>
        
        <FormField label="전시 유형">
          <Select
            value={exhibition.type}
            onChange={(val) => onChange({
              metadata: {
                ...event.metadata,
                display: {
                  exhibition: {
                    ...exhibition,
                    type: val
                  }
                }
              }
            })}
            options={[
              { value: '기획전', label: '기획전' },
              { value: '특별전', label: '특별전' },
              { value: '상설전', label: '상설전' },
              { value: '순회전', label: '순회전' },
            ]}
          />
        </FormField>
        
        <FormField label="권장 관람 시간 (분)">
          <Input
            type="number"
            value={exhibition.duration_minutes || ''}
            onChange={(e) => onChange({
              metadata: {
                ...event.metadata,
                display: {
                  exhibition: {
                    ...exhibition,
                    duration_minutes: parseInt(e.target.value)
                  }
                }
              }
            })}
            placeholder="60"
          />
        </FormField>
        
        <FormField label="편의시설">
          <CheckboxGroup>
            <Checkbox
              checked={exhibition.facilities.photo_zone}
              onChange={(checked) => onChange({
                metadata: {
                  ...event.metadata,
                  display: {
                    exhibition: {
                      ...exhibition,
                      facilities: {
                        ...exhibition.facilities,
                        photo_zone: checked
                      }
                    }
                  }
                }
              })}
            >
              포토존
            </Checkbox>
            <Checkbox
              checked={exhibition.facilities.audio_guide}
              onChange={(checked) => onChange({
                metadata: {
                  ...event.metadata,
                  display: {
                    exhibition: {
                      ...exhibition,
                      facilities: {
                        ...exhibition.facilities,
                        audio_guide: checked
                      }
                    }
                  }
                }
              })}
            >
              오디오 가이드
            </Checkbox>
            {/* ... 나머지 체크박스 */}
          </CheckboxGroup>
        </FormField>
        
        <FormField label="도슨트 투어">
          <Input
            value={exhibition.docent_tour || ''}
            onChange={(e) => onChange({
              metadata: {
                ...event.metadata,
                display: {
                  exhibition: {
                    ...exhibition,
                    docent_tour: e.target.value
                  }
                }
              }
            })}
            placeholder="예: 매일 14:00, 16:00"
          />
        </FormField>
      </div>
    );
  }
  
  // 공연
  if (event.mainCategory === '공연' && display?.performance) {
    // ... 유사한 구조
  }
  
  return null;
}
```

---

## 🔄 5. 스케줄러 연동

```typescript
// src/scheduler.ts

import { displayFieldsBackfill } from './jobs/displayFieldsBackfill';
import { aiDisplayFieldsEnrichment } from './jobs/aiDisplayFieldsEnrichment';

// 매일 03:40 KST - Display Fields Backfill (공공 API)
cron.schedule('40 3 * * *', async () => {
  await runJobSafely('display-fields-backfill', async () => {
    await displayFieldsBackfill({ dryRun: false });
  });
}, {
  timezone: 'Asia/Seoul'
});
console.log('[Scheduler] registered: Display Fields Backfill @ 03:40 KST');

// 매일 04:40 KST - AI Display Fields Enrichment (네이버 + AI)
cron.schedule('40 4 * * *', async () => {
  await runJobSafely('ai-display-fields', async () => {
    await aiDisplayFieldsEnrichment({ limit: 100 });
  });
}, {
  timezone: 'Asia/Seoul'
});
console.log('[Scheduler] registered: AI Display Fields Enrichment @ 04:40 KST');
```

### 전체 스케줄러 타임라인

```
03:00 - 데이터 수집 (KOPIS, Culture, TourAPI)
03:30 - Price Info Backfill
03:40 - Display Fields Backfill (공공 API) ← 새로 추가!
04:00 - AI Enrichment (derived_tags, overview)
04:15 - Phase 2 Internal Fields
04:30 - Auto-recommend Update
04:40 - AI Display Fields Enrichment (네이버 + AI) ← 새로 추가!
```

---

## 📊 6. 성능 최적화 (GIN 인덱스)

```sql
-- Migration: 20260130_add_display_indexes.sql

-- 전시: 작가 검색
CREATE INDEX idx_display_exhibition_artists 
  ON canonical_events USING GIN ((metadata->'display'->'exhibition'->'artists'));

-- 전시: 장르 검색
CREATE INDEX idx_display_exhibition_genre 
  ON canonical_events USING GIN ((metadata->'display'->'exhibition'->'genre'));

-- 공연: 출연진 검색
CREATE INDEX idx_display_performance_cast 
  ON canonical_events USING GIN ((metadata->'display'->'performance'->'cast'));

-- 공연: 장르 검색
CREATE INDEX idx_display_performance_genre 
  ON canonical_events USING GIN ((metadata->'display'->'performance'->'genre'));

-- 팝업: 브랜드 검색
CREATE INDEX idx_display_popup_brand 
  ON canonical_events ((metadata->'display'->'popup'->>'brand'));

COMMENT ON INDEX idx_display_exhibition_artists IS 'Phase 3: 전시 작가 검색용 GIN 인덱스';
```

### 쿼리 예시

```sql
-- 작가로 검색 (GIN 인덱스 사용)
SELECT * FROM canonical_events
WHERE metadata->'display'->'exhibition'->'artists' @> '["팀랩"]'::jsonb;

-- 출연진으로 검색
SELECT * FROM canonical_events
WHERE metadata->'display'->'performance'->'cast' @> '["김광석"]'::jsonb;

-- 브랜드로 검색
SELECT * FROM canonical_events
WHERE metadata->'display'->'popup'->>'brand' = '무신사';
```

---

## 🎯 7. 구현 우선순위

### MVP (1주차)
```
✅ displayFieldsBackfill.ts
  - extractExhibitionFromAPI()
  - extractPerformanceFromAPI()
  
✅ 테스트 (샘플 10개)
  
✅ GIN 인덱스 추가
```

### Phase 1 (2주차)
```
✅ aiDisplayFieldsEnrichment.ts
  - 전시, 공연 AI 보완
  
✅ Admin UI (전시, 공연)
```

### Phase 2 (3주차)
```
✅ 팝업, 축제, 행사 추가
  - Backfill + AI
  
✅ Admin UI (팝업, 축제, 행사)
```

---

## 🎉 8. 최종 장점

| 항목 | 결과 |
|-----|------|
| **저장 방식** | ✅ JSONB (깔끔, NULL 없음) |
| **데이터 품질** | ✅ API + 네이버 + AI (높음) |
| **쿼리 성능** | ✅ GIN 인덱스 (빠름) |
| **스키마 유연성** | ✅ Migration 불필요 |
| **Frontend** | ✅ 그룹핑 깔끔 |
| **Admin UI** | ✅ 간결 |
| **Phase 1 일관성** | ✅ 데이터 수집 방식 동일 |

---

## ✅ 다음 단계

**MVP부터 시작할까요?**

1. **displayFieldsBackfill.ts** 구현
2. **GIN 인덱스** 추가
3. **테스트** (샘플 이벤트)
4. **AI Enrichment** (다음 단계)
5. **Admin UI** (마지막)

구현을 시작할까요? 🚀

