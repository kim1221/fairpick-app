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

function mockCardClient(query, { readSlots, writeAssignments, freshPool } = {}) {
  const state = {
    connectCount: 0,
    releaseCount: 0,
    lockQueries: [],
    transactions: [],
    capUpdates: [],
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
        // 동적 캡: 신선 풀 카운트(기본 320 = 풀 충분 → 캡 50, 기존 테스트 동작 유지)
        if (text.includes('fresh_pool_count')) {
          return freshPool ? freshPool(params, text) : { rows: [{ fresh: 320 }], rowCount: 1 };
        }
        if (text.includes('SET daily_open_cap')) {
          state.capUpdates.push({ params });
          return { rows: [], rowCount: 1 };
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
  assert.equal(body.dailyLimit, 50);
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
    // "?" 슬롯은 티저까지 은닉, 카테고리 슬롯은 티저 카피 제공(스펙 §3.3)
    if (preview.slotType === 'mystery') {
      assert.equal(preview.teaserEyebrow, null);
      assert.equal(preview.teaserHeadline, null);
      assert.equal(preview.category, null);
    } else {
      assert.equal(preview.slotType, 'category');
      assert.equal(typeof preview.teaserEyebrow, 'string');
      assert.equal(typeof preview.teaserHeadline, 'string');
    }
    assert.equal(typeof preview.palette.background, 'string');
  }
  assert.equal(todayResponse.body.lockedCards.filter((card) => card.slotType === 'mystery').length, 1);
  assert.equal(todayResponse.body.dailyOpenCount, 1);
  assert.equal(todayResponse.body.dailyOpenLimit, 50);
  assert.equal(todayResponse.body.weeklyDiscovery.items.length, 1);
  assert.equal(todayResponse.body.weeklyDiscovery.items[0].eventId, opened.id);

  await new Promise((resolve) => setImmediate(resolve));
  // 미스터리 슬롯이 어느 카드를 가리든 상관없게 토큰 복호화로 카드를 찾는다.
  const findByEvent = (eventId) => todayResponse.body.lockedCards.find(
    (card) => openLockedCard(card.cardToken).eventId === eventId,
  );
  const token = findByEvent('locked-a').cardToken;
  const cappedToken = findByEvent('locked-b').cardToken;
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
  assert.equal(openedResponse.body.earned, 1);
  assert.equal(openedResponse.body.dailyOpenCount, 1);
  assert.equal(openedResponse.body.dailyOpenLimit, 50);
  assert.ok(['category', 'mystery'].includes(openedResponse.body.reveal.slotType));
  assert.equal(openedResponse.body.reveal.hidden, false); // buzz 40 < HIDDEN_BUZZ_MIN(70)
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
  // 카테고리 슬롯 2개는 서로 다른 핵심 카테고리, "?" 슬롯 1개는 카테고리 은닉.
  const coreCategorySlots = body.lockedCards.filter((card) => card.slotType === 'category');
  assert.equal(coreCategorySlots.length, 2);
  assert.equal(body.lockedCards.filter((card) => card.slotType === 'mystery').length, 1);
  assert.equal(new Set(coreCategorySlots.map((card) => card.category)).size, 2);
  for (const card of coreCategorySlots) {
    assert.ok(['전시', '공연', '팝업'].includes(card.category));
  }
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
  // 핵심 카테고리 후보는 전시(최근 노출 1장뿐)·공연 각 1장만 둔다 — 일별 셔플이 어떤 순서든
  // 카테고리 슬롯 2개 = (완화된) 전시 + 공연으로 확정되고, "?" 슬롯은 남는 축제를 가져간다.
  const freshCandidates = [
    { id: 'recent-only-exhibition', title: '최근에 본 유일한 전시', content_key: 'recent-only-exhibition-key', main_category: '전시', venue: '전시관', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(10), image_url: null, overview: null, buzz_score: 1 },
    { id: 'fresh-performance-1', title: '새 공연 1', content_key: 'fresh-performance-key-1', main_category: '공연', venue: '공연장', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(10), image_url: null, overview: null, buzz_score: 90 },
    { id: 'fresh-festival-1', title: '새 축제 1', content_key: 'fresh-festival-key-1', main_category: '축제', venue: '광장', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(10), image_url: null, overview: null, buzz_score: 60 },
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
  // 카테고리 슬롯 2개 = 완화된 전시 + 새 공연, "?" 슬롯 1개 = 카테고리 은닉(null).
  const coreSlots = body.lockedCards.filter((card) => card.slotType === 'category');
  const mysterySlots = body.lockedCards.filter((card) => card.slotType === 'mystery');
  assert.equal(coreSlots.length, 2);
  assert.equal(mysterySlots.length, 1);
  assert.equal(mysterySlots[0].category, null);
  assert.deepEqual(
    new Set(coreSlots.map((card) => card.category)),
    new Set(['전시', '공연']),
  );
  const decodedIds = body.lockedCards.map((card) => openLockedCard(card.cardToken).eventId);
  assert.equal(decodedIds.includes('recent-only-exhibition'), true);
  // 완화로 살아난 전시 카드는 카테고리 슬롯(은닉 아님)에 배정된다.
  const exhibitionSlot = coreSlots.find((card) => card.category === '전시');
  assert.equal(openLockedCard(exhibitionSlot.cardToken).eventId, 'recent-only-exhibition');
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
  // "?" 슬롯 위치·카테고리 배치는 일별 셔플을 따르므로, 어느 카테고리를 열어도
  // 검증할 수 있게 보충 후보(50km 전용)와 신규 고점수 카드를 카테고리별로 준비한다.
  const wideByCategory = new Map([
    ['전시', candidate('wide-exhibition', '전시', 40_000)],
    ['공연', candidate('wide-performance', '공연', 40_000)],
    ['팝업', candidate('wide-popup', '팝업', 40_000)],
  ]);
  // 첫 배정 뒤 새로 유입되며, pin이 없다면 기존 카드보다 점수가 높다.
  const newHighByCategory = new Map([
    ['전시', candidate('new-high-exhibition', '전시', 350, { fresh: true, buzz: 100 })],
    ['공연', candidate('new-high-performance', '공연', 450, { fresh: true, buzz: 100 })],
    ['팝업', candidate('new-high-popup', '팝업', 550, { fresh: true, buzz: 100 })],
  ]);
  const eventById = new Map([
    initialExhibition,
    initialPerformance,
    initialPopup,
    ...wideByCategory.values(),
    ...newHighByCategory.values(),
  ].map((event) => [event.id, event]));
  const previousKstDay = new Date(Date.now() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const impressions = new Map([
    [initialPerformance.id, previousKstDay],
    ...Array.from({ length: 9 }, (_, index) => [`older-performance-${index + 1}`, previousKstDay]),
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

      const openedCategories = new Set(
        [...openedEventIds].map((id) => eventById.get(id).main_category),
      );
      const rows = [initialExhibition, initialPerformance, initialPopup]
        .filter((event) => !openedEventIds.has(event.id));
      if (assignmentWrites.length > 0) {
        // 열지 않은 카테고리에만 새 고점수 카드가 유입된다(핀 보호 검증용).
        for (const [category, event] of newHighByCategory) {
          if (!openedCategories.has(category)) rows.push(event);
        }
      }
      if (radius === 50_000) {
        // 연 카테고리의 보충 후보는 50km 반경에서만 나타난다(반경 확장 검증용).
        for (const [category, event] of wideByCategory) {
          if (openedCategories.has(category)) rows.push(event);
        }
      }
      return { rows };
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
          slot_type: slot.slotType,
        }] : [];
      }),
    }),
    writeAssignments: async (params) => {
      const [assignedUserId, assignedOn, slotIndexes, categories, eventIds, slotTypes] = params;
      assert.equal(assignedUserId, userId);
      assert.equal(assignedOn, todayKst());
      assert.equal(new Set(slotIndexes).size, slotIndexes.length);
      assert.equal(slotTypes.filter((slotType) => slotType === 'mystery').length, 1);
      assignmentWrites.push({
        slotIndexes: slotIndexes.slice(),
        categories: categories.slice(),
        eventIds: eventIds.slice(),
        slotTypes: slotTypes.slice(),
      });
      dailySlots.clear();
      slotIndexes.forEach((slotIndex, index) => dailySlots.set(slotIndex, {
        category: categories[index],
        eventId: eventIds[index],
        slotType: slotTypes[index],
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
      slotType: card.slotType,
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
  // 첫 배정 = 근처 3장. 어느 슬롯이 "?"인지는 일별 셔플에 달렸지만 구성은 결정적이다.
  assert.deepEqual(
    new Set([...firstSelection.values()].map((selection) => selection.eventId)),
    new Set([initialExhibition.id, initialPerformance.id, initialPopup.id]),
  );
  const mysteryEntries = [...firstSelection].filter(([, selection]) => selection.slotType === 'mystery');
  assert.equal(mysteryEntries.length, 1);
  assert.equal(mysteryEntries[0][1].category, null);
  for (const [, selection] of firstSelection) {
    if (selection.slotType !== 'category') continue;
    assert.equal(selection.category, eventById.get(selection.eventId).main_category);
  }
  assert.deepEqual(secondSelection, firstSelection);
  assert.deepEqual(
    second.body.lockedCards.map((card) => ({ category: card.category, visualSeed: card.visualSeed })),
    first.body.lockedCards.map((card) => ({ category: card.category, visualSeed: card.visualSeed })),
  );
  assert.equal(impressions.get(initialExhibition.id), todayKst());
  assert.equal(impressions.get(initialPerformance.id), todayKst());
  assert.equal(impressions.get(initialPopup.id), todayKst());
  for (const [slotIndex, selection] of firstSelection) {
    assert.equal(dailySlots.get(slotIndex).eventId, selection.eventId);
  }
  assert.equal(radiusCalls.some((call) => call.phase === 'same-day'), false);
  assert.ok(impressionReadCounts[0] >= 10);

  // 카테고리 슬롯 하나를 연다("?" 슬롯 개봉·재보충은 별도 테스트에서 다룬다).
  const [openSlotIndex, openSelection] = [...firstSelection]
    .find(([, selection]) => selection.slotType === 'category');
  const openedCategory = eventById.get(openSelection.eventId).main_category;
  openedEventIds.add(openSelection.eventId);
  const afterOpen = await request(makeApp(cardsRouter), 'GET', movedPath);
  assert.equal(afterOpen.status, 200);
  assert.equal(afterOpen.body.dailyOpenCount, 1);

  const afterOpenSelection = readSelection(afterOpen);
  // 연 슬롯만 50km 보충 후보로 교체되고, 나머지("?" 포함)는 그대로 핀 유지.
  assert.equal(afterOpenSelection.get(openSlotIndex).eventId, wideByCategory.get(openedCategory).id);
  assert.equal(afterOpenSelection.get(openSlotIndex).slotType, 'category');
  for (const [slotIndex, selection] of firstSelection) {
    if (slotIndex === openSlotIndex) continue;
    assert.deepEqual(afterOpenSelection.get(slotIndex), selection);
  }
  // 새로 유입된 고점수 카드는 핀 덕에 어떤 슬롯도 밀어내지 못한다.
  for (const event of newHighByCategory.values()) {
    assert.equal([...afterOpenSelection.values()].some(({ eventId }) => eventId === event.id), false);
  }
  assert.deepEqual(
    radiusCalls.filter((call) => call.phase === 'after-open').map((call) => call.radius),
    [3_000, 10_000, 50_000],
  );
  assert.equal(fallbackCalls, 0);
  assert.equal(assignmentWrites.length, 3);
  assert.equal(dailySlots.get(openSlotIndex).eventId, wideByCategory.get(openedCategory).id);
  for (const [slotIndex, selection] of firstSelection) {
    if (slotIndex === openSlotIndex) continue;
    assert.equal(dailySlots.get(slotIndex).eventId, selection.eventId);
  }
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
          slot_type: slot.slotType,
        }] : [];
      }),
    }),
    writeAssignments: async (params, text) => {
      const [assignedUserId, assignedOn, slotIndexes, categories, eventIds, slotTypes] = params;
      assert.equal(assignedUserId, userId);
      assert.equal(assignedOn, todayKst());
      assert.deepEqual(slotIndexes, [0, 1, 2]);
      // "?" 슬롯도 실제 카드 카테고리로 기록된다(핀 복원용) — slot_type으로만 구분.
      assert.deepEqual(categories, ['팝업', '팝업', '팝업']);
      assert.deepEqual(slotTypes, ['category', 'category', 'mystery']);
      assert.equal(new Set(eventIds).size, 3);
      assert.match(text, /ON CONFLICT \(user_id, slot_index\)/);
      dailySlots.clear();
      slotIndexes.forEach((slotIndex, index) => dailySlots.set(slotIndex, {
        category: categories[index],
        eventId: eventIds[index],
        slotType: slotTypes[index],
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
      slotType: card.slotType,
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
  const popupCategorySlots = [...firstPositions.values()].filter((slot) => slot.slotType === 'category');
  assert.equal(popupCategorySlots.length, 2);
  assert.equal(popupCategorySlots.every((slot) => slot.category === '팝업'), true);
  const popupMysterySlots = [...firstPositions.values()].filter((slot) => slot.slotType === 'mystery');
  assert.equal(popupMysterySlots.length, 1);
  assert.equal(popupMysterySlots[0].category, null);
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

test('GET /api/cards/v2/today hides every content cue on the "?" slot but keeps a decodable token', async () => {
  const freshCandidates = [
    { id: 'hide-exhibition', title: '숨김 전시', content_key: 'hide-a', main_category: '전시', venue: 'A관', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: 'https://img/a.jpg', overview: 'A 소개', buzz_score: 40 },
    { id: 'hide-performance', title: '숨김 공연', content_key: 'hide-b', main_category: '공연', venue: 'B홀', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(6), image_url: null, overview: 'B 소개', buzz_score: 30 },
    { id: 'hide-popup', title: '숨김 팝업', content_key: 'hide-c', main_category: '팝업', venue: 'C존', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(7), image_url: null, overview: 'C 소개', buzz_score: 20 },
    { id: 'hide-festival', title: '숨김 축제', content_key: 'hide-d', main_category: '축제', venue: '광장', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(8), image_url: null, overview: 'D 소개', buzz_score: 10 },
  ];
  mockCardClient(async (sql) => {
    const text = String(sql);
    if (text.includes('user_card_impressions')) return { rows: [] };
    if (text.includes('user_likes')) return { rows: [] };
    if (text.includes('FROM user_tickets')) {
      return { rows: [{ ticket_count: 0, daily_earned: 0, daily_earned_date: todayKst() }] };
    }
    if (text.includes('MAX(el.earn_date)')) return { rows: [] };
    if (text.includes('FROM user_ticket_earn_log el')) return { rows: [{ count: 0 }] };
    if (text.includes('FROM canonical_events')) return { rows: freshCandidates };
    throw new Error(`Unexpected mystery-hiding query: ${text}`);
  });

  const { status, body } = await request(makeApp(cardsRouter), 'GET', '/v2/today');

  assert.equal(status, 200);
  const mysteryCard = body.lockedCards.find((card) => card.slotType === 'mystery');
  assert.ok(mysteryCard);
  // "?" 슬롯은 내용 단서를 전부 은닉한다(스펙 §3.3).
  assert.equal(mysteryCard.category, null);
  assert.equal(mysteryCard.areaLabel, null);
  assert.equal(mysteryCard.distanceLabel, null);
  assert.equal(mysteryCard.timingLabel, null);
  assert.equal(mysteryCard.teaserEyebrow, null);
  assert.equal(mysteryCard.teaserHeadline, null);
  assert.deepEqual(mysteryCard.reasonTags, []);
  // 토큰·티켓 스킨 시드는 유지되고, 토큰에는 발급 시점의 slotType이 봉인된다.
  assert.equal(typeof mysteryCard.visualSeed, 'string');
  assert.equal(typeof mysteryCard.palette.background, 'string');
  const mysteryPayload = openLockedCard(mysteryCard.cardToken);
  assert.equal(mysteryPayload.slotType, 'mystery');
  assert.equal(freshCandidates.some((event) => event.id === mysteryPayload.eventId), true);
  for (const card of body.lockedCards) {
    if (card.slotType !== 'category') continue;
    assert.equal(typeof card.category, 'string');
    assert.equal(typeof card.areaLabel, 'string');
    assert.equal(typeof card.timingLabel, 'string');
    assert.equal(openLockedCard(card.cardToken).slotType, 'category');
  }

  await new Promise((resolve) => setImmediate(resolve));
});

test('GET /api/cards/v2/today picks the "?" card deterministically from the daily seed', async () => {
  // 저장된 슬롯이 없어도(핀 미보존) 같은 날 반복 조회는 같은 배치·같은 "?" 카드를 내야 한다.
  // Math.random이 섞이면 남는 후보 4장 중 무엇이 "?"가 될지 호출마다 달라진다.
  const freshCandidates = [
    { id: 'det-exhibition', title: '결정 전시', content_key: 'det-a', main_category: '전시', venue: 'A관', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(5), image_url: null, overview: null, buzz_score: 40 },
    { id: 'det-performance', title: '결정 공연', content_key: 'det-b', main_category: '공연', venue: 'B홀', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(6), image_url: null, overview: null, buzz_score: 30 },
    { id: 'det-popup', title: '결정 팝업', content_key: 'det-c', main_category: '팝업', venue: 'C존', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(7), image_url: null, overview: null, buzz_score: 20 },
    { id: 'det-festival-1', title: '결정 축제 1', content_key: 'det-d1', main_category: '축제', venue: '광장1', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(8), image_url: null, overview: null, buzz_score: 85 },
    { id: 'det-festival-2', title: '결정 축제 2', content_key: 'det-d2', main_category: '축제', venue: '광장2', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(8), image_url: null, overview: null, buzz_score: 80 },
    { id: 'det-festival-3', title: '결정 축제 3', content_key: 'det-d3', main_category: '축제', venue: '광장3', region: '서울', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(8), image_url: null, overview: null, buzz_score: 75 },
  ];
  mockCardClient(async (sql) => {
    const text = String(sql);
    if (text.includes('user_card_impressions')) return { rows: [] };
    if (text.includes('user_likes')) return { rows: [] };
    if (text.includes('FROM user_tickets')) {
      return { rows: [{ ticket_count: 0, daily_earned: 0, daily_earned_date: todayKst() }] };
    }
    if (text.includes('MAX(el.earn_date)')) return { rows: [] };
    if (text.includes('FROM user_ticket_earn_log el')) return { rows: [{ count: 0 }] };
    if (text.includes('FROM canonical_events')) return { rows: freshCandidates };
    throw new Error(`Unexpected mystery-determinism query: ${text}`);
  });

  const first = await request(makeApp(cardsRouter), 'GET', '/v2/today');
  const second = await request(makeApp(cardsRouter), 'GET', '/v2/today');
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  const layout = (response) => response.body.lockedCards.map((card) => ({
    slotType: card.slotType,
    eventId: openLockedCard(card.cardToken).eventId,
  }));
  const firstLayout = layout(first);
  assert.deepEqual(layout(second), firstLayout);
  // 저장된 슬롯이 없으면 "?"는 항상 마지막 슬롯 고정이다.
  assert.deepEqual(
    firstLayout.map((slot) => slot.slotType),
    ['category', 'category', 'mystery'],
  );

  await new Promise((resolve) => setImmediate(resolve));
});

test('POST /api/cards/v2/open reveals slot type from the token and flags high-buzz mystery cards as hidden', async () => {
  const highBuzzEvent = {
    id: 'hidden-gem',
    title: '고버즈 히든 카드',
    content_key: 'hidden-gem-key',
    canonical_key: null,
    main_category: '공연',
    region: '서울',
    venue: '비밀 공연장',
    start_at: isoDaysFromNow(-1),
    end_at: isoDaysFromNow(9),
    image_url: null,
    overview: '히든 소개',
    buzz_score: 90, // HIDDEN_BUZZ_MIN(70) 이상
  };
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (text.includes('FROM ad_reward_attempts')) {
        return { rows: [{ attempt_id: params[0] }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO event_archive_snapshots')) {
        return { rows: [{ event_id: highBuzzEvent.id }], rowCount: 1 };
      }
      if (text.includes('FROM canonical_events')) {
        return { rows: [highBuzzEvent], rowCount: 1 };
      }
      if (text.includes('pg_advisory_xact_lock')) return { rows: [{}], rowCount: 1 };
      if (text.includes('SELECT 1') && text.includes('FROM user_card_opened_keys')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('INSERT INTO user_card_opened_keys')) {
        return { rows: [{ expected_count: 2, inserted_count: 2 }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO user_ticket_earn_log')) return { rows: [{ id: 'earn-hidden' }], rowCount: 1 };
      if (text.includes('INSERT INTO user_tickets')) return { rows: [], rowCount: 1 };
      if (text.includes('FROM user_tickets') && text.includes('FOR UPDATE')) {
        return { rows: [{ ticket_count: 0, daily_earned: 0, daily_earned_date: todayKst() }], rowCount: 1 };
      }
      if (text.includes('COUNT(*)::int AS count') && text.includes('user_ticket_earn_log')) {
        return { rows: [{ count: 0 }], rowCount: 1 };
      }
      if (text.includes('UPDATE user_tickets')) return { rows: [{ ticket_count: 1, total_earned: 1 }], rowCount: 1 };
      if (text.includes('UPDATE user_ticket_earn_log')) return { rows: [], rowCount: 1 };
      if (text.includes('UPDATE ad_reward_attempts')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected reveal query: ${text}`);
    },
    release() {},
  };
  pool.connect = async () => client;

  // "?" 슬롯 토큰: reveal은 mystery이고, 고버즈라 히든 카드 프레임을 받는다.
  const mysteryToken = sealLockedCard({
    userId,
    eventId: highBuzzEvent.id,
    assignedOn: todayKst(),
    walkMinutes: 12,
    reasonTags: [],
    slotType: 'mystery',
  });
  const mysteryResponse = await request(makeApp(cardsRouter), 'POST', '/v2/open', {
    cardToken: mysteryToken,
    adAttemptId: 'attempt-mystery',
  });
  assert.equal(mysteryResponse.status, 200);
  assert.deepEqual(mysteryResponse.body.reveal, { slotType: 'mystery', hidden: true });
  assert.equal(mysteryResponse.body.card.eventId, highBuzzEvent.id);
  assert.equal(mysteryResponse.body.card.title, highBuzzEvent.title);

  // 과거 발급 토큰(slotType 없음)은 category로 해석되고, 고버즈여도 hidden이 아니다.
  const legacyToken = sealLockedCard({
    userId,
    eventId: highBuzzEvent.id,
    assignedOn: todayKst(),
    walkMinutes: null,
    reasonTags: [],
  });
  const legacyResponse = await request(makeApp(cardsRouter), 'POST', '/v2/open', {
    cardToken: legacyToken,
    adAttemptId: 'attempt-legacy',
  });
  assert.equal(legacyResponse.status, 200);
  assert.deepEqual(legacyResponse.body.reveal, { slotType: 'category', hidden: false });
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

// ── 경제 상수·교환 금액 추첨 (스펙 2026-07-19 §2.3·§2.4) ──────────────────────

const {
  DAILY_OPEN_LIMIT: ECON_DAILY_OPEN_LIMIT,
  DAILY_TICKET_LIMIT: ECON_DAILY_TICKET_LIMIT,
  TICKETS_PER_OPEN,
  EXCHANGE_AMOUNT_TABLE,
  drawExchangeAmount,
} = require('../../../src/services/ticketGrant');

test('tickets are fixed at 1 per open and the daily ticket limit follows the open limit', () => {
  assert.equal(TICKETS_PER_OPEN, 1);
  assert.equal(ECON_DAILY_TICKET_LIMIT, ECON_DAILY_OPEN_LIMIT);
});

test('exchange amount table has EV 20.0 and the draw maps rand boundaries to table entries', () => {
  const totalWeight = EXCHANGE_AMOUNT_TABLE.reduce((sum, e) => sum + e.weight, 0);
  const ev = EXCHANGE_AMOUNT_TABLE.reduce((sum, e) => sum + e.amount * e.weight, 0) / totalWeight;
  assert.equal(ev, 20.0);

  // 누적 가중치 경계에서의 매핑 (weights: 500/200/120/100/60/16/4, total 1000)
  assert.equal(drawExchangeAmount(() => 0), 10);
  assert.equal(drawExchangeAmount(() => 0.4999), 10);
  assert.equal(drawExchangeAmount(() => 0.5), 15);
  assert.equal(drawExchangeAmount(() => 0.9999), 500);

  // 어떤 rand에서도 테이블 밖 금액은 나오지 않는다
  const allowed = new Set(EXCHANGE_AMOUNT_TABLE.map((e) => e.amount));
  for (let i = 0; i < 200; i += 1) {
    assert.ok(allowed.has(drawExchangeAmount()));
  }
});

// ── S2: 지역 풀 기반 동적 오픈 캡 (스펙 §2.2) ──────────────────────────────

const {
  computeDailyOpenCap,
  resolveEffectiveOpenLimit,
} = require('../../../src/services/ticketGrant');

test('computeDailyOpenCap follows the spec formula and boundary values', () => {
  assert.equal(computeDailyOpenCap(1156), 50); // 서울 신규 — 풀 충분
  assert.equal(computeDailyOpenCap(300), 50);  // 풀 충분 경계
  assert.equal(computeDailyOpenCap(299), 42);  // floor(299/7)
  assert.equal(computeDailyOpenCap(156), 22);  // 서울 헤비
  assert.equal(computeDailyOpenCap(28), 4);    // 부산
  assert.equal(computeDailyOpenCap(10), 3);    // 플로어
  assert.equal(computeDailyOpenCap(2), 2);     // 풀 < 플로어 → 풀 크기
  assert.equal(computeDailyOpenCap(0), 0);     // pool_empty
});

test('resolveEffectiveOpenLimit only honors a cap stored for today', () => {
  const today = todayKst();
  assert.equal(resolveEffectiveOpenLimit({ daily_open_cap: 4, daily_open_cap_date: today }, today), 4);
  assert.equal(resolveEffectiveOpenLimit({ daily_open_cap: 999, daily_open_cap_date: today }, today), 50);
  assert.equal(resolveEffectiveOpenLimit({ daily_open_cap: 4, daily_open_cap_date: '2020-01-01' }, today), 50);
  assert.equal(resolveEffectiveOpenLimit({}, today), 50);
  assert.equal(resolveEffectiveOpenLimit(undefined, today), 50);
});

test('GET /api/cards/v2/today lowers the cap from the regional fresh pool and pins it', async () => {
  const freshCandidates = [
    ...Array.from({ length: 3 }, (_, index) => ({ id: `cap-exhibition-${index + 1}`, title: `전시 ${index + 1}`, content_key: `cap-ex-key-${index + 1}`, main_category: '전시', venue: '전시관', region: '부산', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(10), image_url: null, overview: null, buzz_score: 60 - index }),),
    ...Array.from({ length: 3 }, (_, index) => ({ id: `cap-performance-${index + 1}`, title: `공연 ${index + 1}`, content_key: `cap-pf-key-${index + 1}`, main_category: '공연', venue: '공연장', region: '부산', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(10), image_url: null, overview: null, buzz_score: 50 - index }),),
    ...Array.from({ length: 3 }, (_, index) => ({ id: `cap-popup-${index + 1}`, title: `팝업 ${index + 1}`, content_key: `cap-pp-key-${index + 1}`, main_category: '팝업', venue: '팝업존', region: '부산', start_at: isoDaysFromNow(-1), end_at: isoDaysFromNow(10), image_url: null, overview: null, buzz_score: 40 - index }),),
  ];

  const state = mockCardClient(async (sql) => {
    const text = String(sql);
    if (text.includes('SELECT event_id FROM user_card_impressions')) return { rows: [] };
    if (text.includes('user_likes')) return { rows: [] };
    if (text.includes('FROM user_tickets')) {
      return { rows: [{ ticket_count: 0, daily_earned: 0, daily_earned_date: todayKst() }] };
    }
    if (text.includes('MAX(el.earn_date)')) return { rows: [] };
    if (text.includes('FROM user_ticket_earn_log el')) return { rows: [{ count: 0 }] };
    if (text.includes('FROM canonical_events')) return { rows: freshCandidates };
    throw new Error(`Unexpected dynamic-cap query: ${text}`);
  }, {
    // 부산 헤비 유저 가정: 신선 풀 28 → 캡 4
    freshPool: async () => ({ rows: [{ fresh: 28 }], rowCount: 1 }),
    writeAssignments: async (params) => ({ rows: [], rowCount: params[4].length }),
  });

  const { status, body } = await request(makeApp(cardsRouter), 'GET', '/v2/today');

  assert.equal(status, 200);
  assert.equal(body.dailyOpenLimit, 4);
  assert.deepEqual(body.openCap, {
    base: 50,
    effective: 4,
    reason: 'regional_pool',
    regionLabel: null,
  });
  assert.equal(body.weeklyDiscovery.goal, 21);
  // 캡이 user_tickets에 고정 저장된다 (상향만 허용은 SQL GREATEST가 담당)
  assert.equal(state.capUpdates.length, 1);
  assert.equal(state.capUpdates[0].params[2], 4);
});
