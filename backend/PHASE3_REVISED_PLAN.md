# Phase 3: 카테고리별 필드 구현 계획 (수정안)

**핵심 변경**: metadata.display (JSONB) ❌ → 실제 DB 컬럼 ✅

**방식**: Phase 1 (Core Data)과 동일!

---

## 🎯 1. 전체 전략

### Phase 1 방식 재사용
```
1. Migration으로 DB 컬럼 추가
2. Admin UI에 필드 추가 (카테고리별 조건부)
3. 데이터 수집:
   - 공공 API (KOPIS, Culture, TourAPI)
   - 네이버 API + AI (부족한 부분)
   - 수동 입력 (최종)
4. 스케줄러 연동
```

---

## 📊 2. 카테고리별 DB 컬럼 정의

### 2-1. 전시 (Exhibition)

```sql
-- Migration: 20260130_add_exhibition_fields.sql

ALTER TABLE canonical_events

-- 작가/아티스트 (문자열 배열)
ADD COLUMN exhibition_artists TEXT[],

-- 장르 (문자열 배열)
ADD COLUMN exhibition_genre TEXT[],

-- 전시 유형
ADD COLUMN exhibition_type VARCHAR(50),
  -- 예: '기획전', '특별전', '상설전', '순회전'

-- 권장 관람 시간 (분)
ADD COLUMN exhibition_duration_minutes INTEGER,

-- 편의시설 (JSONB)
ADD COLUMN exhibition_facilities JSONB DEFAULT '{
  "photo_zone": false,
  "audio_guide": false,
  "goods_shop": false,
  "cafe": false
}'::jsonb,

-- 도슨트 투어 (텍스트)
ADD COLUMN exhibition_docent_tour TEXT,
  -- 예: '매일 14:00, 16:00'

-- 특별 프로그램 (문자열 배열)
ADD COLUMN exhibition_special_programs TEXT[],

-- 연령 추천
ADD COLUMN exhibition_age_recommendation VARCHAR(50);

-- 인덱스
CREATE INDEX idx_exhibition_artists ON canonical_events USING GIN (exhibition_artists);
CREATE INDEX idx_exhibition_genre ON canonical_events USING GIN (exhibition_genre);
CREATE INDEX idx_exhibition_type ON canonical_events (exhibition_type);

COMMENT ON COLUMN canonical_events.exhibition_artists IS '전시 작가/아티스트 목록';
COMMENT ON COLUMN canonical_events.exhibition_genre IS '전시 장르 (미디어아트, 현대미술, 사진 등)';
COMMENT ON COLUMN canonical_events.exhibition_type IS '전시 유형 (기획전, 특별전, 상설전, 순회전)';
COMMENT ON COLUMN canonical_events.exhibition_duration_minutes IS '권장 관람 시간 (분)';
```

---

### 2-2. 공연 (Performance)

```sql
-- Migration: 20260130_add_performance_fields.sql

ALTER TABLE canonical_events

-- 출연진 (문자열 배열)
ADD COLUMN performance_cast TEXT[],

-- 장르 (문자열 배열)
ADD COLUMN performance_genre TEXT[],

-- 공연 시간 (분)
ADD COLUMN performance_duration_minutes INTEGER,

-- 인터미션 여부
ADD COLUMN performance_intermission BOOLEAN,

-- 연령 제한
ADD COLUMN performance_age_limit VARCHAR(50),
  -- 예: '전체관람가', '만 7세 이상', '만 19세 이상'

-- 공연 시간대 (문자열 배열)
ADD COLUMN performance_showtimes TEXT[],
  -- 예: ['평일 19:30', '주말 14:00, 18:00']

-- 런타임 설명
ADD COLUMN performance_runtime TEXT,
  -- 예: '2시간 30분 (인터미션 20분 포함)'

-- 제작진 (JSONB)
ADD COLUMN performance_crew JSONB DEFAULT '{
  "director": null,
  "writer": null,
  "composer": null
}'::jsonb,

-- 할인 정보 (문자열 배열)
ADD COLUMN performance_discounts TEXT[];

-- 인덱스
CREATE INDEX idx_performance_cast ON canonical_events USING GIN (performance_cast);
CREATE INDEX idx_performance_genre ON canonical_events USING GIN (performance_genre);
CREATE INDEX idx_performance_age_limit ON canonical_events (performance_age_limit);

COMMENT ON COLUMN canonical_events.performance_cast IS '공연 출연진';
COMMENT ON COLUMN canonical_events.performance_genre IS '공연 장르 (뮤지컬, 콘서트, 연극 등)';
COMMENT ON COLUMN canonical_events.performance_duration_minutes IS '공연 시간 (분)';
```

