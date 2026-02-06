import express from 'express';
import cors from 'cors';
import axios from 'axios';
import crypto from 'crypto';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { pool } from './db';
import { initScheduler } from './scheduler';
import { config } from './config';
import { calculateBoundingBox, getHaversineDistanceSQL } from './utils/geo';
import {
  startTimer,
  getElapsedMs,
  logApiMetrics,
  nowIso,
  safeJsonSizeKB,
} from './utils/instrumentApi';
import { uploadEventImage, deleteEventImage, ImageUploadError, validateS3Config } from './lib/imageUpload';
import { searchEventInfo, mergeSearchResults, extractTicketLinks, searchEventInfoEnhanced } from './lib/naverApi';
import { extractEventInfo, extractEventInfoEnhanced, AIExtractedInfo } from './lib/aiExtractor';
import { enrichSingleEvent } from './jobs/enrichInternalFields';
import { 
  filterSearchResults, 
  scoreSearchResults, 
  capResultsByDomain, 
  groupResultsBySection,
  ScoredSearchResult 
} from './lib/searchScoring';
import dayjs from 'dayjs';
import recommendationsRouter from './routes/recommendations';
import userEventsRouter from './routes/userEvents';
import * as recommender from './lib/recommender';
import { calculateConsensusLight, calculateStructuralScore } from './lib/hotScoreCalculator';

/**
 * 카테고리별 기본 운영시간 반환
 */
function getDefaultOpeningHours(category: string): {
  weekday: string;
  weekend: string;
  holiday?: string;
  closed: string;
  notes?: string;
} {
  const normalizedCategory = category.toLowerCase();
  
  if (normalizedCategory.includes('전시') || normalizedCategory.includes('갤러리')) {
    return {
      weekday: '10:00-18:00',
      weekend: '10:00-20:00',
      closed: '월요일',
      notes: '입장 마감 30분 전'
    };
  } else if (normalizedCategory.includes('팝업')) {
    return {
      weekday: '11:00-20:00',
      weekend: '11:00-21:00',
      closed: '없음'
    };
  } else if (normalizedCategory.includes('공연') || normalizedCategory.includes('뮤지컬') || normalizedCategory.includes('콘서트')) {
    return {
      weekday: '',
      weekend: '',
      closed: '',
      notes: '공연 시간은 예매 페이지를 참고하세요'
    };
  } else if (normalizedCategory.includes('페스티벌') || normalizedCategory.includes('축제')) {
    return {
      weekday: '10:00-22:00',
      weekend: '10:00-23:00',
      closed: '없음'
    };
  } else if (normalizedCategory.includes('박물관') || normalizedCategory.includes('전통')) {
    return {
      weekday: '09:00-18:00',
      weekend: '09:00-18:00',
      closed: '월요일'
    };
  } else {
    // 기타 카테고리 기본값
    return {
      weekday: '10:00-18:00',
      weekend: '10:00-20:00',
      closed: '없음'
    };
  }
}

/**
 * Phase A 체크포인트: 저장 직전 최소 검증
 * AI가 추출한 데이터의 최종 검증
 */
function validateExtractedData(
  extracted: AIExtractedInfo,
  event: { startYear: number; endYear: number }
): AIExtractedInfo {
  const eventYears = [event.startYear, event.endYear];
  
  // ticket_url에 명백한 과거 연도가 있으면 제거
  if (extracted.external_links?.ticket) {
    const ticketUrl = extracted.external_links.ticket;
    const yearMatches = ticketUrl.match(/20(2[0-5]|1[0-9])/g);
    
    if (yearMatches) {
      for (const match of yearMatches) {
        const year = parseInt(match);
        // 이벤트 연도가 아니고, 명백히 과거 (2년 이상 차이)이면 제거
        if (!eventYears.includes(year) && year < Math.min(...eventYears) - 1) {
          console.warn(`[VALIDATOR] ticket_url에 과거 연도(${year}) 감지, 제거:`, ticketUrl);
          extracted.external_links.ticket = undefined;
          break;
        }
      }
    }
  }
  
  // reservation_link도 동일하게 검증
  if (extracted.external_links?.reservation) {
    const resUrl = extracted.external_links.reservation;
    const yearMatches = resUrl.match(/20(2[0-5]|1[0-9])/g);
    
    if (yearMatches) {
      for (const match of yearMatches) {
        const year = parseInt(match);
        if (!eventYears.includes(year) && year < Math.min(...eventYears) - 1) {
          console.warn(`[VALIDATOR] reservation_link에 과거 연도(${year}) 감지, 제거:`, resUrl);
          extracted.external_links.reservation = undefined;
          break;
        }
      }
    }
  }
  
  return extracted;
}

/**
 * 검색 결과를 섹션별 텍스트로 변환
 */
function formatResultsForAI(results: ScoredSearchResult[]): string {
  return results.map((r, idx) => {
    let text = `[${idx + 1}] ${r.title}\n`;
    text += `   ${r.description}\n`;
    text += `   링크: ${r.link}\n`;
    if (r.address) text += `   주소: ${r.address}\n`;
    if (r.roadAddress) text += `   도로명: ${r.roadAddress}\n`;
    if (r.postdate) text += `   날짜: ${r.postdate}\n`;
    text += `   (점수: ${r.score}, 근거: ${r.scoreBreakdown.join(', ')})\n`;
    return text;
  }).join('\n---\n');
}

// import { GoogleGenerativeAI } from '@google/generative-ai'; // 향후 임베딩/분석용
import OpenAI from 'openai';

const app = express();
app.use(cors());
app.use(express.json());

const PLACEHOLDER_IMAGE = 'https://static.toss.im/tds/icon/picture/default-01.png';

