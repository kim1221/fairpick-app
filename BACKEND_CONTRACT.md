# Backend Contract

## Culture Card APIs

All endpoints below require `Authorization: Bearer <jwt>` and are served by the Express backend only. Clients must not access Supabase directly for these flows.

### `GET /api/cards/today`

Query:

```ts
type CardsTodayQuery = {
  lat?: number;
  lng?: number;
};
```

Response:

```ts
type Card = {
  eventId: string;
  title: string;
  category: string;
  venue: string | null;
  region: string | null;
  startAt: string | null;
  endAt: string | null;
  dday: number | null;
  imageUrl: string | null;
  walkMinutes: number | null;
  blurb: string | null;
  opened: boolean;
};

type CardsTodayResponse = {
  today: Card[];
  morePool: Card[];
  ticketCount: number;
  dailyEarned: number;
  dailyLimit: number;
};
```

Backend rules:
- `today` returns up to 3 cards from `canonical_events`.
- Source events use `canonical_events.is_deleted = false` and `end_at` not earlier than the current KST date.
- When `lat/lng` are provided, candidates are selected by Haversine distance with radius expansion: 3km, then 10km, then 50km, then national fallback.
- Location candidates require `canonical_events.lat/lng`; `walkMinutes` is `ceil(distance_m / 80)` and is `null` when distance cannot be calculated.
- `today` prefers category diversity by selecting different normalized categories first (`전시 | 공연 | 팝업 | 축제 | 기타`) before filling remaining slots.
- When `lat/lng` are missing or invalid, the backend uses the existing active/upcoming trending/recent fallback ordering.
- `opened` is derived from `user_ticket_earn_log(user_id, event_id, earn_date)` for KST today.
- Events already opened today are excluded from `today` and `morePool`.
- `dailyLimit` is `30`; `dailyEarned` resets by KST date from `user_tickets`.

### `POST /api/visits`

Request:

```ts
type VisitRequest = {
  eventId: string;
  lat?: number;
  lng?: number;
};
```

Response:

```ts
type VisitResponse = {
  ok: true;
  alreadyVisited: boolean;
  verified: boolean;
  reason?: 'TOO_FAR' | 'NO_LOCATION' | 'EVENT_NO_COORDS' | 'OUT_OF_PERIOD';
  distanceM?: number;
  bonusTickets: number;
  ticketCount: number;
  stampCount: number;
};
```

Backend rules:
- `user_visit_log` is the idempotency gate with `UNIQUE(user_id, event_id)`.
- First visit for an event records a stamp and can grant `+3` tickets only when GPS verification passes.
- GPS verification requires device `lat/lng`, event `canonical_events.lat/lng`, distance within 400m, and the current time inside `start_at` through `end_at` when those dates exist.
- Verification failures are fail-closed: they return `verified: false`, grant `0` tickets, and do not insert a stamp.
- Repeated visit calls return `alreadyVisited: true`, `verified: true`, and grant `0` tickets without requiring a fresh device location.
- Visit bonus is separate from the ad daily ticket limit.
- Daily visit bonuses are capped at 10 KST-day grants per user. After the cap, stamps are still recorded with `bonusTickets: 0`.
- Visit idempotency check, GPS verification, insert, bonus decision, ticket balance update, and stamp count read run in one transaction with `user_tickets ... FOR UPDATE`.

### `GET /api/passport`

Response:

```ts
type PassportStamp = {
  eventId: string;
  title: string;
  category: string;
  visitedAt: string;
};

type PassportResponse = {
  passportNo: string;
  discoveredCount: number;
  visitedCount: number;
  monthDiscovered: number;
  tasteCategories: string[];
  stamps: PassportStamp[];
};
```

Backend rules:
- `passportNo` is a deterministic 4-digit zero-padded value derived from the authenticated user id.
- `discoveredCount` is lifetime distinct `user_ticket_earn_log.event_id`.
- `visitedCount` is lifetime distinct `user_visit_log.event_id`.
- `monthDiscovered` uses KST calendar month boundaries.
- `tasteCategories` comes from top `canonical_events.main_category` values for discovered events, normalized to `전시 | 공연 | 팝업 | 축제 | 기타`.
- `stamps` returns recent visits joined to `canonical_events`, newest first, max 12.

## Culture Card Schema

Migration: `backend/migrations/20260701_culturecard_visit_log.sql`

```sql
CREATE TABLE IF NOT EXISTS user_visit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  bonus_tickets INTEGER NOT NULL DEFAULT 0,
  visited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_user_visit_log_user_visited_at
  ON user_visit_log(user_id, visited_at DESC);

ALTER TABLE user_visit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE user_visit_log FROM anon, authenticated;
```

Additional migration for GPS check-in coordinates: `backend/migrations/20260701_add_visit_checkin_coords.sql`

```sql
ALTER TABLE user_visit_log
  ADD COLUMN IF NOT EXISTS checkin_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS checkin_lng DOUBLE PRECISION;
```

RLS stays deny-all by default because no public policies are created. Backend writes and reads this table through the server-side Supabase/Postgres credentials.
