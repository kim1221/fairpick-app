require('ts-node/register/transpile-only');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  POPGA_API_HEADERS,
  PopgaApiContractError,
  buildPopgaListUrl,
  fetchPopgaEventList,
  parsePopgaDetailResponse,
  parsePopgaListResponse,
} = require('../../../src/jobs/popgaApiClient');
const {
  popgaEventStatus,
  requirePopgaEventDate,
  resolvePopgaEndDate,
  stablePopgaEventId,
} = require('../../../src/jobs/popgaEventFields');
const { latestDailyScheduleBoundaryMs } = require('../../../src/lib/scheduleBoundary');

function listBody({ content, number = 0, size = 2, totalElements, totalPages }) {
  return {
    result: { code: 20000000, desc: 'success' },
    data: {
      content,
      page: { size, number, totalElements, totalPages },
    },
  };
}

test('parses the current Popga list response contract', () => {
  const body = listBody({
    content: [
      { id: 8002, title: '오프레임 팝업' },
      { id: 8001, title: '허그유어스킨 팝업' },
    ],
    totalElements: 316,
    totalPages: 158,
  });

  const parsed = parsePopgaListResponse(body, 0);
  assert.equal(parsed.content.length, 2);
  assert.equal(parsed.page.totalElements, 316);
  assert.equal(parsed.page.totalPages, 158);
});

test('walks every list page with the new indexed query parameters', async () => {
  const fixtures = [
    listBody({
      content: [{ id: 3, title: '셋' }, { id: 2, title: '둘' }],
      number: 0,
      totalElements: 3,
      totalPages: 2,
    }),
    listBody({
      content: [{ id: 1, title: '하나' }],
      number: 1,
      totalElements: 3,
      totalPages: 2,
    }),
  ];
  const calls = [];
  const get = async (url, config) => {
    const parsedUrl = new URL(url);
    const page = Number(parsedUrl.searchParams.get('page'));
    calls.push({ parsedUrl, config });
    return { data: fixtures[page] };
  };

  const result = await fetchPopgaEventList({ get, pageSize: 2, pageDelayMs: 0 });

  assert.deepEqual(result.map((item) => item.id), [3, 2, 1]);
  assert.deepEqual(calls.map(({ parsedUrl }) => Number(parsedUrl.searchParams.get('page'))), [0, 1]);
  assert.equal(calls[0].parsedUrl.pathname, '/api/spots/search');
  assert.equal(calls[0].parsedUrl.searchParams.get('periodTypes[0]'), 'IN_PROGRESS');
  assert.equal(calls[0].parsedUrl.searchParams.get('periodTypes[1]'), 'READY');
  assert.equal(calls[0].config.headers.Origin, POPGA_API_HEADERS.Origin);
});

test('rejects the old HTTP-200 error envelope instead of treating it as an empty list', () => {
  assert.throws(
    () => parsePopgaListResponse({
      result: { code: 50000000, desc: '서버 에러' },
      data: null,
    }),
    (error) => error instanceof PopgaApiContractError && /50000000/.test(error.message),
  );
});

test('allows a genuinely empty source only at the API parser boundary', async () => {
  const empty = listBody({
    content: [],
    size: 50,
    totalElements: 0,
    totalPages: 0,
  });

  assert.deepEqual(parsePopgaListResponse(empty, 0).content, []);
  const result = await fetchPopgaEventList({
    get: async () => ({ data: empty }),
    pageDelayMs: 0,
  });
  assert.deepEqual(result, []);
});

test('rejects a contradictory empty page at the parser boundary', () => {
  assert.throws(
    () => parsePopgaListResponse(listBody({
      content: [],
      totalElements: 3,
      totalPages: 2,
    })),
    /3건을 보고했지만/,
  );
});

test('re-crawls once when pagination totals change mid-walk and merges both passes', async () => {
  // 1차 순회: page1에서 총계가 2→3으로 늘어 드리프트 감지(늘어난 page2까지 따라감).
  const firstCrawl = [
    listBody({ content: [{ id: 2, title: '둘' }], number: 0, size: 1, totalElements: 2, totalPages: 2 }),
    listBody({ content: [{ id: 1, title: '하나' }], number: 1, size: 1, totalElements: 3, totalPages: 3 }),
    listBody({ content: [{ id: 0, title: '영' }], number: 2, size: 1, totalElements: 3, totalPages: 3 }),
  ];
  // 2차 순회: 안정된 목록(새 항목 3 포함) — 드리프트 없음.
  const secondCrawl = [
    listBody({ content: [{ id: 3, title: '셋' }], number: 0, size: 1, totalElements: 3, totalPages: 3 }),
    listBody({ content: [{ id: 2, title: '둘' }], number: 1, size: 1, totalElements: 3, totalPages: 3 }),
    listBody({ content: [{ id: 1, title: '하나' }], number: 2, size: 1, totalElements: 3, totalPages: 3 }),
  ];
  let calls = 0;
  const get = async (url) => {
    const page = Number(new URL(url).searchParams.get('page'));
    calls += 1;
    return { data: calls <= firstCrawl.length ? firstCrawl[page] : secondCrawl[page] };
  };

  const result = await fetchPopgaEventList({ get, pageSize: 1, pageDelayMs: 0 });

  assert.equal(calls, 6);
  // 두 순회의 합집합 — 1차에서 본 항목 위치가 유지되고 새 항목이 뒤에 붙는다.
  assert.deepEqual(result.map((item) => item.id).sort(), [0, 1, 2, 3]);
});

