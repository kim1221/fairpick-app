/**
 * AI Enrichment Backfill Job
 * 
 * 네이버 검색 → AI 가공 → DB 업데이트
 * 
 * 실행:
 * - npm run backfill:ai-enrich:test   # 10개만 테스트
 * - npm run backfill:ai-enrich        # 전체 실행
 * - npm run backfill:ai-enrich -- --limit=50  # 50개만
 */

import { pool } from '../db';
import { searchEventInfo, mergeSearchResults } from '../lib/naverApi';
import { extractEventInfo, extractDerivedTagsOnly } from '../lib/aiExtractor';
import { DEFAULT_POLICY, AGGRESSIVE_POLICY, CONSERVATIVE_POLICY, EnrichmentPolicy } from '../lib/enrichmentPolicy';
import { 
  decideFieldAction, 
  addSuggestion, 
  prepareAutoUpdate,
  createActionStats,
  updateActionStats,
  EnrichmentActionStats
} from '../lib/enrichmentHelper';

interface CanonicalEventRow {
  id: string;
  title: string;
  main_category: string;
  sub_category: string | null;
  venue: string | null;
  overview: string | null;
  derived_tags: string[] | null;
  opening_hours: any;
  price_min: number | null;
  price_max: number | null;
  manually_edited_fields: Record<string, boolean> | null;  // 🆕 수동 편집 추적
}

interface EnrichmentStats {
  total: number;
  processed: number;
  success: number;
  failed: number;
  skipped: number;
  updated_fields: {
    opening_hours: number;
    price: number;
    reservation: number;
    age_restriction: number;
    derived_tags: number;
    parking: number;
    transport: number;
    accessibility: number;
  };
}

/**
 * 필드가 수동으로 편집되었는지 확인
 * 
 * @param event - 이벤트 데이터
 * @param fieldName - 확인할 필드명
 * @param forceFields - 강제로 재생성할 필드 목록
 * @returns true면 수동 편집됨 (AI가 건드리면 안 됨)
 */
function isManuallyEdited(
  event: CanonicalEventRow,
  fieldName: string,
  forceFields: string[]
): boolean {
  // forceFields에 포함되어 있으면 수동 편집 무시
  if (forceFields.includes(fieldName)) {
    return false;
  }
  
  // manually_edited_fields 체크
  if (event.manually_edited_fields && event.manually_edited_fields[fieldName] === true) {
    return true;
  }
  
  return false;
}

/**
 * 이벤트가 이미 충분한 정보를 가지고 있는지 확인
 */
function needsEnrichment(event: CanonicalEventRow): boolean {
  // derived_tags가 없으면 무조건 처리
  if (!event.derived_tags || event.derived_tags.length === 0) {
    return true;
  }

  // opening_hours가 없으면 처리
  if (!event.opening_hours) {
    return true;
  }

  // price_min/max가 둘 다 없으면 처리
  if (event.price_min === null && event.price_max === null) {
    return true;
  }

  // 🆕 카테고리별 특화 정보 체크
  // CanonicalEventRow에는 metadata가 없으므로 여기서는 체크하지 않음
  // 대신 enrichSingleEvent에서 metadata를 조회하여 처리

  // 충분한 정보가 있으면 스킵
  return false;
}

/**
 * 단일 이벤트 처리
 */
