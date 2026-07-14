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
const { openLockedCard, sealLockedCard } = require('../../../src/services/cardToken');

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

function mockCardClient(query, { readSlots, writeAssignments } = {}) {
  const state = {
    connectCount: 0,
    releaseCount: 0,
    lockQueries: [],
    transactions: [],
  };

  pool.query = query;
  pool.connect = async () => {
    state.connectCount += 1;
    const transactionEvents = [];
    state.transactions.push(transactionEvents);
    return {
      async query(sql, params = []) {
        const text = String(sql);
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
          transactionEvents.push(text);
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('pg_advisory_xact_lock(')) {
          assert.deepEqual(params, [userId]);
          assert.match(text, /hashtext\(\$1::text\), hashtext\('culturecard-open'\)/);
          state.lockQueries.push({ text, params });
          transactionEvents.push('xact-lock');
          return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
        }
        if (text.includes('FROM user_daily_card_slots slot')) {
          return readSlots ? readSlots(params, text) : { rows: [] };
        }
        if (
          text.includes('WITH selected AS') &&
          text.includes('INSERT INTO user_daily_card_slots') &&
          text.includes('INSERT INTO user_card_impressions')
        ) {
          transactionEvents.push('assignment');
          return writeAssignments
            ? writeAssignments(params, text)
            : { rows: [], rowCount: Array.isArray(params[4]) ? params[4].length : 0 };
        }
        return query(sql, params);
      },
      release() {
        state.releaseCount += 1;
        transactionEvents.push('release');
      },
    };
  };

  return state;
}

test('POST /api/tickets/earn retires the unverified legacy reward path', async () => {
  const response = await request(ticketsRouter, 'POST', '/earn', {
    eventId: 'arbitrary-event-id',
    adAttemptId: 'unverified-attempt',
  });

  assert.equal(response.status, 410);
  assert.equal(response.body.error, 'LEGACY_TICKET_EARN_RETIRED');
  assert.equal(response.body.replacement, '/api/cards/v2/open');
});

test('GET /api/cards/today returns three unopened cards, morePool, and ticket totals', async () => {
  const canonicalSql = [];
  mockCardClient(async (sql, params) => {
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
      assert.deepEqual(params.slice(-1), [300]);
      assert.equal(params[1], userId);
      assert.match(text, /NOT EXISTS[\s\S]*FROM user_card_opened_keys opened/);
      return {
        // SQL anti-join이 실행된 DB 결과처럼 이미 연 event-2는 포함하지 않는다.
        rows: [
          { id: 'event-1', title: '전시 하나', main_category: '전시', venue: 'A관', region: '서울', start_at: isoDaysFromNow(-2), end_at: isoDaysFromNow(2), image_url: 'https://img/1.jpg', overview: '첫 줄 소개\n둘째 줄', buzz_score: 50 },
          { id: 'event-3', title: '팝업 셋', main_category: '팝업', venue: '팝업존', region: '부산', start_at: isoDaysFromNow(1), end_at: null, image_url: null, overview: '팝업 소개', buzz_score: 30 },
          { id: 'event-4', title: '축제 넷', main_category: '축제', venue: '광장', region: '대구', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(9), image_url: null, overview: '축제 소개', buzz_score: 20 },
          { id: 'event-5', title: '클래스 다섯', main_category: '클래스', venue: '스튜디오', region: '제주', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(10), image_url: null, overview: '기타 소개', buzz_score: 10 },
        ],
      };
    }
    throw new Error(`Unexpected query: ${text}`);
  });

  const { status, body } = await request(makeApp(cardsRouter), 'GET', '/today');

  assert.equal(status, 200);
  assert.equal(body.today.length, 3);
  assert.deepEqual(
    new Set(body.today.map((card) => card.eventId)),
    new Set(['event-1', 'event-3', 'event-4']),
  );
  assert.equal(body.today.every((card) => card.opened === false), true);
  const exhibitionCard = body.today.find((card) => card.category === '전시');
  assert.ok(exhibitionCard);
  assert.equal(exhibitionCard.blurb, '첫 줄 소개');
  assert.equal(typeof exhibitionCard.dday, 'number');
  assert.equal(exhibitionCard.walkMinutes, null);
  assert.equal(body.morePool.some((card) => card.eventId === 'event-2'), false);
  assert.equal(body.morePool.every((card) => card.opened === false), true);
  assert.equal(body.ticketCount, 7);
  assert.equal(body.dailyEarned, 4);
  assert.equal(body.dailyLimit, 150);
  assert.match(body.weeklyCuration.weekKey, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(body.weeklyCuration.title, '이번 주 문화 3선');
  assert.equal(body.weeklyCuration.items.length, 3);
  assert.deepEqual(body.personalization, {
    level: 'cold',
    signalCount: 0,
    topCategories: [],
  });
  assert.equal(body.today.every((card) => Array.isArray(card.reasonTags)), true);
  assert.match(canonicalSql[0], /is_deleted\s*=\s*false/i);
});