---

### 2-3. 팝업 (Popup)

```sql
-- Migration: 20260130_add_popup_fields.sql

ALTER TABLE canonical_events

-- 브랜드
ADD COLUMN popup_brand VARCHAR(100),

-- 콜라보레이션
ADD COLUMN popup_collaboration VARCHAR(200),
  -- 예: '나이키 x 무신사'

-- 팝업 유형
ADD COLUMN popup_type VARCHAR(50),
  -- 예: '패션', 'F&B', '캐릭터', '전시형'

-- 특징 (JSONB)
ADD COLUMN popup_features JSONB DEFAULT '{
  "limited_goods": false,
  "photo_zone": false,
  "experience": false,
  "reservation_required": false
}'::jsonb,

-- 입장료
ADD COLUMN popup_entrance_fee VARCHAR(100),
  -- 예: '무료', '5,000원 (음료 쿠폰 포함)'

-- 특별 이벤트 (문자열 배열)
ADD COLUMN popup_special_events TEXT[],

-- 운영 방식
ADD COLUMN popup_operation_style VARCHAR(100);
  -- 예: '선착순 입장', '사전 예약제', '자유 관람'

-- 인덱스
CREATE INDEX idx_popup_brand ON canonical_events (popup_brand);
CREATE INDEX idx_popup_type ON canonical_events (popup_type);

COMMENT ON COLUMN canonical_events.popup_brand IS '팝업 브랜드';
COMMENT ON COLUMN canonical_events.popup_collaboration IS '콜라보레이션 정보';
```

---

### 2-4. 축제 (Festival)

```sql
-- Migration: 20260130_add_festival_fields.sql

ALTER TABLE canonical_events

-- 축제 유형
ADD COLUMN festival_type VARCHAR(50),
  -- 예: '음악', '문화', '음식', '지역축제'

-- 규모
ADD COLUMN festival_scale VARCHAR(50),
  -- 예: '대규모', '중규모', '소규모'

-- 주요 프로그램 (문자열 배열)
ADD COLUMN festival_main_programs TEXT[],

-- 편의시설 (JSONB)
ADD COLUMN festival_facilities JSONB DEFAULT '{
  "parking": false,
  "food_court": false,
  "kids_zone": false,
  "rest_area": false
}'::jsonb,

-- 날씨 영향 여부
ADD COLUMN festival_weather_dependent BOOLEAN;

-- 인덱스
CREATE INDEX idx_festival_type ON canonical_events (festival_type);
CREATE INDEX idx_festival_scale ON canonical_events (festival_scale);

COMMENT ON COLUMN canonical_events.festival_type IS '축제 유형 (음악, 문화, 음식 등)';
COMMENT ON COLUMN canonical_events.festival_weather_dependent IS '야외 축제 여부';
```

---

### 2-5. 행사 (Event)

```sql
-- Migration: 20260130_add_event_fields.sql

ALTER TABLE canonical_events

-- 행사 유형
ADD COLUMN event_type VARCHAR(50),
  -- 예: '컨퍼런스', '워크샵', '박람회', '세미나'

-- 대상 (문자열 배열)
ADD COLUMN event_target_audience TEXT[],
  -- 예: ['일반인', '전문가', '학생']

-- 주최
ADD COLUMN event_organizer VARCHAR(200),

-- 참가 정보 (JSONB)
ADD COLUMN event_participation JSONB DEFAULT '{
  "registration_required": false,
  "capacity": null,
  "on_site_ok": false
}'::jsonb;

-- 인덱스
CREATE INDEX idx_event_type ON canonical_events (event_type);
CREATE INDEX idx_event_organizer ON canonical_events (event_organizer);

COMMENT ON COLUMN canonical_events.event_type IS '행사 유형 (컨퍼런스, 워크샵 등)';
COMMENT ON COLUMN canonical_events.event_organizer IS '행사 주최기관';
```