async function enrichSingleEvent(
  event: CanonicalEventRow,
  useNaverSearch: boolean,
  stats: EnrichmentStats,
  actionStats: EnrichmentActionStats,  // 🆕 추가
  forceFields: string[] = []  // 🆕 강제 재생성할 필드
): Promise<void> {
  console.log(`\n[Enrich] Processing (${stats.processed + 1}/${stats.total}):`, event.title);

  try {
    let extractedInfo: any = null;
    let naverPlaceLink: string | null = null;
    
    // 🔖 field_sources를 한 번에 모아서 업데이트
    const allFieldSources: Record<string, any> = {};

    if (useNaverSearch) {
      // 네이버 검색 + AI 추출 (플레이스, 블로그, 웹)
      const searchResult = await searchEventInfo(event.title, event.venue || undefined);
      const searchText = mergeSearchResults(searchResult.place, searchResult.blog, searchResult.web);

      // 네이버 플레이스 링크 추출 (AI가 못 찾을 때를 대비)
      if (searchResult.place && searchResult.place.items && searchResult.place.items.length > 0) {
        const firstPlace = searchResult.place.items[0];
        if (firstPlace.link && firstPlace.link.trim()) {
          naverPlaceLink = firstPlace.link.trim();
          console.log(`[Enrich] 네이버 플레이스 링크 발견: ${naverPlaceLink}`);
        }
      }

      if (searchText !== '검색 결과 없음') {
        extractedInfo = await extractEventInfo(
          event.title,
          event.main_category,
          event.overview,
          searchText
        );
      } else {
        console.log('[Enrich] No search results, extracting tags only');
      }
    }

    // 검색 결과가 없거나 AI 추출 실패 시, derived_tags만 추출
    if (!extractedInfo) {
      const tags = await extractDerivedTagsOnly(
        event.title,
        event.main_category,
        event.sub_category,
        event.overview
      );
      extractedInfo = { derived_tags: tags };
    }

    // DB 업데이트
    // ⚠️ 중요: 공공 API 데이터 우선 원칙
    // - 이미 값이 있는 필드는 덮어쓰지 않음 (공공 API > AI)
    // - 비어있는 필드만 AI로 채움
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramIndex = 1;

    // opening_hours: 신뢰도 기반 자동 적용 vs 제안
    if (extractedInfo.opening_hours && Object.keys(extractedInfo.opening_hours).length > 0) {
      const hasExisting = !!(event.opening_hours && Object.keys(event.opening_hours).length > 0);
      const manuallyEdited = false; // opening_hours는 manually_edited_fields에서 추적 안 함
      
      // 신뢰도 계산
      const confidence = 80; // 운영시간은 중간 신뢰도
      
      const decision = decideFieldAction('opening_hours', extractedInfo.opening_hours, confidence, {
        hasExisting,
        manuallyEdited,
        policy: DEFAULT_POLICY,
      });
      
      updateActionStats(actionStats, 'opening_hours', decision.action);  // 🆕 통계 기록
      
      if (decision.action === 'auto') {
        updateFields.push(`opening_hours = $${paramIndex++}`);
        updateValues.push(JSON.stringify(extractedInfo.opening_hours));
        stats.updated_fields.opening_hours++;
        
        // 🔖 field_sources에 추가
        const timestamp = new Date().toISOString();
        allFieldSources['opening_hours'] = {
          source: 'AI',
          sourceDetail: 'Gemini extracted opening hours (auto-applied)',
          confidence: confidence,
          updatedAt: timestamp
        };
        console.log(`[Enrich] ✅ opening_hours auto-applied (confidence: ${confidence}%)`);
      } else if (decision.action === 'suggestion') {
        await addSuggestion(
          event.id,
          'opening_hours',
          extractedInfo.opening_hours,
          confidence,
          'AI',
          'Gemini extracted opening hours (requires review)'
        );
        console.log(`[Enrich] 💡 opening_hours suggestion created (confidence: ${confidence}%)`);
      } else {
        console.log(`[Enrich] ⏭️  opening_hours skipped (${decision.reason})`);
      }
    }

    // price_min: 중요 필드이므로 항상 제안 방식
    if (extractedInfo.price_min !== undefined && extractedInfo.price_min !== null) {
      const hasExisting = !!(event.price_min !== null && event.price_min !== undefined);
      const manuallyEdited = isManuallyEdited(event, 'price_min', forceFields);
      
      // 신뢰도 계산 (가격은 중요하므로 보수적으로)
      const confidence = 75;
      
      const decision = decideFieldAction('price_min', extractedInfo.price_min, confidence, {
        hasExisting,
        manuallyEdited,
        policy: DEFAULT_POLICY,
      });
      
      updateActionStats(actionStats, 'price_min', decision.action);  // 🆕 통계 기록
      
      if (decision.action === 'suggestion') {
        // Critical 필드이므로 무조건 제안 방식
        await addSuggestion(
          event.id,
          'price_min',
          extractedInfo.price_min,
          confidence,
          'AI',
          'Gemini extracted price (requires review)'
        );
        console.log(`[Enrich] 💡 price_min suggestion created (confidence: ${confidence}%)`);
        stats.updated_fields.price++;
      } else {
        console.log(`[Enrich] ⏭️  price_min skipped (${decision.reason})`);
      }
    }

    // price_max: 중요 필드이므로 항상 제안 방식
    if (extractedInfo.price_max !== undefined && extractedInfo.price_max !== null) {
      const hasExisting = !!(event.price_max !== null && event.price_max !== undefined);
      const manuallyEdited = isManuallyEdited(event, 'price_max', forceFields);
      
      const confidence = 75;
      
      const decision = decideFieldAction('price_max', extractedInfo.price_max, confidence, {
        hasExisting,
        manuallyEdited,
        policy: DEFAULT_POLICY,
      });
      
      updateActionStats(actionStats, 'price_max', decision.action);  // 🆕 통계 기록
      
      if (decision.action === 'suggestion') {
        await addSuggestion(
          event.id,
          'price_max',
          extractedInfo.price_max,
          confidence,
          'AI',
          'Gemini extracted price (requires review)'
        );
        console.log(`[Enrich] 💡 price_max suggestion created (confidence: ${confidence}%)`);
        stats.updated_fields.price++;
      } else {
        console.log(`[Enrich] ⏭️  price_max skipped (${decision.reason})`);
      }
    }

    // TEMP: category_details 컬럼이 없으므로 주석 처리
    // if (extractedInfo.reservation_required !== undefined) {
    //   // category_details JSONB에 추가
    //   updateFields.push(`category_details = COALESCE(category_details, '{}'::jsonb) || $${paramIndex++}::jsonb`);
    //   updateValues.push(
    //     JSON.stringify({
    //       reservation_required: extractedInfo.reservation_required,
    //       reservation_link: extractedInfo.reservation_link || null,
    //     })
    //   );
    //   stats.updated_fields.reservation++;
    // }

    // if (extractedInfo.age_restriction) {
    //   updateFields.push(`category_details = COALESCE(category_details, '{}'::jsonb) || $${paramIndex++}::jsonb`);
    //   updateValues.push(JSON.stringify({ age_restriction: extractedInfo.age_restriction }));
    //   stats.updated_fields.age_restriction++;
    // }

    // derived_tags: 신뢰도 기반 자동 적용 vs 제안
    if (extractedInfo.derived_tags && extractedInfo.derived_tags.length > 0) {
      const hasExisting = !!(event.derived_tags && event.derived_tags.length > 0);
      const manuallyEdited = isManuallyEdited(event, 'derived_tags', forceFields);
      
      // 신뢰도 계산 (태그는 일반적으로 높은 신뢰도)
      const confidence = 85; // 태그는 틀려도 큰 문제 없으므로 높은 신뢰도
      
      const decision = decideFieldAction('derived_tags', extractedInfo.derived_tags, confidence, {
        hasExisting,
        manuallyEdited,
        policy: DEFAULT_POLICY,
      });
      
      updateActionStats(actionStats, 'derived_tags', decision.action);  // 🆕 통계 기록
      
      if (decision.action === 'auto') {
        // 자동 적용
        updateFields.push(`derived_tags = $${paramIndex++}`);
        updateValues.push(JSON.stringify(extractedInfo.derived_tags));
        stats.updated_fields.derived_tags++;
        
        // 🔖 field_sources에 추가
        const timestamp = new Date().toISOString();
        allFieldSources['derived_tags'] = {
          source: 'AI',
          sourceDetail: 'Gemini extracted tags (auto-applied)',
          confidence: confidence,
          updatedAt: timestamp
        };
        console.log(`[Enrich] ✅ derived_tags auto-applied (confidence: ${confidence}%)`);
      } else if (decision.action === 'suggestion') {
        // 제안 생성 (운영자 검토 필요)
        await addSuggestion(
          event.id,
          'derived_tags',
          extractedInfo.derived_tags,
          confidence,
          'AI',
          'Gemini extracted tags (requires review)'
        );
        console.log(`[Enrich] 💡 derived_tags suggestion created (confidence: ${confidence}%)`);
      } else {
        console.log(`[Enrich] ⏭️  derived_tags skipped (${decision.reason})`);
      }
    }

    // external_links 업데이트 (공식 홈페이지, 티켓 링크 등)
    const externalLinks: any = { ...(extractedInfo.external_links || {}) };
    
    // 네이버 플레이스 링크가 있고, AI가 official 링크를 찾지 못했다면 자동 추가
    if (naverPlaceLink && !externalLinks.official) {
      externalLinks.official = naverPlaceLink;
      console.log(`[Enrich] 네이버 플레이스 링크를 official로 설정: ${naverPlaceLink}`);
    }

    if (Object.keys(externalLinks).length > 0) {
      updateFields.push(`external_links = COALESCE(external_links, '{}'::jsonb) || $${paramIndex++}::jsonb`);
      updateValues.push(JSON.stringify(externalLinks));
      // stats에는 별도 카운터 추가 안 함 (기존 구조 유지)
    }

    // TEMP: category_details 컬럼이 없으므로 주석 처리
    // if (extractedInfo.parking_info) {
    //   updateFields.push(`category_details = COALESCE(category_details, '{}'::jsonb) || $${paramIndex++}::jsonb`);
    //   updateValues.push(JSON.stringify({ parking_info: extractedInfo.parking_info }));
    //   stats.updated_fields.parking++;
    // }

    // if (extractedInfo.public_transport_info) {
    //   updateFields.push(`category_details = COALESCE(category_details, '{}'::jsonb) || $${paramIndex++}::jsonb`);
    //   updateValues.push(JSON.stringify({ public_transport_info: extractedInfo.public_transport_info }));
    //   stats.updated_fields.transport++;
    // }

    // if (extractedInfo.accessibility_info) {
    //   updateFields.push(`category_details = COALESCE(category_details, '{}'::jsonb) || $${paramIndex++}::jsonb`);
    //   updateValues.push(JSON.stringify({ accessibility_info: extractedInfo.accessibility_info }));
    //   stats.updated_fields.accessibility++;
    // }

    // Phase 3: Category-Specific Display Fields
    if (extractedInfo.exhibition_display) {
      const manuallyEdited = isManuallyEdited(event, 'metadata.display.exhibition', forceFields);
      
      if (manuallyEdited) {
        console.log('[Enrich] 🔒 exhibition_display skipped (manually edited by admin)');
      } else {
        // 전시 전용 필드를 metadata.display에 저장
        const displayData = {
          exhibition: extractedInfo.exhibition_display
        };
        updateFields.push(`metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{display}',
          $${paramIndex++}::jsonb,
          true
        )`);
        updateValues.push(JSON.stringify(displayData));
        console.log('[Enrich] ✅ Exhibition display fields added');
      }
    }

    if (extractedInfo.performance_display) {
      const manuallyEdited = isManuallyEdited(event, 'metadata.display.performance', forceFields);
      
      if (manuallyEdited) {
        console.log('[Enrich] 🔒 performance_display skipped (manually edited by admin)');
      } else {
        // 공연 전용 필드를 metadata.display에 저장
        const displayData = {
          performance: extractedInfo.performance_display
        };
        updateFields.push(`metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{display}',
          $${paramIndex++}::jsonb,
          true
        )`);
        updateValues.push(JSON.stringify(displayData));
        console.log('[Enrich] ✅ Performance display fields added');
      }
    }

    // 🎪 축제 특화 정보
    if (extractedInfo.festival_display) {
      const manuallyEdited = isManuallyEdited(event, 'metadata.display.festival', forceFields);
      
      if (manuallyEdited) {
        console.log('[Enrich] 🔒 festival_display skipped (manually edited by admin)');
      } else {
        const displayData = {
          festival: extractedInfo.festival_display
        };
        updateFields.push(`metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{display}',
          $${paramIndex++}::jsonb,
          true
        )`);
        updateValues.push(JSON.stringify(displayData));
        
        // 🔖 field_sources에 추가
        const timestamp = new Date().toISOString();
        const aiSource = { source: 'AI', sourceDetail: 'Gemini extracted', confidence: 80, updatedAt: timestamp };
        
        if (extractedInfo.festival_display.organizer) allFieldSources['metadata.display.festival.organizer'] = aiSource;
        if (extractedInfo.festival_display.program_highlights) allFieldSources['metadata.display.festival.program_highlights'] = aiSource;
        if (extractedInfo.festival_display.food_and_booths) allFieldSources['metadata.display.festival.food_and_booths'] = aiSource;
        if (extractedInfo.festival_display.scale_text) allFieldSources['metadata.display.festival.scale_text'] = aiSource;
        if (extractedInfo.festival_display.parking_tips) allFieldSources['metadata.display.festival.parking_tips'] = aiSource;
        
        console.log('[Enrich] ✅ Festival display fields added');
      }
    }

    // 📅 행사 특화 정보
    if (extractedInfo.event_display) {
      const manuallyEdited = isManuallyEdited(event, 'metadata.display.event', forceFields);
      
      if (manuallyEdited) {
        console.log('[Enrich] 🔒 event_display skipped (manually edited by admin)');
      } else {
        const displayData = {
          event: extractedInfo.event_display
        };
        updateFields.push(`metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{display}',
          $${paramIndex++}::jsonb,
          true
        )`);
        updateValues.push(JSON.stringify(displayData));
        
        // 🔖 field_sources에 추가
        const timestamp = new Date().toISOString();
        const aiSource = { source: 'AI', sourceDetail: 'Gemini extracted', confidence: 80, updatedAt: timestamp };
        
        if (extractedInfo.event_display.target_audience) allFieldSources['metadata.display.event.target_audience'] = aiSource;
        if (extractedInfo.event_display.capacity) allFieldSources['metadata.display.event.capacity'] = aiSource;
        if (extractedInfo.event_display.registration?.required !== undefined) {
          allFieldSources['metadata.display.event.registration.required'] = aiSource;
          if (extractedInfo.event_display.registration.url) allFieldSources['metadata.display.event.registration.url'] = aiSource;
          if (extractedInfo.event_display.registration.deadline) allFieldSources['metadata.display.event.registration.deadline'] = aiSource;
        }
        
        console.log('[Enrich] ✅ Event display fields added');
      }
    }

    // 🏪 팝업 특화 정보
    if (extractedInfo.popup_display) {
      const manuallyEdited = isManuallyEdited(event, 'metadata.display.popup', forceFields);
      
      if (manuallyEdited) {
        console.log('[Enrich] 🔒 popup_display skipped (manually edited by admin)');
      } else {
        const displayData = {
          popup: extractedInfo.popup_display
        };
        updateFields.push(`metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{display}',
          $${paramIndex++}::jsonb,
          true
        )`);
        updateValues.push(JSON.stringify(displayData));
        
        // 🔖 field_sources에 추가
        const timestamp = new Date().toISOString();
        const aiSource = { source: 'AI', sourceDetail: 'Gemini extracted', confidence: 80, updatedAt: timestamp };
        
        if (extractedInfo.popup_display.brands) allFieldSources['metadata.display.popup.brands'] = aiSource;
        if (extractedInfo.popup_display.is_collab !== undefined) allFieldSources['metadata.display.popup.is_collab'] = aiSource;
        if (extractedInfo.popup_display.is_fnb !== undefined) allFieldSources['metadata.display.popup.is_fnb'] = aiSource;
        
        // ⭐ F&B 정보 field_sources
        if (extractedInfo.popup_display.fnb_items) {
          if (extractedInfo.popup_display.fnb_items.signature_menu) allFieldSources['metadata.display.popup.fnb_items.signature_menu'] = aiSource;
          if (extractedInfo.popup_display.fnb_items.menu_categories) allFieldSources['metadata.display.popup.fnb_items.menu_categories'] = aiSource;
          if (extractedInfo.popup_display.fnb_items.price_range) allFieldSources['metadata.display.popup.fnb_items.price_range'] = aiSource;
          if (extractedInfo.popup_display.fnb_items.best_items) allFieldSources['metadata.display.popup.fnb_items.best_items'] = aiSource;
        }
        
        if (extractedInfo.popup_display.goods_items) allFieldSources['metadata.display.popup.goods_items'] = aiSource;
        if (extractedInfo.popup_display.limited_edition !== undefined) allFieldSources['metadata.display.popup.limited_edition'] = aiSource;
        if (extractedInfo.popup_display.photo_zone !== undefined) allFieldSources['metadata.display.popup.photo_zone'] = aiSource;
        if (extractedInfo.popup_display.photo_zone_desc) allFieldSources['metadata.display.popup.photo_zone_desc'] = aiSource;
        if (extractedInfo.popup_display.waiting_hint) allFieldSources['metadata.display.popup.waiting_hint'] = aiSource;
        
        console.log('[Enrich] ✅ Popup display fields added');
      }
    }

    // 🔖 모든 field_sources를 한 번에 업데이트
    if (Object.keys(allFieldSources).length > 0) {
      const fieldSourcePairs = Object.entries(allFieldSources).map(([key, value]) => 
        `'${key}', '${JSON.stringify(value)}'::jsonb`
      ).join(', ');
      
      updateFields.push(`field_sources = COALESCE(field_sources, '{}'::jsonb) || jsonb_build_object(${fieldSourcePairs})`);
    }

    if (updateFields.length > 0) {
      updateValues.push(event.id);
      const updateSQL = `
        UPDATE canonical_events
        SET ${updateFields.join(', ')}, updated_at = NOW()
        WHERE id = $${paramIndex}
      `;
      await pool.query(updateSQL, updateValues);
      console.log(`[Enrich] ✅ Updated ${updateFields.length} fields`);
      stats.success++;
    } else {
      console.log('[Enrich] ⚠️ No fields to update');
      stats.skipped++;
    }
  } catch (error: any) {
    console.error('[Enrich] ❌ Error:', error.message);
    stats.failed++;
  }

  stats.processed++;
}