// 날짜 필드를 문자열로 변환하는 헬퍼 함수 (타임존 문제 방지)
function formatEventDates(event: any): any {
  if (!event) return event;
  
  // Date 객체를 YYYY-MM-DD 문자열로 변환
  const formatDate = (date: any): string | null => {
    if (!date) return null;
    if (typeof date === 'string') return date.split('T')[0];
    if (date instanceof Date) {
      // ⚠️ 중요: UTC 메서드를 사용하여 타임존 변환 방지
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    return null;
  };
  
  return {
    ...event,
    start_at: formatDate(event.start_at),
    end_at: formatDate(event.end_at),
  };
}

// API Metric Helper
function logApiMetric(endpoint: string, query: Record<string, unknown>, eventCount: number, payload: unknown) {
  const payloadStr = JSON.stringify(payload);
  const payloadKB = (Buffer.byteLength(payloadStr, 'utf8') / 1024).toFixed(2);
  console.log(`[API_METRIC] endpoint=${endpoint} timestamp=${new Date().toISOString()} query=${JSON.stringify(query)} eventCount=${eventCount} payloadKB=${payloadKB}`);
}

/**
 * Admin 이벤트 즉시 라이트 계산 (Hot Score)
 * 
 * GPT 피드백: 즉시 라이트 계산 (Q1만 + Structural)으로 비용 최소화
 * 다음 날 자정 스케줄러가 정식 재계산 (Q1+Q2+Q3)
 */
async function calculateLightBuzzScore(eventId: string): Promise<void> {
  try {
    console.log('[LightBuzzScore] Starting light calculation for:', eventId);

    // 이벤트 조회
    const eventResult = await pool.query(
      `SELECT id, title, main_category, venue, region, start_at, end_at, source 
       FROM canonical_events 
       WHERE id = $1`,
      [eventId]
    );

    if (eventResult.rowCount === 0) {
      console.warn('[LightBuzzScore] Event not found:', eventId);
      return;
    }

    const event = eventResult.rows[0];

    // Consensus 라이트 (Q1만) + Structural (로컬)
    const consensusScore = await calculateConsensusLight({
      id: event.id,
      title: event.title,
      main_category: event.main_category,
      venue: event.venue || undefined,
      region: event.region || undefined,
      start_at: event.start_at,
      end_at: event.end_at,
      source: event.source || undefined,
    });

    const structuralResult = calculateStructuralScore({
      id: event.id,
      title: event.title,
      main_category: event.main_category,
      venue: event.venue || undefined,
      start_at: event.start_at,
      end_at: event.end_at,
      source: event.source || undefined,
    });

    // 라이트 점수 계산 (50:50)
    const lightScore = consensusScore * 0.5 + structuralResult.total * 0.5;

    // DB 업데이트
    await pool.query(
      `UPDATE canonical_events
       SET 
         buzz_score = $1,
         buzz_components = $2::jsonb,
         buzz_updated_at = NOW()
       WHERE id = $3`,
      [
        Math.round(lightScore),
        JSON.stringify({
          consensus_light: consensusScore,
          structural: structuralResult.total,
          type: 'light',
          calculated_at: new Date().toISOString(),
        }),
        eventId,
      ]
    );

    console.log('[LightBuzzScore] ✅ Light calculation completed:', {
      eventId,
      title: event.title,
      consensusScore,
      structuralScore: structuralResult.total,
      lightScore: Math.round(lightScore),
    });
  } catch (error: any) {
    console.error('[LightBuzzScore] Error:', {
      eventId,
      error: error.message,
    });
  }
}

app.get('/health', (_, res) => {
  res.json({ status: 'ok' });
});

// Phase 2: Recommendations API
app.use('/recommendations', recommendationsRouter);

// Phase 2.5: User Events API (사용자 행동 로그)
app.use('/api/user-events', userEventsRouter);

// ============================================================
// Phase 3: 룰 기반 추천 시스템 API
// ============================================================

/**
 * Frontend 호환성을 위한 이벤트 필드 매핑
 * canonical_events → Frontend Event 타입
 */
function mapEventForFrontend(event: any) {
  if (!event) return null;
  
  return {
    ...event,
    // Frontend가 기대하는 필드명으로 매핑
    thumbnail_url: event.image_url || event.thumbnail_url,
    category: event.main_category || event.category,
    start_date: event.start_at || event.start_date,
    end_date: event.end_at || event.end_date,
  };
}

/**
 * GET /api/recommendations/v2/today
 * 오늘의 추천 (종합 점수 최상위 1개)
 */
app.get('/api/recommendations/v2/today', async (req, res) => {
  try {
    const { userId, lat, lng } = req.query;
    
    const location = lat && lng 
      ? { lat: parseFloat(lat as string), lng: parseFloat(lng as string) }
      : undefined;
    
    // 사용자 취향 조회 (로그인 시)
    let userPrefs: recommender.UserPreference | undefined;
    if (userId) {
      const prefsResult = await pool.query(
        'SELECT category_scores, preferred_tags FROM user_preferences WHERE user_id = $1',
        [userId]
      );
      if (prefsResult.rows.length > 0) {
        userPrefs = {
          categories: prefsResult.rows[0].category_scores || {},
          tags: prefsResult.rows[0].preferred_tags || [],
        };
      }
    }
    
    const pick = await recommender.getTodaysPick(pool, userId as string, location, userPrefs);
    
    res.json({
      success: true,
      data: mapEventForFrontend(pick),
    });
  } catch (error: any) {
    console.error('[Recommendations/Today] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/recommendations/v2/trending
 * 지금 떠오르는 (인기 급상승)
 */
app.get('/api/recommendations/v2/trending', async (req, res) => {
  try {
    const { excludeIds, limit = '10', lat, lng } = req.query;
    
    const excludeSet = new Set<string>(
      excludeIds ? (excludeIds as string).split(',') : []
    );
    
    const location = lat && lng 
      ? { lat: parseFloat(lat as string), lng: parseFloat(lng as string) }
      : undefined;
    
    const events = await recommender.getTrending(
      pool,
      location,  // ⭐ 파라미터 순서 변경 (Phase 1 Task 3)
      excludeSet,
      parseInt(limit as string, 10)
    );
    
    res.json({
      success: true,
      count: events.length,
      data: events.map(mapEventForFrontend),
    });
  } catch (error: any) {
    console.error('[Recommendations/Trending] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/recommendations/v2/nearby
 * 근처 이벤트 (거리 기반)
 */
app.get('/api/recommendations/v2/nearby', async (req, res) => {
  try {
    const { lat, lng, excludeIds, limit = '10' } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        error: 'lat와 lng 파라미터가 필요합니다.',
      });
    }
    
    const location = {
      lat: parseFloat(lat as string),
      lng: parseFloat(lng as string),
    };
    
    const excludeSet = new Set<string>(
      excludeIds ? (excludeIds as string).split(',') : []
    );
    
    const events = await recommender.getNearby(
      pool,
      location,
      excludeSet,
      parseInt(limit as string, 10)
    );
    
    res.json({
      success: true,
      count: events.length,
      data: events.map(mapEventForFrontend),
    });
  } catch (error: any) {
    console.error('[Recommendations/Nearby] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/recommendations/v2/personalized
 * 취향 저격 (로그인 사용자 전용)
 */
app.get('/api/recommendations/v2/personalized', async (req, res) => {
  try {
    const { userId, excludeIds, limit = '10' } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId 파라미터가 필요합니다 (로그인 필요).',
      });
    }
    
    // 사용자 취향 조회
    const prefsResult = await pool.query(
      'SELECT category_scores, preferred_tags FROM user_preferences WHERE user_id = $1',
      [userId]
    );
    
    if (prefsResult.rows.length === 0) {
      return res.json({
        success: true,
        count: 0,
        data: [],
        message: '사용자 취향 데이터가 없습니다.',
      });
    }
    
    const userPrefs: recommender.UserPreference = {
      categories: prefsResult.rows[0].category_scores || {},
      tags: prefsResult.rows[0].preferred_tags || [],
    };
    
    const excludeSet = new Set<string>(
      excludeIds ? (excludeIds as string).split(',') : []
    );
    
    const events = await recommender.getPersonalized(
      pool,
      userId as string,
      userPrefs,
      excludeSet,
      parseInt(limit as string, 10)
    );
    
    res.json({
      success: true,
      count: events.length,
      data: events,
    });
  } catch (error: any) {
    console.error('[Recommendations/Personalized] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/recommendations/v2/weekend
 * 이번 주말 추천
 */
app.get('/api/recommendations/v2/weekend', async (req, res) => {
  try {
    const { excludeIds, limit = '10', lat, lng } = req.query;
    
    const excludeSet = new Set<string>(
      excludeIds ? (excludeIds as string).split(',') : []
    );
    
    const location = lat && lng 
      ? { lat: parseFloat(lat as string), lng: parseFloat(lng as string) }
      : undefined;
    
    const events = await recommender.getWeekend(
      pool,
      excludeSet,
      parseInt(limit as string, 10),
      location
    );
    
    res.json({
      success: true,
      count: events.length,
      data: events.map(mapEventForFrontend),
    });
  } catch (error: any) {
    console.error('[Recommendations/Weekend] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/recommendations/v2/latest
 * 새로 올라왔어요 (최신순)
 */
app.get('/api/recommendations/v2/latest', async (req, res) => {
  try {
    const { excludeIds, limit = '10', lat, lng } = req.query;
    
    const excludeSet = new Set<string>(
      excludeIds ? (excludeIds as string).split(',') : []
    );
    
    const location = lat && lng 
      ? { lat: parseFloat(lat as string), lng: parseFloat(lng as string) }
      : undefined;
    
    const events = await recommender.getLatest(
      pool,
      excludeSet,
      parseInt(limit as string, 10),
      location
    );
    
    res.json({
      success: true,
      count: events.length,
      data: events.map(mapEventForFrontend),
    });
  } catch (error: any) {
    console.error('[Recommendations/Latest] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/events/:id
 * 이벤트 상세 정보 조회
 */
app.get('/api/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // canonical_events 테이블에서 이벤트 조회 (모든 필드 포함)
    const result = await pool.query(
      `SELECT *
      FROM canonical_events
      WHERE id = $1 AND is_deleted = false`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Event not found',
      });
    }
    
    const event = mapEventForFrontend(result.rows[0]);
    
    res.json({
      success: true,
      data: event,
    });
  } catch (error: any) {
    console.error('[Events/Detail] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/user-events
 * 사용자 행동 로그 기록
 */
app.post('/api/user-events', async (req, res) => {
  try {
    const { userId, eventId, actionType, metadata } = req.body;
    
    if (!userId || !eventId || !actionType) {
      return res.status(400).json({
        success: false,
        error: 'userId, eventId, actionType이 필요합니다.',
      });
    }
    
    // 유효한 actionType 검증
    const validActions = ['view', 'save', 'unsave', 'share', 'click'];
    if (!validActions.includes(actionType)) {
      return res.status(400).json({
        success: false,
        error: `actionType은 ${validActions.join(', ')} 중 하나여야 합니다.`,
      });
    }
    
    await pool.query(
      `INSERT INTO user_events (user_id, event_id, action_type, metadata)
       VALUES ($1, $2, $3, $4)`,
      [userId, eventId, actionType, JSON.stringify(metadata || {})]
    );
    
    res.json({
      success: true,
      message: '행동 로그가 기록되었습니다.',
    });
  } catch (error: any) {
    console.error('[UserEvents] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Admin 인증 미들웨어
function requireAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  console.log('[DEBUG] [Auth] requireAdminAuth middleware called');
  console.log('[DEBUG] [Auth] Request path:', req.path);
  console.log('[DEBUG] [Auth] Request method:', req.method);

  const adminKey = req.headers['x-admin-key'] as string;
  const expectedKey = process.env.ADMIN_KEY || 'fairpick-admin-2024';

  console.log('[Auth] Checking admin key:', {
    provided: adminKey ? `${adminKey.substring(0, 5)}...` : 'NONE',
    providedFull: adminKey || 'NONE',
    expected: expectedKey ? `${expectedKey.substring(0, 5)}...` : 'NONE',
    expectedFull: expectedKey || 'NONE',
    match: adminKey === expectedKey,
  });

  if (!adminKey || adminKey !== expectedKey) {
    console.error('[Auth] ❌ Unauthorized - Admin key mismatch');
    console.error('[DEBUG] [Auth] Returning 401 response');
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  console.log('[Auth] ✅ Admin authenticated');
  console.log('[DEBUG] [Auth] Calling next()');
  next();
  console.log('[DEBUG] [Auth] next() called successfully');
}

// Multer 설정 (메모리 저장)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB 제한
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('이미지 파일만 업로드 가능합니다'));
    }
    cb(null, true);
  },
});

// Rate Limiter 설정 (업로드 제한)
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 20, // 최대 20개
  message: {
    error: '업로드 횟수 제한 초과',
    message: '15분당 최대 20개까지 업로드 가능합니다. 잠시 후 다시 시도하세요.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Admin 인증 실패 시 rate limit 체크 안함 (어차피 401)
    const adminKey = req.headers['x-admin-key'] as string;
    const expectedKey = process.env.ADMIN_KEY || 'fairpick-admin-2024';
    return !adminKey || adminKey !== expectedKey;
  },
});

// DMCA 신고 Rate Limiter (공개 API 스팸 방지)
const dmcaReportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1시간
  max: 5, // 최대 5회
  message: {
    error: 'DMCA 신고 횟수 제한 초과',
    message: '1시간당 최대 5건까지 신고 가능합니다. 잠시 후 다시 시도하세요.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  // IP 기반 제한 (default keyGenerator 사용)
});

// Admin: Key 검증
app.post('/admin/verify', (req, res) => {
  const adminKey = req.headers['x-admin-key'] as string;
  const expectedKey = process.env.ADMIN_KEY || 'fairpick-admin-2024';
  
  if (adminKey === expectedKey) {
    res.json({ valid: true });
  } else {
    res.status(401).json({ valid: false });
  }
});

// Admin: 이미지 업로드
app.post(
  '/admin/uploads/image',
  (req, res, next) => {
    console.log('[Upload] 1️⃣ Request received at endpoint');
    next();
  },
  uploadLimiter,
  (req, res, next) => {
    console.log('[Upload] 2️⃣ Passed rate limiter');
    next();
  },
  requireAdminAuth,
  (req, res, next) => {
    console.log('[Upload] 3️⃣ Passed admin auth');
    next();
  },
  upload.single('image'),
  async (req, res) => {
    console.log('[Upload] 4️⃣ Passed multer upload');
    const startTime = startTimer();
    const requestTs = nowIso();
    
    try {
      // 1. S3 설정 검증
      const s3Validation = validateS3Config();
      if (!s3Validation.valid) {
        console.error('[Upload] S3 config invalid:', s3Validation.errors);
        return res.status(500).json({
          success: false,
          error: 'CDN 설정이 올바르지 않습니다',
          details: s3Validation.errors,
        });
      }
      
      // 2. 파일 존재 확인
      if (!req.file) {
        console.error('[Upload] ❌ No file in request');
        return res.status(400).json({
          success: false,
          error: '파일이 업로드되지 않았습니다',
          code: 'NO_FILE',
        });
      }
      
      console.log('[Upload] 5️⃣ File validated:', {
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        size: `${(req.file.size / 1024).toFixed(1)}KB`,
      });
      
      // 3. 이미지 업로드 (최적화 + S3/R2)
      const result = await uploadEventImage(
        req.file.buffer,
        req.file.originalname,
        {
          checkDuplicate: false, // MVP에서는 중복 체크 skip
        }
      );
      
      // 4. 성공 응답
      const response = {
        success: true,
        ...result,
      };
      
      // 5. 로그
      logApiMetrics({
        endpoint: 'POST /admin/uploads/image',
        ts: requestTs,
        query: { filename: req.file.originalname },
        status: 200,
        count: 1,
        payloadKB: safeJsonSizeKB(response),
        elapsedMs: getElapsedMs(startTime),
      });
      
      res.json(response);
      
    } catch (error: any) {
      console.error('[Upload] Failed:', error);
      
      // ImageUploadError 처리
      if (error instanceof ImageUploadError) {
        logApiMetrics({
          endpoint: 'POST /admin/uploads/image',
          ts: requestTs,
          query: { filename: req.file?.originalname },
          status: 400,
          count: null,
          payloadKB: -1,
          elapsedMs: getElapsedMs(startTime),
        });
        
        return res.status(400).json({
          success: false,
          error: error.message,
          code: error.code,
        });
      }
      
      // 기타 에러
      logApiMetrics({
        endpoint: 'POST /admin/uploads/image',
        ts: requestTs,
        query: { filename: req.file?.originalname },
        status: 500,
        count: null,
        payloadKB: -1,
        elapsedMs: getElapsedMs(startTime),
      });
      
      res.status(500).json({
        success: false,
        error: '이미지 업로드에 실패했습니다',
        code: 'UPLOAD_FAIL',
      });
    }
  }
);

// Admin: 대시보드 통계
app.get('/admin/dashboard', requireAdminAuth, async (_, res) => {
  try {
    const statsResult = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM canonical_events WHERE is_deleted = false) AS "totalEvents",
        (SELECT COUNT(*) FROM canonical_events WHERE is_featured = true AND is_deleted = false) AS "featuredCount",
        (SELECT COUNT(*) FROM canonical_events WHERE updated_at >= NOW() - INTERVAL '24 hours' AND is_deleted = false) AS "recentUpdatedCount",
        (SELECT COUNT(*) FROM canonical_events WHERE created_at >= NOW() - INTERVAL '24 hours' AND is_deleted = false) AS "recentNewCount"
    `);
    
    const logsResult = await pool.query(`
      SELECT id, source, type, status, started_at, completed_at, items_count, success_count, failed_count
      FROM collection_logs
      ORDER BY started_at DESC
      LIMIT 10
    `);
    
    res.json({
      totalEvents: parseInt(statsResult.rows[0].totalEvents),
      featuredCount: parseInt(statsResult.rows[0].featuredCount),
      recentUpdatedCount: parseInt(statsResult.rows[0].recentUpdatedCount),
      recentNewCount: parseInt(statsResult.rows[0].recentNewCount),
      recentLogs: logsResult.rows,
    });
  } catch (error) {
    console.error('[Admin] Dashboard failed:', error);
    res.status(500).json({ message: 'Failed to load dashboard' });
  }
});

// Admin: 이미지 통계 (디버깅용)
app.get('/admin/image-stats', requireAdminAuth, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN image_url IS NULL OR image_url = '' THEN 1 END) as null_images,
        COUNT(CASE WHEN image_url LIKE '%placeholder%' OR image_url LIKE '%/defaults/%' THEN 1 END) as placeholder_images,
        COUNT(CASE WHEN image_url IS NOT NULL AND image_url != '' AND image_url NOT LIKE '%placeholder%' AND image_url NOT LIKE '%/defaults/%' THEN 1 END) as real_images
      FROM canonical_events 
      WHERE is_deleted = false
    `);
    
    const placeholderSamples = await pool.query(`
      SELECT id, title, image_url, main_category
      FROM canonical_events 
      WHERE is_deleted = false 
        AND (image_url IS NULL OR image_url = '' OR image_url LIKE '%placeholder%' OR image_url LIKE '%/defaults/%')
      ORDER BY created_at DESC
      LIMIT 30
    `);
    
    const realImageSamples = await pool.query(`
      SELECT id, title, image_url, main_category
      FROM canonical_events 
      WHERE is_deleted = false 
        AND image_url IS NOT NULL 
        AND image_url != '' 
        AND image_url NOT LIKE '%placeholder%'
        AND image_url NOT LIKE '%/defaults/%'
      LIMIT 10
    `);
    
    res.json({ 
      stats: stats.rows[0],
      placeholderSamples: placeholderSamples.rows,
      realImageSamples: realImageSamples.rows 
    });
  } catch (error) {
    console.error('[Admin] Image stats error:', error);
    res.status(500).json({ error: 'Failed to get image stats' });
  }
});

// Admin: 이벤트 목록
app.get('/admin/events', requireAdminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const size = parseInt(req.query.size as string) || 20;
    const offset = (page - 1) * size;
    
    const q = req.query.q as string;
    const category = req.query.category as string;
    const isFeatured = req.query.isFeatured as string;
    const hasImage = req.query.hasImage as string;
    const isDeleted = req.query.isDeleted === 'true' ? true : req.query.isDeleted === 'false' ? false : null;
    const recentlyCollected = req.query.recentlyCollected as string; // 🆕 최근 수집 필터
    
    console.log('[Admin] GET /admin/events - Filters:', {
      q,
      category,
      isFeatured,
      hasImage,
      isDeleted,
      recentlyCollected,
      page,
      size
    });
    
    let whereConditions = [];
    let params: any[] = [];
    let paramIndex = 1;
    
    if (isDeleted !== null) {
      whereConditions.push(`is_deleted = $${paramIndex++}`);
      params.push(isDeleted);
    }
    
    if (q) {
      whereConditions.push(`title ILIKE $${paramIndex++}`);
      params.push(`%${q}%`);
    }
    
    if (category) {
      whereConditions.push(`main_category = $${paramIndex++}`);
      params.push(category);
    }
    
    if (isFeatured) {
      whereConditions.push(`is_featured = $${paramIndex++}`);
      params.push(isFeatured === 'true');
    }
    
    if (hasImage === 'true') {
      // 실제 이미지만 (placeholder와 defaults 제외)
      whereConditions.push(`
        image_url IS NOT NULL 
        AND image_url != '' 
        AND image_url NOT LIKE '%placeholder%'
        AND image_url NOT LIKE '%/defaults/%'
      `);
    } else if (hasImage === 'false') {
      // 이미지 없음 (NULL, 빈 문자열, placeholder, defaults 포함)
      whereConditions.push(`(
        image_url IS NULL 
        OR image_url = '' 
        OR image_url LIKE '%placeholder%'
        OR image_url LIKE '%/defaults/%'
      )`);
    }
    
    // 🆕 최근 수집 필터 (created_at 기준)
    if (recentlyCollected === '24h') {
      whereConditions.push(`created_at >= NOW() - INTERVAL '24 hours'`);
    } else if (recentlyCollected === '7d') {
      whereConditions.push(`created_at >= NOW() - INTERVAL '7 days'`);
    } else if (recentlyCollected === '30d') {
      whereConditions.push(`created_at >= NOW() - INTERVAL '30 days'`);
    }
    
    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
    
    console.log('[Admin] SQL Query:', {
      whereClause,
      params,
      whereConditions
    });
    
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM canonical_events ${whereClause}`,
      params
    );
    
    params.push(size, offset);
    const eventsResult = await pool.query(
      `SELECT *, 
              to_char(start_at, 'YYYY-MM-DD') as start_at_str,
              to_char(end_at, 'YYYY-MM-DD') as end_at_str
       FROM canonical_events ${whereClause} ORDER BY updated_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      params
    );
    
    // 날짜 필드를 PostgreSQL에서 직접 포맷한 문자열로 대체 (타임존 문제 완전 방지)
    const formattedEvents = eventsResult.rows.map(event => {
      event.start_at = event.start_at_str;
      event.end_at = event.end_at_str;
      delete event.start_at_str;
      delete event.end_at_str;
      return event;
    });
    
    res.json({
      items: formattedEvents,
      totalCount: parseInt(countResult.rows[0].total),
      page,
      size,
    });
  } catch (error) {
    console.error('[Admin] Events list failed:', error);
    res.status(500).json({ message: 'Failed to load events' });
  }
});

// Admin: 이벤트 상세
app.get('/admin/events/:id', requireAdminAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *, 
              to_char(start_at, 'YYYY-MM-DD') as start_at_str,
              to_char(end_at, 'YYYY-MM-DD') as end_at_str
       FROM canonical_events WHERE id = $1`,
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Event not found' });
    }
    
    const event = result.rows[0];
    // 날짜 필드를 PostgreSQL에서 직접 포맷한 문자열로 대체 (타임존 문제 완전 방지)
    event.start_at = event.start_at_str;
    event.end_at = event.end_at_str;
    delete event.start_at_str;
    delete event.end_at_str;
    
    res.json({ item: event });
  } catch (error) {
    console.error('[Admin] Event detail failed:', error);
    res.status(500).json({ message: 'Failed to load event' });
  }
});

// Admin: 이벤트 수정
app.patch('/admin/events/:id', requireAdminAuth, async (req, res) => {
  console.log('🔥🔥🔥 [PATCH /admin/events/:id] REQUEST RECEIVED! 🔥🔥🔥');
  console.log('[PATCH] Event ID:', req.params.id);
  console.log('[PATCH] Request body keys:', Object.keys(req.body));
  console.log('[PATCH] Address in body:', req.body.address);
  console.log('[PATCH] Venue in body:', req.body.venue);
  
  try {
    // 🔍 먼저 기존 이벤트 데이터 조회 (비교용)
    const existingEventResult = await pool.query(
      'SELECT * FROM canonical_events WHERE id = $1',
      [req.params.id]
    );
    
    if (existingEventResult.rows.length === 0) {
      return res.status(404).json({ message: 'Event not found' });
    }
    
    const existingEvent = existingEventResult.rows[0];
    console.log('[PATCH] Existing event fetched for comparison');
    
    // 날짜 검증 함수 (YYYY-MM-DD 형식, 타임존 변환 없음)
    const isValidDateFormat = (dateStr: string | null | undefined): boolean => {
      if (!dateStr) return false;
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(dateStr)) return false;
      
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return date.getFullYear() === year && 
             date.getMonth() === month - 1 && 
             date.getDate() === day;
    };
    
    // 날짜 필드 검증
    if (req.body.start_at !== undefined && !isValidDateFormat(req.body.start_at)) {
      return res.status(400).json({ 
        message: 'Invalid start_at format. Required: YYYY-MM-DD',
        provided: req.body.start_at
      });
    }
    if (req.body.end_at !== undefined && !isValidDateFormat(req.body.end_at)) {
      return res.status(400).json({ 
        message: 'Invalid end_at format. Required: YYYY-MM-DD',
        provided: req.body.end_at
      });
    }
    
    const editableFields = [
      'title', 'display_title', 'main_category', 'sub_category',
      'start_at', 'end_at', 'venue', 'address', 'lat', 'lng', 'region', 'overview',
      'image_url', 'is_free', 'price_info', 'popularity_score',
      'is_featured', 'featured_order', 'is_deleted', 'deleted_reason',
      // Phase 1 공통 필드
      'price_min', 'price_max'
    ];
    
    // JSONB 필드는 별도 처리
    const jsonbFields = ['external_links', 'source_tags', 'derived_tags', 'opening_hours', 'quality_flags', 'metadata'];

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // 🔒 수동 편집 추적: AI가 생성하는 필드들 (manually_edited_fields 용)
    const aiGeneratedFields = ['overview', 'derived_tags', 'opening_hours', 'external_links', 'metadata'];
    const manuallyEditedFields: string[] = [];
    const fieldSourcesMap: Record<string, any> = {}; // 🆕 개별 필드별 source 추적
    
    // 🔒 metadata.display 세부 필드 추적 (값 비교 필요)
    if (req.body.metadata?.display?.exhibition) {
      manuallyEditedFields.push('metadata.display.exhibition');
    }
    if (req.body.metadata?.display?.performance) {
      manuallyEditedFields.push('metadata.display.performance');
    }

    for (const field of editableFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${paramIndex++}`);
        // 날짜 필드는 문자열 그대로 저장 (타임존 변환 없음)
        params.push(req.body[field]);
        
        // 🔖 모든 필드가 변경되면 field_sources를 "Manual"로 설정 (값 비교)
        if (req.body[field] !== existingEvent[field]) {
          // 🔒 AI 생성 필드는 manually_edited_fields에도 추가
        if (aiGeneratedFields.includes(field)) {
          manuallyEditedFields.push(field);
          }
          
          // 🆕 field_sources 업데이트 (모든 필드)
          fieldSourcesMap[field] = {
            source: 'Manual',
            sourceDetail: 'Admin UI manual edit',
            confidence: 100,
            updatedAt: new Date().toISOString()
          };
          console.log(`[PATCH] 📝 Field changed: ${field} (old: ${existingEvent[field]}, new: ${req.body[field]})`);
        }
      }
    }
    
    // JSONB 필드 처리
    for (const field of jsonbFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${paramIndex++}::jsonb`);
        params.push(JSON.stringify(req.body[field]));
        
        // 🔒 AI 생성 필드를 수동으로 편집하면 마킹
        if (aiGeneratedFields.includes(field)) {
          
          // 🆕 external_links 개별 필드 추적 (값 비교)
          if (field === 'external_links' && req.body[field]) {
            const newLinks = req.body[field];
            const oldLinks = existingEvent.external_links || {};
            
            if (newLinks.official !== undefined && newLinks.official !== oldLinks.official) {
              manuallyEditedFields.push('external_links.official');
              fieldSourcesMap['external_links.official'] = {
                source: 'Manual',
                sourceDetail: 'Admin UI manual edit',
                confidence: 100,
                updatedAt: new Date().toISOString()
              };
              console.log(`[PATCH] 📝 Field changed: external_links.official`);
            }
            if (newLinks.ticket !== undefined && newLinks.ticket !== oldLinks.ticket) {
              manuallyEditedFields.push('external_links.ticket');
              fieldSourcesMap['external_links.ticket'] = {
                source: 'Manual',
                sourceDetail: 'Admin UI manual edit',
                confidence: 100,
                updatedAt: new Date().toISOString()
              };
              console.log(`[PATCH] 📝 Field changed: external_links.ticket`);
            }
            if (newLinks.reservation !== undefined && newLinks.reservation !== oldLinks.reservation) {
              manuallyEditedFields.push('external_links.reservation');
              fieldSourcesMap['external_links.reservation'] = {
                source: 'Manual',
                sourceDetail: 'Admin UI manual edit',
                confidence: 100,
                updatedAt: new Date().toISOString()
              };
              console.log(`[PATCH] 📝 Field changed: external_links.reservation`);
            }
          }
          
          // 🆕 metadata.display 개별 필드 추적 (값 비교)
          if (field === 'metadata' && req.body[field]?.display) {
            const newDisplay = req.body[field].display;
            const oldDisplay = existingEvent.metadata?.display || {};
            
            // Performance 필드
            if (newDisplay.performance) {
              const newPerf = newDisplay.performance;
              const oldPerf = oldDisplay.performance || {};
              
              if (newPerf.cast !== undefined && JSON.stringify(newPerf.cast) !== JSON.stringify(oldPerf.cast)) {
                manuallyEditedFields.push('metadata.display.performance.cast');
                fieldSourcesMap['metadata.display.performance.cast'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
                console.log(`[PATCH] 📝 Field changed: metadata.display.performance.cast`);
              }
              if (newPerf.genre !== undefined && JSON.stringify(newPerf.genre) !== JSON.stringify(oldPerf.genre)) {
                manuallyEditedFields.push('metadata.display.performance.genre');
                fieldSourcesMap['metadata.display.performance.genre'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
                console.log(`[PATCH] 📝 Field changed: metadata.display.performance.genre`);
              }
              if (newPerf.duration_minutes !== undefined && newPerf.duration_minutes !== oldPerf.duration_minutes) {
                manuallyEditedFields.push('metadata.display.performance.duration_minutes');
                fieldSourcesMap['metadata.display.performance.duration_minutes'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
                console.log(`[PATCH] 📝 Field changed: metadata.display.performance.duration_minutes`);
              }
              if (newPerf.age_limit !== undefined && newPerf.age_limit !== oldPerf.age_limit) {
                manuallyEditedFields.push('metadata.display.performance.age_limit');
                fieldSourcesMap['metadata.display.performance.age_limit'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
                console.log(`[PATCH] 📝 Field changed: metadata.display.performance.age_limit`);
              }
              if (newPerf.discounts !== undefined && JSON.stringify(newPerf.discounts) !== JSON.stringify(oldPerf.discounts)) {
                manuallyEditedFields.push('metadata.display.performance.discounts');
                fieldSourcesMap['metadata.display.performance.discounts'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
                console.log(`[PATCH] 📝 Field changed: metadata.display.performance.discounts`);
              }
            }
            
            // Exhibition 필드
            if (newDisplay.exhibition) {
              const newExh = newDisplay.exhibition;
              const oldExh = oldDisplay.exhibition || {};
              
              if (newExh.artists !== undefined && JSON.stringify(newExh.artists) !== JSON.stringify(oldExh.artists)) {
                manuallyEditedFields.push('metadata.display.exhibition.artists');
                fieldSourcesMap['metadata.display.exhibition.artists'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
                console.log(`[PATCH] 📝 Field changed: metadata.display.exhibition.artists`);
              }
              if (newExh.genre !== undefined && JSON.stringify(newExh.genre) !== JSON.stringify(oldExh.genre)) {
                manuallyEditedFields.push('metadata.display.exhibition.genre');
                fieldSourcesMap['metadata.display.exhibition.genre'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
                console.log(`[PATCH] 📝 Field changed: metadata.display.exhibition.genre`);
              }
              if (newExh.duration_minutes !== undefined && newExh.duration_minutes !== oldExh.duration_minutes) {
                manuallyEditedFields.push('metadata.display.exhibition.duration_minutes');
                fieldSourcesMap['metadata.display.exhibition.duration_minutes'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
                console.log(`[PATCH] 📝 Field changed: metadata.display.exhibition.duration_minutes`);
              }
              if (newExh.type !== undefined && newExh.type !== oldExh.type) {
                manuallyEditedFields.push('metadata.display.exhibition.type');
                fieldSourcesMap['metadata.display.exhibition.type'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
                console.log(`[PATCH] 📝 Field changed: metadata.display.exhibition.type`);
              }
            }
            
            // 🎪 Festival 필드
            if (newDisplay.festival) {
              const newFest = newDisplay.festival;
              const oldFest = oldDisplay.festival || {};
              
              if (newFest.organizer !== undefined && newFest.organizer !== oldFest.organizer) {
                fieldSourcesMap['metadata.display.festival.organizer'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
              }
              if (newFest.program_highlights !== undefined && newFest.program_highlights !== oldFest.program_highlights) {
                fieldSourcesMap['metadata.display.festival.program_highlights'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
              }
              if (newFest.food_and_booths !== undefined && newFest.food_and_booths !== oldFest.food_and_booths) {
                fieldSourcesMap['metadata.display.festival.food_and_booths'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
              }
              if (newFest.scale_text !== undefined && newFest.scale_text !== oldFest.scale_text) {
                fieldSourcesMap['metadata.display.festival.scale_text'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
              }
              if (newFest.parking_tips !== undefined && newFest.parking_tips !== oldFest.parking_tips) {
                fieldSourcesMap['metadata.display.festival.parking_tips'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
              }
            }
            
            // 📅 Event 필드
            if (newDisplay.event) {
              const newEvt = newDisplay.event;
              const oldEvt = oldDisplay.event || {};
              
              if (newEvt.target_audience !== undefined && newEvt.target_audience !== oldEvt.target_audience) {
                fieldSourcesMap['metadata.display.event.target_audience'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
              }
              if (newEvt.capacity !== undefined && newEvt.capacity !== oldEvt.capacity) {
                fieldSourcesMap['metadata.display.event.capacity'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
              }
              if (newEvt.registration && JSON.stringify(newEvt.registration) !== JSON.stringify(oldEvt.registration || {})) {
                fieldSourcesMap['metadata.display.event.registration'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
              }
            }
            
            // 🏪 Popup 필드
            if (newDisplay.popup) {
              const newPop = newDisplay.popup;
              const oldPop = oldDisplay.popup || {};
              
              if (JSON.stringify(newPop.brands) !== JSON.stringify(oldPop.brands)) {
                fieldSourcesMap['metadata.display.popup.brands'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
              }
              if (newPop.is_fnb !== undefined && newPop.is_fnb !== oldPop.is_fnb) {
                fieldSourcesMap['metadata.display.popup.is_fnb'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
              }
              if (newPop.fnb_items && JSON.stringify(newPop.fnb_items) !== JSON.stringify(oldPop.fnb_items || {})) {
                fieldSourcesMap['metadata.display.popup.fnb_items'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
              }
              if (JSON.stringify(newPop.goods_items) !== JSON.stringify(oldPop.goods_items)) {
                fieldSourcesMap['metadata.display.popup.goods_items'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
              }
              if (newPop.photo_zone !== undefined && newPop.photo_zone !== oldPop.photo_zone) {
                fieldSourcesMap['metadata.display.popup.photo_zone'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
              }
              if (newPop.waiting_hint && JSON.stringify(newPop.waiting_hint) !== JSON.stringify(oldPop.waiting_hint || {})) {
                fieldSourcesMap['metadata.display.popup.waiting_hint'] = {
                  source: 'Manual',
                  sourceDetail: 'Admin UI manual edit',
                  confidence: 100,
                  updatedAt: new Date().toISOString()
                };
              }
            }
          }
        }
      }
    }
    
    // 🔒 수동 편집 필드 마킹 (manually_edited_fields 업데이트)
    if (manuallyEditedFields.length > 0) {
      const markings = manuallyEditedFields.map(f => `"${f}": true`).join(', ');
      updates.push(`manually_edited_fields = COALESCE(manually_edited_fields, '{}'::jsonb) || '{${markings}}'::jsonb`);
      console.log('[Admin] 🔒 Marking manually edited fields:', manuallyEditedFields);
    }
      
      // 🔖 field_sources 업데이트 (수동 편집 시 출처를 "Manual"로 기록)
    if (Object.keys(fieldSourcesMap).length > 0) {
      const fieldSourceUpdates = Object.entries(fieldSourcesMap)
        .map(([field, source]) => `"${field}": ${JSON.stringify(source)}`)
        .join(', ');
      updates.push(`field_sources = COALESCE(field_sources, '{}'::jsonb) || '{${fieldSourceUpdates}}'::jsonb`);
      console.log('[Admin] 🔖 Updating field_sources for manual edits:', Object.keys(fieldSourcesMap));
    }
    
    // status 자동 계산 (start_at 또는 end_at 변경 시)
    if (req.body.start_at !== undefined || req.body.end_at !== undefined) {
      // 기존 데이터 조회하여 계산
      const oldEvent = await pool.query(
        'SELECT start_at, end_at FROM canonical_events WHERE id = $1',
        [req.params.id]
      );

      if (oldEvent.rows.length > 0) {
        // DB에서 가져온 날짜는 Date 객체일 수 있으므로 문자열로 변환
        const formatDateToString = (date: any): string => {
          if (typeof date === 'string') return date;
          if (date instanceof Date) {
            return date.toISOString().split('T')[0]; // YYYY-MM-DD
          }
          return String(date);
        };

        const startAt = req.body.start_at || formatDateToString(oldEvent.rows[0].start_at);
        const endAt = req.body.end_at || formatDateToString(oldEvent.rows[0].end_at);

        const [startYear, startMonth, startDay] = startAt.split('-').map(Number);
        const [endYear, endMonth, endDay] = endAt.split('-').map(Number);
        const startDate = new Date(startYear, startMonth - 1, startDay);
        const endDate = new Date(endYear, endMonth - 1, endDay);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        let status = 'unknown';
        if (startDate > today) {
          status = 'scheduled';
        } else if (endDate < today) {
          status = 'ended';
        } else {
          status = 'ongoing';
        }
        
        updates.push(`status = $${paramIndex++}`);
        params.push(status);
      }
    }

    // is_featured가 true로 변경되면 featured_at 자동 설정
    if (req.body.is_featured === true) {
      updates.push(`featured_at = NOW()`);
    }

    // 지오코딩: 항상 좌표를 체크하여 NULL이면 수행
    try {
      // 기존 데이터 조회 (lat, lng 포함)
      const oldEvent = await pool.query(
        'SELECT address, venue, lat, lng FROM canonical_events WHERE id = $1',
        [req.params.id]
      );

      if (oldEvent.rows.length > 0) {
        const oldAddress = oldEvent.rows[0].address;
        const oldVenue = oldEvent.rows[0].venue;
        const oldLat = oldEvent.rows[0].lat;
        const oldLng = oldEvent.rows[0].lng;
        const newAddress = req.body.address !== undefined ? req.body.address : oldAddress;
        const newVenue = req.body.venue !== undefined ? req.body.venue : oldVenue;

        // 사용자가 직접 좌표를 보낸 경우 지오코딩 스킵
        const userProvidedCoords = req.body.lat !== undefined && req.body.lng !== undefined;
        
        // address/venue 변경 OR 좌표가 NULL이면 지오코딩 (단, 사용자가 직접 좌표를 보내지 않은 경우에만)
        const shouldGeocode = 
          !userProvidedCoords && (
            newAddress !== oldAddress || 
            newVenue !== oldVenue ||
            oldLat === null || 
            oldLng === null
          );

        if (shouldGeocode) {
          console.log('[Geocode][Update] Triggering geocode:', {
            addressChanged: newAddress !== oldAddress,
            venueChanged: newVenue !== oldVenue,
            hasNullCoords: oldLat === null || oldLng === null,
            oldAddress,
            newAddress,
            oldVenue,
            newVenue,
            eventId: req.params.id
          });

            try {
              const { geocodeBestEffort } = await import('./lib/geocode');
              const geoResult = await geocodeBestEffort({
                address: newAddress,
                venue: newVenue
              });

              // 성공 시 좌표 업데이트
              if (geoResult.lat && geoResult.lng) {
                updates.push(`region = $${paramIndex++}`);
                params.push(geoResult.region);
                updates.push(`lat = $${paramIndex++}`);
                params.push(geoResult.lat);
                updates.push(`lng = $${paramIndex++}`);
                params.push(geoResult.lng);

                console.log('[Geocode][Update] Success:', {
                  region: geoResult.region,
                  lat: geoResult.lat,
                  lng: geoResult.lng,
                  source: geoResult.source,
                  confidence: geoResult.confidence
                });
              }

              // 성공/실패 무관하게 geo_* 필드 업데이트
              // geocodeBestEffort source → DB geo_source 매핑
              const sourceMap: Record<string, string> = {
                'kakao_address': 'kakao',
                'kakao_keyword': 'kakao',
                'nominatim': 'nominatim',
                'failed': 'manual'
              };
              updates.push(`geo_source = $${paramIndex++}`);
              params.push(sourceMap[geoResult.source] || 'manual');
              updates.push(`geo_confidence = $${paramIndex++}`);
              params.push(geoResult.confidence);
              updates.push(`geo_reason = $${paramIndex++}`);
              params.push(geoResult.reason);
              updates.push(`geo_updated_at = NOW()`);
            } catch (geoError) {
              console.error('[Geocode][Update] Error:', geoError);
              // 에러 시에도 geo_* 필드 업데이트
              updates.push(`geo_source = $${paramIndex++}`);
              params.push('manual');
              updates.push(`geo_confidence = $${paramIndex++}`);
              params.push('D');
              updates.push(`geo_reason = $${paramIndex++}`);
              params.push(`geocode_error: ${geoError instanceof Error ? geoError.message : String(geoError)}`);
              updates.push(`geo_updated_at = NOW()`);
            }
          }
        }
      } catch (selectError) {
        console.error('[Geocode][Update] Failed to fetch old data:', selectError);
        // SELECT 실패해도 계속 진행
      }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    params.push(req.params.id);

    await pool.query(
      `UPDATE canonical_events SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      params
    );

    // 업데이트 후 최신 데이터 반환
    const updated = await pool.query(
      `SELECT *, 
              to_char(start_at, 'YYYY-MM-DD') as start_at_str,
              to_char(end_at, 'YYYY-MM-DD') as end_at_str
       FROM canonical_events WHERE id = $1`,
      [req.params.id]
    );

    // 날짜 필드를 PostgreSQL에서 직접 포맷한 문자열로 대체 (타임존 문제 방지)
    const updatedEvent = updated.rows[0];
    updatedEvent.start_at = updatedEvent.start_at_str;
    updatedEvent.end_at = updatedEvent.end_at_str;
    delete updatedEvent.start_at_str;
    delete updatedEvent.end_at_str;

    // Phase 2: derived_tags, opening_hours, lat/lng 변경 시 자동 재계산
    const shouldRecalculate = 
      req.body.derived_tags !== undefined ||
      req.body.opening_hours !== undefined ||
      req.body.lat !== undefined ||
      req.body.lng !== undefined;
    
    if (shouldRecalculate) {
      console.log('[Admin] Triggering Phase 2 recalculation for event:', req.params.id);
      // 비동기 실행 (응답 속도 유지)
      const eventId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      enrichSingleEvent(eventId).catch(error => {
        console.error('[Admin] Phase 2 recalculation failed:', error);
      });
    }

    res.json({ success: true, item: updatedEvent });
  } catch (error) {
    console.error('[Admin] Event update failed:', error);
    console.error('[Admin] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      requestBody: req.body,
      eventId: req.params.id
    });
    res.status(500).json({ 
      message: 'Failed to update event',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Admin: 범용 이벤트 생성
app.post('/admin/events', requireAdminAuth, async (req, res) => {
  try {
    const { 
      main_category, title, display_title, start_at, end_at, venue, address, 
      image_url, overview, is_free, price_info,
      // 이미지 출처 정보
      image_storage, image_origin, image_source_page_url, image_key, image_metadata,
      // Phase 1 공통 필드
      external_links, price_min, price_max, source_tags, derived_tags, opening_hours
    } = req.body;
    
    // 필수 필드 검증
    if (!main_category) {
      return res.status(400).json({ message: 'Missing required field: main_category' });
    }
    if (!title || !start_at || !end_at || !venue) {
      return res.status(400).json({ message: 'Missing required fields: title, start_at, end_at, venue' });
    }
    
    // 날짜 검증 (YYYY-MM-DD 형식, 타임존 변환 없음)
    const isValidDateFormat = (dateStr: string | null | undefined): boolean => {
      if (!dateStr) return false;
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(dateStr)) return false;
      
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return date.getFullYear() === year && 
             date.getMonth() === month - 1 && 
             date.getDate() === day;
    };

    if (!isValidDateFormat(start_at) || !isValidDateFormat(end_at)) {
      return res.status(400).json({ 
        message: 'Invalid date format. Required: YYYY-MM-DD',
        provided: { start_at, end_at }
      });
    }
    
    const startAtDate = start_at;
    const endAtDate = end_at;
    
    // 1. UUID 생성
    const id = crypto.randomUUID();
    
    // 2. content_key 생성
    const contentKey = crypto
      .createHash('sha256')
      .update(`${title}-${start_at}-${end_at}-${venue}`)
      .digest('hex')
      .substring(0, 32);
    
    // 3. 종료 임박 여부 계산
    const [endYear, endMonth, endDay] = end_at.split('-').map(Number);
    const endDate = new Date(endYear, endMonth - 1, endDay);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysUntilEnd = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const isEndingSoon = daysUntilEnd <= 7 && daysUntilEnd >= 0;
    
    // 3-1. status 자동 계산
    const [startYear, startMonth, startDay] = start_at.split('-').map(Number);
    const startDate = new Date(startYear, startMonth - 1, startDay);
    let status = 'unknown';
    if (startDate > today) {
      status = 'scheduled';
    } else if (endDate < today) {
      status = 'ended';
    } else {
      status = 'ongoing';
    }
    
    // 4. 지오코딩
    let region = null;
    let lat = null;
    let lng = null;
    let geoSource = 'manual';
    let geoConfidence = 'D';
    let geoReason = 'not_attempted';

    if (address || venue) {
      try {
        const { geocodeBestEffort } = await import('./lib/geocode');
        const geoResult = await geocodeBestEffort({
          address: address || null,
          venue: venue
        });

        region = geoResult.region;
        lat = geoResult.lat;
        lng = geoResult.lng;

        const sourceMap: Record<string, string> = {
          'kakao_address': 'kakao',
          'kakao_keyword': 'kakao',
          'nominatim': 'nominatim',
          'failed': 'manual'
        };
        geoSource = sourceMap[geoResult.source] || 'manual';
        geoConfidence = geoResult.confidence;
        geoReason = geoResult.reason || 'unknown';

        if (geoResult.lat && geoResult.lng) {
          console.log('[Geocode] Success:', {
            source: geoResult.source,
            confidence: geoResult.confidence,
            region: geoResult.region,
            lat: geoResult.lat,
            lng: geoResult.lng
          });
        } else {
          console.warn('[Geocode] Failed:', {
            reason: geoResult.reason,
            address,
            venue
          });
        }
      } catch (geoError) {
        geoSource = 'manual';
        geoConfidence = 'D';
        geoReason = `geocode_error: ${geoError instanceof Error ? geoError.message : String(geoError)}`;
        console.error('[Geocode] Exception:', { reason: geoReason });
      }
    }
    
    // 5. sources jsonb 구성
    const sourcesData = [{
      source: 'admin',
      createdBy: 'admin',
      category: main_category,
      createdAt: new Date().toISOString(),
    }];

    // 6. 기본값 설정
    const defaultValues = {
      display_title: display_title || null,
      sub_category: null,
      image_url: image_url || PLACEHOLDER_IMAGE,
      is_free: is_free !== undefined ? is_free : true,
      price_info: price_info || '입장 무료',
      overview: overview || null,
      popularity_score: 500,
      buzz_score: 0,
      is_featured: false,
      featured_order: null,
      featured_at: null,
      source_priority_winner: 'manual',
      is_deleted: false,
      deleted_reason: null,
      image_storage: image_storage || (image_url ? 'external' : null),
      image_origin: image_origin || null,
      image_source_page_url: image_source_page_url || null,
      image_key: image_key || null,
      image_metadata: image_metadata || {},
      // Phase 1 공통 필드
      external_links: external_links || {},
      status: status,
      price_min: price_min || null,
      price_max: price_max || null,
      source_tags: source_tags || [],
      derived_tags: derived_tags || [],
      opening_hours: opening_hours || null,
      quality_flags: {
        has_real_image: image_url && image_url !== PLACEHOLDER_IMAGE && !image_url.includes('/defaults/'),
        has_exact_address: !!address,
        geo_ok: !!(lat && lng),
        has_overview: !!overview,
        has_price_info: !!price_info
      }
    };
    
    // 7. DB 삽입
    const geoUpdatedAtValue = geoSource ? new Date() : null;

    const result = await pool.query(
      `INSERT INTO canonical_events (
        id, content_key, title, display_title, start_at, end_at, venue, address,
        region, lat, lng, main_category, sub_category, image_url, is_free, price_info,
        overview, is_ending_soon, popularity_score, buzz_score, is_featured, featured_order,
        featured_at, sources, source_priority_winner, is_deleted, deleted_reason,
        image_storage, image_origin, image_source_page_url, image_key, image_metadata,
        geo_source, geo_confidence, geo_reason, geo_updated_at,
        external_links, status, price_min, price_max, source_tags, derived_tags, opening_hours, quality_flags,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24::jsonb, $25, $26, $27,
        $28, $29, $30, $31, $32::jsonb,
        $33, $34, $35, $36,
        $37::jsonb, $38, $39, $40, $41::jsonb, $42::jsonb, $43::jsonb, $44::jsonb,
        NOW(), NOW()
      ) RETURNING *`,
      [
        id,
        contentKey,
        title,
        defaultValues.display_title,
        startAtDate,
        endAtDate,
        venue,
        address || null,
        region,
        lat,
        lng,
        main_category,
        defaultValues.sub_category,
        defaultValues.image_url,
        defaultValues.is_free,
        defaultValues.price_info,
        defaultValues.overview,
        isEndingSoon,
        defaultValues.popularity_score,
        defaultValues.buzz_score,
        defaultValues.is_featured,
        defaultValues.featured_order,
        defaultValues.featured_at,
        JSON.stringify(sourcesData),
        defaultValues.source_priority_winner,
        defaultValues.is_deleted,
        defaultValues.deleted_reason,
        defaultValues.image_storage,
        defaultValues.image_origin,
        defaultValues.image_source_page_url,
        defaultValues.image_key,
        JSON.stringify(defaultValues.image_metadata),
        geoSource,
        geoConfidence,
        geoReason,
        geoUpdatedAtValue,
        JSON.stringify(defaultValues.external_links),
        defaultValues.status,
        defaultValues.price_min,
        defaultValues.price_max,
        JSON.stringify(defaultValues.source_tags),
        JSON.stringify(defaultValues.derived_tags),
        defaultValues.opening_hours ? JSON.stringify(defaultValues.opening_hours) : null,
        JSON.stringify(defaultValues.quality_flags),
      ]
    );
    
    console.log('[Admin] ✅ Event created:', {
      id,
      title,
      category: main_category,
      geo: { region, lat, lng, source: geoSource, confidence: geoConfidence },
      imageSource: { storage: defaultValues.image_storage, origin: defaultValues.image_origin }
    });

    // Hot Score 즉시 라이트 계산 (비동기, 응답 블로킹 안 함)
    calculateLightBuzzScore(id).catch(err => {
      console.error('[Admin] Light buzz score calculation failed:', err);
    });

    // 날짜 필드를 문자열로 변환 (타임존 문제 방지)
    const formattedEvent = formatEventDates(result.rows[0]);

    res.json({ item: formattedEvent });
  } catch (error) {
    console.error('[Admin] Event creation failed:', error);
    res.status(500).json({ message: 'Failed to create event' });
  }
});

// Admin: 팝업 이벤트 생성
app.post('/admin/events/popup', requireAdminAuth, async (req, res) => {
  try {
    const { 
      title, displayTitle, startAt, endAt, venue, address, imageUrl, overview, instagramUrl,
      imageStorage, imageOrigin, imageSourcePageUrl, imageKey, imageMetadata 
    } = req.body;
    
    // 필수 필드 검증
    if (!title || !startAt || !endAt || !venue) {
      return res.status(400).json({ message: 'Missing required fields: title, startAt, endAt, venue' });
    }
    
    // 이미지 URL 검증
    if (imageUrl) {
      // Instagram scontent URL 차단
      if (imageStorage === 'external' && (imageUrl.includes('cdninstagram') || imageUrl.includes('scontent'))) {
        console.error('[Admin] Instagram CDN URL rejected:', {
          imageUrl,
          admin: req.headers['x-admin-key'],
        });
        return res.status(400).json({
          message: '⚠️ Instagram CDN URL(scontent)은 24시간 후 만료됩니다. 이미지를 직접 업로드해주세요.',
          code: 'INSTAGRAM_CDN_NOT_ALLOWED',
        });
      }
      
      // CDN 이미지는 반드시 CDN_BASE_URL로 시작
      if (imageStorage === 'cdn') {
        if (!config.cdnBaseUrl) {
          return res.status(500).json({
            message: 'CDN_BASE_URL이 설정되지 않았습니다',
            code: 'CDN_NOT_CONFIGURED',
          });
        }
        
        // Trailing slash 정규화
        const normalizedCdnBase = config.cdnBaseUrl.replace(/\/$/, '');
        const normalizedImageUrl = imageUrl.replace(/\/$/, '');
        
        if (!normalizedImageUrl.startsWith(normalizedCdnBase)) {
          console.error('[Admin] Invalid CDN URL:', {
            imageUrl,
            expected: config.cdnBaseUrl,
          });
          return res.status(400).json({
            message: 'CDN 이미지 URL이 올바르지 않습니다',
            code: 'INVALID_CDN_URL',
          });
        }
      }
      
      // CDN 이미지는 imageOrigin 필수
      if (imageStorage === 'cdn' && !imageOrigin) {
        return res.status(400).json({
          message: 'CDN 이미지는 출처(imageOrigin) 선택이 필수입니다',
          code: 'ORIGIN_REQUIRED',
        });
      }
    }
    
    // 1. UUID 생성
    const id = crypto.randomUUID();
    
    // 2. content_key 생성
    const contentKey = crypto
      .createHash('sha256')
      .update(`${title}-${startAt}-${endAt}-${venue}`)
      .digest('hex')
      .substring(0, 32);
    
    // 3. 종료 임박 여부 계산 (로컬 날짜 기준, 타임존 변환 없음)
    const [endYear, endMonth, endDay] = endAt.split('-').map(Number);
    const endDate = new Date(endYear, endMonth - 1, endDay);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0); // 시간 부분 제거하여 날짜만 비교
    
    const daysUntilEnd = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const isEndingSoon = daysUntilEnd <= 7 && daysUntilEnd >= 0;
    
    // 4. 지오코딩 (address 또는 venue가 있을 경우)
    let lat = null;
    let lng = null;
    let region = null;
    let geoSource: string | null = null;
    let geoConfidence: string | null = null; // 'A', 'B', 'C', 'D'
    let geoReason: string | null = null;

    if (address || venue) {
      console.log('[Geocode] input:', { address, venue });
      try {
        const { geocodeBestEffort } = await import('./lib/geocode');
        const geoResult = await geocodeBestEffort({ address, venue });

        lat = geoResult.lat;
        lng = geoResult.lng;
        region = geoResult.region;

        // geocodeBestEffort source → DB geo_source 매핑
        const sourceMap: Record<string, string> = {
          'kakao_address': 'kakao',
          'kakao_keyword': 'kakao',
          'nominatim': 'nominatim',
          'failed': 'manual'
        };
        geoSource = sourceMap[geoResult.source] || 'manual';
        geoConfidence = geoResult.confidence;
        geoReason = geoResult.reason;

        if (geoResult.lat && geoResult.lng) {
          console.log('[Geocode] Success:', {
            source: geoResult.source,
            confidence: geoResult.confidence,
            region: geoResult.region,
            lat: geoResult.lat,
            lng: geoResult.lng
          });
        } else {
          console.warn('[Geocode] Failed:', {
            reason: geoResult.reason,
            address,
            venue
          });
        }
      } catch (geoError) {
        // 지오코딩 예외 발생
        geoSource = 'manual';
        geoConfidence = 'D';
        geoReason = `geocode_error: ${geoError instanceof Error ? geoError.message : String(geoError)}`;
        console.error('[Geocode] Exception:', { reason: geoReason });
        // 지오코딩 실패해도 계속 진행
      }
    } else {
      // address와 venue 둘 다 없는 경우
      geoSource = 'manual';
      geoConfidence = 'D';
      geoReason = 'no_address_or_venue';
      console.log('[Geocode] skipped:', { reason: geoReason });
    }
    
    // 5. 날짜 검증 (YYYY-MM-DD 형식만 허용, 타임존 변환 없이 그대로 사용)
    const isValidDateFormat = (dateStr: string | null | undefined): boolean => {
      if (!dateStr) return false;
      // YYYY-MM-DD 형식 검증
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(dateStr)) return false;
      
      // 실제 유효한 날짜인지 검증 (2월 30일 같은 거 방지)
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return date.getFullYear() === year && 
             date.getMonth() === month - 1 && 
             date.getDate() === day;
    };

    if (!isValidDateFormat(startAt) || !isValidDateFormat(endAt)) {
      return res.status(400).json({ 
        message: 'Invalid date format. Required: YYYY-MM-DD (e.g., 2026-01-28)',
        provided: { startAt, endAt }
      });
    }
    
    // 날짜 문자열을 그대로 사용 (타임존 변환 없음)
    const startAtDate = startAt;
    const endAtDate = endAt;

    // 6. sources jsonb 구성 (admin 생성 이벤트)
    const sourcesData = [{
      source: 'admin',
      createdBy: 'admin',
      instagramUrl: instagramUrl || null,
      createdAt: new Date().toISOString(),
    }];

    // 7. 기본값 설정
    const defaultValues = {
      display_title: displayTitle || null,
      main_category: '팝업',
      sub_category: null, // 향후 AI로 추론 가능
      image_url: imageUrl || null,
      is_free: true,
      price_info: '입장 무료 (굿즈 별도)',
      overview: overview || null,
      popularity_score: 500,
      buzz_score: 0,
      is_featured: false,
      featured_order: null,
      featured_at: null,
      source_priority_winner: 'manual',
      is_deleted: false,
      deleted_reason: null,
    };
    
    // 8. DB 삽입
    const geoUpdatedAtValue = geoSource ? new Date() : null;

    const result = await pool.query(
      `INSERT INTO canonical_events (
        id, content_key, title, display_title, start_at, end_at, venue, address,
        region, lat, lng, main_category, sub_category, image_url, is_free, price_info,
        overview, is_ending_soon, popularity_score, buzz_score, is_featured, featured_order,
        featured_at, sources, source_priority_winner, is_deleted, deleted_reason,
        image_storage, image_origin, image_source_page_url, image_key, image_metadata,
        geo_source, geo_confidence, geo_reason, geo_updated_at,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24::jsonb, $25, $26, $27,
        $28, $29, $30, $31, $32::jsonb,
        $33, $34, $35, $36,
        NOW(), NOW()
      ) RETURNING *`,
      [
        id,
        contentKey,
        title,
        defaultValues.display_title,
        startAtDate,
        endAtDate,
        venue,
        address || null,
        region,
        lat,
        lng,
        defaultValues.main_category,
        defaultValues.sub_category,
        defaultValues.image_url,
        defaultValues.is_free,
        defaultValues.price_info,
        defaultValues.overview,
        isEndingSoon,
        defaultValues.popularity_score,
        defaultValues.buzz_score,
        defaultValues.is_featured,
        defaultValues.featured_order,
        defaultValues.featured_at,
        JSON.stringify(sourcesData),
        defaultValues.source_priority_winner,
        defaultValues.is_deleted,
        defaultValues.deleted_reason,
        imageStorage || 'external',
        imageOrigin || null,
        imageSourcePageUrl || null,
        imageKey || null,
        imageMetadata ? JSON.stringify(imageMetadata) : '{}',
        geoSource,
        geoConfidence,
        geoReason,
        geoUpdatedAtValue,
      ]
    );
    
    console.log('[Admin] ✅ Popup event created:', {
      id,
      title,
      geo: { region, lat, lng, source: geoSource, confidence: geoConfidence, reason: geoReason }
    });

    // Hot Score 즉시 라이트 계산 (비동기, 응답 블로킹 안 함)
    calculateLightBuzzScore(id).catch(err => {
      console.error('[Admin] Light buzz score calculation failed:', err);
    });

    // 날짜 필드를 문자열로 변환 (타임존 문제 방지)
    const formattedEvent = formatEventDates(result.rows[0]);

    res.json({ item: formattedEvent });
  } catch (error) {
    console.error('[Admin] Popup creation failed:', error);
    res.status(500).json({ message: 'Failed to create popup event' });
  }
});

// DMCA Report API (공개 - 신고만 접수, 즉시 삭제 안함)
app.post('/api/dmca/report', dmcaReportLimiter, async (req, res) => {
  try {
    const { eventId, copyrightHolderName, copyrightHolderEmail, reason, evidenceUrl, imageUrl } = req.body;
    
    // 필수 필드 검증
    if (!eventId || !copyrightHolderName || !copyrightHolderEmail || !reason) {
      return res.status(400).json({
        error: '필수 정보가 누락되었습니다',
        required: ['eventId', 'copyrightHolderName', 'copyrightHolderEmail', 'reason'],
      });
    }
    
    // 이메일 형식 검증
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(copyrightHolderEmail)) {
      return res.status(400).json({ error: '올바른 이메일 주소를 입력하세요' });
    }
    
    console.log('[DMCA] Report received:', {
      eventId,
      copyrightHolderName,
      copyrightHolderEmail,
      reason: reason.substring(0, 100),
    });
    
    // 이벤트 조회
    const eventResult = await pool.query(
      'SELECT id, title, image_url, image_key, image_storage, image_origin FROM canonical_events WHERE id = $1',
      [eventId]
    );
    
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: '이벤트를 찾을 수 없습니다' });
    }
    
    const event = eventResult.rows[0];
    
    // 감사 로그 삽입 (status: pending)
    const logResult = await pool.query(
      `INSERT INTO image_audit_log (
        event_id, action, image_url, image_key, image_origin,
        copyright_holder_email, deletion_reason, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id`,
      [
        eventId,
        'dmca_report_pending',
        event.image_url,
        event.image_key,
        event.image_origin,
        copyrightHolderEmail,
        reason,
        JSON.stringify({
          copyrightHolderName,
          evidenceUrl,
          reportedImageUrl: imageUrl, // optional - 신고자가 본 이미지 URL (참고용)
          reportedAt: new Date().toISOString(),
          status: 'pending',
        }),
      ]
    );
    
    const reportId = logResult.rows[0].id;
    
    console.log('[DMCA] ✅ Report logged (pending admin review):', { reportId, eventId });
    
    // 성공 응답 (즉시 삭제되지 않음)
    res.json({
      success: true,
      message: '신고가 접수되었습니다. 관리자 검토 후 처리됩니다.',
      reportId,
      eventId,
      status: 'pending',
    });
    
  } catch (error) {
    console.error('[DMCA] Report failed:', error);
    res.status(500).json({
      error: '신고 접수에 실패했습니다',
      message: '관리자에게 문의하세요',
    });
  }
});

// DMCA Approve & Takedown API (Admin 전용 - 실제 삭제)
app.post('/admin/dmca/approve', requireAdminAuth, async (req, res) => {
  try {
    const { reportId, eventId, adminNote } = req.body;
    
    if (!eventId) {
      return res.status(400).json({ error: 'eventId는 필수입니다' });
    }
    
    console.log('[DMCA] Admin approval:', { reportId, eventId, adminNote });
    
    // 1. 이벤트 조회
    const eventResult = await pool.query(
      'SELECT id, title, image_url, image_key, image_storage, image_origin FROM canonical_events WHERE id = $1',
      [eventId]
    );
    
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: '이벤트를 찾을 수 없습니다' });
    }
    
    const event = eventResult.rows[0];
    
    // 2. 기존 신고 로그 업데이트 (있으면)
    if (reportId) {
      await pool.query(
        `UPDATE image_audit_log 
         SET action = 'dmca_takedown',
             deleted_at = NOW(),
             metadata = metadata || jsonb_build_object(
               'status', 'approved',
               'approvedAt', NOW(),
               'approvedBy', 'admin',
               'adminNote', $2
             )
         WHERE id = $1`,
        [reportId, adminNote || '']
      );
    } else {
      // 신고 없이 직접 삭제 (admin이 직접 발견한 경우)
      await pool.query(
        `INSERT INTO image_audit_log (
          event_id, action, image_url, image_key, image_origin,
          deletion_reason, deleted_at, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
        [
          eventId,
          'dmca_takedown',
          event.image_url,
          event.image_key,
          event.image_origin,
          adminNote || 'Admin initiated takedown',
          JSON.stringify({
            approvedBy: 'admin',
            approvedAt: new Date().toISOString(),
          }),
        ]
      );
    }
    
    // 3. CDN 이미지라면 S3/R2에서 삭제
    if (event.image_storage === 'cdn' && event.image_key) {
      try {
        await deleteEventImage(event.image_key);
        console.log('[DMCA] CDN image deleted:', event.image_key);
      } catch (deleteError) {
        console.error('[DMCA] Failed to delete from CDN:', deleteError);
        // CDN 삭제 실패해도 계속 진행
      }
    }
    
    // 4. DB 이미지 정보 null 처리
    await pool.query(
      `UPDATE canonical_events
       SET image_url = NULL,
           image_key = NULL,
           image_metadata = COALESCE(image_metadata, '{}'::jsonb) || jsonb_build_object(
             'dmca_takedown', true,
             'dmca_removed_at', NOW(),
             'dmca_approved_by', 'admin',
             'dmca_note', $2
           ),
           updated_at = NOW()
       WHERE id = $1`,
      [eventId, adminNote || '']
    );
    
    console.log('[DMCA] ✅ Image removed (admin approved):', { eventId, title: event.title });
    
    res.json({
      success: true,
      message: '이미지가 삭제되었습니다',
      eventId,
      removedImageUrl: event.image_url,
    });
    
  } catch (error) {
    console.error('[DMCA] Admin approval failed:', error);
    res.status(500).json({
      error: '삭제 처리에 실패했습니다',
    });
  }
});

app.get('/admin/metrics', async (_, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          source,
          type,
          status,
          started_at AS "startedAt",
          completed_at AS "completedAt"
        FROM collection_logs
        WHERE completed_at IS NOT NULL
        ORDER BY completed_at DESC
        LIMIT 1;
      `
    );

    res.json({
      lastCollection: result.rows[0] ?? null,
    });
  } catch (error) {
    console.error('[API] /admin/metrics failed', error);
    res.status(500).json({ message: 'Failed to load admin metrics.' });
  }
});