---

## 🎨 3. Admin UI 구현

### 3-1. TypeScript Interface 업데이트

```typescript
// backend/admin-web/src/types/index.ts

export interface Event {
  // ... 기존 필드 ...
  
  // 전시 필드
  exhibitionArtists?: string[];
  exhibitionGenre?: string[];
  exhibitionType?: string;
  exhibitionDurationMinutes?: number;
  exhibitionFacilities?: {
    photo_zone: boolean;
    audio_guide: boolean;
    goods_shop: boolean;
    cafe: boolean;
  };
  exhibitionDocentTour?: string;
  exhibitionSpecialPrograms?: string[];
  exhibitionAgeRecommendation?: string;
  
  // 공연 필드
  performanceCast?: string[];
  performanceGenre?: string[];
  performanceDurationMinutes?: number;
  performanceIntermission?: boolean;
  performanceAgeLimit?: string;
  performanceShowtimes?: string[];
  performanceRuntime?: string;
  performanceCrew?: {
    director: string | null;
    writer: string | null;
    composer: string | null;
  };
  performanceDiscounts?: string[];
  
  // 팝업 필드
  popupBrand?: string;
  popupCollaboration?: string;
  popupType?: string;
  popupFeatures?: {
    limited_goods: boolean;
    photo_zone: boolean;
    experience: boolean;
    reservation_required: boolean;
  };
  popupEntranceFee?: string;
  popupSpecialEvents?: string[];
  popupOperationStyle?: string;
  
  // 축제 필드
  festivalType?: string;
  festivalScale?: string;
  festivalMainPrograms?: string[];
  festivalFacilities?: {
    parking: boolean;
    food_court: boolean;
    kids_zone: boolean;
    rest_area: boolean;
  };
  festivalWeatherDependent?: boolean;
  
  // 행사 필드
  eventType?: string;
  eventTargetAudience?: string[];
  eventOrganizer?: string;
  eventParticipation?: {
    registration_required: boolean;
    capacity: number | null;
    on_site_ok: boolean;
  };
}
```

---

### 3-2. Admin UI 컴포넌트 (카테고리별 조건부 렌더링)

