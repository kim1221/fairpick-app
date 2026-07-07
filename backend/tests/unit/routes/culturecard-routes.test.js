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
    if (text.includes('user_card_impressions')) return { rows: [] };
    if (text.includes('user_likes')) return { rows: [] }; // 취향 쿼리(빈 취향)
    if (text.includes('FROM user_tickets')) {
      return { rows: [{ ticket_count: 7, daily_earned: 4, daily_earned_date: todayKst() }] };
    }
    if (text.includes('FROM user_ticket_earn_log')) {
      return { rows: [{ event_id: 'event-2' }] };
    }
    if (text.includes('FROM canonical_events')) {
      canonicalSql.push(text);
      assert.deepEqual(params.slice(-1), [80]);
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
    if (text.includes('user_card_impressions')) return { rows: [] };
    if (text.includes('user_likes')) return { rows: [] }; // 취향 쿼리(빈 취향)
    if (text.includes('FROM user_tickets')) {
      return { rows: [{ ticket_count: 9, daily_earned: 6, daily_earned_date: todayKst() }] };
    }
    if (text.includes('FROM user_ticket_earn_log')) {
      return { rows: [{ event_id: 'event-opened' }] };
    }
    if (text.includes('FROM canonical_events')) {
      canonicalCalls.push({ text, params });
      if (!text.includes('distance_m')) {
        return { rows: [] };
      }
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
  assert.ok(canonicalCalls.length >= 3);
  // 반경 확장이 3km→10km→50km로 일어났는지(파라미터로 검증)
  const radiiUsed = canonicalCalls.flatMap((call) => call.params).filter((p) => [3000, 10000, 50000].includes(p));
  assert.ok(radiiUsed.includes(3000) && radiiUsed.includes(10000) && radiiUsed.includes(50000));
  // v2 점수화는 시드로 매일 회전 → 정확한 eventId는 비결정적. 카테고리 다양성은 우선순위 고정이라 결정적.
  assert.equal(body.today.length, 3);
  assert.deepEqual(body.today.map((card) => card.category), ['전시', '공연', '팝업']);
  // 위치 있으면 모든 카드에 walkMinutes(양수) 채워짐
  assert.equal(body.today.every((card) => typeof card.walkMinutes === 'number' && card.walkMinutes > 0), true);
  // 오늘 3장은 서로 다른 이벤트 & 제공된 후보에서 나옴
  assert.equal(new Set(body.today.map((c) => c.eventId)).size, 3);
  // 연(opened) 이벤트는 오늘/더보기 어디에도 없음
  assert.equal(body.today.some((card) => card.eventId === 'event-opened'), false);
  assert.equal(body.morePool.some((card) => card.eventId === 'event-opened'), false);
});

test('GET /api/cards/today soft-excludes recently shown cards for fresh discovery', async () => {
  const ev = (id, cat, buzz) => ({ id, title: id, main_category: cat, venue: 'V', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: null, buzz_score: buzz, created_at: null });
  pool.query = async (sql) => {
    const text = String(sql);
    if (text.includes('user_card_impressions')) return { rows: [{ event_id: 'event-a' }, { event_id: 'event-b' }] };
    if (text.includes('user_likes')) return { rows: [] };
    if (text.includes('FROM user_tickets')) return { rows: [{ ticket_count: 0, daily_earned: 0, daily_earned_date: todayKst() }] };
    if (text.includes('FROM user_ticket_earn_log')) return { rows: [] };
    if (text.includes('FROM canonical_events')) {
      // a,b는 buzz가 높아도 최근 노출됨 → 대안(c~f)이 충분하므로 제외되어야
      return { rows: [ev('event-a', '전시', 90), ev('event-b', '공연', 90), ev('event-c', '전시', 10), ev('event-d', '공연', 10), ev('event-e', '팝업', 10), ev('event-f', '축제', 10)] };
    }
    throw new Error(`Unexpected query: ${text}`);
  };

  const { status, body } = await request(makeApp(cardsRouter), 'GET', '/today');

  assert.equal(status, 200);
  const surfaced = [...body.today, ...body.morePool].map((c) => c.eventId);
  assert.equal(surfaced.includes('event-a'), false);
  assert.equal(surfaced.includes('event-b'), false);
  assert.equal(body.today.length, 3);
});

