process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret';
require('ts-node/register');

const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');

const { pool } = require('../../../src/db');
const { config } = require('../../../src/config');
const cardsRouter = require('../../../src/routes/cards').default;
const visitsRouter = require('../../../src/routes/visits').default;
const passportRouter = require('../../../src/routes/passport').default;
const ticketsRouter = require('../../../src/routes/tickets').default;

const userId = '00000000-0000-4000-8000-000000000001';

function authHeaders() {
  const token = jwt.sign({ userId, userKey: 1234 }, config.jwtSecret);
  return { authorization: `Bearer ${token}` };
}

function makeApp(router) {
  return router;
}

async function request(router, method, path, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(path, 'http://unit.test');
    const req = {
      headers: {
        ...authHeaders(),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      method,
      url: `${parsedUrl.pathname}${parsedUrl.search}`,
      originalUrl: `${parsedUrl.pathname}${parsedUrl.search}`,
      body,
      query: Object.fromEntries(parsedUrl.searchParams.entries()),
      params: {},
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      getHeader(name) {
        return this.headers[name.toLowerCase()];
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
    };

    router.handle(req, res, (err) => {
      if (err) reject(err);
      else reject(new Error(`No response for ${method} ${path}`));
    });
  });
}

function closeLng(lat, lng, metersEast) {
  const lngDelta = metersEast / (111_320 * Math.cos((lat * Math.PI) / 180));
  return lng + lngDelta;
}

function isoDaysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function todayKst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test('GET /api/cards/today returns three unopened cards, morePool, and ticket totals', async () => {
  const canonicalSql = [];
  pool.query = async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM user_tickets')) {
      return { rows: [{ ticket_count: 7, daily_earned: 4, daily_earned_date: todayKst() }] };
    }
    if (text.includes('FROM user_ticket_earn_log')) {
      return { rows: [{ event_id: 'event-2' }] };
    }
    if (text.includes('FROM canonical_events')) {
      canonicalSql.push(text);
      assert.deepEqual(params.slice(-1), [12]);
      return {
        rows: [
          { id: 'event-1', title: '전시 하나', main_category: '전시', venue: 'A관', region: '서울', start_at: isoDaysFromNow(-2), end_at: isoDaysFromNow(2), image_url: 'https://img/1.jpg', overview: '첫 줄 소개\n둘째 줄', buzz_score: 50 },
          { id: 'event-2', title: '공연 둘', main_category: '공연', venue: null, region: null, start_at: null, end_at: isoDaysFromNow(5), image_url: null, overview: null, buzz_score: 40 },
          { id: 'event-3', title: '팝업 셋', main_category: '팝업', venue: '팝업존', region: '부산', start_at: isoDaysFromNow(1), end_at: null, image_url: null, overview: '팝업 소개', buzz_score: 30 },
          { id: 'event-4', title: '축제 넷', main_category: '축제', venue: '광장', region: '대구', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(9), image_url: null, overview: '축제 소개', buzz_score: 20 },
          { id: 'event-5', title: '클래스 다섯', main_category: '클래스', venue: '스튜디오', region: '제주', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(10), image_url: null, overview: '기타 소개', buzz_score: 10 },
        ],
      };
    }
    throw new Error(`Unexpected query: ${text}`);
  };

  const { status, body } = await request(makeApp(cardsRouter), 'GET', '/today');

  assert.equal(status, 200);
  assert.equal(body.today.length, 3);
  assert.deepEqual(body.today.map((card) => card.eventId), ['event-1', 'event-3', 'event-4']);
  assert.equal(body.today.every((card) => card.opened === false), true);
  assert.equal(body.today[0].category, '전시');
  assert.equal(body.today[0].blurb, '첫 줄 소개');
  assert.equal(typeof body.today[0].dday, 'number');
  assert.equal(body.today[0].walkMinutes, null);
  assert.equal(body.morePool.some((card) => card.eventId === 'event-2'), false);
  assert.equal(body.morePool.every((card) => card.opened === false), true);
  assert.equal(body.ticketCount, 7);
  assert.equal(body.dailyEarned, 4);
  assert.equal(body.dailyLimit, 30);
  assert.match(canonicalSql[0], /is_deleted\s*=\s*false/i);
});