```tsx
// backend/admin-web/src/pages/EventsPage.tsx

function CategorySpecificFields({ event, onChange }: Props) {
  const category = event.mainCategory;

  // 전시
  if (category === '전시') {
    return (
      <div className="category-fields">
        <h3>전시 상세 정보</h3>
        
        <FormField label="작가/아티스트">
          <TagInput
            value={event.exhibitionArtists || []}
            onChange={(tags) => onChange({ exhibitionArtists: tags })}
            placeholder="예: 팀랩, 구사마 야요이"
          />
        </FormField>
        
        <FormField label="장르">
          <TagInput
            value={event.exhibitionGenre || []}
            onChange={(tags) => onChange({ exhibitionGenre: tags })}
            placeholder="예: 미디어아트, 현대미술"
          />
        </FormField>
        
        <FormField label="전시 유형">
          <Select
            value={event.exhibitionType || ''}
            onChange={(val) => onChange({ exhibitionType: val })}
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
            value={event.exhibitionDurationMinutes || ''}
            onChange={(e) => onChange({ 
              exhibitionDurationMinutes: parseInt(e.target.value) 
            })}
            placeholder="예: 60"
          />
        </FormField>
        
        <FormField label="편의시설">
          <CheckboxGroup>
            <Checkbox
              checked={event.exhibitionFacilities?.photo_zone || false}
              onChange={(checked) => onChange({
                exhibitionFacilities: {
                  ...event.exhibitionFacilities,
                  photo_zone: checked
                }
              })}
            >
              포토존
            </Checkbox>
            <Checkbox
              checked={event.exhibitionFacilities?.audio_guide || false}
              onChange={(checked) => onChange({
                exhibitionFacilities: {
                  ...event.exhibitionFacilities,
                  audio_guide: checked
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
            value={event.exhibitionDocentTour || ''}
            onChange={(e) => onChange({ exhibitionDocentTour: e.target.value })}
            placeholder="예: 매일 14:00, 16:00"
          />
        </FormField>
      </div>
    );
  }

  // 공연
  if (category === '공연') {
    return (
      <div className="category-fields">
        <h3>공연 상세 정보</h3>
        
        <FormField label="출연진">
          <TagInput
            value={event.performanceCast || []}
            onChange={(tags) => onChange({ performanceCast: tags })}
            placeholder="예: 김광석, 이승환"
          />
        </FormField>
        
        <FormField label="장르">
          <TagInput
            value={event.performanceGenre || []}
            onChange={(tags) => onChange({ performanceGenre: tags })}
            placeholder="예: 뮤지컬, 콘서트"
          />
        </FormField>
        
        <FormField label="공연 시간 (분)">
          <Input
            type="number"
            value={event.performanceDurationMinutes || ''}
            onChange={(e) => onChange({ 
              performanceDurationMinutes: parseInt(e.target.value) 
            })}
          />
        </FormField>
        
        <FormField label="연령 제한">
          <Select
            value={event.performanceAgeLimit || ''}
            onChange={(val) => onChange({ performanceAgeLimit: val })}
            options={[
              { value: '전체관람가', label: '전체관람가' },
              { value: '만 7세 이상', label: '만 7세 이상' },
              { value: '만 12세 이상', label: '만 12세 이상' },
              { value: '만 15세 이상', label: '만 15세 이상' },
              { value: '만 19세 이상', label: '만 19세 이상' },
            ]}
          />
        </FormField>
        
        {/* ... 나머지 필드 */}
      </div>
    );
  }

  // 팝업
  if (category === '팝업') {
    return (
      <div className="category-fields">
        <h3>팝업 상세 정보</h3>
        
        <FormField label="브랜드">
          <Input
            value={event.popupBrand || ''}
            onChange={(e) => onChange({ popupBrand: e.target.value })}
            placeholder="예: 무신사"
          />
        </FormField>
        
        <FormField label="콜라보레이션">
          <Input
            value={event.popupCollaboration || ''}
            onChange={(e) => onChange({ popupCollaboration: e.target.value })}
            placeholder="예: 나이키 x 무신사"
          />
        </FormField>
        
        {/* ... 나머지 필드 */}
      </div>
    );
  }

  // 카테고리 없음
  return null;
}
```

---

## 🔄 4. 데이터 수집 파이프라인

### 4-1. 공공 API 우선 (Backfill Job)