app.get('/categories', (_, res) => {
  const categories = {
    mainCategories: ['공연', '전시', '축제', '행사'],
    subCategories: {
      공연: ['뮤지컬', '연극', '콘서트', '클래식', '무용', '국악', '기타 공연'],
      전시: ['미술 전시', '사진 전시', '미디어아트', '체험형 전시', '어린이 전시', '특별전', '기타 전시'],
      축제: ['지역 축제', '음악 축제', '불꽃 / 드론 / 빛 축제', '계절 축제', '전통 / 문화 축제', '기타 축제'],
      행사: ['문화 행사', '체험 행사', '교육 / 강연', '마켓 / 플리마켓', '기념 행사', '가족 / 어린이', '기타 행사'],
    },
  };
  res.json(categories);
});

app.get('/events', async (req, res) => {
  const startTime = startTimer();
  const requestTs = nowIso();
  
  try {
    const page = Math.max(parseInt((req.query.page as string) ?? '1', 10) || 1, 1);
    const size = Math.min(Math.max(parseInt((req.query.size as string) ?? '20', 10) || 20, 1), 100);
    const mainCategory = (req.query.category as string) || undefined; // 호환성: category → main_category
    const subCategory = (req.query.subCategory as string) || undefined;
    const region = (req.query.region as string) || undefined;
    const query = (req.query.q as string) || undefined; // 검색어
    const sortBy = (req.query.sortBy as string) || 'start_at'; // start_at | created_at | updated_at
    const order = (req.query.order as string) || 'asc'; // asc | desc

    const filters: string[] = [];
    const params: unknown[] = [];

    // Always filter out ended events
    filters.push(`end_at >= CURRENT_DATE`);

    // 공연 카테고리는 KOPIS만 노출
    filters.push(`(main_category != '공연' OR source_priority_winner = 'kopis')`);

    if (mainCategory && mainCategory !== '전체') {
      params.push(mainCategory);
      filters.push(`main_category = $${params.length}`);
    }
    if (subCategory && subCategory !== '전체') {
      params.push(subCategory);
      filters.push(`sub_category = $${params.length}`);
    }
    if (region && region !== '전국') {
      params.push(region);
      filters.push(`region = $${params.length}`);
    }
    
    // 검색어 필터 (display_title, title, venue, address에서 검색)
    if (query && query.trim()) {
      const searchPattern = `%${query.trim()}%`;
      params.push(searchPattern);
      filters.push(`(
        display_title ILIKE $${params.length} OR
        title ILIKE $${params.length} OR
        venue ILIKE $${params.length} OR
        address ILIKE $${params.length}
      )`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    // 정렬 필드 검증
    const validSortFields = ['start_at', 'created_at', 'updated_at'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'start_at';
    const sortOrder = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    params.push(size);
    const limitIndex = params.length;
    params.push((page - 1) * size);
    const offsetIndex = params.length;

    const listQuery = `
      WITH ranked AS (
        SELECT
          id,
          title,
          display_title AS "displayTitle",
          content_key AS "contentKey",
          COALESCE(venue, '') AS venue,
          start_at AS "startAt",
          end_at AS "endAt",
          region,
          main_category AS "mainCategory",
          sub_category AS "subCategory",
          COALESCE(image_url, '${PLACEHOLDER_IMAGE}') AS "imageUrl",
          source_priority_winner AS "sourcePriorityWinner",
          address,
          lat,
          lng,
          start_at,
          created_at,
          updated_at,
          CASE
            WHEN image_url IS NOT NULL
              AND image_url != ''
              AND image_url NOT LIKE '%placeholder%'
            THEN 1
            ELSE 0
          END AS has_real_image,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(content_key, canonical_key, id::text)
            ORDER BY
              CASE
                WHEN image_url IS NOT NULL
                  AND image_url != ''
                  AND image_url NOT LIKE '%placeholder%'
                THEN 1
                ELSE 0
              END DESC,
              updated_at DESC
          ) AS rn
        FROM canonical_events
        ${where}
      )
      SELECT
        id,
        title,
        "displayTitle",
        "contentKey",
        venue,
        "startAt",
        "endAt",
        region,
        "mainCategory",
        "subCategory",
        "imageUrl",
        "sourcePriorityWinner",
        address,
        lat,
        lng
      FROM ranked
      WHERE rn = 1
      ORDER BY ${sortField} ${sortOrder}, id ASC
      LIMIT $${limitIndex} OFFSET $${offsetIndex};
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT DISTINCT COALESCE(content_key, canonical_key, id::text) AS dedupe_key
        FROM canonical_events
        ${where}
      ) AS deduped;
    `;

    const [itemsResult, countResult] = await Promise.all([
      pool.query(listQuery, params),
      pool.query(countQuery, params.slice(0, params.length - 2)),
    ]);

    const totalCount = countResult.rows[0]?.total ?? 0;

    const responsePayload = {
      items: itemsResult.rows,
      pageInfo: {
        page,
        size,
        totalCount,
      },
    };

    const payloadStr = JSON.stringify(responsePayload);
    const payloadKB = (Buffer.byteLength(payloadStr, 'utf8') / 1024).toFixed(2);

    logApiMetric('/events', req.query as Record<string, unknown>, itemsResult.rows.length, responsePayload);

    if (process.env.NODE_ENV === 'development') {
      console.log('[API][/events] page:', page, 'size:', size, 'totalCount:', totalCount, 'returned items:', itemsResult.rows.length, 'filters:', { mainCategory, subCategory, region, query });
    }

    // 계측 로그
    logApiMetrics({
      endpoint: 'GET /events',
      ts: requestTs,
      query: req.query as Record<string, unknown>,
      status: 200,
      count: itemsResult.rows.length,
      payloadKB: safeJsonSizeKB(responsePayload),
      elapsedMs: getElapsedMs(startTime),
    });

    res.json(responsePayload);
  } catch (error) {
    console.error('[API] /events failed', error);
    
    // 계측 로그 (에러 경로)
    logApiMetrics({
      endpoint: 'GET /events',
      ts: requestTs,
      query: req.query as Record<string, unknown>,
      status: 500,
      count: null,
      payloadKB: -1,
      elapsedMs: getElapsedMs(startTime),
    });
    
    res.status(500).json({ message: 'Failed to load events.' });
  }
});

// 구체적인 라우트를 먼저 정의 (/:id보다 앞에 위치해야 함)
app.get('/events/hot', async (req, res) => {
  const startTime = startTimer();
  const requestTs = nowIso();

  try {
    const page = Math.max(parseInt((req.query.page as string) ?? '1', 10) || 1, 1);
    const size = Math.min(Math.max(parseInt((req.query.size as string) ?? '20', 10) || 20, 1), 100);

    const params: unknown[] = [];

    params.push(size);
    const limitIndex = params.length;
    params.push((page - 1) * size);
    const offsetIndex = params.length;

    const listQuery = `
      WITH ranked AS (
        SELECT
          id,
          title,
          display_title AS "displayTitle",
          content_key AS "contentKey",
          COALESCE(venue, '') AS venue,
          start_at AS "startAt",
          end_at AS "endAt",
          region,
          main_category AS "mainCategory",
          sub_category AS "subCategory",
          COALESCE(image_url, '${PLACEHOLDER_IMAGE}') AS "imageUrl",
          source_priority_winner AS "sourcePriorityWinner",
          popularity_score AS "popularityScore",
          buzz_score AS "buzzScore",
          buzz_updated_at AS "buzzUpdatedAt",
          is_ending_soon AS "isEndingSoon",
          is_free AS "isFree",
          created_at,
          updated_at,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(content_key, canonical_key, id::text)
            ORDER BY
              CASE
                WHEN image_url IS NOT NULL
                  AND image_url != ''
                  AND image_url NOT LIKE '%placeholder%'
                THEN 1
                ELSE 0
              END DESC,
              updated_at DESC
          ) AS rn
        FROM canonical_events
        WHERE end_at >= CURRENT_DATE
          AND (main_category != '공연' OR source_priority_winner = 'kopis')
          AND image_url IS NOT NULL
          AND image_url != ''
          AND image_url NOT LIKE '%placeholder%'
      )
      SELECT
        id,
        title,
        "displayTitle",
        "contentKey",
        venue,
        "startAt",
        "endAt",
        region,
        "mainCategory",
        "subCategory",
        "imageUrl",
        "sourcePriorityWinner",
        "popularityScore",
        "buzzScore",
        "buzzUpdatedAt",
        "isEndingSoon",
        "isFree"
      FROM ranked
      WHERE rn = 1
      ORDER BY
        CASE
          WHEN "buzzUpdatedAt" IS NOT NULL AND "buzzScore" > 0
            THEN "buzzScore"
          ELSE "popularityScore"
        END DESC,
        created_at DESC,
        id ASC
      LIMIT $${limitIndex} OFFSET $${offsetIndex};
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT DISTINCT COALESCE(content_key, canonical_key, id::text) AS dedupe_key
        FROM canonical_events
        WHERE end_at >= CURRENT_DATE
          AND (main_category != '공연' OR source_priority_winner = 'kopis')
          AND image_url IS NOT NULL
          AND image_url != ''
          AND image_url NOT LIKE '%placeholder%'
      ) AS deduped;
    `;

    const [itemsResult, countResult] = await Promise.all([
      pool.query(listQuery, params),
      pool.query(countQuery),
    ]);

    const responsePayload = {
      items: itemsResult.rows,
      pageInfo: {
        page,
        size,
        totalCount: countResult.rows[0]?.total ?? 0,
      },
    };

    logApiMetric('/events/hot', req.query as Record<string, unknown>, itemsResult.rows.length, responsePayload);

    // 계측 로그
    logApiMetrics({
      endpoint: 'GET /events/hot',
      ts: requestTs,
      query: req.query as Record<string, unknown>,
      status: 200,
      count: itemsResult.rows.length,
      payloadKB: safeJsonSizeKB(responsePayload),
      elapsedMs: getElapsedMs(startTime),
    });

    res.json(responsePayload);
  } catch (error) {
    console.error('[API] /events/hot failed', error);
    
    // 계측 로그 (에러 경로)
    logApiMetrics({
      endpoint: 'GET /events/hot',
      ts: requestTs,
      query: req.query as Record<string, unknown>,
      status: 500,
      count: null,
      payloadKB: -1,
      elapsedMs: getElapsedMs(startTime),
    });
    
    res.status(500).json({ message: 'Failed to load hot events.' });
  }
});

app.get('/events/free', async (req, res) => {
  const startTime = startTimer();
  const requestTs = nowIso();
  
  try {
    const page = Math.max(parseInt((req.query.page as string) ?? '1', 10) || 1, 1);
    const size = Math.min(Math.max(parseInt((req.query.size as string) ?? '20', 10) || 20, 1), 100);

    const params: unknown[] = [];

    params.push(size);
    const limitIndex = params.length;
    params.push((page - 1) * size);
    const offsetIndex = params.length;

    const listQuery = `
      WITH ranked AS (
        SELECT
          id,
          title,
          display_title AS "displayTitle",
          content_key AS "contentKey",
          COALESCE(venue, '') AS venue,
          start_at AS "startAt",
          end_at AS "endAt",
          region,
          main_category AS "mainCategory",
          sub_category AS "subCategory",
          COALESCE(image_url, '${PLACEHOLDER_IMAGE}') AS "imageUrl",
          source_priority_winner AS "sourcePriorityWinner",
          popularity_score AS "popularityScore",
          is_ending_soon AS "isEndingSoon",
          is_free AS "isFree",
          start_at,
          updated_at,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(content_key, canonical_key, id::text)
            ORDER BY
              CASE
                WHEN image_url IS NOT NULL
                  AND image_url != ''
                  AND image_url NOT LIKE '%placeholder%'
                THEN 1
                ELSE 0
              END DESC,
              updated_at DESC
          ) AS rn
        FROM canonical_events
        WHERE end_at >= CURRENT_DATE
          AND (main_category != '공연' OR source_priority_winner = 'kopis')
          AND is_free = true
      )
      SELECT
        id,
        title,
        "displayTitle",
        "contentKey",
        venue,
        "startAt",
        "endAt",
        region,
        "mainCategory",
        "subCategory",
        "imageUrl",
        "sourcePriorityWinner",
        "popularityScore",
        "isEndingSoon",
        "isFree"
      FROM ranked
      WHERE rn = 1
      ORDER BY start_at ASC, id ASC
      LIMIT $${limitIndex} OFFSET $${offsetIndex};
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT DISTINCT COALESCE(content_key, canonical_key, id::text) AS dedupe_key
        FROM canonical_events
        WHERE end_at >= CURRENT_DATE
          AND (main_category != '공연' OR source_priority_winner = 'kopis')
          AND is_free = true
      ) AS deduped;
    `;

    const [itemsResult, countResult] = await Promise.all([
      pool.query(listQuery, params),
      pool.query(countQuery),
    ]);

    const responsePayload = {
      items: itemsResult.rows,
      pageInfo: {
        page,
        size,
        totalCount: countResult.rows[0]?.total ?? 0,
      },
    };

    // 계측 로그
    logApiMetrics({
      endpoint: 'GET /events/free',
      ts: requestTs,
      query: req.query as Record<string, unknown>,
      status: 200,
      count: itemsResult.rows.length,
      payloadKB: safeJsonSizeKB(responsePayload),
      elapsedMs: getElapsedMs(startTime),
    });

    res.json(responsePayload);
  } catch (error) {
    console.error('[API] /events/free failed', error);
    
    // 계측 로그 (에러 경로)
    logApiMetrics({
      endpoint: 'GET /events/free',
      ts: requestTs,
      query: req.query as Record<string, unknown>,
      status: 500,
      count: null,
      payloadKB: -1,
      elapsedMs: getElapsedMs(startTime),
    });
    
    res.status(500).json({ message: 'Failed to load free events.' });
  }
});

app.get('/events/ending', async (req, res) => {
  const startTime = startTimer();
  const requestTs = nowIso();
  
  try {
    const page = Math.max(parseInt((req.query.page as string) ?? '1', 10) || 1, 1);
    const size = Math.min(Math.max(parseInt((req.query.size as string) ?? '20', 10) || 20, 1), 100);

    const params: unknown[] = [];

    params.push(size);
    const limitIndex = params.length;
    params.push((page - 1) * size);
    const offsetIndex = params.length;

    const listQuery = `
      WITH ranked AS (
        SELECT
          id,
          title,
          display_title AS "displayTitle",
          content_key AS "contentKey",
          COALESCE(venue, '') AS venue,
          start_at AS "startAt",
          end_at AS "endAt",
          region,
          main_category AS "mainCategory",
          sub_category AS "subCategory",
          COALESCE(image_url, '${PLACEHOLDER_IMAGE}') AS "imageUrl",
          source_priority_winner AS "sourcePriorityWinner",
          popularity_score AS "popularityScore",
          is_ending_soon AS "isEndingSoon",
          is_free AS "isFree",
          end_at,
          updated_at,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(content_key, canonical_key, id::text)
            ORDER BY
              CASE
                WHEN image_url IS NOT NULL
                  AND image_url != ''
                  AND image_url NOT LIKE '%placeholder%'
                THEN 1
                ELSE 0
              END DESC,
              updated_at DESC
          ) AS rn
        FROM canonical_events
        WHERE end_at >= CURRENT_DATE
          AND (main_category != '공연' OR source_priority_winner = 'kopis')
          AND is_ending_soon = true
      )
      SELECT
        id,
        title,
        "displayTitle",
        "contentKey",
        venue,
        "startAt",
        "endAt",
        region,
        "mainCategory",
        "subCategory",
        "imageUrl",
        "sourcePriorityWinner",
        "popularityScore",
        "isEndingSoon",
        "isFree"
      FROM ranked
      WHERE rn = 1
      ORDER BY end_at ASC, id ASC
      LIMIT $${limitIndex} OFFSET $${offsetIndex};
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT DISTINCT COALESCE(content_key, canonical_key, id::text) AS dedupe_key
        FROM canonical_events
        WHERE end_at >= CURRENT_DATE
          AND (main_category != '공연' OR source_priority_winner = 'kopis')
          AND is_ending_soon = true
      ) AS deduped;
    `;

    const [itemsResult, countResult] = await Promise.all([
      pool.query(listQuery, params),
      pool.query(countQuery),
    ]);

    const responsePayload = {
      items: itemsResult.rows,
      pageInfo: {
        page,
        size,
        totalCount: countResult.rows[0]?.total ?? 0,
      },
    };

    // 계측 로그
    logApiMetrics({
      endpoint: 'GET /events/ending',
      ts: requestTs,
      query: req.query as Record<string, unknown>,
      status: 200,
      count: itemsResult.rows.length,
      payloadKB: safeJsonSizeKB(responsePayload),
      elapsedMs: getElapsedMs(startTime),
    });

    res.json(responsePayload);
  } catch (error) {
    console.error('[API] /events/ending failed', error);
    
    // 계측 로그 (에러 경로)
    logApiMetrics({
      endpoint: 'GET /events/ending',
      ts: requestTs,
      query: req.query as Record<string, unknown>,
      status: 500,
      count: null,
      payloadKB: -1,
      elapsedMs: getElapsedMs(startTime),
    });
    
    res.status(500).json({ message: 'Failed to load ending events.' });
  }
});

app.get('/events/new', async (req, res) => {
  const startTime = startTimer();
  const requestTs = nowIso();
  
  try {
    const page = Math.max(parseInt((req.query.page as string) ?? '1', 10) || 1, 1);
    const size = Math.min(Math.max(parseInt((req.query.size as string) ?? '20', 10) || 20, 1), 100);

    const params: unknown[] = [];

    params.push(size);
    const limitIndex = params.length;
    params.push((page - 1) * size);
    const offsetIndex = params.length;

    const listQuery = `
      WITH ranked AS (
        SELECT
          id,
          title,
          display_title AS "displayTitle",
          content_key AS "contentKey",
          COALESCE(venue, '') AS venue,
          start_at AS "startAt",
          end_at AS "endAt",
          region,
          main_category AS "mainCategory",
          sub_category AS "subCategory",
          COALESCE(image_url, '${PLACEHOLDER_IMAGE}') AS "imageUrl",
          source_priority_winner AS "sourcePriorityWinner",
          popularity_score AS "popularityScore",
          is_ending_soon AS "isEndingSoon",
          is_free AS "isFree",
          created_at,
          updated_at,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(content_key, canonical_key, id::text)
            ORDER BY
              CASE
                WHEN image_url IS NOT NULL
                  AND image_url != ''
                  AND image_url NOT LIKE '%placeholder%'
                THEN 1
                ELSE 0
              END DESC,
              updated_at DESC
          ) AS rn
        FROM canonical_events
        WHERE end_at >= CURRENT_DATE
          AND (main_category != '공연' OR source_priority_winner = 'kopis')
      )
      SELECT
        id,
        title,
        "displayTitle",
        "contentKey",
        venue,
        "startAt",
        "endAt",
        region,
        "mainCategory",
        "subCategory",
        "imageUrl",
        "sourcePriorityWinner",
        "popularityScore",
        "isEndingSoon",
        "isFree"
      FROM ranked
      WHERE rn = 1
      ORDER BY created_at DESC, id ASC
      LIMIT $${limitIndex} OFFSET $${offsetIndex};
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT DISTINCT COALESCE(content_key, canonical_key, id::text) AS dedupe_key
        FROM canonical_events
        WHERE end_at >= CURRENT_DATE
          AND (main_category != '공연' OR source_priority_winner = 'kopis')
      ) AS deduped;
    `;

    const [itemsResult, countResult] = await Promise.all([
      pool.query(listQuery, params),
      pool.query(countQuery),
    ]);

    const responsePayload = {
      items: itemsResult.rows,
      pageInfo: {
        page,
        size,
        totalCount: countResult.rows[0]?.total ?? 0,
      },
    };

    // 계측 로그
    logApiMetrics({
      endpoint: 'GET /events/new',
      ts: requestTs,
      query: req.query as Record<string, unknown>,
      status: 200,
      count: itemsResult.rows.length,
      payloadKB: safeJsonSizeKB(responsePayload),
      elapsedMs: getElapsedMs(startTime),
    });

    res.json(responsePayload);
  } catch (error) {
    console.error('[API] /events/new failed', error);
    
    // 계측 로그 (에러 경로)
    logApiMetrics({
      endpoint: 'GET /events/new',
      ts: requestTs,
      query: req.query as Record<string, unknown>,
      status: 500,
      count: null,
      payloadKB: -1,
      elapsedMs: getElapsedMs(startTime),
    });
    
    res.status(500).json({ message: 'Failed to load new events.' });
  }
});

app.get('/events/recommend', async (req, res) => {
  const startTime = startTimer();
  const requestTs = nowIso();
  
  try {
    const page = Math.max(parseInt((req.query.page as string) ?? '1', 10) || 1, 1);
    const size = Math.min(Math.max(parseInt((req.query.size as string) ?? '20', 10) || 20, 1), 100);

    const params: unknown[] = [];

    params.push(size);
    const limitIndex = params.length;
    params.push((page - 1) * size);
    const offsetIndex = params.length;

    const listQuery = `
      WITH ranked AS (
        SELECT
          id,
          title,
          display_title AS "displayTitle",
          content_key AS "contentKey",
          COALESCE(venue, '') AS venue,
          start_at AS "startAt",
          end_at AS "endAt",
          region,
          main_category AS "mainCategory",
          sub_category AS "subCategory",
          COALESCE(image_url, '${PLACEHOLDER_IMAGE}') AS "imageUrl",
          source_priority_winner AS "sourcePriorityWinner",
          popularity_score AS "popularityScore",
          is_ending_soon AS "isEndingSoon",
          is_free AS "isFree",
          is_featured AS "isFeatured",
          created_at,
          updated_at,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(content_key, canonical_key, id::text)
            ORDER BY
              CASE
                WHEN image_url IS NOT NULL
                  AND image_url != ''
                  AND image_url NOT LIKE '%placeholder%'
                THEN 1
                ELSE 0
              END DESC,
              updated_at DESC
          ) AS rn
        FROM canonical_events
        WHERE end_at >= CURRENT_DATE
          AND (main_category != '공연' OR source_priority_winner = 'kopis')
          AND image_url IS NOT NULL
          AND image_url != ''
      )
      SELECT
        id,
        title,
        "displayTitle",
        "contentKey",
        venue,
        "startAt",
        "endAt",
        region,
        "mainCategory",
        "subCategory",
        "imageUrl",
        "sourcePriorityWinner",
        "popularityScore",
        "isEndingSoon",
        "isFree",
        "isFeatured"
      FROM ranked
      WHERE rn = 1
      ORDER BY
        CASE WHEN "isFeatured" THEN 0 ELSE 1 END,
        "popularityScore" DESC NULLS LAST,
        created_at DESC,
        id ASC
      LIMIT $${limitIndex} OFFSET $${offsetIndex};
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT DISTINCT COALESCE(content_key, canonical_key, id::text) AS dedupe_key
        FROM canonical_events
        WHERE end_at >= CURRENT_DATE
          AND (main_category != '공연' OR source_priority_winner = 'kopis')
          AND image_url IS NOT NULL
          AND image_url != ''
      ) AS deduped;
    `;

    const [itemsResult, countResult] = await Promise.all([
      pool.query(listQuery, params),
      pool.query(countQuery),
    ]);

    const responsePayload = {
      items: itemsResult.rows,
      pageInfo: {
        page,
        size,
        totalCount: countResult.rows[0]?.total ?? 0,
      },
    };

    // 계측 로그
    logApiMetrics({
      endpoint: 'GET /events/recommend',
      ts: requestTs,
      query: req.query as Record<string, unknown>,
      status: 200,
      count: itemsResult.rows.length,
      payloadKB: safeJsonSizeKB(responsePayload),
      elapsedMs: getElapsedMs(startTime),
    });

    res.json(responsePayload);
  } catch (error) {
    console.error('[API] /events/recommend failed', error);
    
    // 계측 로그 (에러 경로)
    logApiMetrics({
      endpoint: 'GET /events/recommend',
      ts: requestTs,
      query: req.query as Record<string, unknown>,
      status: 500,
      count: null,
      payloadKB: -1,
      elapsedMs: getElapsedMs(startTime),
    });
    
    res.status(500).json({ message: 'Failed to load recommended events.' });
  }
});

/**
 * GET /events/nearby - 반경 내 이벤트 검색 (거리순 정렬)
 * 
 * Query Parameters:
 * - lat (required): 위도
 * - lng (required): 경도
 * - radius (optional): 반경(미터), default 5000, min 100, max 50000
 * - page (optional): 페이지 번호, default 1
 * - size (optional): 페이지 크기, default 20, max 100
 * - category, subCategory, region: 기존 /events와 동일한 필터
 * 
 * Response:
 * - items: 이벤트 목록 + distanceMeters
 * - pageInfo: { page, size, totalCount }
 */
app.get('/events/nearby', async (req, res) => {
  const startTime = startTimer();
  const requestTs = nowIso();
  
  try {
    // 1. 파라미터 파싱 및 검증
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ message: 'Invalid lat or lng. Both must be valid numbers.' });
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ message: 'lat must be in [-90, 90] and lng in [-180, 180].' });
    }

    // radius: 100m ~ 50km, default 5km
    let radius = parseFloat(req.query.radius as string) || 5000;
    if (isNaN(radius)) radius = 5000;
    radius = Math.max(100, Math.min(50000, radius));

    const page = Math.max(parseInt((req.query.page as string) ?? '1', 10) || 1, 1);
    const size = Math.min(Math.max(parseInt((req.query.size as string) ?? '20', 10) || 20, 1), 100);

    // 기존 필터 (category, subCategory, region)
    const mainCategory = (req.query.category as string) || undefined;
    const subCategory = (req.query.subCategory as string) || undefined;
    const region = (req.query.region as string) || undefined;

    // 2. Bounding Box 계산 (1차 필터링)
    const bbox = calculateBoundingBox(lat, lng, radius);

    // 3. SQL 쿼리 작성
    const filters: string[] = [];
    const params: unknown[] = [];

    // 필수 조건
    filters.push(`end_at >= CURRENT_DATE`);
    filters.push(`(main_category != '공연' OR source_priority_winner = 'kopis')`);
    filters.push(`lat IS NOT NULL`);
    filters.push(`lng IS NOT NULL`);

    // Bounding Box 1차 필터 (인덱스 활용)
    params.push(bbox.latMin);
    filters.push(`lat >= $${params.length}`);
    params.push(bbox.latMax);
    filters.push(`lat <= $${params.length}`);
    params.push(bbox.lngMin);
    filters.push(`lng >= $${params.length}`);
    params.push(bbox.lngMax);
    filters.push(`lng <= $${params.length}`);

    // 카테고리/지역 필터
    if (mainCategory && mainCategory !== '전체') {
      params.push(mainCategory);
      filters.push(`main_category = $${params.length}`);
    }
    if (subCategory && subCategory !== '전체') {
      params.push(subCategory);
      filters.push(`sub_category = $${params.length}`);
    }
    if (region && region !== '전국') {
      params.push(region);
      filters.push(`region = $${params.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    // 사용자 위치 파라미터
    params.push(lat);
    const userLatParamIndex = params.length;
    params.push(lng);
    const userLngParamIndex = params.length;

    // Haversine 거리 계산 SQL
    const distanceSQL = getHaversineDistanceSQL(`$${userLatParamIndex}`, `$${userLngParamIndex}`);

    // radius 파라미터
    params.push(radius);
    const radiusParamIndex = params.length;

    // LIMIT/OFFSET
    params.push(size);
    const limitIndex = params.length;
    params.push((page - 1) * size);
    const offsetIndex = params.length;

    // 메인 쿼리 (서브쿼리로 거리 계산 후 필터링)
    const listQuery = `
      WITH ranked AS (
        SELECT
          id,
          title,
          display_title AS "displayTitle",
          content_key AS "contentKey",
          COALESCE(venue, '') AS venue,
          start_at AS "startAt",
          end_at AS "endAt",
          region,
          main_category AS "mainCategory",
          sub_category AS "subCategory",
          COALESCE(image_url, '${PLACEHOLDER_IMAGE}') AS "imageUrl",
          source_priority_winner AS "sourcePriorityWinner",
          address,
          lat,
          lng,
          ${distanceSQL} AS "distanceMeters",
          updated_at,
          -- Traits 필드 추가
          is_free AS "isFree",
          is_ending_soon AS "isEndingSoon",
          popularity_score AS "popularityScore",
          CASE 
            WHEN end_at IS NOT NULL THEN GREATEST(0, (end_at - CURRENT_DATE)::INTEGER)
            ELSE NULL
          END AS "daysLeft",
          CASE 
            WHEN image_url IS NOT NULL 
              AND image_url != '' 
              AND image_url NOT LIKE '%placeholder%' 
            THEN true 
            ELSE false 
          END AS "hasImage",
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(content_key, canonical_key, id::text)
            ORDER BY
              CASE
                WHEN image_url IS NOT NULL
                  AND image_url != ''
                  AND image_url NOT LIKE '%placeholder%'
                THEN 1
                ELSE 0
              END DESC,
              updated_at DESC
          ) AS rn
        FROM canonical_events
        ${where}
      )
      SELECT
        id,
        title,
        "displayTitle",
        "contentKey",
        venue,
        "startAt",
        "endAt",
        region,
        "mainCategory",
        "subCategory",
        "imageUrl",
        "sourcePriorityWinner",
        address,
        lat,
        lng,
        "distanceMeters",
        -- Traits 필드 포함
        "isFree",
        "isEndingSoon",
        "popularityScore",
        "daysLeft",
        "hasImage"
      FROM ranked
      WHERE rn = 1
        AND "distanceMeters" <= $${radiusParamIndex}
      ORDER BY "distanceMeters" ASC, id ASC
      LIMIT $${limitIndex} OFFSET $${offsetIndex};
    `;

    // COUNT 쿼리 (동일한 WHERE + 거리 조건)
    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT DISTINCT COALESCE(content_key, canonical_key, id::text) AS dedupe_key,
               ${distanceSQL} AS distance
        FROM canonical_events
        ${where}
      ) AS events_with_distance
      WHERE distance <= $${radiusParamIndex};
    `;

    if (process.env.NODE_ENV === 'development') {
      console.log('[API][/events/nearby] params:', { lat, lng, radius, page, size, mainCategory, subCategory, region });
      console.log('[API][/events/nearby] bbox:', bbox);
    }

    const [itemsResult, countResult] = await Promise.all([
      pool.query(listQuery, params),
      pool.query(countQuery, params.slice(0, radiusParamIndex)),
    ]);

    const totalCount = countResult.rows[0]?.total ?? 0;

    if (process.env.NODE_ENV === 'development') {
      console.log('[API][/events/nearby] totalCount:', totalCount, 'returned:', itemsResult.rows.length);
      if (itemsResult.rows.length > 0) {
        console.log('[API][/events/nearby] sample distances (first 3):', 
          itemsResult.rows.slice(0, 3).map((r: any) => Math.round(r.distanceMeters) + 'm')
        );
      }
    }

    const responsePayload = {
      items: itemsResult.rows,
      pageInfo: {
        page,
        size,
        totalCount,
      },
    };

    // 계측 로그
    logApiMetrics({
      endpoint: 'GET /events/nearby',
      ts: requestTs,
      query: req.query as Record<string, unknown>,
      status: 200,
      count: itemsResult.rows.length,
      payloadKB: safeJsonSizeKB(responsePayload),
      elapsedMs: getElapsedMs(startTime),
    });

    res.json(responsePayload);
  } catch (error) {
    console.error('[API] /events/nearby failed', error);
    
    // 계측 로그 (에러 경로)
    logApiMetrics({
      endpoint: 'GET /events/nearby',
      ts: requestTs,
      query: req.query as Record<string, unknown>,
      status: 500,
      count: null,
      payloadKB: -1,
      elapsedMs: getElapsedMs(startTime),
    });
    
    res.status(500).json({ message: 'Failed to load nearby events.' });
  }
});

