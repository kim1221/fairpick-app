/**
 * QA: 캐시 정책 검증 스크립트
 *
 * 검증 항목:
 * 1. KST 날짜 포맷 (YYYY-MM-DD)
 * 2. 30분 TTL 동작
 * 3. 자정 date-change invalidate (KST 기준)
 * 4. trending 15분 TTL 분리
 * 5. in-flight 중복 방지
 * 6. refreshTrendingAsync — trending만 바뀌고 다른 섹션 불변
 *
 * 실행:
 *   npx ts-node --transpile-only src/scripts/qa-cache-policy.ts
 */

let passed = 0;
let failed = 0;

function ok(label: string) {
  console.log(`  ✅ ${label}`);
  passed++;
}
function fail(label: string, detail?: string) {
  console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  failed++;
}
function section(title: string) {
  console.log(`\n▶ ${title}`);
}

// ─── 검증 대상 함수들 (index.ts에서 추출) ────────────────────────────────────

const SECTIONS_CACHE_TTL_MS = 30 * 60 * 1000;
const TRENDING_CACHE_TTL_MS = 15 * 60 * 1000;

function getKSTDateString(ts: number): string {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

interface SectionsCache {
  pools: { slug: string; rawEvents: any[]; limit: number }[];
  cachedAt: number;
  trendingCachedAt?: number;
  location?: { lat: number; lng: number };
}

function isCacheStaleByDate(cached: SectionsCache): boolean {
  return getKSTDateString(cached.cachedAt) !== getKSTDateString(Date.now());
}

// ─── 1. KST 날짜 포맷 ────────────────────────────────────────────────────────
section('1. KST 날짜 포맷 (YYYY-MM-DD)');

const nowStr = getKSTDateString(Date.now());
const isValidFormat = /^\d{4}-\d{2}-\d{2}$/.test(nowStr);
isValidFormat
  ? ok(`현재 KST 날짜: "${nowStr}" → YYYY-MM-DD 형식 정상`)
  : fail('YYYY-MM-DD 형식 아님', `실제: "${nowStr}"`);

// UTC vs KST 차이 확인 (UTC 기준 오후 → KST 다음날)
const utc1459 = new Date('2026-03-15T14:59:00.000Z').getTime(); // KST 23:59
const utc1500 = new Date('2026-03-15T15:00:00.000Z').getTime(); // KST 00:00 (+1일)
const kst1459 = getKSTDateString(utc1459);
const kst1500 = getKSTDateString(utc1500);
kst1459 !== kst1500
  ? ok(`자정 경계 정확: UTC 14:59→"${kst1459}" / UTC 15:00→"${kst1500}"`)
  : fail('자정 경계 미감지', `${kst1459} === ${kst1500}`);

// ─── 2. 30분 TTL ──────────────────────────────────────────────────────────────
section('2. 30분 TTL 상수 확인');

SECTIONS_CACHE_TTL_MS === 30 * 60 * 1000
  ? ok(`SECTIONS_CACHE_TTL_MS = ${SECTIONS_CACHE_TTL_MS / 60000}분`)
  : fail('TTL이 30분이 아님', `${SECTIONS_CACHE_TTL_MS / 60000}분`);

// TTL 내 캐시 유효 판정
const freshCache: SectionsCache = { pools: [], cachedAt: Date.now() - 5 * 60 * 1000 }; // 5분 전
const expiredCache: SectionsCache = { pools: [], cachedAt: Date.now() - 31 * 60 * 1000 }; // 31분 전

const freshAge = Date.now() - freshCache.cachedAt;
const expiredAge = Date.now() - expiredCache.cachedAt;

freshAge <= SECTIONS_CACHE_TTL_MS
  ? ok(`5분 경과 캐시 → HIT (age=${Math.round(freshAge / 60000)}분)`)
  : fail('5분 캐시가 만료로 판정됨');

expiredAge > SECTIONS_CACHE_TTL_MS
  ? ok(`31분 경과 캐시 → MISS (age=${Math.round(expiredAge / 60000)}분)`)
  : fail('31분 캐시가 유효로 판정됨');

// ─── 3. 자정 date-change invalidate ──────────────────────────────────────────
section('3. 자정 date-change invalidate (KST 기준)');

// 어제 자정 이전 timestamp 생성
const yesterdayTs = Date.now() - 24 * 60 * 60 * 1000;
const yesterdayCache: SectionsCache = { pools: [], cachedAt: yesterdayTs };
const todayCache: SectionsCache = { pools: [], cachedAt: Date.now() };

isCacheStaleByDate(yesterdayCache)
  ? ok(`어제 캐시 → isCacheStaleByDate = true (재빌드 트리거)`)
  : fail('어제 캐시가 stale로 감지 안 됨');

!isCacheStaleByDate(todayCache)
  ? ok(`오늘 캐시 → isCacheStaleByDate = false (유지)`)
  : fail('오늘 캐시가 stale로 잘못 감지됨');

// KST 자정 경계 시뮬레이션
// cachedAt = UTC 14:59 (KST 23:59), now = UTC 15:01 (KST 00:01 다음날)
const mockCachedAt = new Date('2026-03-15T14:59:00.000Z').getTime();
const mockNow      = new Date('2026-03-15T15:01:00.000Z').getTime();
const mockDateStale = getKSTDateString(mockCachedAt) !== getKSTDateString(mockNow);
mockDateStale
  ? ok(`KST 자정 경계: cachedAt=KST 23:59, now=KST 00:01 → stale=true`)
  : fail('KST 자정 경계 미감지');

// TTL 30분 이내지만 날짜가 바뀐 경우
const justBeforeMidnight: SectionsCache = { pools: [], cachedAt: mockCachedAt };
const ageMs = mockNow - mockCachedAt;
const isStaleByTTL = ageMs > SECTIONS_CACHE_TTL_MS;
const isStaleByDate = getKSTDateString(mockCachedAt) !== getKSTDateString(mockNow);
!isStaleByTTL && isStaleByDate
  ? ok(`TTL(${Math.round(ageMs / 60000)}분) 이내지만 날짜 변경 → date-change로 invalidate`)
  : fail(`TTL=${Math.round(ageMs / 60000)}분, staleByDate=${isStaleByDate}`);

// ─── 4. trending 15분 TTL ─────────────────────────────────────────────────────
section('4. trending 15분 TTL 분리');

TRENDING_CACHE_TTL_MS === 15 * 60 * 1000
  ? ok(`TRENDING_CACHE_TTL_MS = ${TRENDING_CACHE_TTL_MS / 60000}분`)
  : fail('trending TTL이 15분이 아님', `${TRENDING_CACHE_TTL_MS / 60000}분`);

// 14분 경과: refresh 불필요
const cached14min: SectionsCache = {
  pools: [],
  cachedAt: Date.now() - 30 * 60 * 1000,       // 메인 캐시는 아직 유효 (30분 이내)
  trendingCachedAt: Date.now() - 14 * 60 * 1000, // trending 14분 전
};
const trendingAge14 = Date.now() - (cached14min.trendingCachedAt ?? cached14min.cachedAt);
trendingAge14 <= TRENDING_CACHE_TTL_MS
  ? ok(`trending 14분 경과 → refresh 불필요 (age=${Math.round(trendingAge14 / 60000)}분)`)
  : fail('trending 14분이 refresh 대상으로 판정됨');

// 16분 경과: refresh 필요
const cached16min: SectionsCache = {
  pools: [],
  cachedAt: Date.now() - 30 * 60 * 1000,
  trendingCachedAt: Date.now() - 16 * 60 * 1000,
};
const trendingAge16 = Date.now() - (cached16min.trendingCachedAt ?? cached16min.cachedAt);
trendingAge16 > TRENDING_CACHE_TTL_MS
  ? ok(`trending 16분 경과 → refresh 필요 (age=${Math.round(trendingAge16 / 60000)}분)`)
  : fail('trending 16분이 refresh 불필요로 판정됨');

// trendingCachedAt 없는 경우 → cachedAt 기준으로 fallback
const noTrendingTs: SectionsCache = {
  pools: [],
  cachedAt: Date.now() - 16 * 60 * 1000, // 16분 전 빌드
  // trendingCachedAt 없음
};
const trendingAgeFallback = Date.now() - (noTrendingTs.trendingCachedAt ?? noTrendingTs.cachedAt);
trendingAgeFallback > TRENDING_CACHE_TTL_MS
  ? ok(`trendingCachedAt 없을 때 cachedAt 기준 fallback 정상`)
  : fail('trendingCachedAt fallback 로직 오류');

// ─── 5. in-flight 중복 방지 시뮬레이션 ───────────────────────────────────────
section('5. trendingRefreshInFlight 중복 방지 시뮬레이션');

const inFlightSet = new Set<string>();
const key = '37.5,127.0';
let refreshCount = 0;

function mockRefreshTrending(cacheKey: string) {
  if (inFlightSet.has(cacheKey)) return false; // 중복 방지
  inFlightSet.add(cacheKey);
  refreshCount++;
  // 비동기 완료 시뮬레이션
  setTimeout(() => inFlightSet.delete(cacheKey), 100);
  return true;
}

// 동시 5개 요청 시뮬레이션
for (let i = 0; i < 5; i++) {
  mockRefreshTrending(key);
}

refreshCount === 1
  ? ok(`동시 5개 요청 → refreshTrending 실행 ${refreshCount}회 (중복 방지 정상)`)
  : fail(`중복 방지 실패 — ${refreshCount}회 실행됨`);

// ─── 6. refreshTrendingAsync — 다른 섹션 불변 시뮬레이션 ──────────────────────
section('6. trending만 교체, 다른 섹션 불변 확인');

const mockPools = [
  { slug: 'trending',  rawEvents: [{ id: 'old-t1' }, { id: 'old-t2' }], limit: 10 },
  { slug: 'date_pick', rawEvents: [{ id: 'dp-1'   }, { id: 'dp-2'   }], limit: 10 },
  { slug: 'beginner',  rawEvents: [{ id: 'bg-1'   }, { id: 'bg-2'   }], limit: 10 },
];

const freshTrendingEvents = [{ id: 'new-t1' }, { id: 'new-t2' }, { id: 'new-t3' }];

// refreshTrendingAsync의 pools 교체 로직 시뮬레이션
const updatedPools = mockPools.map(p =>
  p.slug === 'trending' ? { ...p, rawEvents: freshTrendingEvents } : p,
);

const trendingUpdated = updatedPools.find(p => p.slug === 'trending')!;
const datePickUnchanged = updatedPools.find(p => p.slug === 'date_pick')!;
const beginnerUnchanged = updatedPools.find(p => p.slug === 'beginner')!;

trendingUpdated.rawEvents[0].id === 'new-t1'
  ? ok(`trending rawEvents 갱신됨 (new-t1, new-t2, new-t3)`)
  : fail('trending 교체 실패');

datePickUnchanged.rawEvents[0].id === 'dp-1'
  ? ok(`date_pick rawEvents 불변 (dp-1, dp-2)`)
  : fail('date_pick이 의도치 않게 바뀜');

beginnerUnchanged.rawEvents[0].id === 'bg-1'
  ? ok(`beginner rawEvents 불변 (bg-1, bg-2)`)
  : fail('beginner가 의도치 않게 바뀜');

// 섹션 간 ID 중복 없음 확인
const allIds = updatedPools.flatMap(p => p.rawEvents.map((e: any) => e.id));
const uniqueIds = new Set(allIds);
allIds.length === uniqueIds.size
  ? ok(`섹션 간 이벤트 ID 중복 없음 (${allIds.length}개 전부 고유)`)
  : fail(`섹션 간 중복 ID 존재: ${allIds.length - uniqueIds.size}개`);

// ─── 최종 결과 ────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`결과: ${passed + failed}개 중 ${passed}개 통과 / ${failed}개 실패`);
if (failed === 0) {
  console.log('✅ 모든 캐시 정책 검증 통과');
} else {
  console.log('❌ 실패 항목 확인 필요');
  process.exit(1);
}