test('GET /api/cards/today relaxes impression exclusion when the pool would be empty', async () => {
  const ev = (id, cat) => ({ id, title: id, main_category: cat, venue: 'V', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: null, buzz_score: 10, created_at: null });
  pool.query = async (sql) => {
    const text = String(sql);
    if (text.includes('user_card_impressions')) return { rows: [{ event_id: 'event-a' }, { event_id: 'event-b' }, { event_id: 'event-c' }] };
    if (text.includes('user_likes')) return { rows: [] };
    if (text.includes('FROM user_tickets')) return { rows: [{ ticket_count: 0, daily_earned: 0, daily_earned_date: todayKst() }] };
    if (text.includes('FROM user_ticket_earn_log')) return { rows: [] };
    if (text.includes('FROM canonical_events')) {
      // 모든 후보가 최근 노출 → 빈 화면 대신 완화해서 보여줘야
      return { rows: [ev('event-a', '전시'), ev('event-b', '공연'), ev('event-c', '팝업')] };
    }
    throw new Error(`Unexpected query: ${text}`);
  };

  const { status, body } = await request(makeApp(cardsRouter), 'GET', '/today');

  assert.equal(status, 200);
  assert.ok(body.today.length >= 1);
});

test('GET /api/cards/today keeps partial nearby candidates and fills the rest from fallback', async () => {
  const lat = 37.5665;
  const lng = 126.9780;
  const canonicalCalls = [];
  pool.query = async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('FROM user_tickets')) {
      return { rows: [{ ticket_count: 3, daily_earned: 2, daily_earned_date: todayKst() }] };
    }
    if (text.includes('FROM user_ticket_earn_log')) {
      return { rows: [] };
    }
    if (text.includes('FROM canonical_events')) {
      canonicalCalls.push({ text, params });

      if (text.includes('distance_m')) {
        if (params.includes(50_000)) {
          return {
            rows: [
              { id: 'near-1', title: '가까운 전시', main_category: '전시', venue: 'A관', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '가까운 후보', distance_m: 300, buzz_score: 10 },
              { id: 'near-2', title: '가까운 공연', main_category: '공연', venue: 'B홀', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '가까운 후보', distance_m: 600, buzz_score: 10 },
            ],
          };
        }
        return { rows: [] };
      }

      return {
        rows: [
          { id: 'fallback-1', title: '전국 팝업', main_category: '팝업', venue: 'C존', region: '부산', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '보충 후보', buzz_score: 90 },
          { id: 'fallback-2', title: '전국 축제', main_category: '축제', venue: 'D광장', region: '대구', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '보충 후보', buzz_score: 80 },
        ],
      };
    }
    throw new Error(`Unexpected query: ${text}`);
  };

  const { status, body } = await request(makeApp(cardsRouter), 'GET', `/today?lat=${lat}&lng=${lng}`);

  assert.equal(status, 200);
  assert.ok(canonicalCalls.some((call) => call.text.includes('distance_m')));
  assert.ok(canonicalCalls.some((call) => !call.text.includes('distance_m')));
  assert.deepEqual(body.today.map((card) => card.eventId), ['near-1', 'near-2', 'fallback-1']);
});