/**
 * Backfill 실행
 */
export async function aiEnrichmentBackfill(options: {
  limit?: number | null;
  testMode?: boolean;
  useNaverSearch?: boolean;
  onlyMissingTags?: boolean;
  onlyRecent?: boolean;  // 최근 24시간 생성/업데이트만
  forceFields?: string[];  // 🆕 강제로 재생성할 필드 목록 (수동 편집 무시)
}) {
  const {
    limit = null,
    testMode = false,
    useNaverSearch = true,
    onlyMissingTags = false,
    onlyRecent = false,
    forceFields = [],  // 🆕 빈 배열이면 모든 수동 편집 존중
  } = options;

  console.log('\n========================================');
  console.log('🤖 AI Enrichment Backfill');
  console.log('========================================');
  console.log('Options:', {
    limit: limit || '전체',
    testMode,
    useNaverSearch,
    onlyMissingTags,
    onlyRecent,
    forceFields: forceFields.length > 0 ? forceFields : '없음 (수동 편집 존중)',
  });
  console.log('========================================\n');

  const startTime = Date.now();

  // 처리할 이벤트 조회
  let selectSQL = `
    SELECT id, title, main_category, sub_category, venue, overview,
           derived_tags, opening_hours, price_min, price_max,
           manually_edited_fields
    FROM canonical_events
    WHERE status IN ('scheduled', 'ongoing')
  `;

  if (onlyMissingTags) {
    selectSQL += ` AND (derived_tags IS NULL OR jsonb_array_length(derived_tags) = 0)`;
  }

  if (onlyRecent) {
    selectSQL += ` AND (created_at >= NOW() - INTERVAL '24 hours' OR updated_at >= NOW() - INTERVAL '24 hours')`;
  }

  selectSQL += ` ORDER BY created_at DESC`;

  if (limit !== null && limit > 0) {
    selectSQL += ` LIMIT ${limit}`;
  }

  const result = await pool.query<CanonicalEventRow>(selectSQL);
  const events = result.rows;

  const stats: EnrichmentStats = {
    total: events.length,
    processed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    updated_fields: {
      opening_hours: 0,
      price: 0,
      reservation: 0,
      age_restriction: 0,
      derived_tags: 0,
      parking: 0,
      transport: 0,
      accessibility: 0,
    },
  };
  
  // 🆕 신뢰도 기반 자동화 통계
  const actionStats = createActionStats();

  console.log(`📊 Total events to process: ${stats.total}\n`);

  if (stats.total === 0) {
    console.log('✅ No events to process');
    return;
  }

  // 배치 처리
  for (const event of events) {
    // 이미 충분한 정보가 있으면 스킵 (testMode가 아닐 때만)
    if (!testMode && !needsEnrichment(event)) {
      console.log(`[Enrich] ⏭️ Skipping (already enriched): ${event.title}`);
      stats.skipped++;
      stats.processed++;
      continue;
    }

    await enrichSingleEvent(event, useNaverSearch, stats, actionStats, forceFields);

    // Rate limiting (네이버 API: 초당 10회, OpenAI: 분당 3회 정도가 안전)
    if (useNaverSearch) {
      await new Promise((resolve) => setTimeout(resolve, 2000)); // 2초 대기
    } else {
      await new Promise((resolve) => setTimeout(resolve, 500)); // 0.5초 대기
    }
  }

  // 최종 리포트
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n========================================');
  console.log('📊 Enrichment Complete');
  console.log('========================================');
  console.log(`⏱️  Duration: ${duration}s`);
  console.log(`✅ Success: ${stats.success}`);
  console.log(`❌ Failed: ${stats.failed}`);
  console.log(`⏭️  Skipped: ${stats.skipped}`);
  console.log(`📈 Total: ${stats.processed} / ${stats.total}`);
  console.log('\n📝 Updated Fields:');
  console.log(`   - opening_hours: ${stats.updated_fields.opening_hours}`);
  console.log(`   - price: ${stats.updated_fields.price}`);
  console.log(`   - reservation: ${stats.updated_fields.reservation}`);
  console.log(`   - age_restriction: ${stats.updated_fields.age_restriction}`);
  console.log(`   - derived_tags: ${stats.updated_fields.derived_tags}`);
  console.log(`   - parking: ${stats.updated_fields.parking}`);
  console.log(`   - transport: ${stats.updated_fields.transport}`);
  console.log(`   - accessibility: ${stats.updated_fields.accessibility}`);
  
  // 🆕 신뢰도 기반 자동화 통계
  console.log('\n📊 Confidence-based Automation Stats:');
  console.log(`   - Auto-applied: ${actionStats.autoApplied} (신뢰도 ≥ 80%)`);
  console.log(`   - Suggestions: ${actionStats.suggestionsGenerated} (60-80%, 운영자 검토 필요)`);
  console.log(`   - Skipped: ${actionStats.skipped}`);
  
  console.log('\n📋 By Field:');
  Object.entries(actionStats.byField).forEach(([field, counts]) => {
    const total = counts.auto + counts.suggestion + counts.skip;
    console.log(`   ${field}:`);
    console.log(`     ✅ Auto: ${counts.auto} (${((counts.auto / total) * 100).toFixed(1)}%)`);
    console.log(`     💡 Suggestion: ${counts.suggestion} (${((counts.suggestion / total) * 100).toFixed(1)}%)`);
    console.log(`     ⏭️  Skip: ${counts.skip} (${((counts.skip / total) * 100).toFixed(1)}%)`);
  });
  
  console.log('========================================\n');
}

// CLI 실행
if (require.main === module) {
  const args = process.argv.slice(2);

  const options: Parameters<typeof aiEnrichmentBackfill>[0] = {
    limit: null,
    testMode: false,
    useNaverSearch: true,
    onlyMissingTags: false,
    onlyRecent: false,
  };

  // 인자 파싱
  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--test') {
      options.testMode = true;
      options.limit = 10;
    } else if (arg === '--no-naver') {
      options.useNaverSearch = false;
    } else if (arg === '--tags-only') {
      options.onlyMissingTags = true;
      options.useNaverSearch = false;
    } else if (arg === '--recent') {
      options.onlyRecent = true;
    }
  }

  aiEnrichmentBackfill(options)
    .then(() => {
      console.log('✅ Backfill completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Backfill failed:', error);
      process.exit(1);
    });
}