test('GET /api/cards/today expands nearby radius, excludes opened events, diversifies categories, and fills walkMinutes', async () => {
  const lat = 37.5665;
  const lng = 126.9780;
  const canonicalCalls = [];
  pool.query = async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('FROM user_tickets')) {
      return { rows: [{ ticket_count: 9, daily_earned: 6, daily_earned_date: todayKst() }] };
    }
    if (text.includes('FROM user_ticket_earn_log')) {
      return { rows: [{ event_id: 'event-opened' }] };
    }
    if (text.includes('FROM canonical_events')) {
      canonicalCalls.push({ text, params });
      assert.match(text, /distance_m/i);
      assert.match(text, /lat IS NOT NULL/i);
      assert.match(text, /lng IS NOT NULL/i);
      assert.equal(params[0], lat);
      assert.equal(params[1], lng);

      if (canonicalCalls.length === 1) {
        assert.ok(params.includes(3000));
        return {
          rows: [
            { id: 'event-near-exhibition', title: '가까운 전시', main_category: '전시', venue: 'A관', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '전시 소개', distance_m: 160, buzz_score: 20 },
            { id: 'event-opened', title: '이미 연 공연', main_category: '공연', venue: 'B홀', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '제외 대상', distance_m: 240, buzz_score: 90 },
          ],
        };
      }

      if (canonicalCalls.length === 2) {
        assert.ok(params.includes(10000));
        return { rows: [] };
      }

      assert.ok(params.includes(50000));
      return {
        rows: [
          { id: 'event-near-exhibition', title: '가까운 전시', main_category: '전시', venue: 'A관', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '전시 소개', distance_m: 160, buzz_score: 20 },
          { id: 'event-second-exhibition', title: '두 번째 전시', main_category: '전시', venue: 'C관', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '전시 중복', distance_m: 240, buzz_score: 80 },
          { id: 'event-performance', title: '근처 공연', main_category: '공연', venue: 'D홀', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '공연 소개', distance_m: 400, buzz_score: 70 },
          { id: 'event-popup', title: '근처 팝업', main_category: '팝업', venue: 'E존', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '팝업 소개', distance_m: 800, buzz_score: 60 },
          { id: 'event-festival', title: '근처 축제', main_category: '축제', venue: 'F광장', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '축제 소개', distance_m: 1200, buzz_score: 50 },
          { id: 'event-opened', title: '이미 연 공연', main_category: '공연', venue: 'B홀', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '제외 대상', distance_m: 240, buzz_score: 90 },
          { id: 'event-etc', title: '기타 문화', main_category: '클래스', venue: 'G실', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '기타 소개', distance_m: 1600, buzz_score: 40 },
          { id: 'event-more-1', title: '더보기 1', main_category: '전시', venue: 'H관', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: null, distance_m: 2000, buzz_score: 30 },
          { id: 'event-more-2', title: '더보기 2', main_category: '공연', venue: 'I홀', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: null, distance_m: 2400, buzz_score: 30 },
          { id: 'event-more-3', title: '더보기 3', main_category: '팝업', venue: 'J존', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: null, distance_m: 2800, buzz_score: 30 },
          { id: 'event-more-4', title: '더보기 4', main_category: '축제', venue: 'K광장', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: null, distance_m: 3200, buzz_score: 30 },
          { id: 'event-more-5', title: '더보기 5', main_category: '클래스', venue: 'L실', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: null, distance_m: 3600, buzz_score: 30 },
        ],
      };
    }
    throw new Error(`Unexpected query: ${text}`);
  };

  const { status, body } = await request(makeApp(cardsRouter), 'GET', `/today?lat=${lat}&lng=${lng}`);

  assert.equal(status, 200);
  assert.equal(canonicalCalls.length, 3);
  assert.deepEqual(body.today.map((card) => card.eventId), ['event-near-exhibition', 'event-performance', 'event-popup']);
  assert.deepEqual(body.today.map((card) => card.category), ['전시', '공연', '팝업']);
  assert.deepEqual(body.today.map((card) => card.walkMinutes), [2, 5, 10]);
  assert.equal(body.today.some((card) => card.eventId === 'event-opened'), false);
  assert.equal(body.morePool.some((card) => card.eventId === 'event-opened'), false);
});