/**
 * POST /api/ai/generate-banner-copy - Gemini 1.5 Flash 기반 배너 문구 생성
 * 
 * Request Body:
 * - eventTitle: string
 * - eventCategory: string
 * - dongLabel: string
 * - distance: string
 * - explanation: { primaryReason, details, insights }
 * - reasonTags: string[]
 * 
 * Response:
 * - success: boolean
 * - copy?: string
 * - error?: string
 * - metadata?: { model, promptTokens, candidatesTokens, totalTokens }
 */
// ============================================================================
// Traits 우선순위 선택 함수
// ============================================================================
interface EventTraits {
  isFree?: boolean;
  isEndingSoon?: boolean;
  popularityScore?: number;
  daysLeft?: number | null;
  hasImage?: boolean;
}

/**
 * Traits 중 가장 중요한 1-2개를 선택하여 텍스트로 변환
 * 우선순위: 무료 > 마감임박 > 인기 > 정보풍부
 */
function selectTopTraits(
  traits: EventTraits | undefined,
  reasonTags: string[] | undefined
): string[] {
  if (!traits) {
    console.log('[AI][selectTopTraits] No traits provided, returning empty array');
    return [];
  }
  
  console.log('[AI][selectTopTraits] Input:', { traits, reasonTags });
  
  const scores: { trait: string; score: number }[] = [];
  
  // [1] 무료는 항상 최우선 (10점)
  if (traits.isFree === true) {
    scores.push({ trait: '무료', score: 10 });
  }
  
  // [2] 마감 임박 (9점)
  if (traits.isEndingSoon === true || reasonTags?.includes('마감 임박') || reasonTags?.includes('곧 끝나요')) {
    if (traits.daysLeft !== null && traits.daysLeft !== undefined && traits.daysLeft <= 3) {
      if (traits.daysLeft === 0) {
        scores.push({ trait: '오늘 마지막', score: 9 });
      } else if (traits.daysLeft === 1) {
        scores.push({ trait: '내일 마지막', score: 9 });
      } else {
        scores.push({ trait: `${traits.daysLeft}일 남음`, score: 9 });
      }
    } else if (traits.isEndingSoon === true) {
      scores.push({ trait: '곧 끝나요', score: 9 });
    }
  }
  
  // [3] 인기 (인기도 점수 기반, 기준 완화) (7점)
  if (reasonTags?.includes('지금 인기') || reasonTags?.includes('인기 많아요') || reasonTags?.includes('인기')) {
    if (traits.popularityScore && traits.popularityScore > 300) {
      scores.push({ trait: '인기', score: 7 });
    }
  }
  
  // [4] 정보 풍부 (6점) - reasonTags만 있어도 적용
  if (reasonTags?.includes('정보 풍부') || reasonTags?.includes('정보 자세함')) {
    scores.push({ trait: '정보 자세함', score: 6 });
  }
  
  // [5] 가까워요 (5점) - reasonTags에 있으면 적용
  if (reasonTags?.includes('가까워요')) {
    scores.push({ trait: '가까운 곳', score: 5 });
  }
  
  // 상위 2개만 선택
  const topTraits = scores
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(t => t.trait);
  
  console.log('[AI][selectTopTraits] Computed topTraits:', topTraits);
  
  return topTraits;
}