test('GET /api/cards/today applies a recent-open cooldown, not just today opened ids', async () => {
  let earnLogSql = '';
  pool.query = async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('FROM user_tickets')) {
      return { rows: [{ ticket_count: 5, daily_earned: 1, daily_earned_date: todayKst() }] };
    }
    if (text.includes('FROM user_ticket_earn_log')) {
      earnLogSql = text;
      assert.equal(params[0], userId);
      return { rows: [{ event_id: 'recent-1', dedupe_key: 'same-show' }] };
    }
    if (text.includes('FROM canonical_events')) {
      assert.match(text, /COALESCE\(content_key,\s*canonical_key,\s*id::text\)/);
      return {
        rows: [
          { id: 'fresh-1', content_key: 'fresh-1', canonical_key: null, title: '새 전시', main_category: '전시', venue: 'A관', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '신규 후보', buzz_score: 30 },
          { id: 'fresh-2', content_key: 'fresh-2', canonical_key: null, title: '새 공연', main_category: '공연', venue: 'B홀', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '신규 후보', buzz_score: 20 },
          { id: 'fresh-3', content_key: 'fresh-3', canonical_key: null, title: '새 팝업', main_category: '팝업', venue: 'C존', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '신규 후보', buzz_score: 10 },
        ],
      };
    }
    throw new Error(`Unexpected query: ${text}`);
  };

  const { status, body } = await request(makeApp(cardsRouter), 'GET', '/today');

  assert.equal(status, 200);
  assert.match(earnLogSql, /earn_date\s*>=/);
  assert.deepEqual(body.today.map((card) => card.eventId), ['fresh-1', 'fresh-2', 'fresh-3']);
});

test('POST /api/visits records a self-report stamp without location or reward', async () => {
  const queries = [];
  pool.query = async (sql, params) => {
    const text = String(sql);
    queries.push(text);
    if (text.includes('INSERT INTO user_visit_log')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], 'event-visit-1');
      return { rows: [{ id: 'visit-1' }], rowCount: 1 };
    }
    if (text.includes('COUNT(DISTINCT event_id)') && text.includes('FROM user_visit_log')) {
      return { rows: [{ count: '5' }], rowCount: 1 };
    }
    throw new Error(`Unexpected query: ${text}`);
  };

  const { status, body } = await request(makeApp(visitsRouter), 'POST', '/', { eventId: 'event-visit-1' });

  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.alreadyVisited, false);
  assert.equal(body.stampCount, 5);
  // 자기신고: 위치/보상/트랜잭션/티켓업데이트 없음
  assert.equal(body.bonusTickets, undefined);
  assert.equal(body.verified, undefined);
  assert.equal(queries.some((sql) => /FOR UPDATE|UPDATE user_tickets|FROM canonical_events/i.test(sql)), false);
});

test('POST /api/visits is idempotent for an already stamped event', async () => {
  pool.query = async (sql) => {
    const text = String(sql);
    if (text.includes('INSERT INTO user_visit_log')) return { rows: [], rowCount: 0 };
    if (text.includes('COUNT(DISTINCT event_id)') && text.includes('FROM user_visit_log')) return { rows: [{ count: '5' }], rowCount: 1 };
    throw new Error(`Unexpected query: ${text}`);
  };

  const { status, body } = await request(makeApp(visitsRouter), 'POST', '/', { eventId: 'event-visit-1' });

  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.alreadyVisited, true);
  assert.equal(body.stampCount, 5);
});

test('POST /api/visits requires an eventId', async () => {
  pool.query = async () => { throw new Error('must not query without eventId'); };

  const { status, body } = await request(makeApp(visitsRouter), 'POST', '/', {});

  assert.equal(status, 400);
  assert.equal(body.error, 'MISSING_EVENT_ID');
});

test('GET /api/visits/ids returns the visited event id set', async () => {
  pool.query = async (sql) => {
    const text = String(sql);
    if (text.includes('SELECT DISTINCT event_id') && text.includes('FROM user_visit_log')) {
      return { rows: [{ event_id: 'a' }, { event_id: 'b' }], rowCount: 2 };
    }
    throw new Error(`Unexpected query: ${text}`);
  };

  const { status, body } = await request(makeApp(visitsRouter), 'GET', '/ids');

  assert.equal(status, 200);
  assert.deepEqual(body.eventIds, ['a', 'b']);
});

