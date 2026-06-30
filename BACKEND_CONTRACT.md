# Backend Contract

## Culture Card APIs

All endpoints below require `Authorization: Bearer <jwt>` and are served by the Express backend only. Clients must not access Supabase directly for these flows.

### `GET /api/cards/today`

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
- Source events use `canonical_events.is_deleted = false` and active/upcoming ordering with soonest `end_at` first.
- `opened` is derived from `user_ticket_earn_log(user_id, event_id, earn_date)` for KST today.
- `dailyLimit` is `30`; `dailyEarned` resets by KST date from `user_tickets`.

### `POST /api/visits`

Request:

```ts
type VisitRequest = {
  eventId: string;
};
```

Response:

```ts
type VisitResponse = {
  ok: true;
  alreadyVisited: boolean;
  bonusTickets: number;
  ticketCount: number;
  stampCount: number;
};
```

Backend rules:
- `user_visit_log` is the idempotency gate with `UNIQUE(user_id, event_id)`.
- First visit for an event records a stamp and can grant `+3` tickets.
- Repeated visit calls return `alreadyVisited: true` and grant `0` tickets.
- Visit bonus is separate from the ad daily ticket limit.
- Daily visit bonuses are capped at 10 KST-day grants per user. After the cap, stamps are still recorded with `bonusTickets: 0`.
- Visit insert, bonus decision, ticket balance update, and stamp count read run in one transaction with `user_tickets ... FOR UPDATE`.

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

RLS stays deny-all by default because no public policies are created. Backend writes and reads this table through the server-side Supabase/Postgres credentials.
