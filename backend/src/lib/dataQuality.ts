/**
 * 데이터 품질 및 완성도 관리
 * 
 * 이벤트 데이터의 완성도를 계산하고 평가하는 유틸리티
 */

export interface DataCompletenessScore {
  percentage: number;        // 0-100
  level: 'empty' | 'poor' | 'good' | 'excellent';
  missingFields: string[];
  filledFields: string[];
  essentialComplete: boolean; // 필수 필드 모두 채워짐
  missingEssential: string[];  // 누락된 필수 필드
}

interface FieldDefinition {
  key: string;
  weight: number;
  check?: (val: any) => boolean;
  displayName?: string;
}

/**
 * 이벤트 데이터 완성도 계산
 * 
 * 필수 필드 (5개): title, start_at, venue, main_category, image_url
 * 중요 필드 (10개): end_at, region, address, lat/lng, overview, price_info, opening_hours, external_links
 * 선택 필드 (나머지): metadata, tags 등
 */
export function calculateDataCompleteness(event: any): DataCompletenessScore {
  // 필수 필드 (5개) - 이게 없으면 사용자 앱에 노출 불가
  const essentialFields: FieldDefinition[] = [
    { 
      key: 'title', 
      weight: 3,
      displayName: '제목'
    },
    { 
      key: 'start_at', 
      weight: 3,
      displayName: '시작일'
    },
    { 
      key: 'venue', 
      weight: 3,
      displayName: '장소'
    },
    { 
      key: 'main_category', 
      weight: 3,
      displayName: '카테고리'
    },
    { 
      key: 'image_url', 
      weight: 3, 
      check: (val: any) => {
        if (!val || val === '') return false;
        const lowerUrl = val.toLowerCase();
        return !lowerUrl.includes('placeholder') && !lowerUrl.includes('/defaults/');
      },
      displayName: '이미지'
    },
  ];

  // 중요 필드 (11개) - UX 향상에 중요
  const importantFields: FieldDefinition[] = [
    {
      key: 'end_at',
      weight: 2,
      displayName: '종료일'
    },
    {
      key: 'region',
      weight: 2,
      displayName: '지역'
    },
    {
      key: 'address',
      weight: 2,
      displayName: '주소'
    },
    {
      key: 'sub_category',
      weight: 1,
      displayName: '서브 카테고리'
    },
    {
      key: 'lat',
      weight: 1,
      displayName: '위도'
    },
    {
      key: 'lng',
      weight: 1,
      displayName: '경도'
    },
    {
      key: 'overview',
      weight: 2,
      displayName: '개요'
    },
    {
      key: 'price_info',
      weight: 1,
      check: (val: any) => {
        // is_free가 true면 price_info 없어도 OK
        return val !== null && val !== undefined && val !== '';
      },
      displayName: '가격상세정보'
    },
    {
      key: 'opening_hours',
      weight: 1,
      check: (val: any) => {
        if (!val) return false;
        if (typeof val === 'string') {
          try {
            const parsed = JSON.parse(val);
            return Object.keys(parsed).length > 0;
          } catch {
            return false;
          }
        }
        return Object.keys(val).length > 0;
      },
      displayName: '운영시간'
    },
    {
      key: 'external_links',
      weight: 1,
      check: (val: any) => {
        if (!val) return false;
        if (typeof val === 'string') {
          try {
            const parsed = JSON.parse(val);
            return Object.keys(parsed).length > 0;
          } catch {
            return false;
          }
        }
        return val && Object.keys(val).length > 0;
      },
      displayName: '외부링크'
    },
    {
      key: 'parking_available',
      weight: 0.5,
      check: (val: any) => val !== null && val !== undefined,
      displayName: '주차가능여부'
    },
    {
      key: 'parking_info',
      weight: 0.5,
      displayName: '주차정보'
    },
  ];

  // 선택 필드 (5개) - 있으면 좋음
  const optionalFields: FieldDefinition[] = [
    { 
      key: 'display_title', 
      weight: 0.5,
      displayName: '표시제목'
    },
    { 
      key: 'metadata', 
      weight: 1, 
      check: (val: any) => {
        if (!val) return false;
        if (typeof val === 'string') {
          try {
            const parsed = JSON.parse(val);
            return Object.keys(parsed).length > 0;
          } catch {
            return false;
          }
        }
        return val && Object.keys(val).length > 0;
      },
      displayName: '메타데이터'
    },
    { 
      key: 'source_tags', 
      weight: 0.5,
      check: (val: any) => Array.isArray(val) && val.length > 0,
      displayName: '소스태그'
    },
    { 
      key: 'derived_tags', 
      weight: 0.5,
      check: (val: any) => Array.isArray(val) && val.length > 0,
      displayName: '파생태그'
    },
    { 
      key: 'price_min', 
      weight: 0.5,
      displayName: '최소가격'
    },
    { 
      key: 'price_max', 
      weight: 0.5,
      displayName: '최대가격'
    },
  ];

  // 🆕 카테고리별 특화 필드 (가중치 1점씩)
  const categorySpecificFields: FieldDefinition[] = [];
  const category = event.main_category || '';

  if (category === '전시') {
    categorySpecificFields.push(
      { key: 'metadata.display.exhibition.artists', weight: 1, check: (val: any) => Array.isArray(val) && val.length > 0, displayName: '작가/아티스트' },
      { key: 'metadata.display.exhibition.genre', weight: 1, check: (val: any) => Array.isArray(val) && val.length > 0, displayName: '전시장르' },
      { key: 'metadata.display.exhibition.type', weight: 0.5, check: (val: any) => !!val && val !== '', displayName: '전시유형' },
      { key: 'metadata.display.exhibition.duration_minutes', weight: 0.5, check: (val: any) => !!val && val > 0, displayName: '관람시간' },
      { 
        key: 'metadata.display.exhibition.facilities', 
        weight: 0.5, 
        check: (val: any) => {
          // facilities는 객체 { photo_zone, audio_guide, goods_shop, cafe }
          if (!val || typeof val !== 'object') return false;
          const keys = Object.keys(val);
          return keys.length > 0 && keys.some(k => val[k] === true);
        }, 
        displayName: '편의시설' 
      },
      { key: 'metadata.display.exhibition.docent_tour', weight: 0.5, check: (val: any) => !!val && val !== '', displayName: '도슨트투어' }
    );
  } else if (category === '공연') {
    categorySpecificFields.push(
      { key: 'metadata.display.performance.cast', weight: 1, check: (val: any) => Array.isArray(val) && val.length > 0, displayName: '출연진' },
      { key: 'metadata.display.performance.genre', weight: 1, check: (val: any) => Array.isArray(val) && val.length > 0, displayName: '공연장르' },
      { key: 'metadata.display.performance.duration_minutes', weight: 1, check: (val: any) => !!val && val > 0, displayName: '공연시간' },
      { key: 'metadata.display.performance.intermission', weight: 0.5, check: (val: any) => val === true || val === false, displayName: '인터미션' },
      { key: 'metadata.display.performance.age_limit', weight: 0.5, check: (val: any) => !!val && val !== '', displayName: '연령제한' },
      { key: 'metadata.display.performance.discounts', weight: 0.5, check: (val: any) => Array.isArray(val) && val.length > 0, displayName: '할인정보' }
    );
  } else if (category === '축제') {
    categorySpecificFields.push(
      { key: 'metadata.display.festival.organizer', weight: 1, check: (val: any) => !!val && val !== '', displayName: '주최/주관' },
      { key: 'metadata.display.festival.program_highlights', weight: 1, check: (val: any) => !!val && val !== '', displayName: '주요프로그램' },
      { key: 'metadata.display.festival.food_and_booths', weight: 0.5, check: (val: any) => !!val && val !== '', displayName: '먹거리/부스' },
      { key: 'metadata.display.festival.scale_text', weight: 0.5, check: (val: any) => !!val && val !== '', displayName: '규모' },
      { key: 'metadata.display.festival.parking_tips', weight: 0.5, check: (val: any) => !!val && val !== '', displayName: '주차정보' }
    );
  } else if (category === '팝업') {
    categorySpecificFields.push(
      { key: 'metadata.display.popup.brands', weight: 1, check: (val: any) => Array.isArray(val) && val.length > 0, displayName: '브랜드' },
      { key: 'metadata.display.popup.type', weight: 1, check: (val: any) => !!val && val !== '', displayName: '팝업타입' },
      { 
        key: 'metadata.display.popup.fnb_items', 
        weight: 0.5, 
        check: (val: any) => {
          // F&B 팝업인 경우만 체크
          if (!val || typeof val !== 'object') return false;
          return !!(val.signature_menu || val.menu_categories || val.price_range);
        }, 
        displayName: 'F&B메뉴정보' 
      },
      { key: 'metadata.display.popup.collab_description', weight: 0.5, check: (val: any) => !!val && val !== '', displayName: '콜라보설명' }
    );
  } else if (category === '행사') {
    categorySpecificFields.push(
      { key: 'metadata.display.event.target_audience', weight: 1, check: (val: any) => !!val && val !== '', displayName: '참가대상' },
      { key: 'metadata.display.event.capacity', weight: 1, check: (val: any) => !!val && val !== '', displayName: '정원' },
      { 
        key: 'metadata.display.event.registration', 
        weight: 1, 
        check: (val: any) => {
          // registration은 객체 { required, url, deadline }
          if (!val || typeof val !== 'object') return false;
          // required가 true이고 url이나 deadline이 있으면 OK
          if (val.required === true && (val.url || val.deadline)) return true;
          // required가 false여도 설정되어 있으면 OK
          return val.required === false;
        }, 
        displayName: '사전등록정보' 
      }
    );
  }

  const allFields = [...essentialFields, ...importantFields, ...optionalFields, ...categorySpecificFields];

  let totalWeight = 0;
  let filledWeight = 0;
  const missingFields: string[] = [];
  const filledFields: string[] = [];
  const missingEssential: string[] = [];

  // 기본 체크 함수
  const defaultCheck = (val: any) => val !== null && val !== undefined && val !== '';
  
  // 중첩 객체 필드 접근 헬퍼
  const getNestedValue = (obj: any, path: string): any => {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  };

  for (const field of allFields) {
    totalWeight += field.weight;
    
    // 중첩 필드 지원 (예: metadata.display.exhibition.artists)
    const value = field.key.includes('.') 
      ? getNestedValue(event, field.key) 
      : event[field.key];
    const checkFunc = field.check || defaultCheck;
    
    if (checkFunc(value)) {
      filledWeight += field.weight;
      filledFields.push(field.displayName || field.key);
    } else {
      missingFields.push(field.displayName || field.key);
    }
  }

  // 필수 필드 체크
  for (const field of essentialFields) {
    const value = event[field.key];
    const checkFunc = field.check || defaultCheck;
    
    if (!checkFunc(value)) {
      missingEssential.push(field.displayName || field.key);
    }
  }

  const percentage = Math.round((filledWeight / totalWeight) * 100);

  // ─── Operational score 기반 레벨 계산 ────────────────────────────────────
  // SQL 필터(index.ts scoreExpr)와 동일한 절대 점수 기준을 사용합니다.
  // 임계값: empty<22, poor 22-26, good 27-28, excellent≥29
  // (completenessConstants.ts와 동기화 — 변경 시 SQL도 함께 변경)
  const opScore = computeOperationalScore(event);
  let level: 'empty' | 'poor' | 'good' | 'excellent';
  if (opScore < 22) level = 'empty';
  else if (opScore < 27) level = 'poor';
  else if (opScore < 30) level = 'good';
  else level = 'excellent';

  // 필수 필드 완성 여부
  const essentialComplete = missingEssential.length === 0;

  return {
    percentage,
    level,
    missingFields,
    filledFields,
    essentialComplete,
    missingEssential,
  };
}

