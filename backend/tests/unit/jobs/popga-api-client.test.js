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

test('rejects a contradictory empty page and changing pagination totals', async () => {
  assert.throws(
    () => parsePopgaListResponse(listBody({
      content: [],
      totalElements: 3,
      totalPages: 2,
    })),
    /3건을 보고했지만/,
  );

  const fixtures = [
    listBody({
      content: [{ id: 2, title: '둘' }],
      number: 0,
      size: 1,
      totalElements: 2,
      totalPages: 2,
    }),
    listBody({
      content: [{ id: 1, title: '하나' }],
      number: 1,
      size: 1,
      totalElements: 3,
      totalPages: 3,
    }),
  ];

  await assert.rejects(
    fetchPopgaEventList({
      get: async (url) => ({ data: fixtures[Number(new URL(url).searchParams.get('page'))] }),
      pageSize: 1,
      pageDelayMs: 0,
    }),
    /페이지 순회 중 변경/,
  );
});

test('allows only Popga current one-record counter drift and rejects a larger gap', async () => {
  const oneHidden = listBody({
    content: [{ id: 1, title: '공개 항목' }],
    number: 0,
    size: 2,
    totalElements: 2,
    totalPages: 1,
  });
  const result = await fetchPopgaEventList({
    get: async () => ({ data: oneHidden }),
    pageSize: 2,
    pageDelayMs: 0,
  });
  assert.equal(result.length, 1);

  const twoMissing = listBody({
    content: [{ id: 1, title: '공개 항목' }],
    number: 0,
    size: 3,
    totalElements: 3,
    totalPages: 1,
  });
  await assert.rejects(
    fetchPopgaEventList({
      get: async () => ({ data: twoMissing }),
      pageSize: 3,
      pageDelayMs: 0,
    }),
    /총계 불일치/,
  );
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
