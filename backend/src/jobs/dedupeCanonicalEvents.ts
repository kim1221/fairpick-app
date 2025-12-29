import { createHash } from 'crypto';
import {
  getAllRawKopisEvents,
  getAllRawCultureEvents,
  getAllRawTourEvents,
  upsertCanonicalEvent,
  RawEventFromDB,
  CanonicalEvent,
  getAllCanonicalEventsForRemerge,
  updateCanonicalEventAfterRemerge,
  deleteCanonicalEvents,
  CanonicalEventForRemerge,
  pool,
} from '../db';

/**
 * Title 정규화: 공백/특수문자/괄호 제거, 소문자 변환
 */
function normalizeTitle(title: string | null): string {
  if (!title) return '';

  return title
    .toLowerCase()
    .replace(/\s+/g, '') // 모든 공백 제거
    .replace(/[^\w가-힣]/g, '') // 특수문자 제거 (한글, 영문, 숫자만)
    .replace(/\(.*?\)/g, '') // 괄호 내용 제거
    .trim();
}

/**
 * Venue 정규화: 공백 제거, 소문자 변환
 */
function normalizeVenue(venue: string | null): string {
  if (!venue) return '';

  return venue
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Region 정규화: 공백 제거, 소문자 변환
 */
function normalizeRegion(region: string | null): string {
  if (!region) return '';

  return region
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Strong key 생성: MD5(normalized_title + start_at + normalized_venue)
 */
function generateStrongKey(
  title: string | null,
  startAt: string | null,
  venue: string | null,
): string {
  const normalizedTitle = normalizeTitle(title);
  const normalizedVenue = normalizeVenue(venue);
  const dateKey = startAt || '';

  const combinedKey = `${normalizedTitle}||${dateKey}||${normalizedVenue}`;
  return createHash('md5').update(combinedKey).digest('hex');
}

/**
 * Soft key 생성: MD5(normalized_title + start_at + normalized_region)
 * venue가 빈값/불안정할 때 사용
 */
function generateSoftKey(
  title: string | null,
  startAt: string | null,
  region: string | null,
): string {
  const normalizedTitle = normalizeTitle(title);
  const normalizedRegion = normalizeRegion(region);
  const dateKey = startAt || '';

  const combinedKey = `${normalizedTitle}||${dateKey}||${normalizedRegion}`;
  return createHash('md5').update(combinedKey).digest('hex');
}

/**
 * Venue에서 핵심 장소명 토큰 추출
 * 예: "서울 DDP 동대문디자인플라자" → ["ddp", "동대문디자인플라자"]
 */
function extractVenueTokens(venue: string | null): Set<string> {
  if (!venue) return new Set();

  const normalized = venue.toLowerCase().replace(/\s+/g, '');
  const tokens = new Set<string>();

  // 주요 장소명 패턴
  const majorVenues = [
    'ddp', '동대문디자인플라자', '예술의전당', '세종문화회관', '국립중앙박물관',
    'coex', '코엑스', 'bexco', '벡스코', 'kintex', '킨텍스',
    '잠실종합운동장', '올림픽공원', '한강공원', '여의도공원',
    '롯데콘서트홀', '예스24라이브홀', '블루스퀘어',
  ];

  for (const venueName of majorVenues) {
    if (normalized.includes(venueName.toLowerCase())) {
      tokens.add(venueName.toLowerCase());
    }
  }

  return tokens;
}

/**
 * URL에서 도메인 추출
 */
function extractDomain(url: string | null): string {
  if (!url) return '';

  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * 두 이벤트 그룹이 soft 병합 가능한지 안전장치 검사
 * 2개 이상의 조건을 만족해야 병합 허용
 */
function canSoftMerge(
  group1: (RawEventFromDB & { rawTable: string })[],
  group2: (RawEventFromDB & { rawTable: string })[],
): boolean {
  const event1 = group1[0];
  const event2 = group2[0];

  let matchCount = 0;

  // 조건 1: region이 동일하거나 한쪽이 null/빈값
  const region1 = normalizeRegion(event1.region);
  const region2 = normalizeRegion(event2.region);
  if (region1 === region2 || !region1 || !region2) {
    matchCount++;
  }

  // 조건 2: venue 토큰 유사 (핵심 장소명 토큰이 겹침)
  const tokens1 = extractVenueTokens(event1.venue);
  const tokens2 = extractVenueTokens(event2.venue);
  const hasCommonToken = [...tokens1].some(t => tokens2.has(t));
  if (hasCommonToken && tokens1.size > 0 && tokens2.size > 0) {
    matchCount++;
  }

  // 조건 3: source_url 도메인이 동일
  const domain1 = extractDomain(event1.source_url);
  const domain2 = extractDomain(event2.source_url);
  if (domain1 && domain2 && domain1 === domain2) {
    matchCount++;
  }

  // 조건 4: image_url 도메인이 동일 또는 완전 동일
  const imgDomain1 = extractDomain(event1.image_url);
  const imgDomain2 = extractDomain(event2.image_url);
  if (event1.image_url && event2.image_url) {
    if (event1.image_url === event2.image_url || (imgDomain1 && imgDomain2 && imgDomain1 === imgDomain2)) {
      matchCount++;
    }
  }

  // 2개 이상 조건 만족 시 병합 허용
  return matchCount >= 2;
}

/**
 * 카테고리 보호: 기존 정규화된 값이 있으면 유지
 */
function chooseProtectedCategory(
  existingMain: string | null,
  existingSub: string | null,
  proposedMain: string | null,
  proposedSub: string | null,
): { mainCategory: string; subCategory: string; wasProtected: boolean } {
  const validMainCategories = ['공연', '전시', '축제', '행사'];
  const defaultSubCategories: Record<string, string> = {
    공연: '기타 공연',
    전시: '기타 전시',
    축제: '기타 축제',
    행사: '기타 행사',
  };

  let mainCategory: string;
  let subCategory: string;
  let wasProtected = false;

  // 1. main_category 결정
  if (existingMain && validMainCategories.includes(existingMain)) {
    // 기존 값이 정규화된 값이면 유지
    mainCategory = existingMain;
    wasProtected = true;
  } else {
    // 그렇지 않으면 proposed 사용 (없으면 '행사')
    mainCategory = proposedMain && validMainCategories.includes(proposedMain)
      ? proposedMain
      : '행사';
  }

  // 2. sub_category 결정
  if (existingSub && existingSub.trim()) {
    // 기존 값이 존재하고 빈값 아니면 유지 (raw 코드가 아닌 정규화된 값)
    // raw 코드는 A0207, A0208 같은 패턴
    if (!existingSub.match(/^A0\d+$/)) {
      subCategory = existingSub;
      wasProtected = true;
    } else {
      // raw 코드면 폴백 사용
      subCategory = proposedSub || defaultSubCategories[mainCategory] || '기타 행사';
    }
  } else {
    // 기존 값이 없으면 proposed 사용 (없으면 폴백)
    subCategory = proposedSub || defaultSubCategories[mainCategory] || '기타 행사';
  }

  return { mainCategory, subCategory, wasProtected };
}

/**
 * 카테고리 추론: title/sub_category 키워드로 분류
 */
function inferCategory(title: string | null, subCategory: string | null): 'performance' | 'festival' | 'exhibition' | 'unknown' {
  const titleLower = (title || '').toLowerCase();
  const subLower = (subCategory || '').toLowerCase();
  const combined = titleLower + ' ' + subLower;

  // 공연 키워드
  const performanceKeywords = ['공연', '연극', '뮤지컬', '콘서트', '음악회', '클래식', '오페라', '발레', '무용', '국악'];
  if (performanceKeywords.some(keyword => combined.includes(keyword))) {
    return 'performance';
  }

  // 전시 키워드
  const exhibitionKeywords = ['전시', '박람회', '미술', '갤러리', '체험'];
  if (exhibitionKeywords.some(keyword => combined.includes(keyword))) {
    return 'exhibition';
  }

  // 축제 키워드
  const festivalKeywords = ['축제', '페스티벌', '행사', '마라톤', '대회'];
  if (festivalKeywords.some(keyword => combined.includes(keyword))) {
    return 'festival';
  }

  return 'unknown';
}

/**
 * 우선순위 결정: 카테고리별 소스 우선순위
 */
function determinePrioritySource(events: RawEventFromDB[]): string {
  if (events.length === 0) return 'unknown';

  // 카테고리 추론 (첫 번째 이벤트 기준)
  const category = inferCategory(events[0].title, events[0].sub_category);

  // 카테고리별 우선순위
  let priority: string[];
  if (category === 'performance') {
    priority = ['kopis', 'culture', 'tour'];
  } else if (category === 'exhibition') {
    priority = ['culture', 'tour', 'kopis'];
  } else if (category === 'festival') {
    priority = ['tour', 'culture', 'kopis'];
  } else {
    // unknown인 경우 source 분포로 결정
    priority = ['kopis', 'culture', 'tour'];
  }

  // 우선순위대로 소스 찾기
  for (const source of priority) {
    const found = events.find(e => e.source === source);
    if (found) return source;
  }

  return events[0].source;
}

/**
 * 그룹 내 대표 이벤트 선택 (winner 기준)
 */
function selectWinnerEvent(events: RawEventFromDB[], winnerSource: string): RawEventFromDB {
  const winnerEvent = events.find(e => e.source === winnerSource);
  return winnerEvent || events[0];
}

/**
 * 위치 정보 병합: address, lat, lng 선택
 * - lat/lng: 첫 번째 유효한 좌표 쌍 사용 (source 우선순위: kopis > culture > tour)
 * - address: 가장 긴 주소 사용 (더 상세한 정보 우선)
 */
function mergeLocation(events: RawEventFromDB[]): {
  address?: string;
  lat?: number;
  lng?: number;
} {
  const sourcePriority = ['kopis', 'culture', 'tour'];

  // lat/lng: 우선순위별로 첫 번째 유효한 좌표 쌍 찾기
  let lat: number | undefined;
  let lng: number | undefined;

  for (const source of sourcePriority) {
    const event = events.find(e =>
      e.source === source &&
      typeof e.lat === 'number' &&
      typeof e.lng === 'number' &&
      !isNaN(e.lat) &&
      !isNaN(e.lng)
    );
    if (event && event.lat && event.lng) {
      lat = event.lat;
      lng = event.lng;
      break;
    }
  }

  // address: 가장 긴 주소 선택 (더 상세한 정보 우선)
  let address: string | undefined;
  for (const event of events) {
    if (event.address && event.address.trim()) {
      if (!address || event.address.length > address.length) {
        address = event.address;
      }
    }
  }

  return {
    address: address || undefined,
    lat: lat || undefined,
    lng: lng || undefined,
  };
}

/**
 * Dedupe 메인 로직
 */
async function dedupeCanonicalEvents() {
  console.log('[Dedupe] Starting canonical event deduplication...');

  // 1. Raw 테이블에서 모든 이벤트 가져오기
  console.log('[Dedupe] Fetching raw events from all sources...');
  const [kopisEvents, cultureEvents, tourEvents] = await Promise.all([
    getAllRawKopisEvents(),
    getAllRawCultureEvents(),
    getAllRawTourEvents(),
  ]);

  const allRawEvents = [
    ...kopisEvents.map(e => ({ ...e, rawTable: 'raw_kopis_events' })),
    ...cultureEvents.map(e => ({ ...e, rawTable: 'raw_culture_events' })),
    ...tourEvents.map(e => ({ ...e, rawTable: 'raw_tour_events' })),
  ];

  console.log(`[Dedupe] Total raw events: ${allRawEvents.length}`);
  console.log(`  - KOPIS: ${kopisEvents.length}`);
  console.log(`  - Culture: ${cultureEvents.length}`);
  console.log(`  - Tour: ${tourEvents.length}`);

  // 2. 1차 그룹핑: Strong key (title + start_at + venue)
  console.log('[Dedupe] Phase 1: Grouping by strong key (title + date + venue)...');
  const strongGroups = new Map<string, (RawEventFromDB & { rawTable: string })[]>();

  for (const event of allRawEvents) {
    // 필수 필드 검증 (title, start_at이 없으면 skip)
    if (!event.title || !event.start_at) {
      continue;
    }

    const strongKey = generateStrongKey(event.title, event.start_at, event.venue);

    if (!strongGroups.has(strongKey)) {
      strongGroups.set(strongKey, []);
    }
    strongGroups.get(strongKey)!.push(event);
  }

  console.log(`[Dedupe] Phase 1 complete: ${strongGroups.size} strong groups`);

  // 3. 2차 그룹핑: Soft key (title + start_at + region)로 추가 병합
  console.log('[Dedupe] Phase 2: Attempting soft merge by soft key (title + date + region)...');

  // 단독 그룹(크기가 1인 그룹)만 soft 병합 대상
  const singletonGroups: Array<{ strongKey: string; events: (RawEventFromDB & { rawTable: string })[] }> = [];
  const multiGroups = new Map<string, (RawEventFromDB & { rawTable: string })[]>();

  for (const [strongKey, events] of strongGroups.entries()) {
    if (events.length === 1) {
      singletonGroups.push({ strongKey, events });
    } else {
      multiGroups.set(strongKey, events);
    }
  }

  console.log(`[Dedupe] Singleton groups (soft merge candidates): ${singletonGroups.length}`);
  console.log(`[Dedupe] Multi-source groups (already merged): ${multiGroups.size}`);

  // soft key로 그룹핑
  const softKeyMap = new Map<string, Array<{ strongKey: string; events: (RawEventFromDB & { rawTable: string })[] }>>();

  for (const group of singletonGroups) {
    const event = group.events[0];
    const softKey = generateSoftKey(event.title, event.start_at, event.region);

    if (!softKeyMap.has(softKey)) {
      softKeyMap.set(softKey, []);
    }
    softKeyMap.get(softKey)!.push(group);
  }

  // soft key 병합 수행 (안전장치 적용)
  let softMergeCount = 0;
  const finalGroups = new Map<string, (RawEventFromDB & { rawTable: string })[]>();

  // 먼저 multi-source 그룹들을 finalGroups에 추가
  for (const [strongKey, events] of multiGroups.entries()) {
    finalGroups.set(strongKey, events);
  }

  // soft key별로 병합 시도
  for (const [softKey, groups] of softKeyMap.entries()) {
    if (groups.length === 1) {
      // 병합 대상 없음 - 그대로 추가
      const group = groups[0];
      finalGroups.set(group.strongKey, group.events);
    } else {
      // 여러 그룹이 같은 soft key를 가짐 - 안전장치 검사 후 병합
      // 첫 번째 그룹을 기준으로 하나씩 비교
      const mergedGroups: Array<(RawEventFromDB & { rawTable: string })[]> = [];
      const baseGroup = groups[0];
      let currentMerged = [...baseGroup.events];

      for (let i = 1; i < groups.length; i++) {
        const candidateGroup = groups[i];

        // 안전장치 검사
        if (canSoftMerge([...currentMerged], candidateGroup.events)) {
          // 병합 허용
          currentMerged = [...currentMerged, ...candidateGroup.events];
          softMergeCount++;
          console.log(`[Dedupe] Soft merged: "${baseGroup.events[0].title?.slice(0, 40)}" (${baseGroup.events[0].venue?.slice(0, 20)}) + (${candidateGroup.events[0].venue?.slice(0, 20)})`);
        } else {
          // 병합 거부 - 별도 그룹으로 유지
          mergedGroups.push(candidateGroup.events);
        }
      }

      // 병합된 그룹 추가
      finalGroups.set(baseGroup.strongKey, currentMerged);

      // 병합되지 않은 그룹들 추가
      for (let i = 0; i < mergedGroups.length; i++) {
        finalGroups.set(`${softKey}_unmerged_${i}`, mergedGroups[i]);
      }
    }
  }

  console.log(`[Dedupe] Phase 2 complete: ${softMergeCount} soft merges performed`);
  console.log(`[Dedupe] Final canonical groups: ${finalGroups.size}`);

  // 4. 각 그룹을 canonical event로 변환 및 저장
  console.log('[Dedupe] Creating canonical events...');
  let savedCount = 0;
  let skippedCount = 0;
  let categoryProtectedCount = 0;

  for (const [groupKey, events] of finalGroups.entries()) {
    try {
      // 우선순위 결정
      const winnerSource = determinePrioritySource(events);
      const winnerEvent = selectWinnerEvent(events, winnerSource);

      // canonical_key는 winner의 strong key 사용 (멱등성 보장)
      const canonicalKey = generateStrongKey(
        winnerEvent.title,
        winnerEvent.start_at,
        winnerEvent.venue,
      );

      // sources 배열 생성 (병합된 모든 소스 포함)
      const sources = events.map(e => ({
        source: e.source,
        rawTable: e.rawTable,
        rawId: e.id,
        sourceEventId: e.source_event_id,
        sourceUrl: e.source_url,
        imageUrl: e.image_url,
        title: e.title,
        startAt: e.start_at,
        endAt: e.end_at,
      }));

      // 기존 canonical_event 조회 (카테고리 보호를 위해)
      const existingResult = await pool.query(
        `SELECT main_category, sub_category FROM canonical_events WHERE canonical_key = $1 LIMIT 1`,
        [canonicalKey],
      );
      const existing = existingResult.rows[0];

      // 카테고리 보호 로직 적용
      const categoryResult = chooseProtectedCategory(
        existing?.main_category || null,
        existing?.sub_category || null,
        winnerEvent.main_category,
        winnerEvent.sub_category,
      );

      // 로그 출력 (처음 20개만)
      if (categoryProtectedCount < 20 && categoryResult.wasProtected) {
        console.log(`[Dedupe][CategoryProtect] keep existing: main=${categoryResult.mainCategory} sub=${categoryResult.subCategory} (ignore proposed main=${winnerEvent.main_category || 'null'} sub=${winnerEvent.sub_category || 'null'})`);
        categoryProtectedCount++;
      } else if (savedCount < 20 && !existing && !categoryResult.wasProtected) {
        console.log(`[Dedupe][CategoryProtect] fill missing: main=${categoryResult.mainCategory} sub=${categoryResult.subCategory}`);
      }

      // is_free 병합: 하나라도 true면 true
      const isFree = events.some((e: RawEventFromDB & { rawTable: string }) => e.is_free === true);

      // location 병합: 우선순위별 lat/lng, 가장 긴 address
      const location = mergeLocation(events);

      // Canonical event 생성
      const canonicalEvent: CanonicalEvent = {
        canonicalKey,
        title: winnerEvent.title || '',
        startAt: winnerEvent.start_at,
        endAt: winnerEvent.end_at,
        venue: winnerEvent.venue,
        region: winnerEvent.region,
        mainCategory: categoryResult.mainCategory,
        subCategory: categoryResult.subCategory,
        imageUrl: winnerEvent.image_url,
        isFree,
        address: location.address,
        lat: location.lat,
        lng: location.lng,
        sourcePriorityWinner: winnerSource,
        sources,
      };

      // DB에 저장 (UPSERT)
      await upsertCanonicalEvent(canonicalEvent);
      savedCount++;

      if (savedCount % 100 === 0) {
        console.log(`[Dedupe] Processed ${savedCount} canonical events...`);
      }
    } catch (error) {
      console.error(`[Dedupe] Failed to save canonical event:`, error);
      skippedCount++;
    }
  }

  console.log('[Dedupe] Phase 1-2 complete!');
  console.log(`  - Canonical events saved: ${savedCount}`);
  console.log(`  - Skipped (errors): ${skippedCount}`);
  console.log(`  - Total raw events processed: ${allRawEvents.length}`);
  console.log(`  - Strong groups: ${strongGroups.size}`);
  console.log(`  - Soft merges performed: ${softMergeCount}`);

  // ========== Phase 3: Canonical Re-merge ==========
  console.log('\n[Dedupe][Phase3] Starting canonical re-merge...');
  const phase3Result = await runPhase3CanonicalRemerge();
  console.log(`[Dedupe][Phase3] Completed`);
  console.log(`  - Candidates: ${phase3Result.candidatesCount}`);
  console.log(`  - Merged: ${phase3Result.groupsMerged}`);

  console.log('\n[Dedupe] All phases complete!');
  console.log(`  - Final canonical events: ${savedCount - phase3Result.deletedCount}`);
  console.log(`  - Total deduplication ratio: ${((1 - (savedCount - phase3Result.deletedCount) / allRawEvents.length) * 100).toFixed(1)}%`);

  // 병합 후 검증 SQL 출력
  console.log('\n[Dedupe] Verification SQL (run manually to check for remaining duplicates):');
  console.log(`
SELECT title, start_at, end_at, region, COUNT(*) cnt
FROM canonical_events
GROUP BY title, start_at, end_at, region
HAVING COUNT(*) > 1
ORDER BY cnt DESC
LIMIT 30;
  `.trim());

  // 카테고리 검증 SQL 출력
  console.log('\n[Dedupe] Category Protection Verification:');
  console.log('\n(1) Pipeline execution order (collect → dedupe → normalize):');
  console.log('    npm run pipeline:refresh');
  console.log('\n(2) Check for raw codes (A0207, A0208, etc.) in categories:');
  console.log(`
SELECT main_category, sub_category, COUNT(*) as count
FROM canonical_events
WHERE sub_category ~ '^A0' OR main_category ~ '^A0'
GROUP BY main_category, sub_category
ORDER BY count DESC;
  `.trim());
  console.log('    Expected: 0 rows (no raw codes should remain after normalize)');
  console.log('\n(3) Verify main_category values (should be only 4 values):');
  console.log(`
SELECT DISTINCT main_category
FROM canonical_events
ORDER BY 1;
  `.trim());
  console.log('    Expected: 공연, 전시, 축제, 행사');
}

// ========== Phase 3: Canonical ↔ Canonical 재병합 ==========

/**
 * Venue 정규화 (Phase 3용): 지역명 접두어 제거, 괄호 내용 제거, 공백/특수문자 제거, 소문자화
 */
function normalizeVenueForRemerge(venue: string | null): string {
  if (!venue) return '';

  let normalized = venue;

  // 1. 괄호 내용 제거 (괄호와 내용 모두 제거)
  normalized = normalized.replace(/\([^)]*\)/g, ''); // 소괄호
  normalized = normalized.replace(/\[[^\]]*\]/g, ''); // 대괄호

  // 2. 지역명 접두어 제거
  // "서울 종로구 하땅세극장" → "종로구 하땅세극장"
  // "서울 하땅세극장" → "하땅세극장"
  const regionPrefixes = [
    '서울특별시', '서울시', '서울',
    '부산광역시', '부산시', '부산',
    '대구광역시', '대구시', '대구',
    '인천광역시', '인천시', '인천',
    '광주광역시', '광주시', '광주',
    '대전광역시', '대전시', '대전',
    '울산광역시', '울산시', '울산',
    '세종특별자치시', '세종시', '세종',
    '경기도', '경기',
    '강원도', '강원',
    '충청북도', '충북',
    '충청남도', '충남',
    '전라북도', '전북',
    '전라남도', '전남',
    '경상북도', '경북',
    '경상남도', '경남',
    '제주특별자치도', '제주도', '제주',
  ];

  for (const prefix of regionPrefixes) {
    const pattern = new RegExp(`^${prefix}\\s*`, 'i');
    normalized = normalized.replace(pattern, '');
  }

  // 3. 공백 제거
  normalized = normalized.replace(/\s+/g, '');

  // 4. 특수문자 제거 (한글, 영문, 숫자만 남김)
  normalized = normalized.replace(/[^\w가-힣]/g, '');

  // 5. 소문자화
  normalized = normalized.toLowerCase();

  return normalized.trim();
}

/**
 * "(구. XXX)" 패턴에서 이전 명칭 추출
 */
function extractPreviousName(venue: string | null): string | null {
  if (!venue) return null;
  
  const match = venue.match(/\(구\.\s*([^)]+)\)/);
  if (match) {
    return match[1]
      .replace(/\s+/g, '')
      .replace(/[^\w가-힣]/g, '')
      .toLowerCase();
  }
  return null;
}