```typescript
// jobs/categoryFieldsBackfill.ts

/**
 * Phase 3: 카테고리별 필드 Backfill
 * 
 * 우선순위:
 * 1. API payload에서 추출 (KOPIS, Culture, TourAPI)
 * 2. 기존 필드 변환 (sub_category → exhibition_type 등)
 * 3. 네이버 API + AI (다음 단계)
 */

interface CategoryFieldsBackfillOptions {
  dryRun?: boolean;
  limit?: number;
  category?: string; // '전시', '공연' 등
}

export async function categoryFieldsBackfill(
  options: CategoryFieldsBackfillOptions = {}
) {
  const { dryRun = false, limit, category } = options;
  
  console.log('[CategoryBackfill] Starting...');
  
  // 1. 대상 이벤트 조회
  let query = `
    SELECT 
      id, title, main_category, sub_category,
      sources, derived_tags
    FROM canonical_events
    WHERE is_deleted = false
      AND end_at >= CURRENT_DATE
  `;
  
  if (category) {
    query += ` AND main_category = '${category}'`;
  }
  
  if (limit) {
    query += ` LIMIT ${limit}`;
  }
  
  const result = await pool.query(query);
  console.log(`[CategoryBackfill] Found ${result.rows.length} events`);
  
  // 2. 카테고리별 처리
  for (const event of result.rows) {
    try {
      switch (event.main_category) {
        case '전시':
          await backfillExhibitionFields(event, dryRun);
          break;
        case '공연':
          await backfillPerformanceFields(event, dryRun);
          break;
        case '팝업':
          await backfillPopupFields(event, dryRun);
          break;
        case '축제':
          await backfillFestivalFields(event, dryRun);
          break;
        case '행사':
          await backfillEventFields(event, dryRun);
          break;
      }
    } catch (error) {
      console.error(`[CategoryBackfill] Error processing ${event.id}:`, error);
    }
  }
}

// ========== 전시 Backfill ==========

async function backfillExhibitionFields(event: any, dryRun: boolean) {
  // 1. API payload 가져오기
  const payloads = await getPayloadFromSources(event.sources);
  const kopisPayload = payloads.find(p => p.source === 'kopis')?.payload;
  
  if (!kopisPayload) {
    console.log(`[Exhibition] No KOPIS payload for ${event.id}`);
    return;
  }
  
  // 2. 작가 추출
  const artists = extractArtistsFromPayload(kopisPayload);
  
  // 3. 장르 추출
  const genre = extractGenreFromPayload(kopisPayload, event.derived_tags);
  
  // 4. 전시 유형 매핑
  const type = mapExhibitionType(event.sub_category);
  
  // 5. 권장 관람 시간 (기본값)
  const durationMinutes = 60;
  
  // 6. DB 업데이트
  if (!dryRun) {
    await pool.query(`
      UPDATE canonical_events
      SET 
        exhibition_artists = $1,
        exhibition_genre = $2,
        exhibition_type = $3,
        exhibition_duration_minutes = $4
      WHERE id = $5
    `, [artists, genre, type, durationMinutes, event.id]);
    
    console.log(`[Exhibition] ✅ Updated ${event.id}`);
  } else {
    console.log(`[Exhibition] [DRY RUN] Would update ${event.id}:`, {
      artists, genre, type, durationMinutes
    });
  }
}

function extractArtistsFromPayload(payload: any): string[] {
  if (!payload.prfcast) return [];
  
  // "팀랩, 구사마 야요이" → ["팀랩", "구사마 야요이"]
  return payload.prfcast
    .split(',')
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0)
    .slice(0, 10); // 최대 10명
}

function extractGenreFromPayload(payload: any, tags: string[]): string[] {
  const genres: string[] = [];
  
  // KOPIS genrenm
  if (payload.genrenm) {
    genres.push(payload.genrenm);
  }
  
  // derived_tags에서 장르 태그
  const genreTags = ['미디어아트', '현대미술', '사진', '조각', '회화', '설치미술'];
  const matched = tags?.filter((t: string) => genreTags.includes(t)) || [];
  genres.push(...matched);
  
  return [...new Set(genres)];
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

// ========== 공연 Backfill ==========

async function backfillPerformanceFields(event: any, dryRun: boolean) {
  const payloads = await getPayloadFromSources(event.sources);
  const kopisPayload = payloads.find(p => p.source === 'kopis')?.payload;
  
  if (!kopisPayload) return;
  
  // 출연진
  const cast = extractCastFromPayload(kopisPayload);
  
  // 장르
  const genre = extractPerformanceGenre(kopisPayload);
  
  // 공연 시간
  const durationMinutes = extractDurationFromPayload(kopisPayload);
  
  // 연령 제한
  const ageLimit = kopisPayload.prfage || '전체관람가';
  
  if (!dryRun) {
    await pool.query(`
      UPDATE canonical_events
      SET 
        performance_cast = $1,
        performance_genre = $2,
        performance_duration_minutes = $3,
        performance_age_limit = $4
      WHERE id = $5
    `, [cast, genre, durationMinutes, ageLimit, event.id]);
    
    console.log(`[Performance] ✅ Updated ${event.id}`);
  }
}

function extractCastFromPayload(payload: any): string[] {
  if (!payload.prfcast) return [];
  
  return payload.prfcast
    .split(',')
    .map((s: string) => s.trim())
    .slice(0, 20); // 최대 20명
}

function extractPerformanceGenre(payload: any): string[] {
  const genres: string[] = [];
  
  if (payload.genrenm) {
    genres.push(payload.genrenm);
  }
  
  return genres;
}

function extractDurationFromPayload(payload: any): number | null {
  if (!payload.prfruntime) return null;
  
  // "120분" → 120
  // "2시간 30분" → 150
  const match = payload.prfruntime.match(/(\d+)분/);
  if (match) {
    return parseInt(match[1], 10);
  }
  
  const hourMatch = payload.prfruntime.match(/(\d+)시간\s*(\d+)분/);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1], 10);
    const mins = parseInt(hourMatch[2], 10);
    return hours * 60 + mins;
  }
  
  return null;
}

// ========== 팝업 Backfill ==========

async function backfillPopupFields(event: any, dryRun: boolean) {
  // 팝업은 공공 API 데이터가 없으므로
  // 제목에서 브랜드 추출 (간단한 패턴 매칭)
  
  const brand = extractBrandFromTitle(event.title);
  const collaboration = extractCollaboration(event.title);
  
  if (!dryRun && (brand || collaboration)) {
    await pool.query(`
      UPDATE canonical_events
      SET 
        popup_brand = $1,
        popup_collaboration = $2
      WHERE id = $3
    `, [brand, collaboration, event.id]);
    
    console.log(`[Popup] ✅ Updated ${event.id}`);
  }
}

function extractBrandFromTitle(title: string): string | null {
  // "무신사 팝업스토어" → "무신사"
  // "나이키 x 무신사 팝업" → "나이키" (콜라보는 별도)
  
  // 간단한 패턴: 첫 단어가 브랜드
  const match = title.match(/^([가-힣a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

function extractCollaboration(title: string): string | null {
  // "나이키 x 무신사" → "나이키 x 무신사"
  // "나이키×무신사" → "나이키×무신사"
  
  if (title.includes(' x ') || title.includes('×')) {
    const match = title.match(/([가-힣a-zA-Z0-9\s]+[x×][가-힣a-zA-Z0-9\s]+)/i);
    return match ? match[1].trim() : null;
  }
  
  return null;
}
```

