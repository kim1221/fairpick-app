require('ts-node/register/transpile-only');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  clusterByDateOverlap,
  overlapRemergeGroupKey,
} = require('../../../src/jobs/dedupeCanonicalEvents');

// 2026-07-19 프로덕션에서 실제로 발견된 중복 쌍들.
// KOPIS가 공연일을 정정하며 새 ID로 재등록 → 날짜가 겹치면 같은 공연(병합),
// 날짜가 분리돼 있으면 별개 회차(병합 금지).
function ev(id, startAt, endAt) {
  return { id, start_at: startAt, end_at: endAt };
}

test('merges KOPIS re-registrations whose date ranges overlap', () => {
  const overlappingPairs = [
    ['BOYNEXTDOOR', ev('a', '2026-07-31', '2026-08-02'), ev('b', '2026-08-01', '2026-08-02')],
    ['Red Velvet', ev('a', '2026-07-31', '2026-08-02'), ev('b', '2026-08-01', '2026-08-02')],
    ['SUPER JUNIOR', ev('a', '2026-07-24', '2026-07-26'), ev('b', '2026-07-25', '2026-07-26')],
    ['무명전설', ev('a', '2026-07-25', '2026-07-26'), ev('b', '2026-07-25', '2026-07-25')],
    ['유승우', ev('a', '2026-07-24', '2026-07-25'), ev('b', '2026-07-25', '2026-07-25')],
    ['사이버 매직쇼', ev('a', '2026-08-22', '2026-08-22'), ev('b', '2026-08-22', '2026-08-23')],
    // 경계일(8/7)을 공유하는 연장 재등록도 같은 공연이다.
    ['김현수 x 이벼리', ev('a', '2026-08-05', '2026-08-07'), ev('b', '2026-08-07', '2026-08-09')],
  ];

  for (const [label, a, b] of overlappingPairs) {
    const clusters = clusterByDateOverlap([a, b]);
    assert.equal(clusters.length, 1, `${label}: 겹치는 재등록은 하나의 클러스터여야 합니다`);
    assert.deepEqual(clusters[0].map((e) => e.id).sort(), ['a', 'b'], label);
  }
});

test('keeps disjoint runs of the same show separate (monthly reruns are not duplicates)', () => {
  const disjointPairs = [
    ['백설공주', ev('a', '2026-08-01', '2026-08-01'), ev('b', '2026-08-30', '2026-08-30')],
    ['신데렐라', ev('a', '2026-08-08', '2026-08-08'), ev('b', '2026-09-05', '2026-09-05')],
    ['노윤정 리사이틀', ev('a', '2026-08-15', '2026-08-15'), ev('b', '2026-08-23', '2026-08-23')],
    ['인어공주', ev('a', '2026-08-22', '2026-08-23'), ev('b', '2026-08-29', '2026-08-30')],
  ];

  for (const [label, a, b] of disjointPairs) {
    assert.deepEqual(clusterByDateOverlap([a, b]), [], `${label}: 분리된 회차는 병합하면 안 됩니다`);
  }
});

test('chains transitively overlapping ranges and unions them into one cluster', () => {
  const clusters = clusterByDateOverlap([
    ev('c', '2026-08-07', '2026-08-09'),
    ev('a', '2026-08-01', '2026-08-03'),
    ev('b', '2026-08-03', '2026-08-07'),
    ev('d', '2026-09-01', '2026-09-02'), // 분리 — 클러스터 밖
  ]);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].map((e) => e.id), ['a', 'b', 'c']);
});

test('ignores events without a start date instead of guessing', () => {
  assert.deepEqual(
    clusterByDateOverlap([ev('a', null, null), ev('b', '2026-08-01', '2026-08-02')]),
    [],
  );
});

test('groups by normalized title+venue+region+category and skips venue-less events', () => {
  const key = overlapRemergeGroupKey({
    title: '무명전설 전국투어 콘서트 [수원]',
    venue: '경희대학교 (선승관(종합체육관))',
    region: '경기',
    main_category: '공연',
  });
  const sameShow = overlapRemergeGroupKey({
    title: '콘서트 무명전설 전국투어 콘서트',
    venue: '경기 경희대학교',
    region: '경기',
    main_category: '공연',
  });
  assert.ok(key);
  assert.equal(key, sameShow);

  const otherVenue = overlapRemergeGroupKey({
    title: '무명전설 전국투어 콘서트',
    venue: '올림픽공원',
    region: '서울',
    main_category: '공연',
  });
  assert.notEqual(key, otherVenue);

  // venue가 없으면 동명 이벤트 오병합 위험 — 대상에서 제외한다.
  assert.equal(overlapRemergeGroupKey({
    title: '무명전설 전국투어 콘서트',
    venue: null,
    region: '경기',
    main_category: '공연',
  }), null);
});