test('POST /api/visits grants a first-visit bonus in one transaction', async () => {
  const eventLat = 37.5665;
  const eventLng = 126.9780;
  const queries = [];
  const client = {
    query: async (sql, params) => {
      const text = String(sql);
      queries.push(text);
      if (text === 'BEGIN' || text === 'COMMIT') return { rows: [], rowCount: null };
      if (text.includes('INSERT INTO user_tickets')) return { rows: [], rowCount: 1 };
      if (text.includes('FROM user_tickets') && text.includes('FOR UPDATE')) return { rows: [{ ticket_count: 2 }], rowCount: 1 };
      if (text.includes('FROM user_visit_log') && text.includes('LIMIT 1')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM canonical_events')) {
        assert.equal(params[0], 'event-visit-1');
        return {
          rows: [{
            id: 'event-visit-1',
            lat: eventLat,
            lng: eventLng,
            start_at: isoDaysFromNow(-1),
            end_at: isoDaysFromNow(1),
          }],
          rowCount: 1,
        };
      }
      if (text.includes('INSERT INTO user_visit_log')) return { rows: [{ id: 'visit-1' }], rowCount: 1 };
      if (text.includes('COUNT(*)') && text.includes('bonus_tickets > 0')) return { rows: [{ count: '0' }], rowCount: 1 };
      if (text.includes('UPDATE user_tickets')) return { rows: [{ ticket_count: 5 }], rowCount: 1 };
      if (text.includes('UPDATE user_visit_log')) {
        assert.equal(params[0], 3);
        assert.equal(params[2], eventLat);
        assert.equal(params[3], eventLng);
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('COUNT(DISTINCT event_id)')) return { rows: [{ count: '1' }], rowCount: 1 };
      throw new Error(`Unexpected query: ${text}`);
    },
    release() {},
  };
  pool.connect = async () => client;

  const { status, body } = await request(makeApp(visitsRouter), 'POST', '/', {
    eventId: 'event-visit-1',
    lat: eventLat,
    lng: eventLng,
  });

  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.alreadyVisited, false);
  assert.equal(body.verified, true);
  assert.equal(body.bonusTickets, 3);
  assert.equal(body.ticketCount, 5);
  assert.equal(body.stampCount, 1);
  assert.equal(body.distanceM <= 1, true);
  assert.equal(queries[0], 'BEGIN');
  assert.equal(queries.at(-1), 'COMMIT');
  assert.ok(queries.some((sql) => /FOR UPDATE/i.test(sql)));
});

test('POST /api/visits fails closed without device coordinates', async () => {
  const queries = [];
  const client = {
    query: async (sql) => {
      const text = String(sql);
      queries.push(text);
      if (text === 'BEGIN' || text === 'COMMIT') return { rows: [], rowCount: null };
      if (text.includes('INSERT INTO user_tickets')) return { rows: [], rowCount: 1 };
      if (text.includes('FROM user_tickets') && text.includes('FOR UPDATE')) return { rows: [{ ticket_count: 2 }], rowCount: 1 };
      if (text.includes('FROM user_visit_log') && text.includes('LIMIT 1')) return { rows: [], rowCount: 0 };
      if (text.includes('COUNT(DISTINCT event_id)')) return { rows: [{ count: '0' }], rowCount: 1 };
      throw new Error(`Unexpected query: ${text}`);
    },
    release() {},
  };
  pool.connect = async () => client;

  const { status, body } = await request(makeApp(visitsRouter), 'POST', '/', { eventId: 'event-visit-1' });

  assert.equal(status, 200);
  assert.equal(body.verified, false);
  assert.equal(body.reason, 'NO_LOCATION');
  assert.equal(body.alreadyVisited, false);
  assert.equal(body.bonusTickets, 0);
  assert.equal(body.ticketCount, 2);
  assert.equal(body.stampCount, 0);
  assert.equal(queries.some((sql) => sql.includes('INSERT INTO user_visit_log')), false);
  assert.equal(queries.some((sql) => sql.includes('UPDATE user_tickets')), false);
});

