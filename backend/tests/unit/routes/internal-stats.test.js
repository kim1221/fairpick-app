process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret';
process.env.STATS_TOKEN = 'test-stats-token';
require('ts-node/register');

const assert = require('node:assert/strict');
const test = require('node:test');

const { pool } = require('../../../src/db');
const internalStatsRouter = require('../../../src/routes/internalStats').default;

/**
 * 감시 서버(miniapp-watch)가 읽는 운영 지표 엔드포인트.
 *
 * 이게 인증 없이 열리면 우리 지출·유저 규모가 외부에 그대로 노출된다.
 * 그래서 토큰이 **비어 있을 때도 반드시 401**이어야 한다 —
 * "설정 안 됨"을 "인증 불필요"로 흘려보내는 게 전형적인 사고 경로다.
 */

const TOKEN = 'test-stats-token';

function request(path, headers) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(path, 'http://unit.test');
    const req = {
      headers: headers ?? {},
      method: 'GET',
      url: `${parsedUrl.pathname}${parsedUrl.search}`,
      originalUrl: `${parsedUrl.pathname}${parsedUrl.search}`,
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
    internalStatsRouter.handle(req, res, (err) => {
      if (err) reject(err);
      else reject(new Error(`No response for GET ${path}`));
    });
  });
}

/**
 * 집계 SQL 5본을 내용으로 식별해 고정된 숫자를 돌려준다.
 * 실행된 SQL을 전부 모아두므로 "쓰기가 섞였는지"도 여기서 검증한다.
 */
function mockStatsPool(overrides = {}) {
  const executed = [];
  let connectCalls = 0;

  pool.query = async (sql, params) => {
    const text = String(sql);
    executed.push({ text, params });

    if (text.includes('FROM user_ticket_exchanges')) {
      return {
        rows: [
          {
            completed_count: overrides.completedCount ?? 3,
            won: overrides.won ?? 90,
            failed_count: overrides.failedCount ?? 1,
          },
        ],
      };
    }
    if (text.includes('FROM users')) {
      return { rows: [{ count: overrides.newUsers ?? 7 }] };
    }
    if (text.includes('WITH opens AS')) {
      return {
        rows: [
          {
            cards_opened: overrides.cardsOpened ?? 42,
            active_users: overrides.activeUsers ?? 11,
          },
        ],
      };
    }
    if (text.includes('FROM ad_reward_attempt_events')) {
      return {
        rows: [{ rewarded: overrides.adsRewarded ?? 40, failures: overrides.adFailures ?? 2 }],
      };
    }
    if (text.includes('FROM user_collection_badges')) {
      return { rows: [{ count: overrides.badges ?? 5 }] };
    }
    throw new Error(`unexpected query: ${text.slice(0, 120)}`);
  };

  pool.connect = async () => {
    connectCalls += 1;
    throw new Error('daily-stats must not open a transaction');
  };

  return {
    executed,
    get connectCalls() {
      return connectCalls;
    },
  };
}

function yesterdayKst() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

test('토큰 없이 호출하면 401', async () => {
  mockStatsPool();
  const res = await request('/daily-stats');
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'UNAUTHORIZED');
});

test('틀린 토큰도 401', async () => {
  mockStatsPool();
  const res = await request('/daily-stats', { authorization: 'Bearer wrong' });
  assert.equal(res.status, 401);
});

test('STATS_TOKEN이 비어 있으면 올바른 형식이어도 401 (열어두지 않는다)', async () => {
  mockStatsPool();
  const saved = process.env.STATS_TOKEN;
  process.env.STATS_TOKEN = '';
  try {
    const res = await request('/daily-stats', { authorization: 'Bearer ' });
    assert.equal(res.status, 401);
    const unset = await request('/daily-stats', { authorization: 'Bearer undefined' });
    assert.equal(unset.status, 401);
  } finally {
    process.env.STATS_TOKEN = saved;
  }
});

test('올바른 토큰이면 감시 서버와 합의한 형태로 지표를 준다', async () => {
  mockStatsPool();
  const res = await request('/daily-stats?date=2026-08-02', {
    authorization: `Bearer ${TOKEN}`,
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    date: '2026-08-02',
    spentWon: 90,
    users: { new: 7, active: 11 },
    actions: { cardsOpened: 42, adsRewarded: 40, adFailures: 2, collectionBadges: 5 },
    exchanges: { count: 3, won: 90, failed: 1 },
  });
});

test('date를 안 주면 어제(KST)를 집계한다', async () => {
  const mock = mockStatsPool();
  const res = await request('/daily-stats', { authorization: `Bearer ${TOKEN}` });

  assert.equal(res.status, 200);
  assert.equal(res.body.date, yesterdayKst());
  // KST 하루는 [00:00+09:00, 다음날 00:00+09:00) 반개구간이어야 한다.
  const exchangeQuery = mock.executed.find((q) => q.text.includes('FROM user_ticket_exchanges'));
  assert.equal(exchangeQuery.params[0], `${yesterdayKst()}T00:00:00+09:00`);
  assert.ok(exchangeQuery.params[1] > exchangeQuery.params[0]);
});

test('쓰기가 아니라 읽기다 — SELECT만 나가고 트랜잭션을 열지 않는다', async () => {
  const mock = mockStatsPool();
  const res = await request('/daily-stats?days=3', { authorization: `Bearer ${TOKEN}` });

  assert.equal(res.status, 200);
  assert.ok(mock.executed.length > 0);
  assert.equal(mock.connectCalls, 0, 'pool.connect()를 쓰면 트랜잭션 경로다');
  for (const { text } of mock.executed) {
    assert.match(text.trimStart(), /^(SELECT|WITH)\b/, `읽기 전용이 아니다: ${text.slice(0, 60)}`);
    assert.doesNotMatch(
      text,
      /\b(INSERT|UPDATE|DELETE|BEGIN|COMMIT|TRUNCATE|ALTER|DROP|FOR UPDATE)\b/i,
      `쓰기 구문이 섞였다: ${text.slice(0, 80)}`,
    );
  }
});

test('?days=N 이면 어제부터 N일치를 배열로 준다 (기준선 계산용)', async () => {
  mockStatsPool();
  const res = await request('/daily-stats?days=5', { authorization: `Bearer ${TOKEN}` });

  assert.equal(res.status, 200);
  assert.equal(res.body.days.length, 5);
  // 최신(어제)이 먼저, 과거로 내려간다
  assert.equal(res.body.days[0].date, yesterdayKst());
  assert.ok(res.body.days[0].date > res.body.days[4].date);
  for (const day of res.body.days) {
    assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof day.spentWon, 'number');
    assert.equal(typeof day.users.active, 'number');
    assert.equal(typeof day.exchanges.failed, 'number');
  }
});

test('days 범위를 벗어나면 단일 날짜로 처리한다', async () => {
  mockStatsPool();
  for (const days of ['999', '0', '-1', 'abc']) {
    const res = await request(`/daily-stats?days=${days}`, {
      authorization: `Bearer ${TOKEN}`,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.days, undefined, `단일 객체여야 한다 (days=${days})`);
    assert.equal(res.body.date, yesterdayKst());
  }
});

test('이상한 date는 조용히 어제로 떨어뜨린다 (SQL로 안 흘려보낸다)', async () => {
  mockStatsPool();
  const res = await request("/daily-stats?date=2026-08-02'%20OR%201=1", {
    authorization: `Bearer ${TOKEN}`,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.date, yesterdayKst());
});