// ============================================================================
// GPT Banner Copy Generation API
// ============================================================================
app.post('/api/ai/generate-banner-copy', async (req, res) => {
  const startTime = startTimer();
  const requestTs = nowIso();
  
  try {
    const { eventTitle, eventCategory, dongLabel, distance, explanation, reasonTags, traits } = req.body;
    
    console.log('[AI] Received request:', {
      eventTitle,
      category: eventCategory,
      reasonTags,
      traits, // ⭐ Traits 수신 로그
    });

    // Traits 우선순위 선택
    const topTraits = selectTopTraits(traits, reasonTags);
    
    // Template fallback 함수 (GPT 실패 시 사용)
    const generateTemplateFallback = (): string => {
      // 위치 정보 제거, 매력 포인트 중심 문구
      if (topTraits.includes('무료')) {
        return `무료로 볼 수 있는 '${eventTitle}' 바로 근처에서 해요!`;
      }
      if (topTraits.includes('오늘 마지막') || topTraits.includes('내일 마지막')) {
        return `'${eventTitle}' ${topTraits[0]}이에요. 놓치지 마세요!`;
      }
      if (topTraits.includes('인기')) {
        return `'${eventTitle}' 지금 엄청 인기예요. 구경해볼까요?`;
      }
      if (reasonTags?.includes('가까워요')) {
        return `바로 근처에서 열리는 '${eventTitle}' 보러 가볼까요?`;
      }
      
      // 기본 fallback
      return `'${eventTitle}' 가까운 곳에서 열리고 있어요!`;
    };

    let finalCopy: string;
    let usedModel: string;
    let gptMetadata: any = null;

    // GPT-4o-mini 시도
    if (config.openaiApiKey) {
      try {
        const openai = new OpenAI({ apiKey: config.openaiApiKey });
        
        console.log('[AI] GPT-4o-mini request:', {
          eventTitle,
          category: eventCategory,
          reasonTags,
          topTraits,
        });

        // confidenceLevel별 톤 매핑
        const getConfidenceTone = (level: string | undefined): string => {
          switch (level) {
            case 'high': return '강력 추천';
            case 'medium': return '추천';
            case 'low': 
            default: return '제안';
          }
        };
        const confidenceTone = getConfidenceTone(explanation?.confidenceLevel);

        const prompt = `다음 이벤트에 대한 추천 문구를 작성하세요:

[이벤트 정보]
- 제목: ${eventTitle}
- 카테고리: ${eventCategory}
- 추천 이유: ${reasonTags?.join(', ') || '일반 추천'}
- 추천 강도: ${confidenceTone}
${topTraits.length > 0 ? `- 특별한 점: ${topTraits.join(', ')}` : ''}

[작성 가이드]
추천 이유를 바탕으로, 사용자가 이 이벤트에 관심을 가질 만한 이유를 자연스럽게 전달하세요.

추천 이유별 표현 예시:
- "가까워요" → "바로 근처에서 열리는 '${eventTitle}' 보러 가볼까요?"
- "인기 많아요" → "'${eventTitle}' 지금 엄청 인기예요. 놓치지 마세요!"
- "곧 끝나요" → "'${eventTitle}' 이번 주말이 마지막이에요. 서둘러 보세요!"
- "정보 풍부" → "'${eventTitle}' 상세 정보 많아서 계획 세우기 좋아요!"

제약 조건:
- 20-40자 길이
- 반말체 (~해요, ~세요)
- 반드시 이벤트명을 따옴표('')로 포함
- 위치/거리 정보 언급 절대 금지
- 1문장으로 완결

추천 문구:`;

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `당신은 문화 이벤트 추천 전문 카피라이터입니다.

핵심 원칙:
1. 사용자가 "왜 이 이벤트를 봐야 하는지" 명확히 전달
2. 위치/거리 정보는 UI가 담당하므로 절대 언급하지 않음
3. 이벤트명은 따옴표('')로 감싸서 반드시 포함
4. 자연스러운 반말체(~해요, ~세요)로 친근하게 작성
5. 행동을 유도하되 강요하지 않음

금지 사항:
- "~m 거리", "~km", "~동", 주소 등 위치 정보 언급 절대 금지
- 단순 사실 나열 금지
- 2문장 이상 금지
- 이벤트명 없이 출력 금지

출력 형식:
- 한 문장 (20-40자)
- 추천 이유가 자연스럽게 녹아든 문장
- 이벤트명이 반드시 포함된 문장`,
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 100,
          top_p: 0.9,
        });

        const gptResponse = completion.choices[0]?.message?.content?.trim();
        
        if (gptResponse && gptResponse.length >= 10) {
          finalCopy = gptResponse;
          usedModel = 'gpt-4o-mini';
          gptMetadata = {
            promptTokens: completion.usage?.prompt_tokens,
            completionTokens: completion.usage?.completion_tokens,
            totalTokens: completion.usage?.total_tokens,
          };
          
          console.log('[AI] GPT-4o-mini success:', {
            copy: finalCopy,
            tokens: gptMetadata.totalTokens,
          });
        } else {
          throw new Error('GPT returned empty response');
        }
      } catch (gptError: any) {
        console.warn('[AI] GPT-4o-mini failed, using template fallback:', {
          error: gptError.message,
        });
        finalCopy = generateTemplateFallback();
        usedModel = 'template-fallback';
      }
    } else {
      console.warn('[AI] OPENAI_API_KEY not set, using template fallback');
      finalCopy = generateTemplateFallback();
      usedModel = 'template-fallback';
    }

    const responsePayload = {
      success: true,
      copy: finalCopy,
      metadata: {
        model: usedModel,
        reasonTags,
        ...(gptMetadata || {}),
      },
    };

    // 계측 로그
    logApiMetrics({
      endpoint: 'POST /ai/generate-banner-copy',
      ts: requestTs,
      query: { eventTitle, category: eventCategory },
      status: 200,
      count: 1,
      payloadKB: safeJsonSizeKB(responsePayload),
      elapsedMs: getElapsedMs(startTime),
    });

    res.json(responsePayload);
  } catch (error: any) {
    console.error('[AI] Banner copy generation failed:', {
      error,
      errorMessage: error?.message,
    });
    
    const errorMessage = error?.message || 'Banner copy generation failed';
    
    // 계측 로그 (에러 경로)
    logApiMetrics({
      endpoint: 'POST /ai/generate-banner-copy',
      ts: requestTs,
      query: req.body,
      status: 500,
      count: null,
      payloadKB: -1,
      elapsedMs: getElapsedMs(startTime),
    });
    
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Reverse Geocoding API (Kakao Local REST API coord2address)
app.get('/geo/reverse', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);

    console.log('[GeoReverse] req', { lat, lng });

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ message: 'Invalid lat or lng' });
    }

    if (!config.kakaoRestApiKey) {
      console.error('[GeoReverse] KAKAO_REST_API_KEY is not set');
      return res.status(500).json({ message: 'Kakao API key is not configured' });
    }

    // Kakao Local REST API coord2address
    const response = await axios.get('https://dapi.kakao.com/v2/local/geo/coord2address.json', {
      params: { x: lng, y: lat },
      headers: {
        Authorization: `KakaoAK ${config.kakaoRestApiKey}`,
      },
    });

    console.log('[GeoReverse] kakao status', response.status);
    console.log('[GeoReverse] kakao full response:', JSON.stringify(response.data, null, 2));

    if (response.data.documents && response.data.documents.length > 0) {
      const address = response.data.documents[0].address;

      // region_2depth_name = 구 (예: 성동구)
      // region_3depth_name = 법정동 (예: 성수동2가)
      const gu = address?.region_2depth_name || '';
      const dongLegal = address?.region_3depth_name || ''; // 법정동
      
      // 법정동 → 행정동 매핑 (Kakao coord2address는 행정동을 제공하지 않음)
      // 서울 주요 지역 매핑 테이블
      const legalToAdminMap: Record<string, string> = {
        // 강남구
        '역삼동': '역삼1동',
        '역삼1동': '역삼1동',
        '역삼2동': '역삼2동',
        '개포동': '개포1동',
        '논현동': '논현1동',
        '논현1동': '논현1동',
        '논현2동': '논현2동',
        '대치동': '대치1동',
        '대치1동': '대치1동',
        '대치2동': '대치2동',
        '대치4동': '대치4동',
        '삼성동': '삼성1동',
        '삼성1동': '삼성1동',
        '삼성2동': '삼성2동',
        '신사동': '신사동',
        '압구정동': '압구정동',
        '청담동': '청담동',
        '도곡동': '도곡1동',
        '도곡1동': '도곡1동',
        '도곡2동': '도곡2동',
        
        // 서초구
        '서초동': '서초1동',
        '서초1동': '서초1동',
        '서초2동': '서초2동',
        '서초3동': '서초3동',
        '서초4동': '서초4동',
        '방배동': '방배1동',
        '방배1동': '방배1동',
        '방배2동': '방배2동',
        '방배3동': '방배3동',
        '방배4동': '방배4동',
        '양재동': '양재1동',
        '양재1동': '양재1동',
        '양재2동': '양재2동',
        '잠원동': '잠원동',
        '반포동': '반포1동',
        '반포1동': '반포1동',
        '반포2동': '반포2동',
        '반포3동': '반포3동',
        '반포4동': '반포4동',
        
        // 송파구
        '잠실동': '잠실3동',
        '잠실3동': '잠실3동',
        '잠실6동': '잠실6동',
        '잠실7동': '잠실7동',
        '송파동': '송파1동',
        '송파1동': '송파1동',
        '송파2동': '송파2동',
        '석촌동': '석촌동',
        '삼전동': '삼전동',
        '가락동': '가락1동',
        '가락1동': '가락1동',
        '가락2동': '가락2동',
        '문정동': '문정1동',
        '문정1동': '문정1동',
        '문정2동': '문정2동',
        '방이동': '방이1동',
        '방이1동': '방이1동',
        '방이2동': '방이2동',
        '오금동': '오금동',
        '풍납동': '풍납1동',
        '풍납1동': '풍납1동',
        '풍납2동': '풍납2동',
        
        // 강동구
        '천호동': '천호1동',
        '천호1동': '천호1동',
        '천호2동': '천호2동',
        '천호3동': '천호3동',
        '성내동': '성내1동',
        '성내1동': '성내1동',
        '성내2동': '성내2동',
        '성내3동': '성내3동',
        '길동': '길동',
        '둔촌동': '둔촌1동',
        '둔촌1동': '둔촌1동',
        '둔촌2동': '둔촌2동',
        '명일동': '명일1동',
        '명일1동': '명일1동',
        '명일2동': '명일2동',
        '고덕동': '고덕1동',
        '고덕1동': '고덕1동',
        '고덕2동': '고덕2동',
        '암사동': '암사1동',
        '암사1동': '암사1동',
        '암사2동': '암사2동',
        '암사3동': '암사3동',
        
        // 성동구
        '성수동1가': '성수1가1동',
        '성수1가1동': '성수1가1동',
        '성수1가2동': '성수1가2동',
        '성수동2가': '성수2가1동',
        '성수2가1동': '성수2가1동',
        '성수2가3동': '성수2가3동',
        '왕십리도선동': '왕십리도선동',
        '왕십리2동': '왕십리2동',
        '행당동': '행당1동',
        '행당1동': '행당1동',
        '행당2동': '행당2동',
        '응봉동': '응봉동',
        '금호동1가': '금호1가동',
        '금호동2가': '금호2·3가동',
        '금호동3가': '금호2·3가동',
        '금호동4가': '금호4가동',
        '옥수동': '옥수동',
        
        // 마포구
        '서교동': '서교동',
        '연남동': '연남동',
        '합정동': '합정동',
        '상수동': '상수동',
        '망원동': '망원1동',
        '망원1동': '망원1동',
        '망원2동': '망원2동',
        '연희동': '연희동',
        '성산동': '성산1동',
        '성산1동': '성산1동',
        '성산2동': '성산2동',
        '상암동': '상암동',
        '대흥동': '대흥동',
        '신수동': '신수동',
        '아현동': '아현동',
        '공덕동': '공덕동',
        '용강동': '용강동',
        '도화동': '도화동',
        '마포동': '마포동',
        '염리동': '염리동',
        
        // 용산구
        '이태원동': '이태원1동',
        '이태원1동': '이태원1동',
        '이태원2동': '이태원2동',
        '한남동': '한남동',
        '이촌동': '이촌1동',
        '이촌1동': '이촌1동',
        '이촌2동': '이촌2동',
        '보광동': '보광동',
        '용산동2가': '용산2가동',
        '용산동3가': '용산2가동',
        '원효로1동': '원효로1동',
        '원효로2동': '원효로2동',
        '효창동': '효창동',
        '청파동': '청파동',
        
        // 종로구
        '삼청동': '삼청동',
        '혜화동': '혜화동',
        '명륜동': '명륜동',
        '청운동': '청운효자동',
        '효자동': '청운효자동',
        '사직동': '사직동',
        '부암동': '부암동',
        '평창동': '평창동',
        '무악동': '무악동',
        '교남동': '교남동',
        '가회동': '가회동',
        '종로1가': '종로1·2·3·4가동',
        '종로2가': '종로1·2·3·4가동',
        '종로3가': '종로1·2·3·4가동',
        '종로4가': '종로1·2·3·4가동',
        '종로5가': '종로5·6가동',
        '종로6가': '종로5·6가동',
        '이화동': '이화동',
        '창신동': '창신1동',
        '창신1동': '창신1동',
        '창신2동': '창신2동',
        '창신3동': '창신3동',
        '숭인동': '숭인1동',
        '숭인1동': '숭인1동',
        '숭인2동': '숭인2동',
        
        // 중구
        '명동': '명동',
        '회현동': '회현동',
        '을지로동': '을지로동',
        '신당동': '신당동',
        '다산동': '다산동',
        '약수동': '약수동',
        '청구동': '청구동',
        '장충동': '장충동',
        '광희동': '광희동',
        '황학동': '황학동',
        '중림동': '중림동',
        
        // 영등포구
        '영등포동': '영등포동',
        '여의도동': '여의도동',
        '당산동': '당산1동',
        '당산1동': '당산1동',
        '당산2동': '당산2동',
        '도림동': '도림동',
        '문래동': '문래동',
        '양평동': '양평1동',
        '양평1동': '양평1동',
        '양평2동': '양평2동',
        '신길동': '신길1동',
        '신길1동': '신길1동',
        '신길3동': '신길3동',
        '신길4동': '신길4동',
        '신길5동': '신길5동',
        '신길6동': '신길6동',
        '신길7동': '신길7동',
        '대림동': '대림1동',
        '대림1동': '대림1동',
        '대림2동': '대림2동',
        '대림3동': '대림3동',
        
        // 동작구
        '노량진동': '노량진1동',
        '노량진1동': '노량진1동',
        '노량진2동': '노량진2동',
        '상도동': '상도1동',
        '상도1동': '상도1동',
        '상도2동': '상도2동',
        '상도3동': '상도3동',
        '상도4동': '상도4동',
        '흑석동': '흑석동',
        '사당동': '사당1동',
        '사당1동': '사당1동',
        '사당2동': '사당2동',
        '사당3동': '사당3동',
        '사당4동': '사당4동',
        '사당5동': '사당5동',
        '대방동': '대방동',
        '신대방동': '신대방1동',
        '신대방1동': '신대방1동',
        '신대방2동': '신대방2동',
        
        // 관악구
        '봉천동': '봉천동',
        '신림동': '신림동',
        
        // 은평구
        '녹번동': '녹번동',
        '불광동': '불광1동',
        '불광1동': '불광1동',
        '불광2동': '불광2동',
        '갈현동': '갈현1동',
        '갈현1동': '갈현1동',
        '갈현2동': '갈현2동',
        '구산동': '구산동',
        '대조동': '대조동',
        '응암동': '응암1동',
        '응암1동': '응암1동',
        '응암2동': '응암2동',
        '응암3동': '응암3동',
        '역촌동': '역촌동',
        // '신사동': '신사1동', // 중복 (강남구에 이미 있음)
        '증산동': '증산동',
        '수색동': '수색동',
        '진관동': '진관동',
      };
      
      // 행정동으로 변환 (매핑 없으면 법정동 그대로)
      const dong = legalToAdminMap[dongLegal] || dongLegal;

      // label: "구 + 동" 형태 (예: "성동구 성수2가1동")
      let label = '';
      if (gu && dong) {
        label = `${gu} ${dong}`;
      } else if (gu) {
        label = gu;
      } else if (address?.region_1depth_name) {
        label = address.region_1depth_name; // 시/도
      } else {
        label = '위치 정보 없음';
      }

      console.log('[GeoReverse] label', label, { dongLegal, dongMapped: dong });

      return res.json({ gu, dong, label });
    } else {
      return res.json({ gu: '', dong: '', label: '위치 정보 없음' });
    }
  } catch (error) {
    console.error('[geo/reverse] Error:', error);
    res.status(500).json({ message: 'Failed to reverse geocode' });
  }
});