/**
 * Venue 병합 가능 여부 검사
 */
function canMergeVenues(venueA: string | null, venueB: string | null): boolean {
  const normA = normalizeVenueForRemerge(venueA);
  const normB = normalizeVenueForRemerge(venueB);

  // 둘 다 빈 문자열이면 병합 가능
  if (!normA && !normB) return true;

  // 동일하면 병합 가능
  if (normA === normB) return true;

  // 한쪽이 다른 쪽을 포함하면 병합 가능
  if (normA && normB) {
    if (normA.includes(normB) || normB.includes(normA)) return true;
  }

  // "(구. XXX)" 패턴 처리: 이전 명칭과 현재 명칭 비교
  const prevNameA = extractPreviousName(venueA);
  const prevNameB = extractPreviousName(venueB);

  // A의 이전 명칭이 B와 일치하거나 포함 관계
  if (prevNameA && normB) {
    if (prevNameA === normB || normB.includes(prevNameA) || prevNameA.includes(normB)) return true;
  }

  // B의 이전 명칭이 A와 일치하거나 포함 관계
  if (prevNameB && normA) {
    if (prevNameB === normA || normA.includes(prevNameB) || prevNameB.includes(normA)) return true;
  }

  // 공통 접두사 비교: 앞 8글자 이상이 같으면 병합 허용
  if (normA && normB && normA.length >= 8 && normB.length >= 8) {
    const prefixLen = Math.min(8, Math.min(normA.length, normB.length));
    if (normA.slice(0, prefixLen) === normB.slice(0, prefixLen)) return true;
  }

  return false;
}