/**
 * Operational Score 계산
 *
 * SQL scoreExpr(index.ts)와 동일한 공식으로 절대 점수를 계산합니다.
 * totalWeight ≈ 33.5 (공통 31.5 + 카테고리 핵심 2점)
 *
 * 임계값:
 *   empty     : score < 22
 *   poor      : 22 ≤ score < 27
 *   good      : 27 ≤ score < 29
 *   excellent : score ≥ 29
 */
export function computeOperationalScore(event: any): number {
  const safeStr = (v: any) => v !== null && v !== undefined && v !== '';
  const safeArr = (v: any) => Array.isArray(v) && v.length > 0;
  const safeObj = (v: any) => {
    if (!v) return false;
    if (typeof v === 'string') {
      try { return Object.keys(JSON.parse(v)).length > 0; } catch { return false; }
    }
    return typeof v === 'object' && Object.keys(v).length > 0;
  };

  let score = 0;

  // 필수 (weight=3, max=15)
  if (safeStr(event.title)) score += 3;
  if (event.start_at) score += 3;
  if (safeStr(event.venue)) score += 3;
  if (safeStr(event.main_category)) score += 3;
  if (
    safeStr(event.image_url) &&
    !String(event.image_url).toLowerCase().includes('placeholder') &&
    !String(event.image_url).toLowerCase().includes('/defaults/')
  ) score += 3;

  // 중요 weight=2 (max=8)
  if (event.end_at) score += 2;
  if (safeStr(event.region)) score += 2;
  if (safeStr(event.address)) score += 2;
  if (safeStr(event.overview)) score += 2;

  // 중요 weight=1 (max=5)
  if (safeStr(event.sub_category)) score += 1;
  if (event.lat != null && event.lng != null) score += 1;
  if (safeStr(event.price_info)) score += 1;
  if (safeObj(event.opening_hours)) score += 1;
  if (safeObj(event.external_links)) score += 1;

  // 선택 weight=0.5 (max=2)
  if (event.price_min != null) score += 0.5;
  if (event.price_max != null) score += 0.5;
  if (event.parking_available != null) score += 0.5;
  if (safeStr(event.parking_info)) score += 0.5;

  // 선택 weight=0.5 (derived_tags)
  if (safeArr(event.derived_tags)) score += 0.5;

  // 선택 weight=1 (metadata 존재)
  if (safeObj(event.metadata)) score += 1;

  // 카테고리 핵심 필드 보너스 (max=2)
  const meta = event.metadata?.display;
  const cat = event.main_category;
  if (cat === '전시') {
    if (meta?.exhibition?.artists != null) score += 1;
    if (meta?.exhibition?.genre != null) score += 1;
  } else if (cat === '공연') {
    if (meta?.performance?.cast != null) score += 1;
    if (meta?.performance?.genre != null) score += 1;
  } else if (cat === '팝업') {
    if (meta?.popup?.type != null) score += 1;
    if (meta?.popup?.brands != null) score += 1;
  } else if (cat === '축제') {
    if (meta?.festival?.organizer != null) score += 1;
    if (meta?.festival?.program_highlights != null) score += 1;
  } else if (cat === '행사') {
    if (meta?.event?.target_audience != null) score += 1;
    if (meta?.event?.capacity != null) score += 1;
  }

  return score;
}

/**
 * 완성도 레벨에 따른 한글 레이블
 */
export function getCompletenessLabel(level: string): string {
  const labels: Record<string, string> = {
    empty: '거의 비어있음',
    poor: '부족',
    good: '양호',
    excellent: '완벽',
  };
  return labels[level] || level;
}

/**
 * 완성도 레벨에 따른 색상 (Tailwind CSS)
 */
export function getCompletenessColor(level: string): string {
  const colors: Record<string, string> = {
    empty: 'red',
    poor: 'orange',
    good: 'yellow',
    excellent: 'green',
  };
  return colors[level] || 'gray';
}