// 동적 라우트는 가장 마지막에 정의 (구체적인 라우트들 뒤)
app.get('/events/:id', async (req, res) => {
  const startTime = startTimer();
  const requestTs = nowIso();
  
  try {
    const result = await pool.query(
      `
        SELECT
          id,
          title,
          display_title AS "displayTitle",
          content_key AS "contentKey",
          COALESCE(venue, '') AS venue,
          start_at AS "startAt",
          end_at AS "endAt",
          region,
          main_category AS "mainCategory",
          sub_category AS "subCategory",
          COALESCE(image_url, '${PLACEHOLDER_IMAGE}') AS "imageUrl",
          source_priority_winner AS "sourcePriorityWinner",
          sources,
          address,
          lat,
          lng
        FROM canonical_events
        WHERE id = $1 AND end_at >= CURRENT_DATE
        LIMIT 1;
      `,
      [req.params.id],
    );

    if (!result.rowCount) {
      // 계측 로그 (404)
      logApiMetrics({
        endpoint: 'GET /events/:id',
        ts: requestTs,
        query: { id: req.params.id },
        status: 404,
        count: 0,
        payloadKB: safeJsonSizeKB({ message: 'Event not found' }),
        elapsedMs: getElapsedMs(startTime),
      });
      
      return res.status(404).json({ message: 'Event not found' });
    }

    const responsePayload = result.rows[0];

    // 계측 로그 (200)
    logApiMetrics({
      endpoint: 'GET /events/:id',
      ts: requestTs,
      query: { id: req.params.id },
      status: 200,
      count: 1,
      payloadKB: safeJsonSizeKB(responsePayload),
      elapsedMs: getElapsedMs(startTime),
    });

    res.json(responsePayload);
  } catch (error) {
    console.error('[API] /events/:id failed', error);
    
    // 계측 로그 (에러 경로)
    logApiMetrics({
      endpoint: 'GET /events/:id',
      ts: requestTs,
      query: { id: req.params.id },
      status: 500,
      count: null,
      payloadKB: -1,
      elapsedMs: getElapsedMs(startTime),
    });
    
    res.status(500).json({ message: 'Failed to load event.' });
  }
});

/**
 * POST /events/:id/view - 이벤트 조회 기록
 *
 * Headers:
 * - X-Session-ID (required): 사용자 세션 ID
 *
 * Body:
 * - referrer_screen (optional): 유입 화면 ('home', 'hot', 'nearby', 'explore', 'mypage', 'search')
 */
app.post('/events/:id/view', async (req, res) => {
  const startTime = startTimer();
  const requestTs = nowIso();

  try {
    const eventId = req.params.id;
    const sessionId = req.headers['x-session-id'] as string;
    const { referrer_screen } = req.body;

    // X-Session-ID 필수 체크
    if (!sessionId) {
      logApiMetrics({
        endpoint: 'POST /events/:id/view',
        ts: requestTs,
        query: { id: eventId },
        status: 400,
        count: null,
        payloadKB: -1,
        elapsedMs: getElapsedMs(startTime),
      });

      return res.status(400).json({ message: 'X-Session-ID header is required' });
    }

    // referrer_screen 검증 (선택)
    const allowedReferrers = ['home', 'hot', 'nearby', 'explore', 'mypage', 'search'];
    if (referrer_screen && !allowedReferrers.includes(referrer_screen)) {
      logApiMetrics({
        endpoint: 'POST /events/:id/view',
        ts: requestTs,
        query: { id: eventId, referrer_screen },
        status: 400,
        count: null,
        payloadKB: -1,
        elapsedMs: getElapsedMs(startTime),
      });

      return res.status(400).json({
        message: `Invalid referrer_screen. Must be one of: ${allowedReferrers.join(', ')}`
      });
    }

    // event_views에 INSERT
    await pool.query(
      `INSERT INTO event_views (event_id, user_id, session_id, referrer_screen, viewed_at)
       VALUES ($1, NULL, $2, $3, NOW())`,
      [eventId, sessionId, referrer_screen || null]
    );

    const responsePayload = { success: true };

    logApiMetrics({
      endpoint: 'POST /events/:id/view',
      ts: requestTs,
      query: { id: eventId, referrer_screen },
      status: 200,
      count: 1,
      payloadKB: safeJsonSizeKB(responsePayload),
      elapsedMs: getElapsedMs(startTime),
    });

    res.json(responsePayload);
  } catch (error) {
    console.error('[API] POST /events/:id/view failed', error);

    logApiMetrics({
      endpoint: 'POST /events/:id/view',
      ts: requestTs,
      query: { id: req.params.id },
      status: 500,
      count: null,
      payloadKB: -1,
      elapsedMs: getElapsedMs(startTime),
    });

    res.status(500).json({ message: 'Failed to record view.' });
  }
});

/**
 * POST /events/:id/action - 이벤트 액션 기록
 *
 * Headers:
 * - X-Session-ID (required): 사용자 세션 ID
 *
 * Body:
 * - action_type (required): 액션 타입 ('like', 'share', 'ticket_click')
 */
app.post('/events/:id/action', async (req, res) => {
  const startTime = startTimer();
  const requestTs = nowIso();

  try {
    const eventId = req.params.id;
    const sessionId = req.headers['x-session-id'] as string;
    const { action_type } = req.body;

    // X-Session-ID 필수 체크
    if (!sessionId) {
      logApiMetrics({
        endpoint: 'POST /events/:id/action',
        ts: requestTs,
        query: { id: eventId },
        status: 400,
        count: null,
        payloadKB: -1,
        elapsedMs: getElapsedMs(startTime),
      });

      return res.status(400).json({ message: 'X-Session-ID header is required' });
    }

    // action_type 필수 체크
    if (!action_type) {
      logApiMetrics({
        endpoint: 'POST /events/:id/action',
        ts: requestTs,
        query: { id: eventId },
        status: 400,
        count: null,
        payloadKB: -1,
        elapsedMs: getElapsedMs(startTime),
      });

      return res.status(400).json({ message: 'action_type is required' });
    }

    // action_type 검증
    const allowedActions = ['like', 'share', 'ticket_click'];
    if (!allowedActions.includes(action_type)) {
      logApiMetrics({
        endpoint: 'POST /events/:id/action',
        ts: requestTs,
        query: { id: eventId, action_type },
        status: 400,
        count: null,
        payloadKB: -1,
        elapsedMs: getElapsedMs(startTime),
      });

      return res.status(400).json({
        message: `Invalid action_type. Must be one of: ${allowedActions.join(', ')}`
      });
    }

    // event_actions에 INSERT
    await pool.query(
      `INSERT INTO event_actions (event_id, user_id, session_id, action_type, created_at)
       VALUES ($1, NULL, $2, $3, NOW())`,
      [eventId, sessionId, action_type]
    );

    const responsePayload = { success: true };

    logApiMetrics({
      endpoint: 'POST /events/:id/action',
      ts: requestTs,
      query: { id: eventId, action_type },
      status: 200,
      count: 1,
      payloadKB: safeJsonSizeKB(responsePayload),
      elapsedMs: getElapsedMs(startTime),
    });

    res.json(responsePayload);
  } catch (error) {
    console.error('[API] POST /events/:id/action failed', error);

    logApiMetrics({
      endpoint: 'POST /events/:id/action',
      ts: requestTs,
      query: { id: req.params.id },
      status: 500,
      count: null,
      payloadKB: -1,
      elapsedMs: getElapsedMs(startTime),
    });

    res.status(500).json({ message: 'Failed to record action.' });
  }
});

// ============================================================
// Admin: AI Enrichment
// ============================================================

/**
 * POST /admin/events/enrich-preview
 * 이벤트 생성 전 AI 자동 채우기 (CreateEventPage용)
 */
