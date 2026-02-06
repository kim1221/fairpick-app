/**
 * Recommendations API (Phase 2)
 * 
 * metadata.internal 기반 개인화 추천
 */

import express from 'express';
import { pool } from '../db';

const router = express.Router();

// ================================================================
// 1. 개인화 추천 API
// ================================================================

/**
 * GET /api/recommendations
 * 
 * Query Parameters:
 * - companions: 동행자 (커플, 가족, 친구, 혼자 등)
 * - time: 시간대 (morning, afternoon, evening, night)
 * - region: 지역 (서울, 경기, 부산 등)
 * - budget: 예산 (최대 가격)
 * - indoor: 실내 여부 (true/false)
 * - main_category: 카테고리 (공연, 전시, 팝업, 축제, 행사)
 * - limit: 결과 개수 (기본 20)
 */
router.get('/', async (req, res) => {
  console.log('[Recommendations API] Received request:', req.query);
  try {
    const {
      companions,
      time,
      region,
      budget,
      indoor,
      main_category,
      limit = '20',
    } = req.query;

    // 쿼리 조건 구성
    const conditions: string[] = [
      'is_deleted = false',
      'end_at >= CURRENT_DATE',
      "metadata->'internal' IS NOT NULL", // internal fields 있는 것만
    ];
    const params: any[] = [];
    let paramIndex = 1;

    // 1. 동행자 필터
    if (companions && typeof companions === 'string') {
      conditions.push(`metadata->'internal'->'matching'->'companions' @> $${paramIndex}::jsonb`);
      params.push(JSON.stringify([companions]));
      paramIndex++;
    }

    // 2. 시간대 필터
    if (time && typeof time === 'string') {
      const timeField = `${time}_available`;
      conditions.push(`(metadata->'internal'->'timing'->>'${timeField}')::boolean = true`);
    }

    // 3. 지역 필터
    if (region && typeof region === 'string') {
      conditions.push(`region = $${paramIndex}`);
      params.push(region);
      paramIndex++;
    }

    // 4. 예산 필터
    if (budget && typeof budget === 'string') {
      const budgetNum = parseInt(budget, 10);
      conditions.push(`(price_max IS NULL OR price_max <= $${paramIndex})`);
      params.push(budgetNum);
      paramIndex++;
    }

    // 5. 실내/실외 필터
    if (indoor !== undefined) {
      const isIndoor = indoor === 'true';
      conditions.push(`(metadata->'internal'->'matching'->>'indoor')::boolean = $${paramIndex}`);
      params.push(isIndoor);
      paramIndex++;
    }

    // 6. 카테고리 필터
    if (main_category && typeof main_category === 'string') {
      conditions.push(`main_category = $${paramIndex}`);
      params.push(main_category);
      paramIndex++;
    }

    // 7. LIMIT
    const limitNum = Math.min(parseInt(limit as string, 10) || 20, 100);

    // 쿼리 실행
    const query = `
      SELECT 
        id, title, display_title, main_category, sub_category,
        start_at, end_at, venue, address, region,
        lat, lng, image_url, is_free, price_min, price_max, price_info,
        popularity_score, is_ending_soon,
        derived_tags,
        metadata->'internal'->'matching' as matching,
        metadata->'internal'->'timing' as timing,
        metadata->'internal'->'location' as location
      FROM canonical_events
      WHERE ${conditions.join(' AND ')}
      ORDER BY 
        popularity_score DESC,
        start_at ASC
      LIMIT ${limitNum}
    `;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      count: result.rows.length,
      filters: {
        companions,
        time,
        region,
        budget,
        indoor,
        main_category,
      },
      items: result.rows.map((row: any) => ({
        // Core Data
        id: row.id,
        title: row.title,
        displayTitle: row.display_title,
        mainCategory: row.main_category,
        subCategory: row.sub_category,
        startAt: row.start_at,
        endAt: row.end_at,
        venue: row.venue,
        address: row.address,
        region: row.region,
        lat: row.lat,
        lng: row.lng,
        imageUrl: row.image_url,
        isFree: row.is_free,
        priceMin: row.price_min,
        priceMax: row.price_max,
        priceInfo: row.price_info,
        popularityScore: row.popularity_score,
        isEndingSoon: row.is_ending_soon,
        derivedTags: row.derived_tags,
        
        // Internal Fields (추천 참고용)
        matching: row.matching,
        timing: row.timing,
        location: row.location,
      })),
    });

  } catch (error: any) {
    console.error('Recommendations API error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ================================================================
// 2. 필터 옵션 조회 API
// ================================================================

/**
 * GET /api/recommendations/filters
 * 
 * 현재 사용 가능한 필터 옵션 반환
 */
router.get('/filters', async (req, res) => {
  try {
    // 1. Companions
    const companionsResult = await pool.query(`
      SELECT DISTINCT jsonb_array_elements_text(
        metadata->'internal'->'matching'->'companions'
      ) as value
      FROM canonical_events
      WHERE is_deleted = false 
        AND end_at >= CURRENT_DATE
        AND metadata->'internal'->'matching'->'companions' IS NOT NULL
      ORDER BY value
    `);

    // 2. Regions
    const regionsResult = await pool.query(`
      SELECT DISTINCT region
      FROM canonical_events
      WHERE is_deleted = false 
        AND end_at >= CURRENT_DATE
        AND region IS NOT NULL
      ORDER BY region
    `);

    // 3. Categories
    const categoriesResult = await pool.query(`
      SELECT DISTINCT main_category
      FROM canonical_events
      WHERE is_deleted = false 
        AND end_at >= CURRENT_DATE
      ORDER BY main_category
    `);

    res.json({
      success: true,
      filters: {
        companions: companionsResult.rows.map((r: any) => r.value),
        time: ['morning', 'afternoon', 'evening', 'night'],
        regions: regionsResult.rows.map((r: any) => r.region),
        categories: categoriesResult.rows.map((r: any) => r.main_category),
        indoor: [true, false],
      },
    });

  } catch (error: any) {
    console.error('Filters API error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ================================================================
// 3. Featured Hot Events (AI 추천)
// ================================================================

/**
 * GET /api/recommendations/featured
 * 
 * AI가 선별한 핫한 이벤트 반환
 * - 팝업: ai-popup-discovery로 발굴 후 admin 승인 (hotness_score 70+)
 * - 전시/공연/축제: ai-hot-rating으로 평가 (hotness_score 70+)
 */
router.get('/featured', async (req, res) => {
  try {
    // 1. 팝업: admin이 승인한 것 중 ai_hotness 70+
    const hotPopups = await pool.query(`
      SELECT 
        id, title, display_title, venue, region, 
        start_at, end_at, image_url, 
        buzz_components->'ai_hotness'->>'score' as hotness_score,
        buzz_components->'ai_hotness'->>'reason' as hotness_reason
      FROM canonical_events
      WHERE 
        main_category = '팝업'
        AND start_at <= NOW() + INTERVAL '7 days'
        AND end_at >= NOW()
        AND is_deleted = false
        AND (buzz_components->'ai_hotness'->>'score')::int >= 70
      ORDER BY (buzz_components->'ai_hotness'->>'score')::int DESC
      LIMIT 10
    `);

    // 2. 전시: AI 평가 70+
    const hotExhibitions = await pool.query(`
      SELECT 
        id, title, display_title, venue, region, 
        start_at, end_at, image_url,
        buzz_components->'ai_hotness'->>'score' as hotness_score,
        buzz_components->'ai_hotness'->>'reason' as hotness_reason
      FROM canonical_events
      WHERE 
        main_category = '전시'
        AND start_at <= NOW() + INTERVAL '30 days'
        AND end_at >= NOW()
        AND is_deleted = false
        AND (buzz_components->'ai_hotness'->>'score')::int >= 70
      ORDER BY (buzz_components->'ai_hotness'->>'score')::int DESC
      LIMIT 10
    `);

    // 3. 공연: AI 평가 70+
    const hotPerformances = await pool.query(`
      SELECT 
        id, title, display_title, venue, region, 
        start_at, end_at, image_url,
        buzz_components->'ai_hotness'->>'score' as hotness_score,
        buzz_components->'ai_hotness'->>'reason' as hotness_reason
      FROM canonical_events
      WHERE 
        main_category = '공연'
        AND start_at <= NOW() + INTERVAL '30 days'
        AND end_at >= NOW()
        AND is_deleted = false
        AND (buzz_components->'ai_hotness'->>'score')::int >= 70
      ORDER BY (buzz_components->'ai_hotness'->>'score')::int DESC
      LIMIT 10
    `);

    // 4. 축제: AI 평가 70+
    const hotFestivals = await pool.query(`
      SELECT 
        id, title, display_title, venue, region, 
        start_at, end_at, image_url,
        buzz_components->'ai_hotness'->>'score' as hotness_score,
        buzz_components->'ai_hotness'->>'reason' as hotness_reason
      FROM canonical_events
      WHERE 
        main_category = '축제'
        AND start_at <= NOW() + INTERVAL '30 days'
        AND end_at >= NOW()
        AND is_deleted = false
        AND (buzz_components->'ai_hotness'->>'score')::int >= 70
      ORDER BY (buzz_components->'ai_hotness'->>'score')::int DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      featured: {
        popups: hotPopups.rows,
        exhibitions: hotExhibitions.rows,
        performances: hotPerformances.rows,
        festivals: hotFestivals.rows,
      },
      total_count: 
        hotPopups.rowCount! + 
        hotExhibitions.rowCount! + 
        hotPerformances.rowCount! + 
        hotFestivals.rowCount!,
    });

  } catch (error: any) {
    console.error('[Featured API] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ================================================================
// 4. 상황별 추천 프리셋
// ================================================================

/**
 * GET /api/recommendations/presets/:presetName
 * 
 * 미리 정의된 상황별 추천
 * - date-evening: 저녁 데이트 코스
 * - family-weekend: 주말 가족 나들이
 * - rainy-day: 비 오는 날
 * - solo-cultural: 혼자 즐기는 문화생활
 */
router.get('/presets/:presetName', async (req, res) => {
  try {
    const { presetName } = req.params;
    const { region, limit = '20' } = req.query;

    const presets: Record<string, any> = {
      'date-evening': {
        companions: ['커플', '데이트'],
        time: 'evening',
        indoor: true,
        categories: ['전시', '팝업', '공연'],
        description: '저녁 데이트 코스',
      },
      'family-weekend': {
        companions: ['가족', '아이와함께'],
        categories: ['전시', '축제', '행사'],
        description: '주말 가족 나들이',
      },
      'rainy-day': {
        indoor: true,
        categories: ['전시', '팝업', '공연'],
        description: '비 오는 날 실내 활동',
      },
      'solo-cultural': {
        companions: ['혼자'],
        categories: ['전시', '공연'],
        description: '혼자 즐기는 문화생활',
      },
    };

    const preset = presets[presetName];
    if (!preset) {
      return res.status(404).json({
        success: false,
        error: 'Preset not found',
        availablePresets: Object.keys(presets),
      });
    }

    // 조건 구성
    const conditions: string[] = [
      'is_deleted = false',
      'end_at >= CURRENT_DATE',
      "metadata->'internal' IS NOT NULL",
    ];
    const params: any[] = [];
    let paramIndex = 1;

    // Companions
    if (preset.companions) {
      conditions.push(`metadata->'internal'->'matching'->'companions' && $${paramIndex}::jsonb`);
      params.push(JSON.stringify(preset.companions));
      paramIndex++;
    }

    // Time
    if (preset.time) {
      const timeField = `${preset.time}_available`;
      conditions.push(`(metadata->'internal'->'timing'->>'${timeField}')::boolean = true`);
    }

    // Indoor
    if (preset.indoor !== undefined) {
      conditions.push(`(metadata->'internal'->'matching'->>'indoor')::boolean = $${paramIndex}`);
      params.push(preset.indoor);
      paramIndex++;
    }

    // Categories
    if (preset.categories) {
      conditions.push(`main_category = ANY($${paramIndex}::text[])`);
      params.push(preset.categories);
      paramIndex++;
    }

    // Region
    if (region && typeof region === 'string') {
      conditions.push(`region = $${paramIndex}`);
      params.push(region);
      paramIndex++;
    }

    const limitNum = Math.min(parseInt(limit as string, 10) || 20, 100);

    const query = `
      SELECT 
        id, title, display_title, main_category, sub_category,
        start_at, end_at, venue, address, region,
        lat, lng, image_url, is_free, price_min, price_max,
        popularity_score, is_ending_soon, derived_tags
      FROM canonical_events
      WHERE ${conditions.join(' AND ')}
      ORDER BY popularity_score DESC
      LIMIT ${limitNum}
    `;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      preset: {
        name: presetName,
        description: preset.description,
        filters: preset,
      },
      count: result.rows.length,
      items: result.rows,
    });

  } catch (error: any) {
    console.error('Preset API error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