test('POST /api/visits fails closed when device is too far from event', async () => {
  const eventLat = 37.5665;
  const eventLng = 126.9780;
  const client = {
    query: async (sql, params) => {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'COMMIT') return { rows: [], rowCount: null };
      if (text.includes('INSERT INTO user_tickets')) return { rows: [], rowCount: 1 };
      if (text.includes('FROM user_tickets') && text.includes('FOR UPDATE')) return { rows: [{ ticket_count: 2 }], rowCount: 1 };
      if (text.includes('FROM user_visit_log') && text.includes('LIMIT 1')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM canonical_events')) {
        assert.equal(params[0], 'event-far');
        return {
          rows: [{
            id: 'event-far',
            lat: eventLat,
            lng: eventLng,
            start_at: isoDaysFromNow(-1),
            end_at: isoDaysFromNow(1),
          }],
          rowCount: 1,
        };
      }
      if (text.includes('COUNT(DISTINCT event_id)')) return { rows: [{ count: '0' }], rowCount: 1 };
      if (text.includes('INSERT INTO user_visit_log')) throw new Error('far visits must not stamp');
      if (text.includes('UPDATE user_tickets')) throw new Error('far visits must not grant tickets');
      throw new Error(`Unexpected query: ${text}`);
    },
    release() {},
  };
  pool.connect = async () => client;

  const { status, body } = await request(makeApp(visitsRouter), 'POST', '/', {
    eventId: 'event-far',
    lat: eventLat,
    lng: closeLng(eventLat, eventLng, 1200),
  });

  assert.equal(status, 200);
  assert.equal(body.verified, false);
  assert.equal(body.reason, 'TOO_FAR');
  assert.equal(body.alreadyVisited, false);
  assert.equal(body.bonusTickets, 0);
  assert.equal(body.distanceM > 400, true);
});

test('POST /api/visits is idempotent for an already visited event', async () => {
  const client = {
    query: async (sql) => {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'COMMIT') return { rows: [], rowCount: null };
      if (text.includes('INSERT INTO user_tickets')) return { rows: [], rowCount: 1 };
      if (text.includes('FROM user_tickets') && text.includes('FOR UPDATE')) return { rows: [{ ticket_count: 8 }], rowCount: 1 };
      if (text.includes('FROM user_visit_log') && text.includes('LIMIT 1')) return { rows: [{ id: 'visit-existing' }], rowCount: 1 };
      if (text.includes('INSERT INTO user_visit_log')) throw new Error('already visited events must not insert a new stamp');
      if (text.includes('COUNT(DISTINCT event_id)')) return { rows: [{ count: '3' }], rowCount: 1 };
      throw new Error(`Unexpected query: ${text}`);
    },
    release() {},
  };
  pool.connect = async () => client;

  const { status, body } = await request(makeApp(visitsRouter), 'POST', '/', { eventId: 'event-visit-1' });

  assert.equal(status, 200);
  assert.deepEqual(body, {
    ok: true,
    alreadyVisited: true,
    verified: true,
    bonusTickets: 0,
    ticketCount: 8,
    stampCount: 3,
  });
});

