import express, { Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/requireAuth';

const router = express.Router();

const VISIT_BONUS_TICKETS = 3;
const DAILY_VISIT_BONUS_LIMIT = 10;
const DEFAULT_CHECKIN_RADIUS_M = 400;

type VisitFailureReason = 'TOO_FAR' | 'NO_LOCATION' | 'EVENT_NO_COORDS' | 'OUT_OF_PERIOD';

type EventVisitRow = {
  id: string;
  lat: number | string | null;
  lng: number | string | null;
  start_at: string | Date | null;
  end_at: string | Date | null;
};

function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function cleanEventId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseCoordinate(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseVisitLocation(body: unknown): { lat: number; lng: number } | null {
  const source = body as { lat?: unknown; lng?: unknown } | null | undefined;
  const lat = parseCoordinate(source?.lat);
  const lng = parseCoordinate(source?.lng);
  if (lat == null || lng == null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTimeOrNull(value: string | Date | null): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

function calculateDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusM = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getVisitVerification(
  event: EventVisitRow | null,
  location: { lat: number; lng: number },
  now = Date.now()
): { verified: true; distanceM: number } | { verified: false; reason: VisitFailureReason; distanceM?: number } {
  if (!event) return { verified: false, reason: 'EVENT_NO_COORDS' };

  const eventLat = toNumberOrNull(event.lat);
  const eventLng = toNumberOrNull(event.lng);
  if (eventLat == null || eventLng == null) {
    return { verified: false, reason: 'EVENT_NO_COORDS' };
  }

  const distanceM = Math.round(calculateDistanceMeters(location.lat, location.lng, eventLat, eventLng));
  if (distanceM > DEFAULT_CHECKIN_RADIUS_M) {
    return { verified: false, reason: 'TOO_FAR', distanceM };
  }

  const startTime = toTimeOrNull(event.start_at);
  const endTime = toTimeOrNull(event.end_at);
  if ((startTime != null && now < startTime) || (endTime != null && now > endTime)) {
    return { verified: false, reason: 'OUT_OF_PERIOD', distanceM };
  }

  return { verified: true, distanceM };
}

async function countStamps(client: Pick<typeof pool, 'query'>, userId: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT COUNT(DISTINCT event_id)::int AS count
     FROM user_visit_log
     WHERE user_id = $1`,
    [userId]
  );
  return Number(rows[0]?.count ?? 0);
}

router.post('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const eventId = cleanEventId(req.body?.eventId);

  if (!eventId) {
    return res.status(400).json({ error: 'MISSING_EVENT_ID' });
  }

  const today = todayKst();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO user_tickets (user_id, ticket_count, total_earned, total_exchanged)
       VALUES ($1, 0, 0, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    const { rows: lockRows } = await client.query(
      `SELECT ticket_count
       FROM user_tickets
       WHERE user_id = $1
       FOR UPDATE`,
      [userId]
    );
    const currentTicketCount = Number(lockRows[0]?.ticket_count ?? 0);

    const { rows: existingVisitRows } = await client.query(
      `SELECT id
       FROM user_visit_log
       WHERE user_id = $1 AND event_id = $2
       LIMIT 1`,
      [userId, eventId]
    );

    if (existingVisitRows.length > 0) {
      const stampCount = await countStamps(client, userId);
      await client.query('COMMIT');
      return res.json({
        ok: true,
        alreadyVisited: true,
        verified: true,
        bonusTickets: 0,
        ticketCount: currentTicketCount,
        stampCount,
      });
    }

    const location = parseVisitLocation(req.body);
    if (!location) {
      const stampCount = await countStamps(client, userId);
      await client.query('COMMIT');
      return res.json({
        ok: true,
        alreadyVisited: false,
        verified: false,
        reason: 'NO_LOCATION',
        bonusTickets: 0,
        ticketCount: currentTicketCount,
        stampCount,
      });
    }

    const { rows: eventRows } = await client.query<EventVisitRow>(
      `SELECT id, lat, lng, start_at, end_at
       FROM canonical_events
       WHERE id::text = $1 AND is_deleted = false
       LIMIT 1`,
      [eventId]
    );
    const verification = getVisitVerification(eventRows[0] ?? null, location);

    if (!verification.verified) {
      const stampCount = await countStamps(client, userId);
      await client.query('COMMIT');
      return res.json({
        ok: true,
        alreadyVisited: false,
        verified: false,
        reason: verification.reason,
        distanceM: verification.distanceM,
        bonusTickets: 0,
        ticketCount: currentTicketCount,
        stampCount,
      });
    }

    const { rows: inserted } = await client.query(
      `INSERT INTO user_visit_log (user_id, event_id, bonus_tickets, checkin_lat, checkin_lng)
       VALUES ($1, $2, 0, $3, $4)
       ON CONFLICT (user_id, event_id) DO NOTHING
       RETURNING id`,
      [userId, eventId, location.lat, location.lng]
    );

    if (inserted.length === 0) {
      const stampCount = await countStamps(client, userId);
      await client.query('COMMIT');
      return res.json({
        ok: true,
        alreadyVisited: true,
        verified: true,
        distanceM: verification.distanceM,
        bonusTickets: 0,
        ticketCount: currentTicketCount,
        stampCount,
      });
    }

    const { rows: dailyBonusRows } = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM user_visit_log
       WHERE user_id = $1
         AND bonus_tickets > 0
         AND (visited_at AT TIME ZONE 'Asia/Seoul')::date = $2::date`,
      [userId, today]
    );
    const dailyBonusCount = Number(dailyBonusRows[0]?.count ?? 0);
    const bonusTickets = dailyBonusCount >= DAILY_VISIT_BONUS_LIMIT ? 0 : VISIT_BONUS_TICKETS;

    let ticketCount = currentTicketCount;
    if (bonusTickets > 0) {
      const { rows: updated } = await client.query(
        `UPDATE user_tickets
         SET ticket_count   = ticket_count + $1,
             total_earned   = total_earned + $1,
             last_earned_at = NOW(),
             updated_at     = NOW()
         WHERE user_id = $2
         RETURNING ticket_count`,
        [bonusTickets, userId]
      );
      ticketCount = Number(updated[0]?.ticket_count ?? currentTicketCount + bonusTickets);
    }

    await client.query(
      `UPDATE user_visit_log
       SET bonus_tickets = $1,
           checkin_lat = $3,
           checkin_lng = $4
       WHERE id = $2`,
      [bonusTickets, inserted[0].id, location.lat, location.lng]
    );

    const stampCount = await countStamps(client, userId);
    await client.query('COMMIT');

    return res.json({
      ok: true,
      alreadyVisited: false,
      verified: true,
      distanceM: verification.distanceM,
      bonusTickets,
      ticketCount,
      stampCount,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Visits] mark visited error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

export default router;
