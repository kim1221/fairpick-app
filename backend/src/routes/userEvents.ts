/**
 * 사용자 행동 로그 API
 * 
 * 이벤트 조회, 저장, 공유 등의 사용자 행동을 기록합니다.
 */

import express, { Request, Response } from 'express';
import { pool } from '../db';

const router = express.Router();

// ==================== 타입 정의 ====================

interface UserEventRequest {
  userId: string;        // 익명 ID 또는 로그인 userId
  eventId: string;       // 이벤트 ID
  actionType: 'view' | 'save' | 'unsave' | 'share' | 'click' | 'dwell' | 'cta_click' | 'sheet_open';
  sectionSlug?: string;
  rankPosition?: number;
  sessionId?: string;
  metadata?: Record<string, any>;
}

// ==================== 헬퍼 함수 ====================

/**
 * 사용자 레코드 가져오기 또는 생성
 * @param userId - 익명 ID 또는 Toss User Key
 * @param isAnonymous - 익명 사용자 여부
 */
async function getOrCreateUser(userId: string, isAnonymous: boolean = true): Promise<string> {
  const client = await pool.connect();
  try {
    if (isAnonymous) {
      // 익명 사용자: anonymous_id로 찾거나 생성
      const result = await client.query(
        `INSERT INTO users (anonymous_id)
         VALUES ($1)
         ON CONFLICT (anonymous_id) DO UPDATE SET anonymous_id = EXCLUDED.anonymous_id
         RETURNING id`,
        [userId]
      );
      return result.rows[0].id;
    } else {
      // 로그인 사용자: toss_user_key로 찾거나 생성
      const result = await client.query(
        `INSERT INTO users (toss_user_key)
         VALUES ($1)
         ON CONFLICT (toss_user_key) DO UPDATE SET toss_user_key = EXCLUDED.toss_user_key
         RETURNING id`,
        [userId]
      );
      return result.rows[0].id;
    }
  } finally {
    client.release();
  }
}

/**
 * 사용자 행동 로그 기록
 */
async function logUserEvent(
  internalUserId: string,
  eventId: string,
  actionType: string,
  sectionSlug?: string,
  rankPosition?: number,
  sessionId?: string,
  metadata?: Record<string, any>
): Promise<void> {
  const client = await pool.connect();
  try {
    // 1. user_events 테이블에 로그 기록
    await client.query(
      `INSERT INTO user_events (user_id, event_id, action_type, section_slug, rank_position, session_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())`,
      [internalUserId, eventId, actionType, sectionSlug ?? null, rankPosition ?? null, sessionId ?? null, metadata ? JSON.stringify(metadata) : null]
    );

    // 2. canonical_events view_count 증가
    if (actionType === 'view') {
      await client.query(
        `UPDATE canonical_events SET view_count = view_count + 1 WHERE id = $1`,
        [eventId]
      );
    }

    // 3. user_preferences 취향 점수 업데이트 (개인화 추천용)
    //    view: +5  /  save: +20  /  unsave: -10  (0~100 범위 클램핑)
    const scoreDelta =
      actionType === 'save'   ?  20 :
      actionType === 'view'   ?   5 :
      actionType === 'unsave' ? -10 : 0;

    if (scoreDelta !== 0) {
      await client.query(
        `WITH cat AS (
           SELECT main_category
           FROM canonical_events
           WHERE id = $1 AND main_category IS NOT NULL
         )
         INSERT INTO user_preferences (user_id, category_scores, preferred_tags, last_updated)
         SELECT
           $2,
           jsonb_build_object((SELECT main_category FROM cat), GREATEST(0, $3::int)),
           ARRAY[]::text[],
           NOW()
         FROM cat
         ON CONFLICT (user_id) DO UPDATE
           SET category_scores = (
                 SELECT jsonb_object_agg(
                   key,
                   GREATEST(0, LEAST(100,
                     COALESCE((user_preferences.category_scores->>key)::int, 0)
                     + CASE WHEN key = (SELECT main_category FROM cat) THEN $3::int ELSE 0 END
                   ))
                 )
                 FROM jsonb_object_keys(
                   COALESCE(user_preferences.category_scores, '{}'::jsonb)
                   || jsonb_build_object((SELECT main_category FROM cat), 0)
                 ) AS key
               ),
               last_updated = NOW()`,
        [eventId, internalUserId, scoreDelta]
      );
    }

    console.log(`[UserEvents] Logged: ${actionType} for event ${eventId} by user ${internalUserId}`);
  } finally {
    client.release();
  }
}

// ==================== API 엔드포인트 ====================