test('GET /api/passport returns lifetime, KST monthly, taste, and recent stamp summary', async () => {
  const seenParams = [];
  const stampParams = [];
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
    if (text.includes('SELECT DISTINCT event_id') && text.includes('FROM user_visit_log')) {
      return { rows: [{ event_id: 'event-1' }, { event_id: 'event-2' }, { event_id: 'event-old' }] };
    }
    if (text.includes('FROM user_ticket_earn_log el') && text.includes('DISTINCT ON')) {
      return {
        rows: [
          {
            event_id: 'event-3',
            title: '발견한 팝업',
            category: '팝업',
            region: '성동구',
            venue: '성수동',
            image_url: 'http://img/3.jpg',
            start_at: '2026-07-10T03:00:00.000Z',
            end_at: '2026-07-20T03:00:00.000Z',
            lat: 37.544,
            lng: 127.055,
            discovered_at: '2026-07-02T03:00:00.000Z',
          },
        ],
      };
    }
    if (text.includes('FROM user_visit_log') && text.includes('JOIN canonical_events')) {
      stampParams.push(params);
      return {
        rows: [
          { event_id: 'event-2', title: '공연 둘', category: '공연', region: '용산구', venue: '노들섬', image_url: 'http://img/2.jpg', visited_at: '2026-07-01T03:00:00.000Z' },
          { event_id: 'event-1', title: '전시 하나', category: '전시', region: '성동구', venue: '성수 코사이어티', image_url: null, visited_at: '2026-06-30T03:00:00.000Z' },
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
    { eventId: 'event-2', title: '공연 둘', category: '공연', region: '용산구', venue: '노들섬', imageUrl: 'http://img/2.jpg', visitedAt: '2026-07-01T03:00:00.000Z' },
    { eventId: 'event-1', title: '전시 하나', category: '전시', region: '성동구', venue: '성수 코사이어티', imageUrl: null, visitedAt: '2026-06-30T03:00:00.000Z' },
  ]);
  assert.deepEqual(body.visitedEventIds, ['event-1', 'event-2', 'event-old']);
  assert.equal(body.stampBook, 1);
  assert.equal(body.stampBookCount, 1);
  assert.equal(body.stampBookSize, 60);
  assert.deepEqual(stampParams[0], [userId, 60, 0]);
  assert.deepEqual(body.discoveredCards, [
    {
      eventId: 'event-3',
      title: '발견한 팝업',
      category: '팝업',
      region: '성동구',
      venue: '성수동',
      imageUrl: 'http://img/3.jpg',
      startAt: '2026-07-10T03:00:00.000Z',
      endAt: '2026-07-20T03:00:00.000Z',
      lat: 37.544,
      lng: 127.055,
      discoveredAt: '2026-07-02T03:00:00.000Z',
    },
  ]);
  assert.equal(seenParams.length, 1);
});

test('GET /api/passport loads older stamp books by query', async () => {
  let stampParams = null;
  pool.query = async (sql, params) => {
    const text = String(sql);
    if (text.includes('COUNT(DISTINCT event_id)') && text.includes('FROM user_ticket_earn_log') && !text.includes('earn_date >=')) {
      return { rows: [{ count: '0' }] };
    }
    if (text.includes('COUNT(DISTINCT event_id)') && text.includes('FROM user_visit_log')) {
      return { rows: [{ count: '72' }] };
    }
    if (text.includes('earn_date >=') && text.includes('FROM user_ticket_earn_log')) {
      return { rows: [{ count: '0' }] };
    }
    if (text.includes('GROUP BY') && text.includes('canonical_events')) {
      return { rows: [] };
    }
    if (text.includes('SELECT DISTINCT event_id') && text.includes('FROM user_visit_log')) {
      return { rows: [{ event_id: 'event-old' }] };
    }
    if (text.includes('FROM user_ticket_earn_log el') && text.includes('DISTINCT ON')) {
      return { rows: [] };
    }
    if (text.includes('FROM user_visit_log') && text.includes('JOIN canonical_events')) {
      stampParams = params;
      return {
        rows: [
          {
            event_id: 'event-old',
            title: '오래된 도장',
            category: '전시',
            region: '서울',
            venue: '갤러리',
            image_url: null,
            visited_at: '2026-01-01T03:00:00.000Z',
          },
        ],
      };
    }
    throw new Error(`Unexpected query: ${text}`);
  };

  const { status, body } = await request(makeApp(passportRouter), 'GET', '/?stampBook=2');

  assert.equal(status, 200);
  assert.deepEqual(stampParams, [userId, 60, 60]);
  assert.equal(body.stampBook, 2);
  assert.equal(body.stampBookCount, 2);
  assert.equal(body.stampBookSize, 60);
  assert.deepEqual(body.stamps.map((stamp) => stamp.eventId), ['event-old']);
});

test('GET /api/tickets/history includes visit stamp bonuses from user_visit_log', async () => {
  pool.query = async (sql) => {
    const text = String(sql);
    if (text.includes('INSERT INTO user_tickets')) {
      return { rows: [{ ticket_count: 12, total_earned: 22, total_exchanged: 1 }], rowCount: 1 };
    }
    if (text.includes('FROM user_visit_log')) {
      assert.match(text, /'visit' AS type/);
      assert.match(text, /'다녀왔어요 도장' AS label/);
      assert.match(text, /bonus_tickets AS amount/);
      assert.match(text, /visited_at AS occurred_at/);
      return {
        rows: [
          {
            type: 'visit',
            label: '다녀왔어요 도장',
            amount: 3,
            occurred_at: new Date('2026-07-01T03:00:00.000Z'),
          },
        ],
        rowCount: 1,
      };
    }
    if (
      text.includes('FROM user_ticket_earn_log') ||
      text.includes('FROM user_attendance_log') ||
      text.includes('FROM user_weekly_bonus_log') ||
      text.includes('FROM user_ticket_exchanges')
    ) {
      return { rows: [], rowCount: 0 };
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
      label: '다녀왔어요 도장',
      amount: 3,
      occurredAt: new Date('2026-07-01T03:00:00.000Z'),
    },
  ]);
});

