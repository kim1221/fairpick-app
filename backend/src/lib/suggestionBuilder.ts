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

  // 날짜: 선택한 필드에 포함되어 있으면 제안
  const hasStartDate = currentEvent.start_at !== null && 
                       currentEvent.start_at !== undefined && 
                       currentEvent.start_at !== '';
  const hasEndDate = currentEvent.end_at !== null && 
                     currentEvent.end_at !== undefined && 
                     currentEvent.end_at !== '';
  
  if (extracted.start_date && shouldSuggest('start_at', hasStartDate)) {
    suggestions.start_at = createSuggestion(
      extracted.start_date,
      'AI',
      'Gemini extracted date',
      'start_at',
      { hasContextualData: context.hasSearchResults }
    );
  }

  if (extracted.end_date && shouldSuggest('end_at', hasEndDate)) {
    suggestions.end_at = createSuggestion(
      extracted.end_date,
      'AI',
      'Gemini extracted date',
      'end_at',
      { hasContextualData: context.hasSearchResults }
    );
  }

  // 장소/주소: 선택한 필드에 포함되어 있으면 제안
  const hasVenue = currentEvent.venue && currentEvent.venue.trim() !== '';
  const hasAddress = currentEvent.address && currentEvent.address.trim() !== '';
  
  if (extracted.venue && shouldSuggest('venue', hasVenue)) {
    suggestions.venue = createSuggestion(
      extracted.venue,
      'AI',
      'Gemini extracted venue',
      'venue',
      { hasContextualData: context.hasSearchResults }
    );
  }

  if (extracted.address && shouldSuggest('address', hasAddress)) {
    suggestions.address = createSuggestion(
      extracted.address,
      'AI',
      'Gemini extracted address',
      'address',
      { hasContextualData: context.hasSearchResults }
    );
  }

  // 2. 가격: 선택한 필드에 포함되어 있으면 제안
  const hasPriceMin = currentEvent.price_min != null;
  const hasPriceMax = currentEvent.price_max != null;
  
  if (extracted.price_min !== undefined && extracted.price_min !== null && shouldSuggest('price_min', hasPriceMin)) {
    suggestions.price_min = createSuggestion(
      extracted.price_min,
      'AI',
      'Gemini extracted price',
      'price_min',
      { hasContextualData: context.hasSearchResults }
    );
  }

  if (extracted.price_max !== undefined && extracted.price_max !== null && shouldSuggest('price_max', hasPriceMax)) {
    suggestions.price_max = createSuggestion(
      extracted.price_max,
      'AI',
      'Gemini extracted price',
      'price_max',
      { hasContextualData: context.hasSearchResults }
    );
  }

  // 3. 태그: 선택한 필드에 포함되어 있으면 제안
  const hasTags = currentEvent.derived_tags && currentEvent.derived_tags.length > 0;
  if (extracted.derived_tags && extracted.derived_tags.length > 0 && shouldSuggest('derived_tags', hasTags)) {
    suggestions.derived_tags = createSuggestion(
      extracted.derived_tags,
      'AI',
      'Gemini derived tags',
      'derived_tags',
      { hasContextualData: context.hasSearchResults }
    );
  }

  // 4. 운영 시간: 선택한 필드에 포함되어 있으면 제안
  const currentOpeningHours = currentEvent.opening_hours || {};
  const hasCurrentOpeningHours = Object.values(currentOpeningHours).some((v: any) => v !== null && v !== '');
  if (extracted.opening_hours && shouldSuggest('opening_hours', hasCurrentOpeningHours)) {
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

  // 5. 외부 링크: 선택한 필드에 포함되어 있으면 제안
  if (extracted.external_links) {
    const links = extracted.external_links;
    const currentLinks = currentEvent.external_links || {};
    
    const hasOfficialLink = !!currentLinks.official;
    const hasTicketLink = !!currentLinks.ticket;
    const hasReservationLink = !!currentLinks.reservation;
    
    if (links.official && shouldSuggest('external_links.official', hasOfficialLink)) {
      suggestions['external_links.official'] = createSuggestion(
        links.official,
        'AI',
        'Gemini extracted official link',
        'external_links.official',
        { hasContextualData: context.hasSearchResults }
      );
    }
    if (links.ticket && shouldSuggest('external_links.ticket', hasTicketLink)) {
      suggestions['external_links.ticket'] = createSuggestion(
        links.ticket,
        'AI',
        'Gemini extracted ticket link',
        'external_links.ticket',
        { hasContextualData: context.hasSearchResults }
      );
    }
    if (links.reservation && shouldSuggest('external_links.reservation', hasReservationLink)) {
      suggestions['external_links.reservation'] = createSuggestion(
        links.reservation,
        'AI',
        'Gemini extracted reservation link',
        'external_links.reservation',
        { hasContextualData: context.hasSearchResults }
      );
    }
  }

  // 6. 카테고리 특화 필드: 개별 필드 단위로 제안 (선택한 필드에 포함되어 있으면)
  const currentMetadata = currentEvent.metadata || {};
  const currentDisplay = currentMetadata.display || {};
  
  if (context.category === '전시' && (extracted as any).exhibition_display) {
    const exhibitionData = (extracted as any).exhibition_display;
    const currentExhibition = currentDisplay.exhibition || {};
    
    // 개별 필드 단위로 제안
    const hasArtists = currentExhibition.artists && currentExhibition.artists.length > 0;
    if (exhibitionData.artists && exhibitionData.artists.length > 0 && shouldSuggest('metadata.display.exhibition.artists', hasArtists)) {
      suggestions['metadata.display.exhibition.artists'] = createSuggestion(
        exhibitionData.artists,
        'AI',
        'Gemini extracted artists',
        'metadata.display.exhibition.artists',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    const hasGenre = currentExhibition.genre && currentExhibition.genre.length > 0;
    if (exhibitionData.genre && exhibitionData.genre.length > 0 && shouldSuggest('metadata.display.exhibition.genre', hasGenre)) {
      suggestions['metadata.display.exhibition.genre'] = createSuggestion(
        exhibitionData.genre,
        'AI',
        'Gemini extracted genre',
        'metadata.display.exhibition.genre',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    const hasDuration = !!currentExhibition.duration_minutes;
    if (exhibitionData.duration_minutes && shouldSuggest('metadata.display.exhibition.duration_minutes', hasDuration)) {
      suggestions['metadata.display.exhibition.duration_minutes'] = createSuggestion(
        exhibitionData.duration_minutes,
        'AI',
        'Gemini extracted duration',
        'metadata.display.exhibition.duration_minutes',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    const hasType = !!currentExhibition.type;
    if (exhibitionData.type && shouldSuggest('metadata.display.exhibition.type', hasType)) {
      suggestions['metadata.display.exhibition.type'] = createSuggestion(
        exhibitionData.type,
        'AI',
        'Gemini extracted exhibition type',
        'metadata.display.exhibition.type',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    const hasFacilities = !!currentExhibition.facilities;
    if (exhibitionData.facilities && shouldSuggest('metadata.display.exhibition.facilities', hasFacilities)) {
      suggestions['metadata.display.exhibition.facilities'] = createSuggestion(
        exhibitionData.facilities,
        'AI',
        'Gemini extracted facilities',
        'metadata.display.exhibition.facilities',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    const hasDocentTour = !!currentExhibition.docent_tour;
    if (exhibitionData.docent_tour && shouldSuggest('metadata.display.exhibition.docent_tour', hasDocentTour)) {
      suggestions['metadata.display.exhibition.docent_tour'] = createSuggestion(
        exhibitionData.docent_tour,
        'AI',
        'Gemini extracted docent tour info',
        'metadata.display.exhibition.docent_tour',
        { hasContextualData: context.hasSearchResults }
      );
    }
  }

  if (context.category === '공연' && (extracted as any).performance_display) {
    const performanceData = (extracted as any).performance_display;
    const currentPerformance = currentDisplay.performance || {};
    
    // 개별 필드 단위로 제안
    const hasCast = currentPerformance.cast && currentPerformance.cast.length > 0;
    if (performanceData.cast && performanceData.cast.length > 0 && shouldSuggest('metadata.display.performance.cast', hasCast)) {
      suggestions['metadata.display.performance.cast'] = createSuggestion(
        performanceData.cast,
        'AI',
        'Gemini extracted cast',
        'metadata.display.performance.cast',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    const hasGenre = currentPerformance.genre && currentPerformance.genre.length > 0;
    if (performanceData.genre && performanceData.genre.length > 0 && shouldSuggest('metadata.display.performance.genre', hasGenre)) {
      suggestions['metadata.display.performance.genre'] = createSuggestion(
        performanceData.genre,
        'AI',
        'Gemini extracted genre',
        'metadata.display.performance.genre',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    const hasDuration = !!currentPerformance.duration_minutes;
    if (performanceData.duration_minutes && shouldSuggest('metadata.display.performance.duration_minutes', hasDuration)) {
      suggestions['metadata.display.performance.duration_minutes'] = createSuggestion(
        performanceData.duration_minutes,
        'AI',
        'Gemini extracted duration',
        'metadata.display.performance.duration_minutes',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    const hasAgeLimit = !!currentPerformance.age_limit;
    if (performanceData.age_limit && shouldSuggest('metadata.display.performance.age_limit', hasAgeLimit)) {
      suggestions['metadata.display.performance.age_limit'] = createSuggestion(
        performanceData.age_limit,
        'AI',
        'Gemini extracted age limit',
        'metadata.display.performance.age_limit',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    const hasIntermission = !!currentPerformance.intermission;
    if (performanceData.intermission && shouldSuggest('metadata.display.performance.intermission', hasIntermission)) {
      suggestions['metadata.display.performance.intermission'] = createSuggestion(
        performanceData.intermission,
        'AI',
        'Gemini extracted intermission info',
        'metadata.display.performance.intermission',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    const hasDiscounts = currentPerformance.discounts && currentPerformance.discounts.length > 0;
    if (performanceData.discounts && performanceData.discounts.length > 0 && shouldSuggest('metadata.display.performance.discounts', hasDiscounts)) {
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
    const hasOrganizer = !!currentFestival.organizer;
    if (festivalData.organizer && shouldSuggest('metadata.display.festival.organizer', hasOrganizer)) {
      suggestions['metadata.display.festival.organizer'] = createSuggestion(
        festivalData.organizer,
        'AI',
        'Gemini extracted organizer',
        'metadata.display.festival.organizer',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    const hasProgramHighlights = !!currentFestival.program_highlights;
    if (festivalData.program_highlights && shouldSuggest('metadata.display.festival.program_highlights', hasProgramHighlights)) {
      suggestions['metadata.display.festival.program_highlights'] = createSuggestion(
        festivalData.program_highlights,
        'AI',
        'Gemini extracted program highlights',
        'metadata.display.festival.program_highlights',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    const hasFoodAndBooths = !!currentFestival.food_and_booths;
    if (festivalData.food_and_booths && shouldSuggest('metadata.display.festival.food_and_booths', hasFoodAndBooths)) {
      suggestions['metadata.display.festival.food_and_booths'] = createSuggestion(
        festivalData.food_and_booths,
        'AI',
        'Gemini extracted food and booths',
        'metadata.display.festival.food_and_booths',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    const hasScaleText = !!currentFestival.scale_text;
    if (festivalData.scale_text && shouldSuggest('metadata.display.festival.scale_text', hasScaleText)) {
      suggestions['metadata.display.festival.scale_text'] = createSuggestion(
        festivalData.scale_text,
        'AI',
        'Gemini extracted scale',
        'metadata.display.festival.scale_text',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    const hasParkingTips = !!currentFestival.parking_tips;
    if (festivalData.parking_tips && shouldSuggest('metadata.display.festival.parking_tips', hasParkingTips)) {
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
    const hasTargetAudience = !!currentEventDisplay.target_audience;
    if (eventData.target_audience && shouldSuggest('metadata.display.event.target_audience', hasTargetAudience)) {
      suggestions['metadata.display.event.target_audience'] = createSuggestion(
        eventData.target_audience,
        'AI',
        'Gemini extracted target audience',
        'metadata.display.event.target_audience',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    const hasCapacity = !!currentEventDisplay.capacity;
    if (eventData.capacity && shouldSuggest('metadata.display.event.capacity', hasCapacity)) {
      suggestions['metadata.display.event.capacity'] = createSuggestion(
        eventData.capacity,
        'AI',
        'Gemini extracted capacity',
        'metadata.display.event.capacity',
        { hasContextualData: context.hasSearchResults }
      );
    }
    
    const hasRegistration = !!currentEventDisplay.registration;
    if (eventData.registration && shouldSuggest('metadata.display.event.registration', hasRegistration)) {
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

  // 🆕 선택한 필드 중 정보를 못 찾은 필드에 대한 설명 추가
  if (forceFields.length > 0) {
    console.log('[SuggestionBuilder] Checking for missing fields in forceFields:', forceFields);
    
    const fieldDescriptions: Record<string, string> = {
      'overview': '개요',
      'start_at': '시작 날짜',
      'end_at': '종료 날짜',
      'venue': '장소',
      'address': '주소',
      'price_min': '최소 가격',
      'price_max': '최대 가격',
      'derived_tags': '태그',
      'opening_hours': '운영 시간',
      'external_links': '외부 링크',
      'external_links.official': '공식 링크',
      'external_links.ticket': '티켓 링크',
      'external_links.reservation': '예약 링크',
      'metadata.display.exhibition.artists': '작가/아티스트',
      'metadata.display.exhibition.genre': '전시 장르',
      'metadata.display.exhibition.type': '전시 유형',
      'metadata.display.exhibition.duration_minutes': '관람 시간',
      'metadata.display.exhibition.facilities': '편의시설',
      'metadata.display.exhibition.docent_tour': '도슨트 투어',
      'metadata.display.performance.cast': '출연진',
      'metadata.display.performance.genre': '공연 장르',
      'metadata.display.performance.duration_minutes': '공연 시간',
      'metadata.display.performance.intermission': '인터미션',
      'metadata.display.performance.age_limit': '연령 제한',
      'metadata.display.performance.discounts': '할인 정보',
      'metadata.display.festival.organizer': '주최/주관',
      'metadata.display.festival.program_highlights': '주요 프로그램',
      'metadata.display.festival.food_and_booths': '먹거리/부스',
      'metadata.display.festival.scale_text': '규모',
      'metadata.display.festival.parking_tips': '주차 정보',
      'metadata.display.event.target_audience': '참가 대상',
      'metadata.display.event.capacity': '정원',
      'metadata.display.event.registration': '사전 등록 정보',
      'metadata.display.popup.type': '팝업 타입',
      'metadata.display.popup.brands': '브랜드',
      'metadata.display.popup.collab_description': '콜라보 설명',
      'metadata.display.popup.fnb_items': 'F&B 메뉴',
      'metadata.display.popup.fnb_items.signature_menu': '시그니처 메뉴',
      'metadata.display.popup.fnb_items.menu_categories': '메뉴 카테고리',
      'metadata.display.popup.fnb_items.price_range': 'F&B 가격대',
      'metadata.display.popup.goods_items': '굿즈',
      'metadata.display.popup.photo_zone': '포토존 여부',
      'metadata.display.popup.photo_zone_desc': '포토존 설명',
      'metadata.display.popup.waiting_hint': '대기 시간',
    };
    
    forceFields.forEach(fieldName => {
      // 이미 제안이 있는 필드는 건너뛰기
      if (suggestions[fieldName]) return;
      
      // 부모 필드가 제안되었는지 확인 (예: external_links.official의 부모는 external_links)
      const parentField = fieldName.split('.').slice(0, -1).join('.');
      if (parentField && suggestions[parentField]) return;
      
      // 자식 필드가 제안되었는지 확인 (예: metadata.display.popup의 자식들)
      const hasChildSuggestion = Object.keys(suggestions).some(key => key.startsWith(fieldName + '.'));
      if (hasChildSuggestion) return;
      
      // 정보를 못 찾은 필드에 대한 설명 추가
      const fieldDesc = fieldDescriptions[fieldName] || fieldName;
      const searchMethod = context.hasSearchResults ? '네이버 검색 결과' : 'AI 직접 검색 (Google Grounding)';
      
      console.log(`[SuggestionBuilder] ⚠️ No suggestion for selected field: ${fieldName} (${fieldDesc})`);
      
      suggestions[fieldName] = {
        value: null,
        confidence: 0,
        source: 'AI',
        source_detail: `${searchMethod}에서 찾을 수 없음`,
        warning: `⚠️ "${fieldDesc}" 정보를 찾을 수 없습니다.\n\n가능한 이유:\n• ${searchMethod}에 해당 정보가 없음\n• 이벤트명이 부정확하거나 너무 일반적임\n• 이벤트가 최신이어서 온라인에 정보가 부족함\n\n💡 수동으로 입력하거나, 다른 소스에서 정보를 확인해주세요.`,
        extracted_at: new Date().toISOString(),
      };
    });
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

/**
 * AI 직접 검색 (Gemini + Google Search) 결과를 제안으로 변환
 * @param aiData - Gemini API의 직접 검색 결과
 * @param context - 현재 이벤트 및 선택한 필드 정보
 */
export function buildSuggestionsFromAIDirect(
  aiData: any,
  context: {
    selectedFields: string[];
    category?: string;
    currentEvent?: any;
  }
): EventSuggestions {
  const suggestions: EventSuggestions = {};
  const currentEvent = context.currentEvent || {};
  const selectedFields = context.selectedFields || [];
  
  // Helper: 필드가 제안 대상인지 확인
  const shouldSuggest = (fieldName: string): boolean => {
    // selectedFields가 비어있으면: 모든 필드 제안
    if (selectedFields.length === 0) return true;
    
    // selectedFields에 포함되어 있으면: 제안
    return selectedFields.some(f => {
      if (f === '*') return true; // 모든 필드
      if (fieldName === f) return true; // 정확히 일치
      if (fieldName.startsWith(f + '.')) return true; // 부모 필드 포함
      if (f.startsWith(fieldName + '.')) return true; // 자식 필드 포함
      return false;
    });
  };
  
  // 🏪 팝업 - 포토존
  if (aiData.photo_zone && shouldSuggest('metadata.display.popup.photo_zone')) {
    suggestions['metadata.display.popup.photo_zone'] = createSuggestion(
      aiData.photo_zone,
      'AI',
      'Gemini direct search (Google Grounding)',
      'metadata.display.popup.photo_zone',
      { hasContextualData: true }
    );
  }
  
  // 🏪 팝업 - 대기시간
  if (aiData.waiting_time && shouldSuggest('metadata.display.popup.waiting_time')) {
    suggestions['metadata.display.popup.waiting_time'] = createSuggestion(
      aiData.waiting_time,
      'AI',
      'Gemini direct search (Google Grounding)',
      'metadata.display.popup.waiting_time',
      { hasContextualData: true }
    );
  }
  
  // 🏪 팝업 - 주차 정보
  if (aiData.parking && shouldSuggest('metadata.display.popup.parking')) {
    suggestions['metadata.display.popup.parking'] = createSuggestion(
      aiData.parking,
      'AI',
      'Gemini direct search (Google Grounding)',
      'metadata.display.popup.parking',
      { hasContextualData: true }
    );
  }
  
  // 🏪 팝업 - 예약 정보
  if (aiData.reservation && shouldSuggest('metadata.display.popup.reservation')) {
    suggestions['metadata.display.popup.reservation'] = createSuggestion(
      aiData.reservation,
      'AI',
      'Gemini direct search (Google Grounding)',
      'metadata.display.popup.reservation',
      { hasContextualData: true }
    );
  }
  
  // 🏪 팝업 - F&B 메뉴
  if (aiData.fnb_items && shouldSuggest('metadata.display.popup.fnb_items')) {
    suggestions['metadata.display.popup.fnb_items'] = createSuggestion(
      aiData.fnb_items,
      'AI',
      'Gemini direct search (Google Grounding)',
      'metadata.display.popup.fnb_items',
      { hasContextualData: true }
    );
  }
  
  // ⏰ 운영시간
  if (aiData.opening_hours && shouldSuggest('opening_hours')) {
    suggestions['opening_hours'] = createSuggestion(
      aiData.opening_hours,
      'AI',
      'Gemini direct search (Google Grounding)',
      'opening_hours',
      { hasContextualData: true }
    );
  }
  
  // 🎨 전시 - 작가
  if (aiData.artists && shouldSuggest('metadata.display.exhibition.artists')) {
    suggestions['metadata.display.exhibition.artists'] = createSuggestion(
      aiData.artists,
      'AI',
      'Gemini direct search (Google Grounding)',
      'metadata.display.exhibition.artists',
      { hasContextualData: true }
    );
  }
  
  // 🎭 공연 - 출연진
  if (aiData.cast && shouldSuggest('metadata.display.performance.cast')) {
    suggestions['metadata.display.performance.cast'] = createSuggestion(
      aiData.cast,
      'AI',
      'Gemini direct search (Google Grounding)',
      'metadata.display.performance.cast',
      { hasContextualData: true }
    );
  }
  
  return suggestions;
}