/**
 * source_priority_winner 우선순위 점수
 */
function getSourcePriorityScore(source: string): number {
  const priorities: Record<string, number> = {
    kopis: 3,
    culture: 2,
    tour: 1,
  };
  return priorities[source.toLowerCase()] || 0;
}

/**
 * Sources 파싱 헬퍼 (문자열 또는 객체 처리)
 */
function parseSources(sources: string | unknown[] | null): unknown[] {
  if (!sources) return [];
  if (Array.isArray(sources)) return sources;
  if (typeof sources === 'string') {
    try {
      return JSON.parse(sources);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Master canonical 선택
 */
function selectMasterCanonical(events: CanonicalEventForRemerge[]): CanonicalEventForRemerge {
  return events.sort((a, b) => {
    // 1. source_priority_winner 우선 (kopis > culture > tour)
    const priorityDiff = getSourcePriorityScore(b.source_priority_winner) - getSourcePriorityScore(a.source_priority_winner);
    if (priorityDiff !== 0) return priorityDiff;

    // 2. sources.length가 더 많은 쪽
    const sourcesA = parseSources(a.sources);
    const sourcesB = parseSources(b.sources);
    const sourceLenDiff = sourcesB.length - sourcesA.length;
    if (sourceLenDiff !== 0) return sourceLenDiff;

    // 3. venue 문자열이 더 긴 쪽 (정보가 많은 쪽)
    const venueA = a.venue || '';
    const venueB = b.venue || '';
    const venueLenDiff = venueB.length - venueA.length;
    if (venueLenDiff !== 0) return venueLenDiff;

    // 4. updated_at이 더 최신인 쪽
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  })[0];
}

/**
 * Sources 병합 (중복 제거)
 */
function mergeSources(events: CanonicalEventForRemerge[]): unknown[] {
  const seen = new Set<string>();
  const merged: unknown[] = [];

  for (const event of events) {
    const sources = parseSources(event.sources);
    for (const src of sources) {
      const srcObj = src as { source?: string; sourceEventId?: string };
      const key = `${srcObj.source || ''}||${srcObj.sourceEventId || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(src);
      }
    }
  }

  return merged;
}

/**
 * Phase 3 실행
 */
async function runPhase3CanonicalRemerge(): Promise<{ candidatesCount: number; groupsMerged: number; deletedCount: number }> {
  // 1. 모든 canonical 이벤트 조회
  const allCanonical = await getAllCanonicalEventsForRemerge();
  console.log(`[Dedupe][Phase3] Total canonical events: ${allCanonical.length}`);

  // 2. 그룹 기준: normalized_title + start_at + end_at + normalized_region
  const groups = new Map<string, CanonicalEventForRemerge[]>();

  for (const event of allCanonical) {
    const normTitle = normalizeTitle(event.title);
    const normRegion = normalizeRegion(event.region);
    const groupKey = `${normTitle}||${event.start_at || ''}||${event.end_at || ''}||${normRegion}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(event);
  }

  // 3. 중복 그룹만 필터링
  const duplicateGroups = Array.from(groups.entries()).filter(([_, events]) => events.length > 1);
  const candidatesCount = duplicateGroups.reduce((sum, [_, events]) => sum + events.length, 0);
  console.log(`[Dedupe][Phase3] Candidates for re-merge: ${candidatesCount} events in ${duplicateGroups.length} groups`);

  let groupsMerged = 0;
  let deletedCount = 0;
  const allIdsToDelete: string[] = [];

  for (const [groupKey, events] of duplicateGroups) {
    // 4. venue 병합 가능 여부 검사 - 모든 쌍에 대해 검사
    const mergeableEvents: CanonicalEventForRemerge[] = [events[0]];
    const nonMergeableEvents: CanonicalEventForRemerge[] = [];

    for (let i = 1; i < events.length; i++) {
      const candidate = events[i];
      // 이미 병합 가능한 그룹 중 하나와 venue가 병합 가능한지 검사
      const canMerge = mergeableEvents.some(e => canMergeVenues(e.venue, candidate.venue));
      if (canMerge) {
        mergeableEvents.push(candidate);
      } else {
        nonMergeableEvents.push(candidate);
      }
    }

    // 병합 가능한 이벤트가 2개 이상이면 병합 수행
    if (mergeableEvents.length > 1) {
      // 5. Master 선택
      const master = selectMasterCanonical(mergeableEvents);
      const others = mergeableEvents.filter(e => e.id !== master.id);

      // 6. Sources 병합
      const mergedSources = mergeSources(mergeableEvents);

      // 7. Venue 선택 (더 긴 문자열)
      let bestVenue = master.venue || '';
      for (const other of others) {
        if (other.venue && other.venue.length > bestVenue.length) {
          bestVenue = other.venue;
        }
      }

      // 8. Image 보강
      let bestImageUrl = master.image_url;
      if (!bestImageUrl || bestImageUrl.includes('placeholder')) {
        for (const other of others) {
          if (other.image_url && !other.image_url.includes('placeholder')) {
            bestImageUrl = other.image_url;
            break;
          }
        }
      }

      // 9. Master 업데이트
      await updateCanonicalEventAfterRemerge(master.id, {
        venue: bestVenue,
        imageUrl: bestImageUrl || undefined,
        sources: mergedSources,
      });

      // 10. 나머지 삭제
      const idsToDelete = others.map(e => e.id);
      allIdsToDelete.push(...idsToDelete);

      groupsMerged++;

      // 로그 출력 (처음 20개만 상세 출력)
      if (groupsMerged <= 20) {
        console.log(`[Dedupe][Phase3] Canonical merged:`);
        console.log(`  '${master.title}'`);
        const venueList = mergeableEvents.map(e => e.venue || '(empty)').join(' + ');
        console.log(`  venue: ${venueList}`);
      }
    }
  }

  // 11. 일괄 삭제
  if (allIdsToDelete.length > 0) {
    await deleteCanonicalEvents(allIdsToDelete);
    deletedCount = allIdsToDelete.length;
  }

  return { candidatesCount, groupsMerged, deletedCount };
}

// 실행
dedupeCanonicalEvents()
  .then(() => {
    console.log('[Dedupe] Job finished successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[Dedupe] Fatal error:', err);
    process.exit(1);
  });
