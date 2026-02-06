/**
 * AI 제안 시스템 - 제안 생성 헬퍼
 * Phase 2: AI 추출 결과를 제안 객체로 변환
 */

import { createSuggestion, type FieldSuggestion, type DataSource } from './confidenceCalculator';
import type { AIExtractedInfo } from './aiExtractor';

export interface EventSuggestions {
  [fieldName: string]: FieldSuggestion;
}

/**
 * AI 추출 정보를 제안 객체로 변환
 * @param currentEvent - 현재 이벤트의 기존 데이터 (이미 값이 있는 필드는 제안하지 않음)
 * @param forceFields - 강제로 제안할 필드 목록 (빈 배열이면 빈 필드만 제안)
 */
export function buildSuggestionsFromAI(
  extracted: AIExtractedInfo,
  context: {
    hasSearchResults: boolean;
    searchResultCount?: number;
    category?: string;
    currentEvent?: any; // 🆕 현재 이벤트 데이터
    forceFields?: string[]; // 🆕 선택한 필드 목록
  }
): EventSuggestions {
  const suggestions: EventSuggestions = {};
  const currentEvent = context.currentEvent || {};
  const forceFields = context.forceFields || [];
  
  // Helper: 필드가 제안 대상인지 확인
  const shouldSuggest = (fieldName: string, hasValue: boolean): boolean => {
    // forceFields가 비어있으면: 빈 필드만 제안
    if (forceFields.length === 0) {
      return !hasValue;
    }
    
    // forceFields에 포함되어 있으면: 제안
    return forceFields.some(f => {
      if (f === '*') return true; // 모든 필드
      if (fieldName === f) return true; // 정확히 일치
      if (fieldName.startsWith(f + '.')) return true; // 부모 필드 포함 (e.g., metadata.display.popup)
      return false;
    });
  };
  
  // 🆕 디버깅: 현재 이벤트의 필드 상태 로깅
  console.log('[SuggestionBuilder] Current event fields:', {
    start_at_value: currentEvent.start_at,
    start_at_type: typeof currentEvent.start_at,
    end_at_value: currentEvent.end_at,
    end_at_type: typeof currentEvent.end_at,
    venue_value: currentEvent.venue,
    address_value: currentEvent.address,
    hasOverview: !!(currentEvent.overview && currentEvent.overview.trim() !== ''),
    hasVenue: !!(currentEvent.venue && currentEvent.venue.trim() !== ''),
    hasAddress: !!(currentEvent.address && currentEvent.address.trim() !== ''),
    hasStartAt: !!(currentEvent.start_at !== null && currentEvent.start_at !== undefined && currentEvent.start_at !== ''),
    hasEndAt: !!(currentEvent.end_at !== null && currentEvent.end_at !== undefined && currentEvent.end_at !== ''),
    hasPriceMin: currentEvent.price_min !== null && currentEvent.price_min !== undefined,
    hasPriceMax: currentEvent.price_max !== null && currentEvent.price_max !== undefined,
    hasTags: !!(currentEvent.derived_tags && currentEvent.derived_tags.length > 0),
    forceFields, // 🆕 선택한 필드 로깅
  });

  // 1. 기본 필드
  // overview: 빈 값일 때만 제안 (null, undefined, 빈 문자열 체크)
  const hasOverview = currentEvent.overview && currentEvent.overview.trim() !== '';
  if (extracted.overview && shouldSuggest('overview', hasOverview)) {
    suggestions.overview = createSuggestion(
      extracted.overview,
      'AI',
      context.hasSearchResults 
        ? `Gemini extraction from ${context.searchResultCount || 0} search results`
        : 'Gemini extraction (no search results)',
      'overview',
      { hasContextualData: context.hasSearchResults }
    );
  }

  // overview_raw: 내부용이므로 제안하지 않음 (AI가 자동으로 참고용으로만 사용)

  // 날짜: 빈 값일 때만 제안 (null, undefined, 빈 문자열 체크)
  const hasStartDate = currentEvent.start_at !== null && 
                       currentEvent.start_at !== undefined && 
                       currentEvent.start_at !== '';
  const hasEndDate = currentEvent.end_at !== null && 
                     currentEvent.end_at !== undefined && 
                     currentEvent.end_at !== '';
  
  if (extracted.start_date && !hasStartDate) {
    suggestions.start_at = createSuggestion(
      extracted.start_date,
      'AI',
      'Gemini extracted date',
      'start_at',
      { hasContextualData: context.hasSearchResults }
    );
  }

  if (extracted.end_date && !hasEndDate) {
    suggestions.end_at = createSuggestion(
      extracted.end_date,
      'AI',
      'Gemini extracted date',
      'end_at',
      { hasContextualData: context.hasSearchResults }
    );
  }

  // 장소/주소: 빈 값일 때만 제안 (null, undefined, 빈 문자열 체크)
  const hasVenue = currentEvent.venue && currentEvent.venue.trim() !== '';
  const hasAddress = currentEvent.address && currentEvent.address.trim() !== '';
  
  if (extracted.venue && !hasVenue) {
    suggestions.venue = createSuggestion(
      extracted.venue,
      'AI',
      'Gemini extracted venue',
      'venue',
      { hasContextualData: context.hasSearchResults }
    );
  }

  if (extracted.address && !hasAddress) {
    suggestions.address = createSuggestion(
      extracted.address,
      'AI',
      'Gemini extracted address',
      'address',
      { hasContextualData: context.hasSearchResults }
    );
  }

  // 2. 가격: 빈 값일 때만 제안
  if (extracted.price_min !== undefined && extracted.price_min !== null && currentEvent.price_min == null) {
    suggestions.price_min = createSuggestion(
      extracted.price_min,
      'AI',
      'Gemini extracted price',
      'price_min',
      { hasContextualData: context.hasSearchResults }
    );
  }

  if (extracted.price_max !== undefined && extracted.price_max !== null && currentEvent.price_max == null) {
    suggestions.price_max = createSuggestion(
      extracted.price_max,
      'AI',
      'Gemini extracted price',
      'price_max',
      { hasContextualData: context.hasSearchResults }
    );
  }

  // 3. 태그: 빈 값일 때만 제안
  if (extracted.derived_tags && extracted.derived_tags.length > 0 && (!currentEvent.derived_tags || currentEvent.derived_tags.length === 0)) {
    suggestions.derived_tags = createSuggestion(
      extracted.derived_tags,
      'AI',
      'Gemini derived tags',
      'derived_tags',
      { hasContextualData: context.hasSearchResults }
    );
  }

  // 4. 운영 시간: 빈 값일 때만 제안
  const currentOpeningHours = currentEvent.opening_hours || {};
  const hasCurrentOpeningHours = Object.values(currentOpeningHours).some((v: any) => v !== null && v !== '');
  if (extracted.opening_hours && !hasCurrentOpeningHours) {
    const hasContent = Object.values(extracted.opening_hours).some(v => v !== null && v !== '');
    if (hasContent) {
      suggestions.opening_hours = createSuggestion(
        extracted.opening_hours,
        'AI',
        'Gemini extracted hours',
        'opening_hours',
        { hasContextualData: context.hasSearchResults }
      );
    }
  }

  // 5. 외부 링크: 빈 값일 때만 제안
  if (extracted.external_links) {
    const links = extracted.external_links;
    const currentLinks = currentEvent.external_links || {};
    
    if (links.official && !currentLinks.official) {
      suggestions['external_links.official'] = createSuggestion(
        links.official,
        'AI',
        'Gemini extracted official link',
        'external_links.official',
        { hasContextualData: context.hasSearchResults }
      );
    }
    if (links.ticket && !currentLinks.ticket) {
      suggestions['external_links.ticket'] = createSuggestion(
        links.ticket,
        'AI',
        'Gemini extracted ticket link',
        'external_links.ticket',
        { hasContextualData: context.hasSearchResults }
      );
    }
    if (links.reservation && !currentLinks.reservation) {
      suggestions['external_links.reservation'] = createSuggestion(
        links.reservation,
        'AI',
        'Gemini extracted reservation link',
        'external_links.reservation',
        { hasContextualData: context.hasSearchResults }
      );
    }
  }

  // 6. 카테고리 특화 필드: 개별 필드 단위로 제안 (빈 값일 때만)
  const currentMetadata = currentEvent.metadata || {};
  const currentDisplay = currentMetadata.display || {};
  
  if (context.category === '전시' && (extracted as any).exhibition_display) {
    const exhibitionData = (extracted as any).exhibition_display;
    const currentExhibition = currentDisplay.exhibition || {};
    
    // 개별 필드 단위로 제안
    if (exhibitionData.artists && exhibitionData.artists.length > 0 && 
        (!currentExhibition.artists || currentExhibition.artists.length === 0)) {
      suggestions['metadata.display.exhibition.artists'] = createSuggestion(
        exhibitionData.artists,
        'AI',
        'Gemini extracted artists',
        'metadata.display.exhibition.artists',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    if (exhibitionData.genre && exhibitionData.genre.length > 0 && 
        (!currentExhibition.genre || currentExhibition.genre.length === 0)) {
      suggestions['metadata.display.exhibition.genre'] = createSuggestion(
        exhibitionData.genre,
        'AI',
        'Gemini extracted genre',
        'metadata.display.exhibition.genre',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    if (exhibitionData.duration_minutes && !currentExhibition.duration_minutes) {
      suggestions['metadata.display.exhibition.duration_minutes'] = createSuggestion(
        exhibitionData.duration_minutes,
        'AI',
        'Gemini extracted duration',
        'metadata.display.exhibition.duration_minutes',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    if (exhibitionData.type && !currentExhibition.type) {
      suggestions['metadata.display.exhibition.type'] = createSuggestion(
        exhibitionData.type,
        'AI',
        'Gemini extracted exhibition type',
        'metadata.display.exhibition.type',
        { hasContextualData: context.hasSearchResults }
      );
    }
  }

  if (context.category === '공연' && (extracted as any).performance_display) {
    const performanceData = (extracted as any).performance_display;
    const currentPerformance = currentDisplay.performance || {};
    
    // 개별 필드 단위로 제안
    if (performanceData.cast && performanceData.cast.length > 0 && 
        (!currentPerformance.cast || currentPerformance.cast.length === 0)) {
      suggestions['metadata.display.performance.cast'] = createSuggestion(
        performanceData.cast,
        'AI',
        'Gemini extracted cast',
        'metadata.display.performance.cast',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    if (performanceData.genre && performanceData.genre.length > 0 && 
        (!currentPerformance.genre || currentPerformance.genre.length === 0)) {
      suggestions['metadata.display.performance.genre'] = createSuggestion(
        performanceData.genre,
        'AI',
        'Gemini extracted genre',
        'metadata.display.performance.genre',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    if (performanceData.duration_minutes && !currentPerformance.duration_minutes) {
      suggestions['metadata.display.performance.duration_minutes'] = createSuggestion(
        performanceData.duration_minutes,
        'AI',
        'Gemini extracted duration',
        'metadata.display.performance.duration_minutes',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    if (performanceData.age_limit && !currentPerformance.age_limit) {
      suggestions['metadata.display.performance.age_limit'] = createSuggestion(
        performanceData.age_limit,
        'AI',
        'Gemini extracted age limit',
        'metadata.display.performance.age_limit',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    if (performanceData.discounts && performanceData.discounts.length > 0 && 
        (!currentPerformance.discounts || currentPerformance.discounts.length === 0)) {
      suggestions['metadata.display.performance.discounts'] = createSuggestion(
        performanceData.discounts,
        'AI',
        'Gemini extracted discounts',
        'metadata.display.performance.discounts',
        { hasContextualData: context.hasSearchResults }
      );
    }
  }

  // 🎪 축제 특화 정보
  if (context.category === '축제' && (extracted as any).festival_display) {
    const festivalData = (extracted as any).festival_display;
    const currentFestival = currentDisplay.festival || {};
    
    // 개별 필드 단위로 제안
    if (festivalData.organizer && !currentFestival.organizer) {
      suggestions['metadata.display.festival.organizer'] = createSuggestion(
        festivalData.organizer,
        'AI',
        'Gemini extracted organizer',
        'metadata.display.festival.organizer',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    if (festivalData.program_highlights && !currentFestival.program_highlights) {
      suggestions['metadata.display.festival.program_highlights'] = createSuggestion(
        festivalData.program_highlights,
        'AI',
        'Gemini extracted program highlights',
        'metadata.display.festival.program_highlights',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    if (festivalData.food_and_booths && !currentFestival.food_and_booths) {
      suggestions['metadata.display.festival.food_and_booths'] = createSuggestion(
        festivalData.food_and_booths,
        'AI',
        'Gemini extracted food and booths',
        'metadata.display.festival.food_and_booths',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    if (festivalData.scale_text && !currentFestival.scale_text) {
      suggestions['metadata.display.festival.scale_text'] = createSuggestion(
        festivalData.scale_text,
        'AI',
        'Gemini extracted scale',
        'metadata.display.festival.scale_text',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    if (festivalData.parking_tips && !currentFestival.parking_tips) {
      suggestions['metadata.display.festival.parking_tips'] = createSuggestion(
        festivalData.parking_tips,
        'AI',
        'Gemini extracted parking tips',
        'metadata.display.festival.parking_tips',
        { hasContextualData: context.hasSearchResults }
      );
    }
  }

  // 📅 행사 특화 정보
  if (context.category === '행사' && (extracted as any).event_display) {
    const eventData = (extracted as any).event_display;
    const currentEventDisplay = currentDisplay.event || {};
    
    // 개별 필드 단위로 제안
    if (eventData.target_audience && !currentEventDisplay.target_audience) {
      suggestions['metadata.display.event.target_audience'] = createSuggestion(
        eventData.target_audience,
        'AI',
        'Gemini extracted target audience',
        'metadata.display.event.target_audience',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    if (eventData.capacity && !currentEventDisplay.capacity) {
      suggestions['metadata.display.event.capacity'] = createSuggestion(
        eventData.capacity,
        'AI',
        'Gemini extracted capacity',
        'metadata.display.event.capacity',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    if (eventData.registration && !currentEventDisplay.registration) {
      suggestions['metadata.display.event.registration'] = createSuggestion(
        eventData.registration,
        'AI',
        'Gemini extracted registration info',
        'metadata.display.event.registration',
        { hasContextualData: context.hasSearchResults }
      );
    }
  }

  // 🏪 팝업 특화 정보
  if (context.category === '팝업' && (extracted as any).popup_display) {
    const popupData = (extracted as any).popup_display;
    const currentPopup = currentDisplay.popup || {};
    
    // ⭐ 팝업 타입 (type)
    const hasType = !!currentPopup.type;
    if (popupData.type && shouldSuggest('metadata.display.popup.type', hasType)) {
      suggestions['metadata.display.popup.type'] = createSuggestion(
        popupData.type,
        'AI',
        'Gemini extracted popup type',
        'metadata.display.popup.type',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    // 브랜드
    const hasBrands = currentPopup.brands && currentPopup.brands.length > 0;
    if (popupData.brands && popupData.brands.length > 0 && shouldSuggest('metadata.display.popup.brands', hasBrands)) {
      suggestions['metadata.display.popup.brands'] = createSuggestion(
        popupData.brands,
        'AI',
        'Gemini extracted brands',
        'metadata.display.popup.brands',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    // 🤝 콜라보 설명
    const hasCollabDesc = !!currentPopup.collab_description;
    if (popupData.collab_description && shouldSuggest('metadata.display.popup.collab_description', hasCollabDesc)) {
      suggestions['metadata.display.popup.collab_description'] = createSuggestion(
        popupData.collab_description,
        'AI',
        'Gemini extracted collaboration description',
        'metadata.display.popup.collab_description',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    // is_fnb (F&B 여부)
    const hasIsFnb = currentPopup.is_fnb !== undefined;
    if (popupData.is_fnb !== undefined && shouldSuggest('metadata.display.popup.is_fnb', hasIsFnb)) {
      suggestions['metadata.display.popup.is_fnb'] = createSuggestion(
        popupData.is_fnb,
        'AI',
        'Gemini extracted F&B status',
        'metadata.display.popup.is_fnb',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    // 🍔 F&B 메뉴 정보 - 개별 필드로 분리
    if (popupData.fnb_items) {
      const currentFnbItems = currentPopup.fnb_items || {};
      
      // 시그니처 메뉴
      const hasSignatureMenu = currentFnbItems.signature_menu && currentFnbItems.signature_menu.length > 0;
      if (popupData.fnb_items.signature_menu && popupData.fnb_items.signature_menu.length > 0 
          && shouldSuggest('metadata.display.popup.fnb_items.signature_menu', hasSignatureMenu)) {
        suggestions['metadata.display.popup.fnb_items.signature_menu'] = createSuggestion(
          popupData.fnb_items.signature_menu,
          'AI',
          'Gemini extracted signature menu',
          'metadata.display.popup.fnb_items.signature_menu',
          { hasContextualData: context.hasSearchResults }
        );
      }
      
      // 메뉴 카테고리
      const hasMenuCategories = currentFnbItems.menu_categories && currentFnbItems.menu_categories.length > 0;
      if (popupData.fnb_items.menu_categories && popupData.fnb_items.menu_categories.length > 0 
          && shouldSuggest('metadata.display.popup.fnb_items.menu_categories', hasMenuCategories)) {
        suggestions['metadata.display.popup.fnb_items.menu_categories'] = createSuggestion(
          popupData.fnb_items.menu_categories,
          'AI',
          'Gemini extracted menu categories',
          'metadata.display.popup.fnb_items.menu_categories',
          { hasContextualData: context.hasSearchResults }
        );
      }
      
      // 가격대
      const hasPriceRange = !!currentFnbItems.price_range;
      if (popupData.fnb_items.price_range && shouldSuggest('metadata.display.popup.fnb_items.price_range', hasPriceRange)) {
        suggestions['metadata.display.popup.fnb_items.price_range'] = createSuggestion(
          popupData.fnb_items.price_range,
          'AI',
          'Gemini extracted price range',
          'metadata.display.popup.fnb_items.price_range',
          { hasContextualData: context.hasSearchResults }
        );
      }
      
      // fnb_items 전체 객체 (하위 필드가 명시되지 않았을 때)
      const hasFnbItems = !!currentPopup.fnb_items;
      if (shouldSuggest('metadata.display.popup.fnb_items', hasFnbItems)) {
        suggestions['metadata.display.popup.fnb_items'] = createSuggestion(
          popupData.fnb_items,
          'AI',
          'Gemini extracted F&B items',
          'metadata.display.popup.fnb_items',
          { hasContextualData: context.hasSearchResults }
        );
      }
    }
    
    // 굿즈
    const hasGoodsItems = currentPopup.goods_items && currentPopup.goods_items.length > 0;
    if (popupData.goods_items && popupData.goods_items.length > 0 && shouldSuggest('metadata.display.popup.goods_items', hasGoodsItems)) {
      suggestions['metadata.display.popup.goods_items'] = createSuggestion(
        popupData.goods_items,
        'AI',
        'Gemini extracted goods',
        'metadata.display.popup.goods_items',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    // 포토존 여부
    const hasPhotoZone = currentPopup.photo_zone !== undefined;
    if (popupData.photo_zone !== undefined && shouldSuggest('metadata.display.popup.photo_zone', hasPhotoZone)) {
      suggestions['metadata.display.popup.photo_zone'] = createSuggestion(
        popupData.photo_zone,
        'AI',
        'Gemini extracted photo zone',
        'metadata.display.popup.photo_zone',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    // 포토존 설명
    const hasPhotoZoneDesc = !!currentPopup.photo_zone_desc;
    if (popupData.photo_zone_desc && shouldSuggest('metadata.display.popup.photo_zone_desc', hasPhotoZoneDesc)) {
      suggestions['metadata.display.popup.photo_zone_desc'] = createSuggestion(
        popupData.photo_zone_desc,
        'AI',
        'Gemini extracted photo zone description',
        'metadata.display.popup.photo_zone_desc',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    // 대기 시간 힌트
    const hasWaitingHint = !!currentPopup.waiting_hint;
    if (popupData.waiting_hint && shouldSuggest('metadata.display.popup.waiting_hint', hasWaitingHint)) {
      suggestions['metadata.display.popup.waiting_hint'] = createSuggestion(
        popupData.waiting_hint,
        'AI',
        'Gemini extracted waiting hint',
        'metadata.display.popup.waiting_hint',
        { hasContextualData: context.hasSearchResults }
      );
    }
  }

  return suggestions;
}

/**
 * Place 섹션 결과를 제안으로 변환
 */
export function buildSuggestionsFromPlace(
  placeResults: any[],
  existingLinks: any
): EventSuggestions {
  const suggestions: EventSuggestions = {};

  if (placeResults.length > 0 && !existingLinks.official) {
    const placeLink = placeResults[0].link;
    suggestions['external_links.official'] = createSuggestion(
      placeLink,
      'NAVER_API',
      'Naver Place search result',
      'external_links.official',
      { hasMultipleSources: false }
    );
  }

  return suggestions;
}

/**
 * 기존 필드 값을 제안으로 변환 (출처 추적용)
 */
export function buildSuggestionsFromExisting(
  event: any,
  source: DataSource,
  sourceDetail: string
): EventSuggestions {
  const suggestions: EventSuggestions = {};

  if (event.overview) {
    suggestions.overview = createSuggestion(
      event.overview,
      source,
      sourceDetail,
      'overview'
    );
  }

  if (event.price_min !== null) {
    suggestions.price_min = createSuggestion(
      event.price_min,
      source,
      sourceDetail,
      'price_min'
    );
  }

  if (event.price_max !== null) {
    suggestions.price_max = createSuggestion(
      event.price_max,
      source,
      sourceDetail,
      'price_max'
    );
  }

  if (event.opening_hours) {
    suggestions.opening_hours = createSuggestion(
      event.opening_hours,
      source,
      sourceDetail,
      'opening_hours'
    );
  }

  return suggestions;
}