test('POST /api/visits stamps but does not grant after ten daily visit bonuses', async () => {
  const eventLat = 37.5665;
  const eventLng = 126.9780;
  const client = {
    query: async (sql, params) => {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'COMMIT') return { rows: [], rowCount: null };
      if (text.includes('INSERT INTO user_tickets')) return { rows: [], rowCount: 1 };
      if (text.includes('FROM user_tickets') && text.includes('FOR UPDATE')) return { rows: [{ ticket_count: 11 }], rowCount: 1 };
      if (text.includes('FROM user_visit_log') && text.includes('LIMIT 1')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM canonical_events')) {
        return {
          rows: [{
            id: 'event-visit-11',
            lat: eventLat,
            lng: eventLng,
            start_at: isoDaysFromNow(-1),
            end_at: isoDaysFromNow(1),
          }],
          rowCount: 1,
        };
      }
      if (text.includes('INSERT INTO user_visit_log')) return { rows: [{ id: 'visit-11' }], rowCount: 1 };
      if (text.includes('COUNT(*)') && text.includes('bonus_tickets > 0')) return { rows: [{ count: '10' }], rowCount: 1 };
      if (text.includes('UPDATE user_tickets')) throw new Error('user_tickets must not be incremented after daily visit cap');
      if (text.includes('UPDATE user_visit_log')) {
        assert.equal(params[0], 0);
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('COUNT(DISTINCT event_id)')) return { rows: [{ count: '11' }], rowCount: 1 };
      throw new Error(`Unexpected query: ${text}`);
    },
    release() {},
  };
  pool.connect = async () => client;

  const { status, body } = await request(makeApp(visitsRouter), 'POST', '/', {
    eventId: 'event-visit-11',
    lat: eventLat,
    lng: eventLng,
  });

  assert.equal(status, 200);
  assert.equal(body.alreadyVisited, false);
  assert.equal(body.verified, true);
  assert.equal(body.bonusTickets, 0);
  assert.equal(body.ticketCount, 11);
  assert.equal(body.stampCount, 11);
});