test('GET /api/tickets/history keeps balance and available history when legacy sources fail', async () => {
  pool.query = async (sql) => {
    const text = String(sql);
    if (text.includes('INSERT INTO user_tickets')) {
      return { rows: [{ ticket_count: 92, total_earned: 105, total_exchanged: 1 }], rowCount: 1 };
    }
    if (text.includes('FROM user_attendance_log')) {
      throw new Error('relation "user_attendance_log" does not exist');
    }
    if (text.includes('FROM user_ticket_earn_log')) {
      return {
        rows: [
          {
            type: 'ad',
            label: '광고 시청',
            amount: 7,
            occurred_at: new Date('2026-07-07T01:00:00.000Z'),
          },
        ],
        rowCount: 1,
      };
    }
    if (
      text.includes('FROM user_weekly_bonus_log') ||
      text.includes('FROM user_visit_log') ||
      text.includes('FROM user_ticket_exchanges')
    ) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected query: ${text}`);
  };

  const { status, body } = await request(makeApp(ticketsRouter), 'GET', '/history');

  assert.equal(status, 200);
  assert.equal(body.ticketCount, 92);
  assert.equal(body.totalExchanged, 1);
  assert.deepEqual(body.history, [
    {
      type: 'ad',
      label: '광고 시청',
      amount: 7,
      occurredAt: new Date('2026-07-07T01:00:00.000Z'),
    },
  ]);
});