---

### 4-2. 네이버 API + AI (다음 단계)

```typescript
// jobs/aiCategoryFieldsEnrichment.ts

/**
 * Phase 3: AI 기반 카테고리 필드 보완
 * 
 * 공공 API로 채울 수 없는 필드를 네이버 검색 + AI로 채움
 * (Phase 1 aiEnrichmentBackfill과 유사한 방식)
 */

export async function aiCategoryFieldsEnrichment(options = {}) {
  // 1. 카테고리 필드가 비어있는 이벤트 조회
  const events = await pool.query(`
    SELECT id, title, main_category
    FROM canonical_events
    WHERE is_deleted = false
      AND end_at >= CURRENT_DATE
      AND (
        -- 전시: 작가 정보 없음
        (main_category = '전시' AND exhibition_artists IS NULL)
        OR
        -- 공연: 출연진 정보 없음
        (main_category = '공연' AND performance_cast IS NULL)
        OR
        -- 팝업: 브랜드 정보 없음
        (main_category = '팝업' AND popup_brand IS NULL)
      )
    LIMIT 100
  `);
  
  console.log(`[AI CategoryFields] Found ${events.rows.length} events to enrich`);
  
  for (const event of events.rows) {
    try {
      // 2. 네이버 검색
      const searchResults = await searchEventInfo(event.title, {
        category: event.main_category
      });
      
      // 3. AI 추출
      const extractedFields = await extractCategoryFieldsWithAI(
        event.title,
        event.main_category,
        searchResults
      );
      
      // 4. DB 업데이트
      await updateCategoryFields(event.id, event.main_category, extractedFields);
      
      console.log(`[AI CategoryFields] ✅ Enriched ${event.id}`);
    } catch (error) {
      console.error(`[AI CategoryFields] ❌ Error for ${event.id}:`, error);
    }
  }
}

async function extractCategoryFieldsWithAI(
  title: string,
  category: string,
  searchResults: any
): Promise<any> {
  // Gemini AI에 프롬프트 전송
  const prompt = generateCategoryFieldsPrompt(title, category, searchResults);
  
  const response = await callGeminiAPI(prompt);
  
  return parseAICategoryResponse(response, category);
}

function generateCategoryFieldsPrompt(
  title: string,
  category: string,
  searchResults: any
): string {
  if (category === '전시') {
    return `