app.post('/admin/events/enrich-preview', requireAdminAuth, async (req, res) => {
  try {
    const { title, venue, main_category, overview, start_at, end_at } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    console.log('[Admin] [Phase A] AI enrich preview:', { title, venue, start_at, end_at });

    // 연도 정보 추출 (Phase A)
    const startYear = start_at ? dayjs(start_at).year() : dayjs().year();
    const endYear = end_at ? dayjs(end_at).year() : startYear;
    const startMonth = start_at ? dayjs(start_at).month() + 1 : 1;
    const yearTokens = startYear === endYear ? `${startYear}` : `${startYear} ${endYear}`;

    console.log('[Admin] [Phase A] Event years:', { startYear, endYear, yearTokens });

    // Phase 1: 검색 확장 (카테고리별 특화 쿼리 포함)
    const allResults = await searchEventInfoEnhanced(
      title,
      venue || '',
      startYear,
      endYear,
      main_category  // 🆕 카테고리 추가
    );

    if (!allResults || allResults.length === 0) {
      return res.json({
        success: false,
        message: '검색 결과가 없습니다.',
        enriched: null,
      });
    }

    console.log(`[Admin] [Phase A] Total raw results: ${allResults.length}`);

    // Phase 2: 방어 필터링 (hard drop)
    const filtered = filterSearchResults(allResults, [startYear, endYear]);
    console.log(`[Admin] [Phase A] After filtering: ${filtered.length}`);

    // Phase 3: 스코어링 (soft penalty)
    const scored = scoreSearchResults(filtered, {
      title,
      venue: venue || '',
      startYear,
      endYear,
      startMonth,
    });

    // Phase 3.5: 도메인별 제한 (다양성)
    const capped = capResultsByDomain(scored, {
      maxPerDomain: 2,
      maxWeb: 15,
      maxBlog: 6,
      maxPlace: 3,
    });

    // Phase 4: 섹션별 그룹핑
    const sections = groupResultsBySection(capped);
    console.log('[Admin] [Phase A] Sections:', {
      ticket: sections.ticket.length,
      official: sections.official.length,
      place: sections.place.length,
      blog: sections.blog.length,
    });

    // AI용 컨텍스트 생성
    const aiContext = {
      ticket: sections.ticket.map(r => formatResultsForAI([r])),
      official: sections.official.map(r => formatResultsForAI([r])),
      place: sections.place.map(r => formatResultsForAI([r])),
      blog: sections.blog.map(r => formatResultsForAI([r])),
    };

    // Gemini AI 분석 (섹션별 분리)
    let extracted = await extractEventInfoEnhanced(
      title,
      main_category || '행사',
      overview || null,
      yearTokens,
      aiContext
    );

    if (!extracted) {
      return res.json({
        success: false,
        message: 'AI 분석에 실패했습니다.',
        enriched: null,
      });
    }

    // Phase 5: 저장 직전 검증
    extracted = validateExtractedData(extracted, { startYear, endYear });

    // 외부 링크 자동 설정
    const externalLinks = extracted.external_links || {};
    
    // 이벤트 상세 페이지 URL 판별 함수 (메인 페이지가 아닌 구체적인 URL인지 확인)
    const isEventDetailUrl = (url: string): boolean => {
      if (!url) return false;
      const lowerUrl = url.toLowerCase();
      return lowerUrl.includes('/view') || 
             lowerUrl.includes('/detail') || 
             lowerUrl.includes('/event') || 
             lowerUrl.includes('?') || 
             lowerUrl.includes('/post') ||
             lowerUrl.includes('/exhibition') ||
             lowerUrl.includes('/show') ||
             lowerUrl.includes('/prfr') ||
             lowerUrl.includes('instagram.com');
    };
    
    // 1. AI가 추출한 이벤트 상세 URL 우선, 없으면 place 섹션의 첫 번째 링크 사용
    const hasEventDetailUrl = externalLinks.official && isEventDetailUrl(externalLinks.official);
    
    if (hasEventDetailUrl) {
      console.log('[Admin] [Preview] ✅ Using AI extracted event detail URL:', externalLinks.official);
    } else if (sections.place.length > 0) {
      externalLinks.official = sections.place[0].link;
      console.log('[Admin] [Preview] ℹ️ Using Place section link as fallback:', externalLinks.official);
    }
    
    // 2. AI가 이미 섹션별로 분리된 결과에서 추출했으므로, 추가 추출 불필요
    console.log('[Admin] [Preview] External links from AI:', externalLinks);

    // 3. 운영시간 기본값 설정 (AI가 추출하지 못한 경우)
    const hasOpeningHours = extracted.opening_hours && 
      Object.values(extracted.opening_hours).some(val => val !== null && val !== '');
    
    if (!hasOpeningHours) {
      const category = main_category || '행사';
      const defaultHours = getDefaultOpeningHours(category);
      extracted.opening_hours = defaultHours;
      console.log('[Admin] ⚠️ AI did not extract opening_hours, using default for category:', category, defaultHours);
    } else {
      console.log('[Admin] ✅ Opening hours extracted by AI:', extracted.opening_hours);
    }

    // 지오코딩 (주소가 추출된 경우)
    let lat: number | null = null;
    let lng: number | null = null;
    let region: string | null = null;

    if (extracted.address) {
      try {
        console.log('[Admin] Geocoding address:', extracted.address);
        const { geocodeBestEffort } = await import('./lib/geocode');
        const geoResult = await geocodeBestEffort({
          address: extracted.address,
          venue: extracted.venue || venue,
        });

        if (geoResult.lat && geoResult.lng) {
          lat = geoResult.lat;
          lng = geoResult.lng;
          region = geoResult.region;
          console.log('[Admin] Geocoding success:', { lat, lng, region });
        }
      } catch (geoError: any) {
        console.error('[Admin] Geocoding error:', geoError.message);
      }
    }

    // 장소와 주소: 사용자가 입력한 값 우선 (더 정확함)
    const finalVenue = venue || extracted.venue || null;
    const finalAddress = extracted.address || null; // preview는 주소가 보통 없으므로 AI 값 사용
    
    console.log('[Admin] [Preview] 장소/주소 선택:', {
      userInputVenue: venue || 'none',
      aiVenue: extracted.venue || 'none',
      finalVenue: finalVenue || 'none',
      aiAddress: extracted.address || 'none',
      finalAddress: finalAddress || 'none'
    });

    res.json({
      success: true,
      enriched: {
        // 기본 정보
        start_date: extracted.start_date || null,
        end_date: extracted.end_date || null,
        venue: finalVenue,
        address: finalAddress,
        overview: extracted.overview || overview || null,
        
        // 지오코딩 결과
        lat,
        lng,
        region,
        
        // 추가 정보
        derived_tags: extracted.derived_tags || [],
        opening_hours: extracted.opening_hours || null,
        price_min: extracted.price_min ?? null,
        price_max: extracted.price_max ?? null,
        external_links: externalLinks,
      },
    });

  } catch (error: any) {
    console.error('[Admin] AI enrich preview failed:', error);
    res.status(500).json({
      success: false,
      error: 'AI 분석 중 오류가 발생했습니다.',
      message: error.message,
    });
  }
});

/**
 * POST /admin/events/:id/enrich
 * 기존 이벤트 AI 보완 (EventsPage용)
 * 
 * Request Body:
 * - forceFields?: string[] - 강제로 재생성할 필드 목록
 *   - [] (빈 배열): 빈 필드만 채우기 (기본값)
 *   - ['overview', 'derived_tags']: 선택한 필드만 재생성
 *   - ['*']: 모든 필드 강제 재생성
 */
app.post('/admin/events/:id/enrich', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { forceFields = [] } = req.body; // 🆕 forceFields 옵션 추가

    console.log('[Admin] [Enrich] forceFields:', forceFields);

    // 이벤트 조회 (기존 데이터 포함)
    const eventResult = await pool.query(
      `SELECT id, title, main_category, venue, address, overview, 
              external_links, opening_hours, price_min, price_max, 
              start_at, end_at, derived_tags, manually_edited_fields, metadata 
       FROM canonical_events WHERE id = $1`,
      [id]
    );

    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = eventResult.rows[0];
    
    // 🆕 Helper: 필드가 강제 재생성 대상인지 확인
    const shouldForce = (fieldName: string): boolean => {
      if (forceFields.includes('*')) return true;
      if (forceFields.includes(fieldName)) return true;
      return false;
    };
    console.log('[Admin] [Phase A] AI enrich event:', { 
      id, 
      title: event.title,
      hasExistingLinks: !!event.external_links,
      hasExistingHours: !!event.opening_hours,
      start_at: event.start_at,
      end_at: event.end_at
    });

    // 연도 정보 추출 (Phase A)
    const startYear = event.start_at ? dayjs(event.start_at).year() : dayjs().year();
    const endYear = event.end_at ? dayjs(event.end_at).year() : startYear;
    const startMonth = event.start_at ? dayjs(event.start_at).month() + 1 : 1;
    const yearTokens = startYear === endYear ? `${startYear}` : `${startYear} ${endYear}`;

    console.log('[Admin] [Phase A] Event years:', { startYear, endYear, yearTokens });

    // Phase 1: 검색 확장 (카테고리별 특화 쿼리 포함)
    const allResults = await searchEventInfoEnhanced(
      event.title,
      event.venue || '',
      startYear,
      endYear,
      event.main_category  // 🆕 카테고리 추가
    );

    if (!allResults || allResults.length === 0) {
      return res.json({
        success: false,
        message: '검색 결과가 없습니다.',
        enriched: null,
      });
    }

    console.log(`[Admin] [Phase A] Total raw results: ${allResults.length}`);

    // Phase 2: 방어 필터링 (hard drop)
    const filtered = filterSearchResults(allResults, [startYear, endYear]);
    console.log(`[Admin] [Phase A] After filtering: ${filtered.length}`);

    // Phase 3: 스코어링 (soft penalty)
    const scored = scoreSearchResults(filtered, {
      title: event.title,
      venue: event.venue || '',
      startYear,
      endYear,
      startMonth,
    });

    // Phase 3.5: 도메인별 제한 (다양성)
    const capped = capResultsByDomain(scored, {
      maxPerDomain: 2,
      maxWeb: 15,
      maxBlog: 6,
      maxPlace: 3,
    });

    // Phase 4: 섹션별 그룹핑
    const sections = groupResultsBySection(capped);
    console.log('[Admin] [Phase A] Sections:', {
      ticket: sections.ticket.length,
      official: sections.official.length,
      place: sections.place.length,
      blog: sections.blog.length,
    });

    // AI용 컨텍스트 생성
    const aiContext = {
      ticket: sections.ticket.map(r => formatResultsForAI([r])),
      official: sections.official.map(r => formatResultsForAI([r])),
      place: sections.place.map(r => formatResultsForAI([r])),
      blog: sections.blog.map(r => formatResultsForAI([r])),
    };

    // Gemini AI 분석 (섹션별 분리)
    let extracted = await extractEventInfoEnhanced(
      event.title,
      event.main_category,
      event.overview,
      yearTokens,
      aiContext
    );

    if (!extracted) {
      return res.json({
        success: false,
        message: 'AI 분석에 실패했습니다.',
        enriched: null,
      });
    }
    
    // 🆕 디버깅: AI 추출 결과 확인
    console.log('[Admin] [Enrich] AI Extracted Data:', {
      category: event.main_category,
      hasExhibitionDisplay: !!(extracted as any).exhibition_display,
      hasPerformanceDisplay: !!(extracted as any).performance_display,
      exhibitionData: (extracted as any).exhibition_display,
      performanceData: (extracted as any).performance_display,
    });

    // Phase 5: 저장 직전 검증
    extracted = validateExtractedData(extracted, { startYear, endYear });

    // ⭐ AI 보완 정책: forceFields에 따라 조건부 재생성
    console.log('[Admin] [Enrich] 기존 데이터 체크:', {
      hasStartDate: !!event.start_at,
      startAtValue: event.start_at,
      startAtType: typeof event.start_at,
      hasEndDate: !!event.end_at,
      endAtValue: event.end_at,
      endAtType: typeof event.end_at,
      hasVenue: !!(event.venue && event.venue.trim()),
      venueValue: event.venue,
      hasAddress: !!(event.address && event.address.trim()),
      addressValue: event.address,
      hasOverview: !!(event.overview && event.overview.trim()),
      overviewLength: event.overview?.length || 0,
      hasOpeningHours: !!event.opening_hours && Object.keys(event.opening_hours).length > 0,
      hasPrice: event.price_min !== null || event.price_max !== null,
      hasLinks: !!event.external_links && Object.keys(event.external_links).length > 0,
      hasTags: !!event.derived_tags && event.derived_tags.length > 0,
      forceFields
    });
    
    // 1. 외부 링크: forceFields 또는 빈 값일 때만 AI 사용
    const existingLinks = event.external_links || {};
    const aiLinks = extracted.external_links || {};
    
    const externalLinks: any = {
      official: (shouldForce('external_links') || !existingLinks.official) ? (aiLinks.official || existingLinks.official || null) : existingLinks.official,
      ticket: (shouldForce('external_links') || !existingLinks.ticket) ? (aiLinks.ticket || existingLinks.ticket || null) : existingLinks.ticket,
      reservation: (shouldForce('external_links') || !existingLinks.reservation) ? (aiLinks.reservation || existingLinks.reservation || null) : existingLinks.reservation,
      instagram: (shouldForce('external_links') || !(existingLinks as any).instagram) ? ((aiLinks as any).instagram || (existingLinks as any).instagram || null) : (existingLinks as any).instagram
    };
    
    // Place 섹션에서 official 링크가 없을 때만 추가
    if (!externalLinks.official && sections.place.length > 0) {
      externalLinks.official = sections.place[0].link;
      console.log('[Admin] [Enrich] Place 링크를 official로 사용:', externalLinks.official);
    }
    
    // 2. 운영시간: forceFields 또는 빈 값일 때만 AI 사용
    let finalOpeningHours = null;
    const hasExistingHours = event.opening_hours && Object.keys(event.opening_hours).length > 0;
    const hasAIHours = extracted.opening_hours && 
      Object.values(extracted.opening_hours).some(val => val !== null && val !== '');
    
    if (shouldForce('opening_hours')) {
      // 강제 재생성: AI 값 우선
      if (hasAIHours) {
        finalOpeningHours = extracted.opening_hours;
        console.log('[Admin] [Enrich] 🔧 강제 재생성: AI 운영시간 사용');
      } else {
        const category = event.main_category || '행사';
        finalOpeningHours = getDefaultOpeningHours(category);
        console.log('[Admin] [Enrich] 🔧 강제 재생성: 기본 운영시간 사용 (카테고리:', category + ')');
      }
    } else if (hasExistingHours) {
      finalOpeningHours = event.opening_hours;
      console.log('[Admin] [Enrich] ✅ 기존 운영시간 유지');
    } else if (hasAIHours) {
      finalOpeningHours = extracted.opening_hours;
      console.log('[Admin] [Enrich] ✅ AI 운영시간 사용');
    } else {
      const category = event.main_category || '행사';
      finalOpeningHours = getDefaultOpeningHours(category);
      console.log('[Admin] [Enrich] ⚠️ 기본 운영시간 사용 (카테고리:', category + ')');
    }

    // 3. 지오코딩: 주소가 없고 AI가 추출한 경우만
    let lat: number | null = null;
    let lng: number | null = null;
    let region: string | null = null;

    if (!event.address && extracted.address) {
      try {
        console.log('[Admin] [Enrich] 지오코딩 시작:', extracted.address);
        const { geocodeBestEffort } = await import('./lib/geocode');
        const geoResult = await geocodeBestEffort({
          address: extracted.address,
          venue: extracted.venue || event.venue,
        });

        if (geoResult.lat && geoResult.lng) {
          lat = geoResult.lat;
          lng = geoResult.lng;
          region = geoResult.region;
          console.log('[Admin] [Enrich] ✅ 지오코딩 성공:', { lat, lng, region });
        }
      } catch (geoError: any) {
        console.error('[Admin] [Enrich] ❌ 지오코딩 실패:', geoError.message);
      }
    }

    // 4. 가격: forceFields 또는 빈 값일 때만 AI 사용
    const finalPriceMin = (shouldForce('price_min') || event.price_min === null) 
      ? (extracted.price_min ?? event.price_min ?? null) 
      : event.price_min;
    const finalPriceMax = (shouldForce('price_max') || event.price_max === null) 
      ? (extracted.price_max ?? event.price_max ?? null) 
      : event.price_max;
    
    // 5. 개요: forceFields 또는 빈 값일 때만 AI 사용
    const finalOverview = (shouldForce('overview') || !event.overview) 
      ? (extracted.overview || event.overview || null) 
      : event.overview;
    
    // 6. 태그: forceFields 또는 빈 값일 때만 AI 사용
    const finalTags = (shouldForce('derived_tags') || !event.derived_tags || event.derived_tags.length === 0) 
      ? (extracted.derived_tags || event.derived_tags || []) 
      : event.derived_tags;
    
    console.log('[Admin] [Enrich] 최종 선택:', {
      overview: finalOverview ? `${finalOverview.substring(0, 50)}...` : 'none',
      priceRange: `${finalPriceMin}-${finalPriceMax}`,
      tagCount: finalTags.length,
      hasOpeningHours: !!finalOpeningHours,
      hasLinks: Object.values(externalLinks).some(v => !!v),
      forcedFields: forceFields
    });
    
    // 장소와 주소: forceFields 또는 빈 값일 때만 AI 사용
    const finalVenue = (shouldForce('venue') || !event.venue) 
      ? (extracted.venue || event.venue || null) 
      : event.venue;
    const finalAddress = (shouldForce('address') || !event.address) 
      ? (extracted.address || event.address || null) 
      : event.address;
    
    console.log('[Admin] [Enrich] 장소/주소 선택:', {
      existingVenue: event.venue || 'none',
      aiVenue: extracted.venue || 'none',
      finalVenue: finalVenue || 'none',
      existingAddress: event.address || 'none',
      aiAddress: extracted.address || 'none',
      finalAddress: finalAddress || 'none'
    });

    // 🆕 Phase 2: AI 제안 시스템 - 제안 생성
    const { buildSuggestionsFromAI, buildSuggestionsFromPlace } = await import('./lib/suggestionBuilder');
    
    const aiSuggestions = buildSuggestionsFromAI(extracted, {
      hasSearchResults: allResults.length > 0,
      searchResultCount: allResults.length,
      category: event.main_category,
      currentEvent: event, // 🆕 현재 이벤트 데이터 전달 (빈 필드만 제안하도록)
      forceFields, // 🆕 선택한 필드만 제안하도록
    });

    // Place 섹션에서 추가 제안 (선택한 필드에 external_links가 포함된 경우만)
    if (sections.place.length > 0 && (forceFields.length === 0 || forceFields.some((f: string) => f.startsWith('external_links')))) {
      const placeSuggestions = buildSuggestionsFromPlace(sections.place, existingLinks);
      Object.assign(aiSuggestions, placeSuggestions);
    }

    console.log('[Admin] [Enrich] Generated suggestions:', Object.keys(aiSuggestions).length);

    // DB에 ai_suggestions 저장
    await pool.query(`
      UPDATE canonical_events
      SET ai_suggestions = $1,
          updated_at = NOW()
      WHERE id = $2
    `, [JSON.stringify(aiSuggestions), id]);

    console.log('[Admin] [Enrich] ✅ AI suggestions saved to DB');

    res.json({
      success: true,
      message: `${Object.keys(aiSuggestions).length}개의 AI 제안이 생성되었습니다. 적용할 제안을 선택하세요.`,
      suggestions: aiSuggestions,
    });

  } catch (error: any) {
    console.error('[Admin] AI enrich event failed:', error);
    res.status(500).json({
      success: false,
      error: 'AI 분석 중 오류가 발생했습니다.',
      message: error.message,
    });
  }
});

/**
 * POST /admin/events/:id/enrich-ai-direct
 * AI만으로 빈 필드 보완 (네이버 API 없이, AI 직접 검색)
 * 
 * Request Body:
 * - selectedFields?: string[] - 보완할 필드 목록
 */