test('POST /api/visits handles concurrent duplicate attempts with one bonus result and one idempotent result', async () => {
  const eventLat = 37.5665;
  const eventLng = 126.9780;
  let insertCount = 0;
  const client = {
    query: async (sql) => {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'COMMIT') return { rows: [], rowCount: null };
      if (text.includes('INSERT INTO user_tickets')) return { rows: [], rowCount: 1 };
      if (text.includes('FROM user_tickets') && text.includes('FOR UPDATE')) return { rows: [{ ticket_count: insertCount === 0 ? 4 : 7 }], rowCount: 1 };
      if (text.includes('FROM user_visit_log') && text.includes('LIMIT 1')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM canonical_events')) {
        return {
          rows: [{
            id: 'event-race',
            lat: eventLat,
            lng: eventLng,
            start_at: isoDaysFromNow(-1),
            end_at: isoDaysFromNow(1),
          }],
          rowCount: 1,
        };
      }
      if (text.includes('INSERT INTO user_visit_log')) {
        insertCount += 1;
        return insertCount === 1 ? { rows: [{ id: 'visit-race' }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (text.includes('COUNT(*)') && text.includes('bonus_tickets > 0')) return { rows: [{ count: '0' }], rowCount: 1 };
      if (text.includes('UPDATE user_tickets')) return { rows: [{ ticket_count: 7 }], rowCount: 1 };
      if (text.includes('UPDATE user_visit_log')) return { rows: [], rowCount: 1 };
      if (text.includes('COUNT(DISTINCT event_id)')) return { rows: [{ count: '4' }], rowCount: 1 };
      throw new Error(`Unexpected query: ${text}`);
    },
    release() {},
  };
  pool.connect = async () => client;
  const app = makeApp(visitsRouter);

  const [first, second] = await Promise.all([
    request(app, 'POST', '/', { eventId: 'event-race', lat: eventLat, lng: eventLng }),
    request(app, 'POST', '/', { eventId: 'event-race', lat: eventLat, lng: eventLng }),
  ]);

  assert.deepEqual([first.body.bonusTickets, second.body.bonusTickets].sort(), [0, 3]);
  assert.deepEqual([first.body.alreadyVisited, second.body.alreadyVisited].sort(), [false, true]);
});

test('GET /api/passport returns lifetime, KST monthly, taste, and recent stamp summary', async () => {
  const seenParams = [];
  pool.query = async (sql, params) => {
    const text = String(sql);
    if (text.includes('COUNT(DISTINCT event_id)') && text.includes('FROM user_ticket_earn_log') && !text.includes('earn_date >=')) {
      return { rows: [{ count: '5' }] };
    }
    if (text.includes('COUNT(DISTINCT event_id)') && text.includes('FROM user_visit_log')) {
      return { rows: [{ count: '2' }] };
    }
    if (text.includes('earn_date >=') && text.includes('FROM user_ticket_earn_log')) {
      seenParams.push(params);
      assert.match(params[1], /^\d{4}-\d{2}-01$/);
      return { rows: [{ count: '3' }] };
    }
    if (text.includes('GROUP BY') && text.includes('canonical_events')) {
      return { rows: [{ category: '전시' }, { category: '팝업' }, { category: '기타' }] };
    }
    if (text.includes('FROM user_visit_log') && text.includes('JOIN canonical_events')) {
      return {
        rows: [
          { event_id: 'event-2', title: '공연 둘', category: '공연', visited_at: '2026-07-01T03:00:00.000Z' },
          { event_id: 'event-1', title: '전시 하나', category: '전시', visited_at: '2026-06-30T03:00:00.000Z' },
        ],
      };
    }
    throw new Error(`Unexpected query: ${text}`);
  };

  const { status, body } = await request(makeApp(passportRouter), 'GET', '/');

  assert.equal(status, 200);
  assert.match(body.passportNo, /^\d{4}$/);
  assert.equal(body.discoveredCount, 5);
  assert.equal(body.visitedCount, 2);
  assert.equal(body.monthDiscovered, 3);
  assert.deepEqual(body.tasteCategories, ['전시', '팝업', '기타']);
  assert.deepEqual(body.stamps, [
    { eventId: 'event-2', title: '공연 둘', category: '공연', visitedAt: '2026-07-01T03:00:00.000Z' },
    { eventId: 'event-1', title: '전시 하나', category: '전시', visitedAt: '2026-06-30T03:00:00.000Z' },
  ]);
  assert.equal(seenParams.length, 1);
});

test('GET /api/tickets/history includes visit stamp bonuses from user_visit_log', async () => {
  pool.query = async (sql) => {
    const text = String(sql);
    if (text.includes('INSERT INTO user_tickets')) {
      return { rows: [{ ticket_count: 12, total_earned: 22, total_exchanged: 1 }], rowCount: 1 };
    }
    if (text.includes('FROM user_ticket_earn_log') && text.includes('ORDER BY occurred_at DESC')) {
      assert.match(text, /FROM user_visit_log/);
      assert.match(text, /'visit' AS type/);
      assert.match(text, /'가봤어요 도장' AS label/);
      assert.match(text, /bonus_tickets AS amount/);
      assert.match(text, /visited_at AS occurred_at/);
      return {
        rows: [
          {
            type: 'visit',
            label: '가봤어요 도장',
            amount: 3,
            occurred_at: new Date('2026-07-01T03:00:00.000Z'),
          },
        ],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected query: ${text}`);
  };

  const { status, body } = await request(makeApp(ticketsRouter), 'GET', '/history');

  assert.equal(status, 200);
  assert.equal(body.ticketCount, 12);
  assert.equal(body.totalExchanged, 1);
  assert.deepEqual(body.history, [
    {
      type: 'visit',
      label: '가봤어요 도장',
      amount: 3,
      occurredAt: new Date('2026-07-01T03:00:00.000Z'),
    },
  ]);
});