다음 전시의 상세 정보를 추출해주세요:

제목: ${title}

검색 결과:
${JSON.stringify(searchResults, null, 2)}

다음 JSON 형식으로 응답해주세요:
{
  "artists": ["작가1", "작가2"],
  "genre": ["미디어아트", "현대미술"],
  "facilities": {
    "photo_zone": true/false,
    "audio_guide": true/false,
    "goods_shop": true/false,
    "cafe": true/false
  },
  "docent_tour": "매일 14:00, 16:00" 또는 null,
  "special_programs": ["작가와의 대화", "워크샵"]
}
`;
  }
  
  if (category === '공연') {
    return `
다음 공연의 상세 정보를 추출해주세요:

제목: ${title}

검색 결과:
${JSON.stringify(searchResults, null, 2)}

다음 JSON 형식으로 응답해주세요:
{
  "cast": ["출연자1", "출연자2"],
  "genre": ["뮤지컬", "콘서트"],
  "intermission": true/false,
  "crew": {
    "director": "연출자",
    "writer": "작가",
    "composer": "작곡가"
  }
}
`;
  }
  
  // ... 다른 카테고리
  
  return '';
}
```

---

## 🔄 5. 스케줄러 연동

```typescript
// src/scheduler.ts

import { categoryFieldsBackfill } from './jobs/categoryFieldsBackfill';
import { aiCategoryFieldsEnrichment } from './jobs/aiCategoryFieldsEnrichment';

// 매일 03:30 KST - Category Fields Backfill (공공 API)
cron.schedule('30 3 * * *', async () => {
  await runJobSafely('category-fields-backfill', async () => {
    await categoryFieldsBackfill({ dryRun: false });
  });
}, {
  timezone: 'Asia/Seoul'
});
console.log('[Scheduler] registered: Category Fields Backfill @ 03:30 KST');

// 매일 04:30 KST - AI Category Fields Enrichment (네이버 + AI)
cron.schedule('30 4 * * *', async () => {
  await runJobSafely('ai-category-fields', async () => {
    await aiCategoryFieldsEnrichment({ limit: 100 });
  });
}, {
  timezone: 'Asia/Seoul'
});
console.log('[Scheduler] registered: AI Category Fields Enrichment @ 04:30 KST');
```

---

## 📊 6. 구현 우선순위

### MVP (1주차)
```
✅ Migration (전시, 공연 컬럼만)
✅ Admin UI (전시, 공연 필드)
✅ Backfill Job (공공 API)
✅ 테스트
```

### Phase 1 (2주차)
```
✅ 팝업 Migration + Admin UI
✅ AI Enrichment (전시, 공연)
```

### Phase 2 (3주차)
```
✅ 축제, 행사 Migration + Admin UI
✅ AI Enrichment (팝업, 축제, 행사)
```

---

## 🎯 핵심 차이점

| 항목 | 기존 계획 (metadata.display) | 수정 계획 (DB 컬럼) |
|-----|----------------------------|-------------------|
| **저장 위치** | JSONB 필드 | 실제 테이블 컬럼 |
| **쿼리** | 어려움 (JSONB 파싱) | 쉬움 (일반 SQL) |
| **인덱스** | 제한적 | 완벽한 인덱싱 |
| **Admin UI** | 복잡 (JSONB 편집) | 간단 (일반 폼) |
| **데이터 소스** | overview만 | API + 네이버 + AI |
| **품질** | 낮음 | 높음 ✅ |
| **Phase 1 방식** | 다름 | 동일 ✅ |

---

## ✅ 다음 단계

**MVP부터 시작할까요?**

1. **Migration 작성** (전시, 공연)
2. **Admin UI 수정** (카테고리별 필드)
3. **Backfill Job 구현** (공공 API)
4. **테스트**
5. **AI Enrichment** (다음 단계)

구현을 시작할까요? 🚀