test('skips an item repeated across pages instead of failing the run', async () => {
  // 순회 중 새 항목이 앞에 끼어들면 같은 id가 두 페이지에 걸쳐 나온다.
  const pages = [
    listBody({ content: [{ id: 9, title: '아홉' }, { id: 8, title: '여덟' }], number: 0, size: 2, totalElements: 3, totalPages: 2 }),
    listBody({ content: [{ id: 8, title: '여덟' }], number: 1, size: 2, totalElements: 3, totalPages: 2 }),
  ];
  let calls = 0;
  const get = async (url) => {
    calls += 1;
    return { data: pages[Number(new URL(url).searchParams.get('page'))] };
  };

  const result = await fetchPopgaEventList({ get, pageSize: 2, pageDelayMs: 0 });

  // 드리프트로 재순회(2회 × 2페이지)하지만 실패하지 않고 유니크 항목을 돌려준다.
  assert.equal(calls, 4);
  assert.deepEqual(result.map((item) => item.id), [9, 8]);
});

test('tolerates counter drift: one hidden record passes quietly, a larger gap keeps collected items', async () => {
  const oneHidden = listBody({
    content: [{ id: 1, title: '공개 항목' }],
    number: 0,
    size: 2,
    totalElements: 2,
    totalPages: 1,
  });
  let oneHiddenCalls = 0;
  const result = await fetchPopgaEventList({
    get: async () => {
      oneHiddenCalls += 1;
      return { data: oneHidden };
    },
    pageSize: 2,
    pageDelayMs: 0,
  });
  assert.equal(result.length, 1);
  // 상시적인 비공개 1건 오차는 드리프트가 아니므로 재순회하지 않는다.
  assert.equal(oneHiddenCalls, 1);

  const twoMissing = listBody({
    content: [{ id: 1, title: '공개 항목' }],
    number: 0,
    size: 3,
    totalElements: 3,
    totalPages: 1,
  });
  let twoMissingCalls = 0;
  const collected = await fetchPopgaEventList({
    get: async () => {
      twoMissingCalls += 1;
      return { data: twoMissing };
    },
    pageSize: 3,
    pageDelayMs: 0,
  });
  // 큰 오차는 재순회를 한 번 더 하고, 그래도 같으면 수집분으로 진행한다(전면 실패 금지).
  assert.equal(twoMissingCalls, 2);
  assert.deepEqual(collected.map((item) => item.id), [1]);
});

test('validates the detail response id and title', () => {
  const detail = parsePopgaDetailResponse({
    result: { code: 20000000, desc: 'success' },
    data: { id: 8002, title: '오프레임 팝업', files: [] },
  }, 8002);
  assert.equal(detail.title, '오프레임 팝업');

  assert.throws(
    () => parsePopgaDetailResponse({
      result: { code: 20000000, desc: 'success' },
      data: { id: 9999, title: '다른 팝업' },
    }, 8002),
    /ID 불일치/,
  );
  assert.throws(
    () => parsePopgaDetailResponse({
      result: { code: 20000000, desc: 'success' },
      data: null,
    }),
    /data 객체가 없습니다/,
  );
});

test('builds the production list URL on popga.co.kr/api', () => {
  const url = new URL(buildPopgaListUrl(4, 50));
  assert.equal(url.origin, 'https://popga.co.kr');
  assert.equal(url.pathname, '/api/spots/search');
  assert.equal(url.searchParams.get('page'), '4');
  assert.equal(url.searchParams.get('size'), '50');
});

test('keeps explicit dates and gives open-ended Popga events a rolling 30-day TTL', () => {
  assert.equal(requirePopgaEventDate('2026.07.03', '시작일', 7787), '2026-07-03');
  assert.deepEqual(resolvePopgaEndDate('2026-07-31', '2026-07-03', 7787, Date.UTC(2026, 6, 14)), {
    endAt: '2026-07-31',
    openEnded: false,
  });
  assert.deepEqual(resolvePopgaEndDate(null, '2026-07-03', 7787, Date.UTC(2026, 6, 14)), {
    endAt: '2026-08-13',
    openEnded: true,
  });
  assert.deepEqual(resolvePopgaEndDate(null, '2026-08-01', 7787, Date.UTC(2026, 6, 14)), {
    endAt: '2026-08-31',
    openEnded: true,
  });
  assert.throws(() => requirePopgaEventDate('2026-02-30', '시작일', 7787), /유효한 날짜/);
  assert.equal(popgaEventStatus('2026-07-15', '2026-07-31', Date.UTC(2026, 6, 14)), 'scheduled');
  assert.equal(popgaEventStatus('2026-07-01', '2026-07-31', Date.UTC(2026, 6, 14)), 'ongoing');
  assert.equal(popgaEventStatus('2026-06-01', '2026-06-30', Date.UTC(2026, 6, 14)), 'ended');
});

test('startup catch-up uses yesterday boundary before 06:00 and today boundary after it', () => {
  const beforeSix = Date.parse('2026-07-13T19:43:00Z'); // 2026-07-14 04:43 KST
  const afterSix = Date.parse('2026-07-13T21:01:00Z');  // 2026-07-14 06:01 KST

  assert.equal(
    new Date(latestDailyScheduleBoundaryMs(beforeSix, 6, 0)).toISOString(),
    '2026-07-12T21:00:00.000Z',
  );
  assert.equal(
    new Date(latestDailyScheduleBoundaryMs(afterSix, 6, 0)).toISOString(),
    '2026-07-13T21:00:00.000Z',
  );
});

test('uses a stable canonical UUID for the same Popga source id', () => {
  const first = stablePopgaEventId(8002);
  assert.equal(first, stablePopgaEventId('8002'));
  assert.notEqual(first, stablePopgaEventId(8001));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