test('v2 locks curated details until rewarded open and keeps weekly discovery disjoint', async () => {
  const opened = {
    id: 'opened-weekly',
    title: '이미 발견한 전시',
    display_title: '이미 발견한 전시',
    content_key: 'opened-key',
    canonical_key: null,
    main_category: '전시',
    region: '서울',
    start_at: isoDaysFromNow(-2),
    end_at: isoDaysFromNow(20),
    image_url: 'https://img/opened.jpg',
    venue: '발견 미술관',
    overview: '이미 광고로 공개한 이벤트',
    buzz_score: 50,
    earn_date: todayKst(),
  };
  const fresh = [
    { id: 'locked-a', title: '비밀 전시', content_key: 'a', main_category: '전시', region: '서울', venue: 'A관', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: 'https://img/a.jpg', overview: 'A 소개', buzz_score: 40 },
    { id: 'locked-b', title: '비밀 공연', content_key: 'b', main_category: '공연', region: '서울', venue: 'B홀', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(6), image_url: 'https://img/b.jpg', overview: 'B 소개', buzz_score: 30 },
    { id: 'locked-c', title: '비밀 팝업', content_key: 'c', main_category: '팝업', region: '서울', venue: 'C존', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(7), image_url: 'https://img/c.jpg', overview: 'C 소개', buzz_score: 20 },
  ];

  mockCardClient(async (sql) => {
    const text = String(sql);
    if (text.includes('user_card_impressions')) return { rows: [], rowCount: 0 };
    if (text.includes('user_likes')) return { rows: [] };
    if (text.includes('FROM user_tickets')) {
      return { rows: [{ ticket_count: 4, daily_earned: 2, daily_earned_date: todayKst() }] };
    }
    if (text.includes('MAX(el.earn_date)')) return { rows: [opened] };
    if (text.includes('FROM user_ticket_earn_log el')) {
      assert.match(text, /COUNT\(\*\)::int AS count/);
      return { rows: [{ count: 1 }] };
    }
    if (text.includes('FROM canonical_events')) {
      assert.match(text, /FROM user_card_opened_keys opened/);
      // opened-weekly는 ledger anti-join에서 제외되고 신규 후보만 반환된다.
      return { rows: fresh };
    }
    throw new Error(`Unexpected v2 query: ${text}`);
  });

  const todayResponse = await request(makeApp(cardsRouter), 'GET', '/v2/today');
  assert.equal(todayResponse.status, 200);
  assert.equal(todayResponse.body.lockedCards.length, 3);
  for (const preview of todayResponse.body.lockedCards) {
    assert.equal(typeof preview.cardToken, 'string');
    assert.equal('eventId' in preview, false);
    assert.equal('title' in preview, false);
    assert.equal('venue' in preview, false);
    assert.equal('imageUrl' in preview, false);
    assert.equal(typeof preview.teaserEyebrow, 'string');
    assert.equal(typeof preview.teaserHeadline, 'string');
    assert.equal(typeof preview.palette.background, 'string');
  }
  assert.equal(todayResponse.body.dailyOpenCount, 1);
  assert.equal(todayResponse.body.dailyOpenLimit, 50);
  assert.equal(todayResponse.body.weeklyDiscovery.items.length, 1);
  assert.equal(todayResponse.body.weeklyDiscovery.items[0].eventId, opened.id);

  await new Promise((resolve) => setImmediate(resolve));
  const token = todayResponse.body.lockedCards.find((card) => card.category === '전시').cardToken;
  const cappedToken = todayResponse.body.lockedCards.find((card) => card.category === '공연').cardToken;
  let grantOpenCount = 1;
  let archiveUpsertCount = 0;
  let ledgerClaimCount = 0;
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (text.includes('FROM ad_reward_attempts')) {
        assert.match(text, /reward_at IS NOT NULL/);
        assert.match(text, /metadata->>'cardToken'/);
        return { rows: [{ attempt_id: 'attempt-v2' }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO event_archive_snapshots')) {
        archiveUpsertCount += 1;
        assert.match(text, /ON CONFLICT \(event_id\) DO UPDATE/);
        return { rows: [{ event_id: 'locked-a' }], rowCount: 1 };
      }
      if (text.includes('FROM canonical_events')) {
        const event = fresh.find((item) => item.id === params[0]);
        return { rows: event ? [event] : [], rowCount: event ? 1 : 0 };
      }
      if (text.includes('pg_advisory_xact_lock')) {
        assert.deepEqual(params, [userId]);
        assert.match(text, /culturecard-open/);
        return { rows: [{}], rowCount: 1 };
      }
      if (text.includes('SELECT 1') && text.includes('FROM user_card_opened_keys')) {
        assert.equal(params[0], userId);
        assert.ok(['locked-a', 'locked-b'].includes(params[1]));
        assert.ok(['a', 'b'].includes(params[2]));
        assert.equal(params[3], null);
        assert.match(text, /key_type IN \('content_key', 'canonical_key'\)/);
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('INSERT INTO user_card_opened_keys')) {
        ledgerClaimCount += 1;
        assert.equal(params[0], userId);
        assert.ok(['locked-a', 'locked-b'].includes(params[1]));
        assert.ok(['a', 'b'].includes(params[2]));
        assert.equal(params[3], null);
        assert.match(text, /ON CONFLICT DO NOTHING/);
        return { rows: [{ expected_count: 2, inserted_count: 2 }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO user_ticket_earn_log')) return { rows: [{ id: 'earn-v2' }], rowCount: 1 };
      if (text.includes('INSERT INTO user_tickets')) return { rows: [], rowCount: 1 };
      if (text.includes('FROM user_tickets') && text.includes('FOR UPDATE')) {
        return { rows: [{ ticket_count: 4, daily_earned: 2, daily_earned_date: todayKst() }], rowCount: 1 };
      }
      if (text.includes('COUNT(*)::int AS count') && text.includes('user_ticket_earn_log')) {
        return { rows: [{ count: grantOpenCount }], rowCount: 1 };
      }
      if (text.includes('UPDATE user_tickets')) {
        return { rows: [{ ticket_count: 5, total_earned: 5 }], rowCount: 1 };
      }
      if (text.includes('UPDATE user_ticket_earn_log')) return { rows: [], rowCount: 1 };
      if (text.includes('UPDATE ad_reward_attempts')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected v2 client query: ${text}`);
    },
    release() {},
  };
  pool.connect = async () => client;

  const openedResponse = await request(makeApp(cardsRouter), 'POST', '/v2/open', {
    cardToken: token,
    adAttemptId: 'attempt-v2',
  });
  assert.equal(openedResponse.status, 200);
  assert.equal(openedResponse.body.card.eventId, 'locked-a');
  assert.equal(openedResponse.body.card.title, '비밀 전시');
  assert.equal(openedResponse.body.card.opened, true);
  assert.ok(openedResponse.body.earned >= 1 && openedResponse.body.earned <= 3);
  assert.equal(openedResponse.body.dailyOpenCount, 1);
  assert.equal(openedResponse.body.dailyOpenLimit, 50);
  assert.equal(archiveUpsertCount, 1);
  assert.equal(ledgerClaimCount, 1);

  grantOpenCount = 51;
  const cappedResponse = await request(makeApp(cardsRouter), 'POST', '/v2/open', {
    cardToken: cappedToken,
    adAttemptId: 'attempt-v2-cap',
  });
  assert.equal(cappedResponse.status, 429);
  assert.equal(cappedResponse.body.error, 'DAILY_OPEN_LIMIT_REACHED');
  assert.equal(cappedResponse.body.dailyOpenLimit, 50);
  assert.equal(ledgerClaimCount, 2);
});

test('GET /api/cards/v2/today expands core categories instead of exhausting the pool on nearby popups', async () => {
  const lat = 37.5665;
  const lng = 126.9780;
  const canonicalCalls = [];
  const popupRows = Array.from({ length: 60 }, (_, index) => ({
    id: `near-popup-${index + 1}`,
    title: `가까운 팝업 ${index + 1}`,
    content_key: `near-popup-key-${index + 1}`,
    main_category: '팝업',
    venue: '팝업 거리',
    region: '서울',
    start_at: isoDaysFromNow(-1),
    end_at: isoDaysFromNow(7),
    image_url: null,
    overview: '가까운 팝업',
    distance_m: 200 + index * 20,
    buzz_score: 90 - (index % 10),
  }));
  const exhibition = {
    id: 'exhibition-at-10km',
    title: '조금 더 넓혀 찾은 전시',
    content_key: 'exhibition-at-10km-key',
    main_category: '전시',
    venue: '전시관',
    region: '서울',
    start_at: isoDaysFromNow(-1),
    end_at: isoDaysFromNow(10),
    image_url: null,
    overview: '10km 안의 전시',
    distance_m: 8_000,
    buzz_score: 50,
  };
  const fallbackPerformance = {
    id: 'performance-from-fallback',
    title: '전국 풀에서 찾은 공연',
    content_key: 'performance-from-fallback-key',
    main_category: '공연',
    venue: '공연장',
    region: '부산',
    start_at: isoDaysFromNow(-1),
    end_at: isoDaysFromNow(12),
    image_url: null,
    overview: '반경 밖의 미공개 공연',
    buzz_score: 40,
  };
  const eventById = new Map(
    [...popupRows, exhibition, fallbackPerformance].map((event) => [event.id, event]),
  );
  const dailySlots = new Map();
  const impressions = new Map();

  mockCardClient(async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('SELECT event_id FROM user_card_impressions')) {
      return {
        rows: [...impressions]
          .filter(([, lastShownOn]) => lastShownOn < todayKst())
          .map(([event_id]) => ({ event_id })),
      };
    }
    if (text.includes('user_likes')) return { rows: [] };
    if (text.includes('FROM user_tickets')) {
      return { rows: [{ ticket_count: 3, daily_earned: 0, daily_earned_date: todayKst() }] };
    }
    if (text.includes('MAX(el.earn_date)')) return { rows: [] };
    if (text.includes('FROM user_ticket_earn_log el')) return { rows: [{ count: 0 }] };
    if (text.includes('FROM canonical_events')) {
      canonicalCalls.push({ text, params });
      const requestedCategory = params.find((param) => ['전시', '공연', '팝업'].includes(param));
      const forRequestedCategory = (rows) => requestedCategory
        ? rows.filter((row) => row.main_category === requestedCategory)
        : rows;

      if (text.includes('distance_m')) {
        if (params.includes(3_000)) return { rows: forRequestedCategory(popupRows) };
        if (params.includes(10_000)) {
          return { rows: forRequestedCategory([...popupRows, exhibition]) };
        }
        if (params.includes(50_000)) {
          return { rows: forRequestedCategory([...popupRows, exhibition]) };
        }
        throw new Error(`Unexpected nearby radius params: ${JSON.stringify(params)}`);
      }

      return { rows: forRequestedCategory([fallbackPerformance]) };
    }
    throw new Error(`Unexpected category-diversity query: ${text}`);
  }, {
    readSlots: async () => ({
      rows: [...dailySlots].flatMap(([slot_index, slot]) => {
        const event = eventById.get(slot.eventId);
        return event ? [{
          ...event,
          slot_index,
          slot_category: slot.category,
          slot_event_id: slot.eventId,
          slot_usable: true,
        }] : [];
      }),
    }),
    writeAssignments: async (params) => {
      const [assignedUserId, assignedOn, slotIndexes, categories, eventIds] = params;
      assert.equal(assignedUserId, userId);
      assert.equal(assignedOn, todayKst());
      dailySlots.clear();
      slotIndexes.forEach((slotIndex, index) => dailySlots.set(slotIndex, {
        category: categories[index],
        eventId: eventIds[index],
      }));
      eventIds.forEach((eventId) => impressions.set(eventId, assignedOn));
      return { rows: [], rowCount: eventIds.length };
    },
  });

  const { status, body } = await request(
    makeApp(cardsRouter),
    'GET',
    `/v2/today?lat=${lat}&lng=${lng}`,
  );

  assert.equal(status, 200);
  assert.equal(body.lockedCards.length, 3);
  assert.deepEqual(
    new Set(body.lockedCards.map((card) => card.category)),
    new Set(['전시', '공연', '팝업']),
  );
  const radiiUsed = canonicalCalls
    .flatMap((call) => call.params)
    .filter((param) => [3_000, 10_000, 50_000].includes(param));
  assert.equal(radiiUsed.includes(3_000), true);
  assert.equal(radiiUsed.includes(10_000), true);
  assert.equal(radiiUsed.includes(50_000), true);
  assert.equal(canonicalCalls.some((call) => !call.text.includes('distance_m')), true);

  await new Promise((resolve) => setImmediate(resolve));
});

test('GET /api/cards/v2/today relaxes recent impressions only for a core category with no fresh card', async () => {
  const previousKstDay = new Date(Date.now() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const impressions = new Map([['recent-only-exhibition', previousKstDay]]);
  const freshCandidates = [
    { id: 'recent-only-exhibition', title: '최근에 본 유일한 전시', content_key: 'recent-only-exhibition-key', main_category: '전시', venue: '전시관', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(10), image_url: null, overview: null, buzz_score: 1 },
    ...Array.from({ length: 3 }, (_, index) => ({ id: `fresh-performance-${index + 1}`, title: `새 공연 ${index + 1}`, content_key: `fresh-performance-key-${index + 1}`, main_category: '공연', venue: '공연장', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(10), image_url: null, overview: null, buzz_score: 90 - index })),
    ...Array.from({ length: 3 }, (_, index) => ({ id: `fresh-popup-${index + 1}`, title: `새 팝업 ${index + 1}`, content_key: `fresh-popup-key-${index + 1}`, main_category: '팝업', venue: '팝업존', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(10), image_url: null, overview: null, buzz_score: 90 - index })),
  ];
  const eventById = new Map(freshCandidates.map((event) => [event.id, event]));
  const dailySlots = new Map();
  let assignmentEventIds = null;

  mockCardClient(async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('SELECT event_id FROM user_card_impressions')) {
      return {
        rows: [...impressions]
          .filter(([, lastShownOn]) => lastShownOn < todayKst())
          .map(([event_id]) => ({ event_id })),
      };
    }
    if (text.includes('user_likes')) return { rows: [] };
    if (text.includes('FROM user_tickets')) {
      return { rows: [{ ticket_count: 0, daily_earned: 0, daily_earned_date: todayKst() }] };
    }
    if (text.includes('MAX(el.earn_date)')) return { rows: [] };
    if (text.includes('FROM user_ticket_earn_log el')) return { rows: [{ count: 0 }] };
    if (text.includes('FROM canonical_events')) return { rows: freshCandidates };
    throw new Error(`Unexpected per-category-impression query: ${text}`);
  }, {
    readSlots: async () => ({
      rows: [...dailySlots].flatMap(([slot_index, slot]) => {
        const event = eventById.get(slot.eventId);
        return event ? [{
          ...event,
          slot_index,
          slot_category: slot.category,
          slot_event_id: slot.eventId,
          slot_usable: true,
        }] : [];
      }),
    }),
    writeAssignments: async (params) => {
      const [assignedUserId, assignedOn, slotIndexes, categories, eventIds] = params;
      assert.equal(assignedUserId, userId);
      assert.equal(assignedOn, todayKst());
      assert.equal(new Set(slotIndexes).size, slotIndexes.length);
      assignmentEventIds = eventIds.slice();
      dailySlots.clear();
      slotIndexes.forEach((slotIndex, index) => dailySlots.set(slotIndex, {
        category: categories[index],
        eventId: eventIds[index],
      }));
      eventIds.forEach((eventId) => impressions.set(eventId, assignedOn));
      return { rows: [], rowCount: eventIds.length };
    },
  });

  const { status, body } = await request(makeApp(cardsRouter), 'GET', '/v2/today');

  assert.equal(status, 200);
  assert.equal(body.lockedCards.length, 3);
  assert.deepEqual(
    new Set(body.lockedCards.map((card) => card.category)),
    new Set(['전시', '공연', '팝업']),
  );
  const decodedIds = body.lockedCards.map((card) => openLockedCard(card.cardToken).eventId);
  assert.equal(decodedIds.includes('recent-only-exhibition'), true);
  assert.deepEqual(new Set(assignmentEventIds), new Set(decodedIds));
  assert.deepEqual(
    new Set([...dailySlots.values()].map((slot) => slot.eventId)),
    new Set(decodedIds),
  );
  assert.equal(impressions.get('recent-only-exhibition'), todayKst());
});

test('GET /api/cards/v2/today keeps one daily slot across location changes and expands only an opened slot', async () => {
  const lat = 37.5665;
  const lng = 126.9780;
  const openedEventIds = new Set();
  const dailySlots = new Map();
  const assignmentWrites = [];
  const impressionReadCounts = [];
  const radiusCalls = [];
  let fallbackCalls = 0;
  const candidate = (id, category, distanceM, { fresh = false, buzz = 0 } = {}) => ({
    id,
    title: id,
    content_key: `${id}-key`,
    main_category: category,
    venue: `${category} 장소`,
    region: '서울',
    start_at: isoDaysFromNow(-1),
    end_at: isoDaysFromNow(10),
    image_url: null,
    overview: null,
    distance_m: distanceM,
    created_at: fresh ? new Date().toISOString() : isoDaysFromNow(-100),
    buzz_score: buzz,
  });
  const initialExhibition = candidate('pinned-exhibition', '전시', 300);
  const initialPerformance = candidate('pinned-performance', '공연', 400);
  const initialPopup = candidate('pinned-popup', '팝업', 500);
  const wideExhibition = candidate('wide-exhibition', '전시', 40_000);
  // 첫 배정 뒤 새로 유입되며, pin이 없다면 기존 두 카드보다 점수가 높다.
  const newHighPerformance = candidate('new-high-performance', '공연', 450, { fresh: true, buzz: 100 });
  const newHighPopup = candidate('new-high-popup', '팝업', 550, { fresh: true, buzz: 100 });
  const eventById = new Map([
    initialExhibition,
    initialPerformance,
    initialPopup,
    wideExhibition,
    newHighPerformance,
    newHighPopup,
  ].map((event) => [event.id, event]));
  const previousKstDay = new Date(Date.now() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const impressions = new Map([
    [initialPerformance.id, previousKstDay],
    [newHighPerformance.id, previousKstDay],
    ...Array.from({ length: 8 }, (_, index) => [`older-performance-${index + 1}`, previousKstDay]),
  ]);

  mockCardClient(async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('SELECT event_id FROM user_card_impressions')) {
      const rows = [...impressions]
        .filter(([, lastShownOn]) => lastShownOn < todayKst())
        .map(([event_id]) => ({ event_id }));
      impressionReadCounts.push(rows.length);
      return { rows };
    }
    if (text.includes('user_likes')) return { rows: [] };
    if (text.includes('FROM user_tickets')) {
      return { rows: [{ ticket_count: 3, daily_earned: 0, daily_earned_date: todayKst() }] };
    }
    if (text.includes('MAX(el.earn_date)')) return { rows: [] };
    if (text.includes('FROM user_ticket_earn_log el')) {
      return { rows: [{ count: openedEventIds.size }] };
    }
    if (text.includes('FROM canonical_events')) {
      if (!text.includes('distance_m')) {
        fallbackCalls += 1;
        return { rows: [] };
      }

      const radius = [3_000, 10_000, 50_000].find((value) => params.includes(value));
      assert.ok(radius);
      radiusCalls.push({
        phase: openedEventIds.size > 0 ? 'after-open' : assignmentWrites.length === 0 ? 'initial' : 'same-day',
        radius,
      });

      const rows = [initialPerformance, initialPopup];
      if (assignmentWrites.length > 0) rows.push(newHighPerformance, newHighPopup);
      if (!openedEventIds.has(initialExhibition.id)) rows.push(initialExhibition);
      if (radius === 50_000) rows.push(wideExhibition);
      return { rows: rows.filter((event) => !openedEventIds.has(event.id)) };
    }
    throw new Error(`Unexpected pinned-selection query: ${text}`);
  }, {
    readSlots: async () => ({
      rows: [...dailySlots].flatMap(([slot_index, slot]) => {
        const event = eventById.get(slot.eventId);
        return event ? [{
          ...event,
          slot_index,
          slot_category: slot.category,
          slot_event_id: slot.eventId,
          slot_usable: !openedEventIds.has(slot.eventId),
        }] : [];
      }),
    }),
    writeAssignments: async (params) => {
      const [assignedUserId, assignedOn, slotIndexes, categories, eventIds] = params;
      assert.equal(assignedUserId, userId);
      assert.equal(assignedOn, todayKst());
      assert.equal(new Set(slotIndexes).size, slotIndexes.length);
      assignmentWrites.push({
        slotIndexes: slotIndexes.slice(),
        categories: categories.slice(),
        eventIds: eventIds.slice(),
      });
      dailySlots.clear();
      slotIndexes.forEach((slotIndex, index) => dailySlots.set(slotIndex, {
        category: categories[index],
        eventId: eventIds[index],
      }));
      eventIds.forEach((eventId) => impressions.set(eventId, assignedOn));
      return { rows: [], rowCount: eventIds.length };
    },
  });

  const readSelection = (response) => new Map(response.body.lockedCards.map((card, slotIndex) => {
    const payload = openLockedCard(card.cardToken);
    assert.ok(payload);
    return [slotIndex, {
      category: card.category,
      eventId: payload.eventId,
      visualSeed: card.visualSeed,
    }];
  }));

  const firstPath = `/v2/today?lat=${lat}&lng=${lng}`;
  const movedPath = '/v2/today?lat=35.1796&lng=129.0756';
  const first = await request(makeApp(cardsRouter), 'GET', firstPath);
  const second = await request(makeApp(cardsRouter), 'GET', movedPath);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  const firstSelection = readSelection(first);
  const secondSelection = readSelection(second);
  const firstByCategory = new Map(
    [...firstSelection].map(([slotIndex, selection]) => [selection.category, { slotIndex, ...selection }]),
  );
  assert.equal(firstByCategory.get('전시').eventId, initialExhibition.id);
  assert.equal(firstByCategory.get('공연').eventId, initialPerformance.id);
  assert.equal(firstByCategory.get('팝업').eventId, initialPopup.id);
  assert.deepEqual(secondSelection, firstSelection);
  assert.deepEqual(
    second.body.lockedCards.map((card) => ({ category: card.category, visualSeed: card.visualSeed })),
    first.body.lockedCards.map((card) => ({ category: card.category, visualSeed: card.visualSeed })),
  );
  assert.deepEqual(
    new Set([...firstSelection.values()].map((selection) => selection.category)),
    new Set(['전시', '공연', '팝업']),
  );
  assert.equal(impressions.get(initialExhibition.id), todayKst());
  assert.equal(impressions.get(initialPerformance.id), todayKst());
  assert.equal(impressions.get(initialPopup.id), todayKst());
  assert.equal(dailySlots.get(firstByCategory.get('전시').slotIndex).eventId, initialExhibition.id);
  assert.equal(dailySlots.get(firstByCategory.get('공연').slotIndex).eventId, initialPerformance.id);
  assert.equal(dailySlots.get(firstByCategory.get('팝업').slotIndex).eventId, initialPopup.id);
  assert.equal(radiusCalls.some((call) => call.phase === 'same-day'), false);
  assert.ok(impressionReadCounts[0] >= 10);

  const exhibitionSlotIndex = firstByCategory.get('전시').slotIndex;
  const openedExhibitionId = firstByCategory.get('전시').eventId;
  openedEventIds.add(openedExhibitionId);
  const afterOpen = await request(makeApp(cardsRouter), 'GET', movedPath);
  assert.equal(afterOpen.status, 200);
  assert.equal(afterOpen.body.dailyOpenCount, 1);

  const afterOpenSelection = readSelection(afterOpen);
  assert.equal(afterOpenSelection.get(exhibitionSlotIndex).eventId, wideExhibition.id);
  for (const [slotIndex, selection] of firstSelection) {
    if (slotIndex === exhibitionSlotIndex) continue;
    assert.deepEqual(afterOpenSelection.get(slotIndex), selection);
  }
  assert.equal([...afterOpenSelection.values()].some(({ eventId }) => eventId === newHighPerformance.id), false);
  assert.equal([...afterOpenSelection.values()].some(({ eventId }) => eventId === newHighPopup.id), false);
  assert.deepEqual(
    radiusCalls.filter((call) => call.phase === 'after-open').map((call) => call.radius),
    [3_000, 10_000, 50_000],
  );
  assert.equal(fallbackCalls, 0);
  assert.equal(assignmentWrites.length, 3);
  assert.equal(dailySlots.get(exhibitionSlotIndex).eventId, wideExhibition.id);
  assert.equal(
    dailySlots.get(firstByCategory.get('공연').slotIndex).eventId,
    initialPerformance.id,
  );
  assert.equal(dailySlots.get(firstByCategory.get('팝업').slotIndex).eventId, initialPopup.id);
});

test('GET /api/cards/v2/today preserves three popup positions and uses the open-card advisory namespace', async () => {
  const popupCandidates = Array.from({ length: 5 }, (_, index) => ({
    id: `popup-only-${index + 1}`,
    title: `팝업 전용 후보 ${index + 1}`,
    content_key: `popup-only-key-${index + 1}`,
    main_category: '팝업',
    venue: '팝업 거리',
    region: '서울',
    start_at: isoDaysFromNow(-1),
    end_at: isoDaysFromNow(10),
    image_url: null,
    overview: null,
    created_at: isoDaysFromNow(-5),
    buzz_score: 100 - index,
  }));
  const eventById = new Map(popupCandidates.map((event) => [event.id, event]));
  const dailySlots = new Map();
  const impressions = new Map();
  let fallbackReadCount = 0;

  const cardDb = mockCardClient(async (sql) => {
    const text = String(sql);
    if (text.includes('SELECT event_id FROM user_card_impressions')) {
      return { rows: [] };
    }
    if (text.includes('user_likes')) return { rows: [] };
    if (text.includes('FROM user_tickets')) {
      return { rows: [{ ticket_count: 0, daily_earned: 0, daily_earned_date: todayKst() }] };
    }
    if (text.includes('MAX(el.earn_date)')) return { rows: [] };
    if (text.includes('FROM user_ticket_earn_log el')) return { rows: [{ count: 0 }] };
    if (text.includes('FROM canonical_events')) {
      fallbackReadCount += 1;
      assert.doesNotMatch(text, /distance_m/);
      return { rows: popupCandidates };
    }
    throw new Error(`Unexpected popup-only query: ${text}`);
  }, {
    readSlots: async () => ({
      rows: [...dailySlots].flatMap(([slot_index, slot]) => {
        const event = eventById.get(slot.eventId);
        return event ? [{
          ...event,
          slot_index,
          slot_category: slot.category,
          slot_event_id: slot.eventId,
          slot_usable: true,
        }] : [];
      }),
    }),
    writeAssignments: async (params, text) => {
      const [assignedUserId, assignedOn, slotIndexes, categories, eventIds] = params;
      assert.equal(assignedUserId, userId);
      assert.equal(assignedOn, todayKst());
      assert.deepEqual(slotIndexes, [0, 1, 2]);
      assert.deepEqual(categories, ['팝업', '팝업', '팝업']);
      assert.equal(new Set(eventIds).size, 3);
      assert.match(text, /ON CONFLICT \(user_id, slot_index\)/);
      dailySlots.clear();
      slotIndexes.forEach((slotIndex, index) => dailySlots.set(slotIndex, {
        category: categories[index],
        eventId: eventIds[index],
      }));
      eventIds.forEach((eventId) => impressions.set(eventId, assignedOn));
      return { rows: [], rowCount: eventIds.length };
    },
  });

  const readPositions = (response) => new Map(response.body.lockedCards.map((card, slotIndex) => {
    const payload = openLockedCard(card.cardToken);
    assert.ok(payload);
    return [slotIndex, {
      eventId: payload.eventId,
      category: card.category,
      visualSeed: card.visualSeed,
    }];
  }));

  const first = await request(makeApp(cardsRouter), 'GET', '/v2/today');
  const second = await request(makeApp(cardsRouter), 'GET', '/v2/today');
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  const firstPositions = readPositions(first);
  const secondPositions = readPositions(second);
  assert.equal(firstPositions.size, 3);
  assert.equal([...firstPositions.values()].every((slot) => slot.category === '팝업'), true);
  assert.deepEqual(secondPositions, firstPositions);
  assert.equal(dailySlots.size, 3);
  assert.equal(fallbackReadCount, 1);
  assert.deepEqual(cardDb.transactions, [
    ['BEGIN', 'xact-lock', 'assignment', 'COMMIT', 'release'],
    ['BEGIN', 'xact-lock', 'assignment', 'COMMIT', 'release'],
  ]);
  assert.equal(cardDb.connectCount, 2);
  assert.equal(cardDb.releaseCount, 2);
  assert.equal(cardDb.lockQueries.length, 2);
});

test('GET /api/cards/v2/today never falls back to lifetime-opened ids or dedupe aliases', async () => {
  let canonicalCalls = 0;
  mockCardClient(async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('user_card_impressions')) return { rows: [] };
    if (text.includes('user_likes')) return { rows: [] };
    if (text.includes('FROM user_tickets')) {
      return { rows: [{ ticket_count: 2, daily_earned: 0, daily_earned_date: todayKst() }] };
    }
    if (text.includes('MAX(el.earn_date)')) return { rows: [] };
    if (text.includes('FROM user_ticket_earn_log el')) {
      assert.doesNotMatch(text, /earn_date\s*>=/);
      assert.match(text, /COUNT\(\*\)::int AS count/);
      return { rows: [{ count: 0 }] };
    }
    if (text.includes('FROM canonical_events')) {
      canonicalCalls += 1;
      assert.deepEqual(params, [todayKst(), userId, 60, 300]);
      assert.match(text, /NOT EXISTS[\s\S]*FROM user_card_opened_keys opened/);
      assert.match(text, /opened\.key_type = 'event_id'/);
      assert.match(text, /ARRAY_REMOVE\(ARRAY\[event\.content_key, event\.canonical_key\], NULL\)/);
      // SQL anti-join이 event id와 same-culture alias 모두를 걸러낸 실제 DB 결과.
      return { rows: [] };
    }
    throw new Error(`Unexpected lifetime v2 query: ${text}`);
  });

  const { status, body } = await request(makeApp(cardsRouter), 'GET', '/v2/today');

  assert.equal(status, 200);
  assert.deepEqual(body.lockedCards, []);
  assert.equal(body.dailyOpenCount, 0);
  assert.equal(canonicalCalls, 1);
});

test('POST /api/cards/v2/open rejects a stale token after a lifetime dedupe match', async () => {
  const cardToken = sealLockedCard({
    userId,
    eventId: 'new-row-same-content',
    assignedOn: todayKst(),
    walkMinutes: null,
    reasonTags: [],
  });
  let rewardMutationAttempted = false;
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (text.includes('FROM ad_reward_attempts')) {
        return { rows: [{ attempt_id: 'stale-attempt' }], rowCount: 1 };
      }
      if (text.includes('FROM canonical_events') && text.includes('WHERE id::text = $1')) {
        return {
          rows: [{
            id: 'new-row-same-content',
            title: '동일 콘텐츠의 새 row',
            content_key: 'same-culture',
            canonical_key: null,
            main_category: '전시',
            end_at: isoDaysFromNow(10),
          }],
          rowCount: 1,
        };
      }
      if (text.includes('pg_advisory_xact_lock')) {
        assert.deepEqual(params, [userId]);
        assert.match(text, /culturecard-open/);
        return { rows: [{}], rowCount: 1 };
      }
      if (text.includes('SELECT 1') && text.includes('FROM user_card_opened_keys')) {
        assert.deepEqual(params, [userId, 'new-row-same-content', 'same-culture', null]);
        assert.match(text, /key_type IN \('content_key', 'canonical_key'\)/);
        return { rows: [{ '?column?': 1 }], rowCount: 1 };
      }
      if (/INSERT INTO user_card_opened_keys|INSERT INTO user_ticket_earn_log|UPDATE user_tickets/.test(text)) {
        rewardMutationAttempted = true;
      }
      throw new Error(`Unexpected stale-token query: ${text}`);
    },
    release() {},
  };
  pool.connect = async () => client;

  const { status, body } = await request(makeApp(cardsRouter), 'POST', '/v2/open', {
    cardToken,
    adAttemptId: 'stale-attempt',
  });

  assert.equal(status, 409);
  assert.equal(body.error, 'EVENT_ALREADY_OPENED');
  assert.equal(rewardMutationAttempted, false);
});

test('GET /api/cards/today explains weighted taste personalization', async () => {
  mockCardClient(async (sql) => {
    const text = String(sql);
    if (text.includes('user_card_impressions')) return { rows: [] };
    if (text.includes('user_likes')) {
      assert.match(text, /3::int AS weight/);
      assert.match(text, /4::int AS weight/);
      assert.match(text, /FROM user_visit_log/);
      return {
        rows: [
          { category: '전시', n: '8', signal_count: '6' },
          { category: '공연', n: '2', signal_count: '2' },
        ],
      };
    }
    if (text.includes('FROM user_tickets')) {
      return { rows: [{ ticket_count: 3, daily_earned: 1, daily_earned_date: todayKst() }] };
    }
    if (text.includes('FROM user_ticket_earn_log')) return { rows: [] };
    if (text.includes('FROM canonical_events')) {
      return {
        rows: [
          { id: 'taste-exhibition', title: '취향 전시', main_category: '전시', venue: 'A관', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(20), image_url: null, overview: null, buzz_score: 30 },
          { id: 'taste-performance', title: '취향 공연', main_category: '공연', venue: 'B홀', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(20), image_url: null, overview: null, buzz_score: 20 },
          { id: 'explore-popup', title: '탐색 팝업', main_category: '팝업', venue: 'C존', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(20), image_url: null, overview: null, buzz_score: 10 },
        ],
      };
    }
    throw new Error(`Unexpected query: ${text}`);
  });

  const { status, body } = await request(makeApp(cardsRouter), 'GET', '/today');

  assert.equal(status, 200);
  assert.equal(body.personalization.level, 'established');
  assert.equal(body.personalization.signalCount, 8);
  assert.deepEqual(body.personalization.topCategories.map((item) => item.category), ['전시', '공연']);
  assert.equal(
    [...body.today, ...body.morePool]
      .find((card) => card.eventId === 'taste-exhibition')
      .reasonTags.includes('취향 전시'),
    true,
  );
});

test('GET /api/cards/today expands nearby radius, excludes opened events, diversifies categories, and fills walkMinutes', async () => {
  const lat = 37.5665;
  const lng = 126.9780;
  const canonicalCalls = [];
  mockCardClient(async (sql, params = []) => {
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
      assert.match(text, /NOT EXISTS[\s\S]*FROM user_card_opened_keys opened/);
      assert.equal(params[0], lat);
      assert.equal(params[1], lng);
      assert.equal(params[3], userId);

      if (canonicalCalls.length === 1) {
        assert.ok(params.includes(3000));
        return {
          rows: [
            { id: 'event-near-exhibition', title: '가까운 전시', main_category: '전시', venue: 'A관', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '전시 소개', distance_m: 160, buzz_score: 20 },
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
  });

  const { status, body } = await request(makeApp(cardsRouter), 'GET', `/today?lat=${lat}&lng=${lng}`);

  assert.equal(status, 200);
  assert.ok(canonicalCalls.length >= 3);
  // 반경 확장이 3km→10km→50km로 일어났는지(파라미터로 검증)
  const radiiUsed = canonicalCalls.flatMap((call) => call.params).filter((p) => [3000, 10000, 50000].includes(p));
  assert.ok(radiiUsed.includes(3000) && radiiUsed.includes(10000) && radiiUsed.includes(50000));
  // v2 점수화는 시드로 매일 회전 → 정확한 eventId는 비결정적. 카테고리 다양성은 우선순위 고정이라 결정적.
  assert.equal(body.today.length, 3);
  assert.deepEqual(
    new Set(body.today.map((card) => card.category)),
    new Set(['전시', '공연', '팝업']),
  );
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
  mockCardClient(async (sql) => {
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
  });

  const { status, body } = await request(makeApp(cardsRouter), 'GET', '/today');

  assert.equal(status, 200);
  const surfaced = [...body.today, ...body.morePool].map((c) => c.eventId);
  assert.equal(surfaced.includes('event-a'), false);
  assert.equal(surfaced.includes('event-b'), false);
  assert.equal(body.today.length, 3);
});

test('GET /api/cards/today relaxes impression exclusion when the pool would be empty', async () => {
  const ev = (id, cat) => ({ id, title: id, main_category: cat, venue: 'V', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: null, buzz_score: 10, created_at: null });
  mockCardClient(async (sql) => {
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
  });

  const { status, body } = await request(makeApp(cardsRouter), 'GET', '/today');

  assert.equal(status, 200);
  assert.ok(body.today.length >= 1);
});

test('GET /api/cards/today keeps partial nearby candidates and fills the rest from fallback', async () => {
  const lat = 37.5665;
  const lng = 126.9780;
  const canonicalCalls = [];
  mockCardClient(async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('FROM user_daily_card_slots slot')) return { rows: [] };
    if (text.includes('SELECT event_id FROM user_card_impressions')) return { rows: [] };
    if (
      text.includes('WITH selected AS') &&
      text.includes('INSERT INTO user_daily_card_slots') &&
      text.includes('INSERT INTO user_card_impressions')
    ) {
      return { rows: [], rowCount: params[3]?.length ?? 0 };
    }
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
  });

  const { status, body } = await request(makeApp(cardsRouter), 'GET', `/today?lat=${lat}&lng=${lng}`);

  assert.equal(status, 200);
  assert.ok(canonicalCalls.some((call) => call.text.includes('distance_m')));
  assert.ok(canonicalCalls.some((call) => !call.text.includes('distance_m')));
  assert.deepEqual(
    new Set(body.today.map((card) => card.eventId)),
    new Set(['near-1', 'near-2', 'fallback-1']),
  );
});

test('GET /api/cards/today lifetime-excludes opened identities with the ledger anti-join', async () => {
  let canonicalSql = '';
  mockCardClient(async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('user_card_impressions')) return { rows: [] };
    if (text.includes('user_likes')) return { rows: [] };
    if (text.includes('FROM user_tickets')) {
      return { rows: [{ ticket_count: 5, daily_earned: 1, daily_earned_date: todayKst() }] };
    }
    if (text.includes('FROM canonical_events')) {
      canonicalSql = text;
      assert.deepEqual(params, [todayKst(), userId, 60, 300]);
      assert.match(text, /NOT EXISTS[\s\S]*FROM user_card_opened_keys opened/);
      assert.match(text, /opened\.key_type = 'event_id'/);
      assert.match(text, /opened\.key_type IN \('content_key', 'canonical_key'\)/);
      return {
        // duplicate-old-show는 same-show ledger alias로 SQL에서 이미 제외된 결과다.
        rows: [
          { id: 'fresh-1', content_key: 'fresh-1', canonical_key: null, title: '새 전시', main_category: '전시', venue: 'A관', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '신규 후보', buzz_score: 30 },
          { id: 'fresh-2', content_key: 'fresh-2', canonical_key: null, title: '새 공연', main_category: '공연', venue: 'B홀', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '신규 후보', buzz_score: 20 },
          { id: 'fresh-3', content_key: 'fresh-3', canonical_key: null, title: '새 팝업', main_category: '팝업', venue: 'C존', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: '신규 후보', buzz_score: 10 },
        ],
      };
    }
    throw new Error(`Unexpected query: ${text}`);
  });

  const { status, body } = await request(makeApp(cardsRouter), 'GET', '/today');

  assert.equal(status, 200);
  assert.ok(canonicalSql);
  assert.deepEqual(
    new Set(body.today.map((card) => card.eventId)),
    new Set(['fresh-1', 'fresh-2', 'fresh-3']),
  );
  assert.equal(body.morePool.some((card) => card.eventId === 'duplicate-old-show'), false);
});

test('POST /api/visits records a self-report stamp without location or reward', async () => {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      queries.push(text);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('INSERT INTO event_archive_snapshots')) {
        assert.equal(params[0], 'event-visit-1');
        assert.match(text, /ON CONFLICT \(event_id\) DO UPDATE/);
        return { rows: [{ event_id: 'event-visit-1' }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO user_visit_log')) {
        assert.equal(params[0], userId);
        assert.equal(params[1], 'event-visit-1');
        return { rows: [{ id: 'visit-1' }], rowCount: 1 };
      }
      if (text.includes('COUNT(DISTINCT vl.event_id)') && text.includes('FROM user_visit_log')) {
        assert.match(text, /JOIN event_archive_snapshots/);
        return { rows: [{ count: '5' }], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
    release() {},
  };
  pool.connect = async () => client;

  const { status, body } = await request(makeApp(visitsRouter), 'POST', '/', { eventId: 'event-visit-1' });

  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.alreadyVisited, false);
  assert.equal(body.stampCount, 5);
  // 자기신고: 위치/보상/티켓 업데이트 없음. 기록+snapshot만 원자 처리.
  assert.equal(body.bonusTickets, undefined);
  assert.equal(body.verified, undefined);
  assert.equal(queries.some((sql) => /FOR UPDATE|UPDATE user_tickets/i.test(sql)), false);
  assert.equal(queries.includes('BEGIN'), true);
  assert.equal(queries.includes('COMMIT'), true);
});

test('POST /api/visits is idempotent for an already stamped event', async () => {
  const client = {
    async query(sql) {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (text.includes('INSERT INTO event_archive_snapshots')) return { rows: [{ event_id: 'event-visit-1' }], rowCount: 1 };
      if (text.includes('INSERT INTO user_visit_log')) return { rows: [], rowCount: 0 };
      if (text.includes('COUNT(DISTINCT vl.event_id)') && text.includes('FROM user_visit_log')) return { rows: [{ count: '5' }], rowCount: 1 };
      throw new Error(`Unexpected query: ${text}`);
    },
    release() {},
  };
  pool.connect = async () => client;

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
    if (text.includes('SELECT DISTINCT vl.event_id') && text.includes('FROM user_visit_log')) {
      assert.match(text, /JOIN event_archive_snapshots/);
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
  const monthVisitedParams = [];
  const stampParams = [];
  pool.query = async (sql, params) => {
    const text = String(sql);
    if (text.includes('COUNT(DISTINCT el.event_id)') && text.includes('FROM user_ticket_earn_log el') && !text.includes('earn_date >=')) {
      assert.match(text, /JOIN event_archive_snapshots/);
      return { rows: [{ count: '5' }] };
    }
    if (text.includes('COUNT(DISTINCT vl.event_id)') && text.includes('FROM user_visit_log vl') && !text.includes('visited_at') && !text.includes('GROUP BY archive.region')) {
      return { rows: [{ count: '3' }] };
    }
    if (text.includes('earn_date >=') && text.includes('FROM user_ticket_earn_log el')) {
      seenParams.push(params);
      assert.match(params[1], /^\d{4}-\d{2}-01$/);
      return { rows: [{ count: '3' }] };
    }
    if (text.includes('COUNT(DISTINCT archive.region)') && text.includes('FROM user_ticket_earn_log el')) {
      return { rows: [{ count: '3' }] };
    }
    if (text.includes('SELECT DISTINCT archive.category') && text.includes('FROM user_ticket_earn_log el')) {
      return { rows: [{ category: '전시회' }, { category: '미디어 전시' }, { category: '뮤지컬' }, { category: '클래스' }] };
    }
    if (text.includes('COUNT(DISTINCT archive.region)') && text.includes('FROM user_visit_log vl')) {
      return { rows: [{ count: '2' }] };
    }
    if (text.includes('COUNT(DISTINCT vl.event_id)') && text.includes('vl.visited_at')) {
      monthVisitedParams.push(params);
      assert.match(params[1], /^\d{4}-\d{2}-01$/);
      return { rows: [{ count: '2' }] };
    }
    if (text.includes('SELECT archive.region, COUNT(DISTINCT vl.event_id)::int AS count')) {
      return { rows: [{ region: '성동구', count: '2' }, { region: '용산구', count: '1' }] };
    }
    if (text.includes('ORDER BY vl.visited_at ASC, vl.event_id ASC')) {
      return {
        rows: [
          { event_id: 'event-1', category: '전시', region: '성동구', visited_at: '2026-06-30T03:00:00.000Z' },
          { event_id: 'event-4', category: '미디어 전시', region: '성동구', visited_at: '2026-07-02T03:00:00.000Z' },
          { event_id: 'event-2', category: '공연', region: '용산구', visited_at: '2026-07-01T03:00:00.000Z' },
        ],
      };
    }
    if (text.includes('GROUP BY archive.category') && text.includes('user_ticket_earn_log')) {
      return { rows: [{ category: '전시' }, { category: '팝업' }, { category: '기타' }] };
    }
    if (text.includes('SELECT DISTINCT vl.event_id') && text.includes('FROM user_visit_log')) {
      return { rows: [{ event_id: 'event-1' }, { event_id: 'event-2' }, { event_id: 'event-4' }, { event_id: 'event-old' }] };
    }
    if (text.includes('WITH latest_discovery AS')) {
      assert.deepEqual(params, [userId, null, null, 51]);
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
            status: 'active',
          },
        ],
      };
    }
    if (text.includes('FROM user_visit_log vl') && text.includes('LEFT JOIN canonical_events')) {
      stampParams.push(params);
      return {
        rows: [
          { event_id: 'event-4', title: '전시 넷', category: '미디어 전시', region: '성동구', venue: '언더스탠드에비뉴', image_url: null, visited_at: '2026-07-02T03:00:00.000Z', status: 'ended' },
          { event_id: 'event-2', title: '공연 둘', category: '공연', region: '용산구', venue: '노들섬', image_url: 'http://img/2.jpg', visited_at: '2026-07-01T03:00:00.000Z', status: 'active' },
          { event_id: 'event-1', title: '전시 하나', category: '전시', region: '성동구', venue: '성수 코사이어티', image_url: null, visited_at: '2026-06-30T03:00:00.000Z', status: 'removed' },
        ],
      };
    }
    throw new Error(`Unexpected query: ${text}`);
  };

  const { status, body } = await request(makeApp(passportRouter), 'GET', '/');

  assert.equal(status, 200);
  assert.match(body.passportNo, /^\d{4}$/);
  assert.equal(body.discoveredCount, 5);
  assert.equal(body.visitedCount, 3);
  assert.equal(body.monthDiscovered, 3);
  assert.equal(body.regionsDiscovered, 3);
  assert.equal(body.categoriesDiscovered, 3);
  assert.equal(body.regionsVisited, 2);
  assert.equal(body.monthVisited, 2);
  assert.deepEqual(body.topRegions, [
    { region: '성동구', count: 2 },
    { region: '용산구', count: 1 },
  ]);
  assert.deepEqual(body.tasteCategories, ['전시', '팝업', '기타']);
  assert.deepEqual(body.stamps, [
    { eventId: 'event-4', title: '전시 넷', category: '전시', region: '성동구', venue: '언더스탠드에비뉴', imageUrl: null, visitedAt: '2026-07-02T03:00:00.000Z', isFirstInRegion: false, isFirstInCategory: false, status: 'ended' },
    { eventId: 'event-2', title: '공연 둘', category: '공연', region: '용산구', venue: '노들섬', imageUrl: 'http://img/2.jpg', visitedAt: '2026-07-01T03:00:00.000Z', isFirstInRegion: true, isFirstInCategory: true, status: 'active' },
    { eventId: 'event-1', title: '전시 하나', category: '전시', region: '성동구', venue: '성수 코사이어티', imageUrl: null, visitedAt: '2026-06-30T03:00:00.000Z', isFirstInRegion: true, isFirstInCategory: true, status: 'removed' },
  ]);
  assert.deepEqual(body.visitedEventIds, ['event-1', 'event-2', 'event-4', 'event-old']);
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
      status: 'active',
    },
  ]);
  assert.deepEqual(body.discoveredPageInfo, { limit: 50, hasMore: false, nextCursor: null });
  assert.equal(seenParams.length, 1);
  assert.equal(monthVisitedParams.length, 1);
});

test('GET /api/passport loads older stamp books by query', async () => {
  let stampParams = null;
  pool.query = async (sql, params) => {
    const text = String(sql);
    if (text.includes('COUNT(DISTINCT el.event_id)') && text.includes('FROM user_ticket_earn_log el') && !text.includes('earn_date >=')) {
      return { rows: [{ count: '0' }] };
    }
    if (text.includes('COUNT(DISTINCT vl.event_id)') && text.includes('FROM user_visit_log vl') && !text.includes('visited_at') && !text.includes('GROUP BY archive.region')) {
      return { rows: [{ count: '72' }] };
    }
    if (text.includes('earn_date >=') && text.includes('FROM user_ticket_earn_log el')) {
      return { rows: [{ count: '0' }] };
    }
    if (text.includes('COUNT(DISTINCT archive.region)') && text.includes('FROM user_ticket_earn_log el')) {
      return { rows: [{ count: '0' }] };
    }
    if (text.includes('SELECT DISTINCT archive.category') && text.includes('FROM user_ticket_earn_log el')) {
      return { rows: [] };
    }
    if (text.includes('COUNT(DISTINCT archive.region)') && text.includes('FROM user_visit_log vl')) {
      return { rows: [{ count: '1' }] };
    }
    if (text.includes('COUNT(DISTINCT vl.event_id)') && text.includes('vl.visited_at')) {
      return { rows: [{ count: '0' }] };
    }
    if (text.includes('SELECT archive.region, COUNT(DISTINCT vl.event_id)::int AS count')) {
      return { rows: [{ region: '서울', count: '72' }] };
    }
    if (text.includes('ORDER BY vl.visited_at ASC, vl.event_id ASC')) {
      return {
        rows: [
          {
            event_id: 'event-old',
            category: '전시',
            region: '서울',
            visited_at: '2026-01-01T03:00:00.000Z',
          },
        ],
      };
    }
    if (text.includes('GROUP BY archive.category') && text.includes('user_ticket_earn_log')) {
      return { rows: [] };
    }
    if (text.includes('SELECT DISTINCT vl.event_id') && text.includes('FROM user_visit_log')) {
      return { rows: [{ event_id: 'event-old' }] };
    }
    if (text.includes('WITH latest_discovery AS')) {
      return { rows: [] };
    }
    if (text.includes('FROM user_visit_log vl') && text.includes('LEFT JOIN canonical_events')) {
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
            status: 'ended',
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

test('GET /api/passport/discovered cursor-paginates archived ended and removed cards', async () => {
  const firstDiscoveredAt = '2026-07-10T03:00:00.000Z';
  let call = 0;
  pool.query = async (sql, params) => {
    const text = String(sql);
    assert.match(text, /WITH latest_discovery AS/);
    assert.match(text, /JOIN event_archive_snapshots/);
    assert.match(text, /LEFT JOIN canonical_events/);
    call += 1;

    if (call === 1) {
      assert.deepEqual(params, [userId, null, null, 2]);
      return {
        rows: [
          {
            event_id: 'event-ended',
            title: '종료된 전시',
            display_title: null,
            category: '전시',
            region: '서울',
            venue: '미술관',
            image_url: null,
            start_at: null,
            end_at: '2026-07-01T03:00:00.000Z',
            lat: null,
            lng: null,
            discovered_at: firstDiscoveredAt,
            status: 'ended',
          },
          {
            event_id: 'event-extra',
            title: '다음 카드',
            display_title: null,
            category: '공연',
            region: null,
            venue: null,
            image_url: null,
            start_at: null,
            end_at: null,
            lat: null,
            lng: null,
            discovered_at: '2026-07-09T03:00:00.000Z',
            status: 'removed',
          },
        ],
      };
    }

    assert.equal(params[1], firstDiscoveredAt);
    assert.equal(params[2], 'event-ended');
    assert.equal(params[3], 2);
    return {
      rows: [
        {
          event_id: 'event-removed',
          title: '제공 종료 행사',
          display_title: null,
          category: '기타',
          region: null,
          venue: null,
          image_url: null,
          start_at: null,
          end_at: null,
          lat: null,
          lng: null,
          discovered_at: '2026-07-08T03:00:00.000Z',
          status: 'removed',
        },
      ],
    };
  };

  const first = await request(makeApp(passportRouter), 'GET', '/discovered?limit=1');
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 1);
  assert.equal(first.body.items[0].status, 'ended');
  assert.equal(first.body.pageInfo.hasMore, true);
  assert.equal(typeof first.body.pageInfo.nextCursor, 'string');

  const second = await request(
    makeApp(passportRouter),
    'GET',
    `/discovered?limit=1&cursor=${encodeURIComponent(first.body.pageInfo.nextCursor)}`,
  );
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.items.map((item) => item.status), ['removed']);
  assert.deepEqual(second.body.pageInfo, { limit: 1, hasMore: false, nextCursor: null });
});

test('GET /api/passport/discovered rejects malformed cursors before querying', async () => {
  pool.query = async () => { throw new Error('must not query for an invalid cursor'); };
  const { status, body } = await request(makeApp(passportRouter), 'GET', '/discovered?cursor=not-a-cursor');
  assert.equal(status, 400);
  assert.equal(body.error, 'INVALID_DISCOVERED_CURSOR');
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