/**
 * POST /api/user-events
 * 사용자 행동 로그 기록
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { userId, eventId, actionType, sectionSlug, rankPosition, sessionId, metadata } = req.body as UserEventRequest;

    // 1. 입력 검증
    if (!userId || !eventId || !actionType) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, eventId, actionType',
      });
    }

    // 2. actionType 검증
    const validActionTypes = ['view', 'save', 'unsave', 'share', 'click', 'dwell', 'cta_click', 'sheet_open'];
    if (!validActionTypes.includes(actionType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid actionType. Must be one of: ${validActionTypes.join(', ')}`,
      });
    }

    // 3. 이벤트 존재 여부 확인
    const eventCheck = await pool.query('SELECT id FROM canonical_events WHERE id = $1', [eventId]);
    if (eventCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Event not found',
      });
    }

    // 4. 사용자 레코드 가져오기 또는 생성
    // 순수 숫자(toss_user_key)가 아니면 모두 익명으로 처리
    // UUID, Toss hash 등 문자열 형식 모두 anonymous_id로 저장
    const isAnonymous = !/^\d+$/.test(userId);
    const internalUserId = await getOrCreateUser(userId, isAnonymous);

    // 5. 행동 로그 기록
    await logUserEvent(internalUserId, eventId, actionType, sectionSlug, rankPosition, sessionId, metadata);

    // 6. 성공 응답
    res.json({
      success: true,
      message: 'User event logged successfully',
    });
  } catch (error: any) {
    console.error('[UserEvents] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to log user event',
    });
  }
});

/**
 * POST /api/user-events/link-anonymous
 * 익명 사용자를 로그인 계정에 연결
 */
router.post('/link-anonymous', async (req: Request, res: Response) => {
  try {
    const { anonymousId, tossUserKey } = req.body;

    // 1. 입력 검증
    if (!anonymousId || !tossUserKey) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: anonymousId, tossUserKey',
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 2. 익명 사용자 찾기
      const anonymousUser = await client.query(
        'SELECT id FROM users WHERE anonymous_id = $1',
        [anonymousId]
      );

      if (anonymousUser.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'Anonymous user not found',
        });
      }

      const anonymousUserId = anonymousUser.rows[0].id;

      // 3. Toss User Key로 사용자 찾기 또는 생성
      let targetUser = await client.query(
        'SELECT id FROM users WHERE toss_user_key = $1',
        [tossUserKey]
      );

      let targetUserId: string;

      if (targetUser.rows.length === 0) {
        // 케이스 1: toss_user_key가 없음 -> 익명 사용자에 toss_user_key 추가
        await client.query(
          'UPDATE users SET toss_user_key = $1 WHERE id = $2',
          [tossUserKey, anonymousUserId]
        );
        targetUserId = anonymousUserId;
        console.log(`[UserEvents/Link] Added toss_user_key ${tossUserKey} to anonymous user ${anonymousUserId}`);
      } else {
        // 케이스 2: toss_user_key가 이미 존재 -> 익명 사용자의 로그를 기존 로그인 사용자에게 이전
        targetUserId = targetUser.rows[0].id;

        if (anonymousUserId !== targetUserId) {
          const updateResult = await client.query(
            'UPDATE user_events SET user_id = $1 WHERE user_id = $2',
            [targetUserId, anonymousUserId]
          );
          console.log(`[UserEvents/Link] Migrated ${updateResult.rowCount} events from ${anonymousUserId} to ${targetUserId}`);

          // 익명 사용자 레코드 삭제 (FK로 인해 user_events도 CASCADE 삭제되지만 이미 이전했음)
          await client.query('DELETE FROM users WHERE id = $1', [anonymousUserId]);
          console.log(`[UserEvents/Link] Deleted anonymous user record ${anonymousUserId}`);
        } else {
          console.log(`[UserEvents/Link] Anonymous user is already linked to this toss_user_key`);
        }
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Anonymous user linked to logged-in account successfully',
        userId: targetUserId,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('[UserEvents/Link] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to link anonymous user',
    });
  }
});

/**
 * GET /api/user-events/stats/:userId
 * 사용자 행동 통계 조회 (디버깅용)
 */
router.get('/stats/:userId', async (req: Request, res: Response) => {
  try {
    const userIdParam = req.params.userId;
    const userId = Array.isArray(userIdParam) ? userIdParam[0] : userIdParam;

    // userId로 internal user_id 찾기
    const isAnonymous = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
    
    let internalUserId: string | null = null;
    if (isAnonymous) {
      const result = await pool.query('SELECT id FROM users WHERE anonymous_id = $1', [userId]);
      if (result.rows.length > 0) {
        internalUserId = result.rows[0].id;
      }
    } else {
      const result = await pool.query('SELECT id FROM users WHERE toss_user_key = $1', [userId]);
      if (result.rows.length > 0) {
        internalUserId = result.rows[0].id;
      }
    }

    if (!internalUserId) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // 통계 집계
    const stats = await pool.query(
      `SELECT 
         action_type,
         COUNT(*) as count
       FROM user_events
       WHERE user_id = $1
       GROUP BY action_type
       ORDER BY count DESC`,
      [internalUserId]
    );

    const recentEvents = await pool.query(
      `SELECT
         ue.action_type,
         ue.created_at,
         e.title as event_title
       FROM user_events ue
       JOIN canonical_events e ON ue.event_id = e.id
       WHERE ue.user_id = $1
       ORDER BY ue.created_at DESC
       LIMIT 10`,
      [internalUserId]
    );

    res.json({
      success: true,
      data: {
        userId: internalUserId,
        stats: stats.rows,
        recentEvents: recentEvents.rows,
      },
    });
  } catch (error: any) {
    console.error('[UserEvents/Stats] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get user stats',
    });
  }
});

export default router;