app.post('/admin/events/:id/enrich-ai-direct', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { selectedFields = [] } = req.body;

    console.log('[Admin] [AI-Direct] Enriching event:', { id, selectedFields });

    // 이벤트 조회
    const eventResult = await pool.query(
      `SELECT id, title, main_category, venue, address, overview, 
              external_links, opening_hours, price_min, price_max, 
              start_at, end_at, derived_tags, metadata 
       FROM canonical_events WHERE id = $1`,
      [id]
    );

    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = eventResult.rows[0];

    // Gemini API 호출 (Google Search Grounding 사용)
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }

    const today = new Date().toISOString().split('T')[0];
    
    // 필드별 프롬프트 생성
    const fieldPrompts: Record<string, string> = {
      'metadata.display.popup.photo_zone': '포토존 유무 및 상세 설명',
      'metadata.display.popup.waiting_time': '대기시간 수준 (주말/평일)',
      'opening_hours': '운영시간 상세 정보',
      'metadata.display.popup.parking': '주차 정보',
      'metadata.display.popup.reservation': '예약 필요 여부',
      'metadata.display.popup.fnb_items': 'F&B 메뉴 정보',
      'metadata.display.exhibition.artists': '작가/아티스트',
      'metadata.display.performance.cast': '출연진',
    };

    const requestedFields = selectedFields.length > 0 
      ? selectedFields.map((f: string) => fieldPrompts[f] || f).join(', ')
      : '포토존, 대기시간, 운영시간, 주차, 예약';

    const prompt = `당신은 한국 이벤트 정보 전문가입니다. 오늘은 ${today}입니다.

**이벤트 정보:**
- 제목: ${event.title}
- 장소: ${event.venue || '미정'}
- 카테고리: ${event.main_category}
- 기간: ${event.start_at?.toISOString().split('T')[0]} ~ ${event.end_at?.toISOString().split('T')[0]}

**필요한 정보:**
${requestedFields}

**검색 소스 (반드시 우선 확인!):**
1. 팝가(popga.com) - "${event.title}" 검색
2. 데이포유(dayforyou.co.kr) - "${event.title}" 검색  
3. 네이버 블로그 - "${event.title} 후기" (최신순)
4. 공식 홈페이지/SNS

**출력 형식 (JSON):**
\`\`\`json
{
  "photo_zone": {
    "available": true,
    "description": "포토존 상세 설명",
    "tips": "방문 팁"
  },
  "waiting_time": {
    "weekday": "대기 없음",
    "weekend": "평균 10-15분",
    "peak_hours": "주말 오후 2-5시",
    "tips": "평일 오전 추천"
  },
  "opening_hours": {
    "weekday": "10:30 - 22:00",
    "weekend": "10:30 - 22:00",
    "break_time": "없음",
    "last_entry": "21:30"
  },
  "parking": "주차 가능 (유료, 시간당 3,000원)",
  "reservation": "예약 불필요 (현장 입장)",
  "fnb_items": {
    "signature_menu": "소금빵, 크루아상",
    "price_range": "3,000원 ~ 8,000원"
  },
  "sources": [
    "https://popga.com/...",
    "https://blog.naver.com/..."
  ]
}
\`\`\`

⚠️ **중요:**
- 정보를 찾을 수 없으면 해당 필드는 null 반환
- 추측 금지! 실제 찾은 정보만
- 출처 URL 필수
- 날짜는 ${event.start_at?.toISOString().split('T')[0]} ~ ${event.end_at?.toISOString().split('T')[0]} 기준
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{ text: prompt }]
          }],
          tools: [{
            google_search: {}
          }],
          generationConfig: {
            temperature: 0.2,
          }
        })
      }
    );

    if (!response.ok) {
      const errorDetails = await response.json();
      console.error('[AI-Direct] Gemini API error:', errorDetails);
      return res.status(500).json({ error: 'Gemini API error', details: errorDetails });
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      return res.json({
        success: false,
        message: 'AI가 정보를 찾지 못했습니다.',
      });
    }

    // JSON 추출
    let jsonMatch = content.match(/```json\s*\n?([\s\S]*?)\n?```/);
    if (!jsonMatch) {
      jsonMatch = content.match(/\{[\s\S]*\}/);
    }

    if (!jsonMatch) {
      console.warn('[AI-Direct] No JSON found in response');
      return res.json({
        success: false,
        message: 'AI 응답을 파싱할 수 없습니다.',
      });
    }

    const jsonText = jsonMatch[1] || jsonMatch[0];
    const aiData = JSON.parse(jsonText);

    console.log('[AI-Direct] AI extracted data:', Object.keys(aiData));

    // metadata 업데이트
    const currentMetadata = event.metadata || {};
    if (!currentMetadata.display) currentMetadata.display = {};
    if (!currentMetadata.display.popup) currentMetadata.display.popup = {};

    // AI 데이터 병합
    if (aiData.photo_zone) currentMetadata.display.popup.photo_zone = aiData.photo_zone;
    if (aiData.waiting_time) currentMetadata.display.popup.waiting_time = aiData.waiting_time;
    if (aiData.parking) currentMetadata.display.popup.parking = aiData.parking;
    if (aiData.reservation) currentMetadata.display.popup.reservation = aiData.reservation;
    if (aiData.fnb_items) currentMetadata.display.popup.fnb_items = aiData.fnb_items;

    // opening_hours 업데이트
    let updatedOpeningHours = event.opening_hours || {};
    if (aiData.opening_hours) {
      updatedOpeningHours = { ...updatedOpeningHours, ...aiData.opening_hours };
    }

    // DB 업데이트
    await pool.query(`
      UPDATE canonical_events
      SET metadata = $1,
          opening_hours = $2,
          updated_at = NOW()
      WHERE id = $3
    `, [JSON.stringify(currentMetadata), JSON.stringify(updatedOpeningHours), id]);

    console.log('[AI-Direct] ✅ Event enriched successfully');

    // 채워진 필드 목록
    const filledFields: string[] = [];
    if (aiData.photo_zone) filledFields.push('포토존');
    if (aiData.waiting_time) filledFields.push('대기시간');
    if (aiData.opening_hours) filledFields.push('운영시간');
    if (aiData.parking) filledFields.push('주차');
    if (aiData.reservation) filledFields.push('예약');
    if (aiData.fnb_items) filledFields.push('메뉴');

    res.json({
      success: true,
      message: `✅ AI가 ${filledFields.length}개 필드를 채웠습니다: ${filledFields.join(', ')}`,
      enriched: aiData,
      sources: aiData.sources || [],
    });

  } catch (error: any) {
    console.error('[AI-Direct] Error:', error);
    res.status(500).json({
      success: false,
      error: 'AI 분석 중 오류가 발생했습니다.',
      message: error.message,
    });
  }
});

/**
 * POST /admin/events/:id/apply-suggestion
 * AI 제안을 실제 필드에 적용
 */
app.post('/admin/events/:id/apply-suggestion', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { fieldName } = req.body;

    if (!fieldName) {
      return res.status(400).json({ error: 'fieldName is required' });
    }

    console.log('[Admin] [Apply Suggestion]:', { eventId: id, fieldName });

    // 이벤트 조회
    const eventResult = await pool.query(
      `SELECT id, ai_suggestions, manually_edited_fields, field_sources, metadata, external_links
       FROM canonical_events WHERE id = $1`,
      [id]
    );

    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = eventResult.rows[0];
    const aiSuggestions = event.ai_suggestions || {};
    const suggestion = aiSuggestions[fieldName];

    if (!suggestion) {
      return res.status(404).json({ error: `No suggestion found for field: ${fieldName}` });
    }

    console.log('[Admin] [Apply Suggestion] Found:', {
      fieldName,
      value: typeof suggestion.value === 'string' 
        ? suggestion.value.substring(0, 100) + '...' 
        : suggestion.value,
      confidence: suggestion.confidence,
      source: suggestion.source,
    });

    // 필드 적용 로직
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // 1. 실제 필드에 값 적용
    if (fieldName === 'overview' || fieldName === 'overview_raw') {
      updates.push(`${fieldName} = $${paramIndex++}`);
      params.push(suggestion.value);
    } else if (fieldName === 'start_at' || fieldName === 'end_at') {
      updates.push(`${fieldName} = $${paramIndex++}`);
      params.push(suggestion.value);
    } else if (fieldName === 'venue' || fieldName === 'address') {
      updates.push(`${fieldName} = $${paramIndex++}`);
      params.push(suggestion.value);
    } else if (fieldName === 'price_min' || fieldName === 'price_max') {
      updates.push(`${fieldName} = $${paramIndex++}`);
      params.push(suggestion.value);
    } else if (fieldName === 'derived_tags') {
      updates.push(`derived_tags = $${paramIndex++}`);
      params.push(JSON.stringify(suggestion.value));
    } else if (fieldName === 'opening_hours') {
      updates.push(`opening_hours = $${paramIndex++}`);
      params.push(JSON.stringify(suggestion.value));
    } else if (fieldName.startsWith('external_links.')) {
      // external_links.official, external_links.ticket 등
      const linkType = fieldName.split('.')[1];
      const currentLinks = event.external_links || {};
      currentLinks[linkType] = suggestion.value;
      updates.push(`external_links = $${paramIndex++}`);
      params.push(JSON.stringify(currentLinks));
    } else if (fieldName === 'metadata.display.exhibition') {
      // 전시 특화 필드
      const currentMetadata = event.metadata || {};
      if (!currentMetadata.display) currentMetadata.display = {};
      currentMetadata.display.exhibition = suggestion.value;
      updates.push(`metadata = $${paramIndex++}`);
      params.push(JSON.stringify(currentMetadata));
    } else if (fieldName === 'metadata.display.performance') {
      // 공연 특화 필드
      const currentMetadata = event.metadata || {};
      if (!currentMetadata.display) currentMetadata.display = {};
      currentMetadata.display.performance = suggestion.value;
      updates.push(`metadata = $${paramIndex++}`);
      params.push(JSON.stringify(currentMetadata));
    } else if (fieldName.startsWith('metadata.display.exhibition.')) {
      // 전시 세부 필드 (예: metadata.display.exhibition.artists)
      const subField = fieldName.split('.').slice(3).join('.');
      const currentMetadata = event.metadata || {};
      if (!currentMetadata.display) currentMetadata.display = {};
      if (!currentMetadata.display.exhibition) currentMetadata.display.exhibition = {};
      currentMetadata.display.exhibition[subField] = suggestion.value;
      updates.push(`metadata = $${paramIndex++}`);
      params.push(JSON.stringify(currentMetadata));
    } else if (fieldName.startsWith('metadata.display.performance.')) {
      // 공연 세부 필드 (예: metadata.display.performance.cast)
      const subField = fieldName.split('.').slice(3).join('.');
      const currentMetadata = event.metadata || {};
      if (!currentMetadata.display) currentMetadata.display = {};
      if (!currentMetadata.display.performance) currentMetadata.display.performance = {};
      currentMetadata.display.performance[subField] = suggestion.value;
      updates.push(`metadata = $${paramIndex++}`);
      params.push(JSON.stringify(currentMetadata));
    } else if (fieldName === 'metadata.display.festival') {
      // 축제 특화 필드 (전체)
      const currentMetadata = event.metadata || {};
      if (!currentMetadata.display) currentMetadata.display = {};
      currentMetadata.display.festival = suggestion.value;
      updates.push(`metadata = $${paramIndex++}`);
      params.push(JSON.stringify(currentMetadata));
    } else if (fieldName.startsWith('metadata.display.festival.')) {
      // 축제 세부 필드 (예: metadata.display.festival.organizer)
      const subField = fieldName.split('.').slice(3).join('.');
      const currentMetadata = event.metadata || {};
      if (!currentMetadata.display) currentMetadata.display = {};
      if (!currentMetadata.display.festival) currentMetadata.display.festival = {};
      currentMetadata.display.festival[subField] = suggestion.value;
      updates.push(`metadata = $${paramIndex++}`);
      params.push(JSON.stringify(currentMetadata));
    } else if (fieldName === 'metadata.display.event') {
      // 행사 특화 필드 (전체)
      const currentMetadata = event.metadata || {};
      if (!currentMetadata.display) currentMetadata.display = {};
      currentMetadata.display.event = suggestion.value;
      updates.push(`metadata = $${paramIndex++}`);
      params.push(JSON.stringify(currentMetadata));
    } else if (fieldName.startsWith('metadata.display.event.')) {
      // 행사 세부 필드 (예: metadata.display.event.target_audience)
      const subField = fieldName.split('.').slice(3).join('.');
      const currentMetadata = event.metadata || {};
      if (!currentMetadata.display) currentMetadata.display = {};
      if (!currentMetadata.display.event) currentMetadata.display.event = {};
      currentMetadata.display.event[subField] = suggestion.value;
      updates.push(`metadata = $${paramIndex++}`);
      params.push(JSON.stringify(currentMetadata));
    } else if (fieldName === 'metadata.display.popup') {
      // 팝업 특화 필드 (전체)
      const currentMetadata = event.metadata || {};
      if (!currentMetadata.display) currentMetadata.display = {};
      currentMetadata.display.popup = suggestion.value;
      updates.push(`metadata = $${paramIndex++}`);
      params.push(JSON.stringify(currentMetadata));
    } else if (fieldName.startsWith('metadata.display.popup.')) {
      // 팝업 세부 필드 (예: metadata.display.popup.brands)
      const subField = fieldName.split('.').slice(3).join('.');
      const currentMetadata = event.metadata || {};
      if (!currentMetadata.display) currentMetadata.display = {};
      if (!currentMetadata.display.popup) currentMetadata.display.popup = {};
      currentMetadata.display.popup[subField] = suggestion.value;
      updates.push(`metadata = $${paramIndex++}`);
      params.push(JSON.stringify(currentMetadata));
    } else {
      return res.status(400).json({ error: `Unsupported field: ${fieldName}` });
    }

    // 2. ai_suggestions에서 해당 제안 제거
    delete aiSuggestions[fieldName];
    updates.push(`ai_suggestions = $${paramIndex++}`);
    params.push(JSON.stringify(aiSuggestions));

    // 3. field_sources 업데이트 (출처 기록)
    const fieldSources = event.field_sources || {};
    fieldSources[fieldName] = {
      source: suggestion.source,
      sourceDetail: suggestion.sourceDetail,
      confidence: suggestion.confidence,
      updatedAt: new Date().toISOString(),
    };
    updates.push(`field_sources = $${paramIndex++}`);
    params.push(JSON.stringify(fieldSources));

    // 5. manually_edited_fields에서 해당 필드 제거 (AI 제안을 적용했으므로 수동 편집 아님)
    const manuallyEditedFields = event.manually_edited_fields || {};
    delete manuallyEditedFields[fieldName];
    updates.push(`manually_edited_fields = $${paramIndex++}`);
    params.push(JSON.stringify(manuallyEditedFields));

    // 6. updated_at
    updates.push(`updated_at = NOW()`);

    // 7. DB 업데이트
    params.push(id);
    const updateQuery = `
      UPDATE canonical_events
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *, 
                to_char(start_at, 'YYYY-MM-DD') as start_at_str,
                to_char(end_at, 'YYYY-MM-DD') as end_at_str
    `;

    const result = await pool.query(updateQuery, params);

    console.log('[Admin] [Apply Suggestion] ✅ Applied successfully');

    // 날짜 필드를 PostgreSQL에서 직접 포맷한 문자열로 대체 (타임존 문제 방지)
    const updatedEvent = result.rows[0];
    updatedEvent.start_at = updatedEvent.start_at_str;
    updatedEvent.end_at = updatedEvent.end_at_str;
    delete updatedEvent.start_at_str;
    delete updatedEvent.end_at_str;

    res.json({
      success: true,
      message: `제안이 적용되었습니다: ${fieldName}`,
      event: updatedEvent,
      remainingSuggestions: Object.keys(aiSuggestions).length,
    });

  } catch (error: any) {
    console.error('[Admin] [Apply Suggestion] ❌ Failed:', error);
    res.status(500).json({
      success: false,
      error: '제안 적용 중 오류가 발생했습니다.',
      message: error.message,
    });
  }
});

/**
 * POST /admin/events/:id/dismiss-suggestion
 * AI 제안 무시 (삭제)
 */
app.post('/admin/events/:id/dismiss-suggestion', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { fieldName } = req.body;

    if (!fieldName) {
      return res.status(400).json({ error: 'fieldName is required' });
    }

    console.log('[Admin] [Dismiss Suggestion]:', { eventId: id, fieldName });

    // 이벤트 조회
    const eventResult = await pool.query(
      `SELECT id, ai_suggestions FROM canonical_events WHERE id = $1`,
      [id]
    );

    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = eventResult.rows[0];
    const aiSuggestions = event.ai_suggestions || {};

    if (!aiSuggestions[fieldName]) {
      return res.status(404).json({ error: `No suggestion found for field: ${fieldName}` });
    }

    // ai_suggestions에서 해당 제안 제거
    delete aiSuggestions[fieldName];

    await pool.query(
      `UPDATE canonical_events
       SET ai_suggestions = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(aiSuggestions), id]
    );

    console.log('[Admin] [Dismiss Suggestion] ✅ Dismissed successfully');

    res.json({
      success: true,
      message: `제안이 무시되었습니다: ${fieldName}`,
      remainingSuggestions: Object.keys(aiSuggestions).length,
    });

  } catch (error: any) {
    console.error('[Admin] [Dismiss Suggestion] ❌ Failed:', error);
    res.status(500).json({
      success: false,
      error: '제안 무시 중 오류가 발생했습니다.',
      message: error.message,
    });
  }
});

// ============================================
// Admin Hot Suggestions (신규 이벤트 후보 관리)
// ============================================

/**
 * GET /admin/hot-suggestions
 * Hot Discovery로 발굴된 이벤트 후보 목록 조회
 */
app.get('/admin/hot-suggestions', requireAdminAuth, async (req, res) => {
  console.log('[DEBUG] [HotSuggestions] Route handler called');
  console.log('[DEBUG] [HotSuggestions] Query params:', req.query);
  console.log('[DEBUG] [HotSuggestions] Headers:', req.headers);

  try {
    const { status = 'pending' } = req.query;
    console.log('[DEBUG] [HotSuggestions] Status filter:', status);

    console.log('[DEBUG] [HotSuggestions] Executing query...');
    const result = await pool.query(
      `SELECT
        id, title, venue, region, link, description,
        source, postdate, candidate_score, status,
        created_at, reviewed_at, reviewed_by
       FROM admin_hot_suggestions
       WHERE status = $1
       ORDER BY candidate_score DESC, created_at DESC
       LIMIT 100`,
      [status]
    );

    console.log(`[DEBUG] [HotSuggestions] Query completed. Row count: ${result.rowCount}`);
    console.log(`[Admin] [HotSuggestions] Retrieved ${result.rowCount} suggestions (status=${status})`);

    console.log('[DEBUG] [HotSuggestions] Sending JSON response...');
    const responseData = {
      success: true,
      total: result.rowCount,
      items: result.rows,
    };

    console.log('[DEBUG] [HotSuggestions] Response data:', {
      success: responseData.success,
      total: responseData.total,
      itemsCount: responseData.items.length,
    });

    res.json(responseData);
    console.log('[DEBUG] [HotSuggestions] Response sent successfully');

  } catch (error: any) {
    console.error('[DEBUG] [HotSuggestions] Error occurred:', error);
    console.error('[Admin] [HotSuggestions] Query failed:', error);
    res.status(500).json({
      success: false,
      error: 'Hot Suggestions 조회 중 오류가 발생했습니다.',
      message: error.message,
    });
  }
});

/**
 * POST /admin/hot-suggestions/:id/approve
 * Hot Suggestion 승인 → canonical_events 생성
 */
app.post('/admin/hot-suggestions/:id/approve', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      venue,
      region,
      start_at,
      end_at,
      main_category = '팝업',
      sub_category,
      overview,
    } = req.body;

    console.log('[Admin] [HotSuggestions] [Approve]:', { id, title });

    // 1. Hot Suggestion 조회
    const suggestionResult = await pool.query(
      `SELECT * FROM admin_hot_suggestions WHERE id = $1`,
      [id]
    );

    if (suggestionResult.rowCount === 0) {
      return res.status(404).json({ error: 'Hot Suggestion을 찾을 수 없습니다.' });
    }

    const suggestion = suggestionResult.rows[0];

    // 2. canonical_events 생성 (기존 POST /admin/events 로직 재사용)
    const eventId = crypto.randomUUID();
    const finalTitle = title || suggestion.title;
    const finalVenue = venue || suggestion.venue;
    const finalRegion = region || suggestion.region;

    // Geocoding (기존 로직 재사용)
    let lat: number | null = null;
    let lng: number | null = null;
    let geoSource = 'none';

    if (finalVenue) {
      try {
        const { geocodeBestEffort } = await import('./lib/geocode');
        const geoResult = await geocodeBestEffort({
          address: finalVenue,
          venue: finalVenue,
        });

        if (geoResult?.lat && geoResult?.lng) {
          lat = geoResult.lat;
          lng = geoResult.lng;
          geoSource = geoResult.source || 'geocode';
        }
      } catch (error: any) {
        console.warn('[Admin] [HotSuggestions] Geocoding failed:', error.message);
      }
    }

    // 3. DB 삽입
    await pool.query(
      `INSERT INTO canonical_events (
        id, title, venue, region, lat, lng, 
        main_category, sub_category, overview,
        start_at, end_at,
        sources, external_links,
        image_url, image_storage, image_origin,
        is_featured, source_priority_winner,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11,
        $12::jsonb, $13::jsonb,
        $14, $15, $16,
        $17, $18,
        NOW(), NOW()
      )`,
      [
        eventId,
        finalTitle,
        finalVenue,
        finalRegion,
        lat,
        lng,
        main_category,
        sub_category,
        overview || suggestion.description || '',
        start_at,
        end_at,
        JSON.stringify([{ source: 'admin_hot_discovery', url: suggestion.link }]),
        JSON.stringify({ official: suggestion.link }),
        null, // image_url (나중에 AI Enrichment로)
        null, // image_storage
        null, // image_origin
        false, // is_featured (Admin이 수동으로 지정)
        'manual', // ⭐ source_priority_winner (필수!)
      ]
    );

    console.log('[Admin] [HotSuggestions] ✅ Event created:', eventId);

    // 4. Hot Suggestion 상태 업데이트
    await pool.query(
      `UPDATE admin_hot_suggestions
       SET status = 'approved',
           reviewed_at = NOW(),
           reviewed_by = $2
       WHERE id = $1`,
      [id, 'admin'] // TODO: 실제 admin user ID 사용
    );

    // 5. Light Buzz Score 계산 (비동기)
    const calculateLightBuzzScore = async (eventId: string) => {
      try {
        const { calculateConsensusLight, calculateStructuralScore } = await import('./lib/hotScoreCalculator');
        
        const eventResult = await pool.query(
          `SELECT id, title, main_category, venue, region, start_at, end_at, (sources->0->>'source') as source FROM canonical_events WHERE id = $1`,
          [eventId]
        );
        const event = eventResult.rows[0];
        if (!event) return;

        const consensus = await calculateConsensusLight({
          id: event.id,
          title: event.title,
          main_category: event.main_category,
          venue: event.venue,
          region: event.region,
          start_at: event.start_at,
          end_at: event.end_at,
          source: event.source,
        });
        
        const structuralResult = calculateStructuralScore({
          id: event.id,
          title: event.title,
          main_category: event.main_category,
          venue: event.venue,
          region: event.region,
          start_at: event.start_at,
          end_at: event.end_at,
          source: event.source,
        });

        const lightScore = 0.5 * consensus + 0.5 * structuralResult.total;

        await pool.query(
          `UPDATE canonical_events
           SET buzz_score = $1,
               buzz_components = $2::jsonb,
               buzz_updated_at = NOW()
           WHERE id = $3`,
          [
            lightScore,
            JSON.stringify({
              consensus_light: consensus,
              structural: structuralResult.total,
              type: 'light',
              updated_at: new Date().toISOString(),
            }),
            eventId,
          ]
        );
        console.log(`[Admin] [HotSuggestions] Light buzz score calculated for ${eventId}: ${lightScore}`);
      } catch (error) {
        console.error(`[Admin] [HotSuggestions] Light buzz score failed for ${eventId}:`, error);
      }
    };

    calculateLightBuzzScore(eventId).catch(err => {
      console.error('[Admin] [HotSuggestions] Light buzz score calculation failed:', err);
    });

    res.json({
      success: true,
      message: '이벤트가 생성되었습니다.',
      event_id: eventId,
    });

  } catch (error: any) {
    console.error('[Admin] [HotSuggestions] [Approve] Failed:', error);
    res.status(500).json({
      success: false,
      error: 'Hot Suggestion 승인 중 오류가 발생했습니다.',
      message: error.message,
    });
  }
});

/**
 * POST /admin/hot-suggestions/:id/reject
 * Hot Suggestion 거부
 */
app.post('/admin/hot-suggestions/:id/reject', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    console.log('[Admin] [HotSuggestions] [Reject]:', { id });

    const result = await pool.query(
      `UPDATE admin_hot_suggestions
       SET status = 'rejected',
           reviewed_at = NOW(),
           reviewed_by = $2
       WHERE id = $1
       RETURNING id`,
      [id, 'admin'] // TODO: 실제 admin user ID 사용
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Hot Suggestion을 찾을 수 없습니다.' });
    }

    console.log('[Admin] [HotSuggestions] ✅ Rejected successfully');

    res.json({
      success: true,
      message: 'Hot Suggestion이 거부되었습니다.',
    });

  } catch (error: any) {
    console.error('[Admin] [HotSuggestions] [Reject] Failed:', error);
    res.status(500).json({
      success: false,
      error: 'Hot Suggestion 거부 중 오류가 발생했습니다.',
      message: error.message,
    });
  }
});

/**
 * POST /admin/hot-suggestions/:id/approve-simple
 * Hot Suggestion 간단 승인 (이벤트 생성 완료 후 status만 업데이트)
 */
app.post('/admin/hot-suggestions/:id/approve-simple', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    console.log('[Admin] [HotSuggestions] [ApproveSimple]:', { id });

    const result = await pool.query(
      `UPDATE admin_hot_suggestions
       SET status = 'approved',
           reviewed_at = NOW(),
           reviewed_by = $2
       WHERE id = $1
       RETURNING id`,
      [id, 'admin']
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Hot Suggestion을 찾을 수 없습니다.' });
    }

    console.log('[Admin] [HotSuggestions] ✅ Approved (simple) successfully');
    res.json({ success: true, message: '승인되었습니다.' });
  } catch (error: any) {
    console.error('[Admin] [HotSuggestions] [ApproveSimple] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = Number(process.env.PORT ?? 4000);
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[API] Server listening on http://0.0.0.0:${PORT}`);
  console.log(`[API] Access from network: http://172.20.10.4:${PORT}`);

  // Initialize scheduler
  initScheduler();
});

// ============================================================
// Event Loop Lag Monitoring
// ============================================================

let lastCheckTime = Date.now();

setInterval(() => {
  const now = Date.now();
  const lag = now - lastCheckTime - 10000; // 10초 기준
  lastCheckTime = now;

  if (lag > 5000) {
    // 5초 이상 지연 시 경고
    const mem = Math.round(process.memoryUsage().rss / 1024 / 1024);
    console.warn(`[INSTRUMENT][EVENTLOOP] LAG ts=${new Date().toISOString()} lag=${lag}ms mem=${mem}MB (expected=10000ms, threshold=5000ms)`);
  }
}, 10000); // 매 10초마다 체크

console.log('[EventLoop] Monitoring started (check_interval=10s, warn_threshold=5s)');

// ============================================================
// Graceful Shutdown
// ============================================================

let isShuttingDown = false;

function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    console.log(`[Shutdown] Already shutting down, ignoring ${signal}`);
    return;
  }

  isShuttingDown = true;
  console.log(`[Shutdown] ${signal} received at ${new Date().toISOString()}`);
  console.log('[Shutdown] Starting graceful shutdown...');

  // 새로운 연결 거부
  server.close(() => {
    console.log('[Shutdown] HTTP server closed');
  });

  // DB 연결 종료
  pool.end(() => {
    console.log('[Shutdown] Database pool closed');
  });

  // 최대 30초 대기 후 강제 종료
  setTimeout(() => {
    console.error('[Shutdown] Forcing shutdown after 30s timeout');
    process.exit(1);
  }, 30000);

  // 정상 종료
  setTimeout(() => {
    console.log('[Shutdown] Graceful shutdown completed');
    process.exit(0);
  }, 5000);
}

// SIGTERM, SIGINT 핸들러 등록
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

console.log('[Shutdown] Graceful shutdown handlers registered (SIGTERM, SIGINT)');
