import { uuidv5 } from '../lib/uuidv5';
import { parseStringPromise } from 'xml2js';
import { config } from '../config';
import { pool, upsertEvent, upsertRawCultureEvent } from '../db';
import http from '../lib/http';
import { CULTURE_DAYS_FORWARD } from '../config/collectionPolicy';

// 문화포털 API 설정
const CULTURE_API_BASE = 'https://apis.data.go.kr/B553457/cultureinfo';
// uuidv5 namespace는 RFC4122 형식(variant 포함)의 "유효한 UUID"여야 합니다.
// (임의 생성한 고정 UUID; 프로젝트 내에서 변경하지 마세요. 변경 시 기존 레코드의 id가 모두 바뀝니다.)
const CULTURE_NAMESPACE = 'a2f0b4a6-0b78-4c43-9a68-6c9dbb46d6c4';


interface CultureItem {
  seq: string;
  title: string;
  startDate: string;
  endDate: string;
  place: string;
  area: string;
  sigungu?: string;
  realmName: string;
  thumbnail?: string;
  serviceName?: string;
}

interface CultureDetailItem extends CultureItem {
  contents1?: string;
  url?: string;
  price?: string;
  imgUrl?: string;
  placeAddr?: string;
  gpsX?: string;  // 경도 (longitude)
  gpsY?: string;  // 위도 (latitude)
}


/**
 * 날짜 포맷 변환 (YYYYMMDD → YYYY-MM-DD)
 */
function formatDate(dateStr: string): string {
  if (!dateStr || dateStr.length !== 8) return dateStr;
  return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
}

/**
 * 표시용 날짜 포맷 (YYYY.MM.DD)
 */
function formatDisplayDate(dateStr: string): string {
  if (!dateStr || dateStr.length !== 8) return dateStr;
  return `${dateStr.slice(0, 4)}.${dateStr.slice(4, 6)}.${dateStr.slice(6, 8)}`;
}

const PLACEHOLDER_URL = 'https://via.placeholder.com/600x400/E8ECF0/B0B8C1?text=No+Image';

function normalizeImageUrl(url?: string): string {
  if (!url) {
    return PLACEHOLDER_URL;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return PLACEHOLDER_URL;
  }
  // iOS/일부 환경에서 http 이미지 차단 이슈 → https로 교체
  if (trimmed.startsWith('http://')) {
    return `https://${trimmed.slice('http://'.length)}`;
  }
  return trimmed;
}

/**
 * 이미지 URL이 실제로 접근 가능한지 확인 (HEAD 요청)
 */
async function isImageUrlValid(url: string): Promise<boolean> {
  if (!url || url === PLACEHOLDER_URL) {
    return false;
  }
  
  try {
    const response = await http.head(url, {
      timeout: 5000,
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 이미지 URL을 정규화하고 유효성 검사
 */
async function getValidImageUrl(url?: string): Promise<string> {
  const normalized = normalizeImageUrl(url);
  
  // placeholder면 그대로 반환
  if (normalized === PLACEHOLDER_URL) {
    return PLACEHOLDER_URL;
  }
  
  // 유효성 검사
  const isValid = await isImageUrlValid(normalized);
  return isValid ? normalized : PLACEHOLDER_URL;
}

/**
 * 중복 체크: 제목 + 시작일 + 종료일 + 장소로 비교
 */
async function isDuplicate(title: string, startDate: string, endDate: string, place: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT id FROM events 
       WHERE title = $1 
       AND start_date = $2 
       AND end_date = $3 
       AND venue LIKE $4
       LIMIT 1`,
      [title.slice(0, 60), startDate, endDate, `%${place.slice(0, 30)}%`],
    );
    return result.rows.length > 0;
  } catch (error) {
    return false;
  }
}

/**
 * DB에 해당 external_id가 존재하는지 확인 (증분 수집용)
 */
async function existsInDB(externalId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT 1 FROM events WHERE source = 'CULTURE' AND external_id = $1 LIMIT 1`,
      [externalId],
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * 기간별 문화정보 목록 조회 (period2 API 사용)
 */
async function fetchByPeriod(serviceTp: string, pageNo: number = 1): Promise<CultureItem[]> {
  if (!config.tourApiKey) {
    console.log('[Culture] Missing API key. Skip fetching.');
    return [];
  }

  // 중요: cultureinfo/period2는 특정 날짜(from=YYYYMMDD)에 대해 <items/>만 내려주는 케이스가 있음.
  // 그래서 요청 범위는 "이번 달 1일 ~ (CULTURE_DAYS_FORWARD 후 말일)"로 잡고,
  // 최종 필터링(오늘~CULTURE_DAYS_FORWARD, 진행중/예정)은 아래 저장 단계에서 적용한다.
  // 변경 전: 1년 후까지 요청, collectionPolicy.ts 로 이관
  const today = new Date();
  const startOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const cultureLimit = new Date(today);
  cultureLimit.setDate(cultureLimit.getDate() + CULTURE_DAYS_FORWARD + 30); // 30일 버퍼 (API 특성 대응)
  const endOfTargetMonth = new Date(cultureLimit.getFullYear(), cultureLimit.getMonth() + 1, 0);

  const fromDate = `${startOfThisMonth.getFullYear()}${String(startOfThisMonth.getMonth() + 1).padStart(2, '0')}${String(
    startOfThisMonth.getDate(),
  ).padStart(2, '0')}`;
  const toDate = `${endOfTargetMonth.getFullYear()}${String(endOfTargetMonth.getMonth() + 1).padStart(2, '0')}${String(
    endOfTargetMonth.getDate(),
  ).padStart(2, '0')}`;

  try {
    const response = await http.get<string>(`${CULTURE_API_BASE}/period2`, {
      params: {
        serviceKey: config.tourApiKey,
        from: fromDate,
        to: toDate,
        // ⚠️ 주의: period2는 실제로는 '공연/전시' 데이터만 내려오고,
        // serviceTp=B(행사/축제)로 호출해도 공연/전시만 내려옵니다(실측).
        // 행사/축제는 livelihood2 → detail2 흐름으로 별도 수집합니다.
        serviceTp, // A: 공연/전시 (B도 호출은 하지만 실제로는 동일 데이터가 내려옴)
        PageNo: pageNo,
        numOfrows: 100,
        // sortStdr 파라미터는 문서에 있지만, 실제로는 <items/>만 내려오는 케이스가 있어 제외합니다.
      },
    });

    const parsed = await parseStringPromise(response);
    const body = parsed?.response?.body?.[0];
    const totalCount = body?.totalCount?.[0];
    const itemsNode = body?.items?.[0];
    const items = typeof itemsNode === 'object' ? itemsNode?.item : undefined;

    // items가 비어있을 때는 <items/>로 내려오며, xml2js가 ''(string)로 파싱하는 케이스가 있음
    if (!items) {
      console.log(`[Culture] API response - totalCount: ${totalCount}, items: 0`);
      return [];
    }

    // items가 단일 객체인 경우 배열로 변환
    const itemArray = Array.isArray(items) ? items : [items];
    console.log(`[Culture] API response - totalCount: ${totalCount}, items: ${itemArray.length}`);

    return itemArray.map((item: Record<string, string[]>) => ({
      seq: item.seq?.[0] || '',
      title: item.title?.[0] || '',
      startDate: item.startDate?.[0] || '',
      endDate: item.endDate?.[0] || '',
      place: item.place?.[0] || '',
      area: item.area?.[0] || '',
      sigungu: item.sigungu?.[0] || '',
      realmName: item.realmName?.[0] || '',
      thumbnail: normalizeImageUrl(item.thumbnail?.[0] || ''),
      serviceName: item.serviceName?.[0] || '',
    }));
  } catch (error) {
    console.error(`[Culture] Failed to fetch serviceTp ${serviceTp}:`, error);
    return [];
  }
}


/**
 * 문화정보 상세 조회
 */
async function fetchDetail(seq: string): Promise<CultureDetailItem | null> {
  if (!config.tourApiKey) {
    return null;
  }

  try {
    const response = await http.get<string>(`${CULTURE_API_BASE}/detail2`, {
      params: {
        serviceKey: config.tourApiKey,
        seq,
      },
    });

    const parsed = await parseStringPromise(response);
    const item = parsed?.response?.body?.[0]?.items?.[0]?.item?.[0];

    if (!item) {
      return null;
    }

    return {
      seq: item.seq?.[0] || seq,
      title: item.title?.[0] || '',
      startDate: item.startDate?.[0] || '',
      endDate: item.endDate?.[0] || '',
      place: item.place?.[0] || '',
      area: item.area?.[0] || '',
      sigungu: item.sigungu?.[0] || '',
      realmName: item.realmName?.[0] || '',
      thumbnail: normalizeImageUrl(item.thumbnail?.[0] || ''),
      contents1: item.contents1?.[0] || '',
      url: item.url?.[0] || '',
      price: item.price?.[0] || '',
      imgUrl: normalizeImageUrl(item.imgUrl?.[0] || ''),
      placeAddr: item.placeAddr?.[0] || '',
      gpsX: item.gpsX?.[0] || '',
      gpsY: item.gpsY?.[0] || '',
    };
  } catch (error) {
    return null;
  }
}

/**
 * 무료 이벤트 여부 판별
 */
function parseIsFree(price?: string): boolean {
  if (!price) return false;

  const priceText = price.toLowerCase();
  return (
    priceText.includes('무료') ||
    priceText.includes('0원') ||
    priceText.includes('free')
  );
}

/**
 * 위치 정보 파싱
 */
function parseLocation(item: CultureDetailItem): {
  address?: string;
  lat?: number;
  lng?: number;
} {
  const address = item.placeAddr?.trim() || undefined;
  // Culture API: gpsY = latitude, gpsX = longitude
  const lat = item.gpsY ? parseFloat(item.gpsY) : undefined;
  const lng = item.gpsX ? parseFloat(item.gpsX) : undefined;

  return {
    address: address || undefined,
    lat: lat && !isNaN(lat) ? lat : undefined,
    lng: lng && !isNaN(lng) ? lng : undefined,
  };
}

/**
 * 지역명 정규화
 */
function normalizeRegion(area: string): string {
  const regionMap: Record<string, string> = {
    서울: '서울',
    서울특별시: '서울',
    경기: '경기',
    경기도: '경기',
    인천: '인천',
    인천광역시: '인천',
    부산: '부산',
    부산광역시: '부산',
    대구: '대구',
    대구광역시: '대구',
    광주: '광주',
    광주광역시: '광주',
    대전: '대전',
    대전광역시: '대전',
    울산: '울산',
    울산광역시: '울산',
    세종: '세종',
    세종특별자치시: '세종',
    강원: '강원',
    강원도: '강원',
    강원특별자치도: '강원',
    충북: '충북',
    충청북도: '충북',
    충남: '충남',
    충청남도: '충남',
    전북: '전북',
    전라북도: '전북',
    전북특별자치도: '전북',
    전남: '전남',
    전라남도: '전남',
    경북: '경북',
    경상북도: '경북',
    경남: '경남',
    경상남도: '경남',
    제주: '제주',
    제주특별자치도: '제주',
  };

  return regionMap[area] || '서울';
}

/**
 * 태그 추출
 */
function extractTags(item: CultureDetailItem, category: string): string[] {
  const tags: string[] = [];

  // realmName에서 태그 추출
  if (item.realmName) {
    tags.push(item.realmName);
  }

  // 가격 정보에서 태그 추출
  if (item.price) {
    const priceStr = item.price.toLowerCase();
    if (priceStr.includes('무료') || priceStr === '0' || priceStr === '0원') {
      tags.push('무료');
    }
  }

  // 제목에서 키워드 추출
  const title = item.title || '';
  const keywords = ['크리스마스', '겨울', '연말', '신년', '가족', '어린이', '클래식', '재즈', '뮤지컬', '발레', '오페라'];
  for (const keyword of keywords) {
    if (title.includes(keyword)) {
      tags.push(keyword);
    }
  }

  return [...new Set(tags)].slice(0, 4);
}


/**
 * realmName을 앱 카테고리로 변환
 */
function mapRealmToCategory(realmName: string, serviceName: string): string {
  // serviceName이 "전시"이면 전시
  if (serviceName === '전시' || realmName === '전시') {
    return '전시';
  }

  // realmName 기반 매핑
  const realmMap: Record<string, string> = {
    연극: '공연',
    '음악/콘서트': '공연',
    국악: '공연',
    '뮤지컬/오페라': '공연',
    '무용/발레': '공연',
    '아동/가족': '공연',
    전시: '전시',
    '행사/축제': '행사',
  };

  return realmMap[realmName] || (serviceName === '공연' ? '공연' : '행사');
}


/**
 * 메인 수집 함수 (증분 방식)
 * - 최신 데이터부터 조회하여 이미 있는 데이터가 연속 N개 나오면 중단
 * - livelihood2는 비효율적(8만건 스캔)이므로 제거 (행사/축제는 TourAPI에서 충분히 커버)
 */
async function collectCultureEvents() {
  console.log('[Culture] Starting incremental collection...');

  if (!config.tourApiKey) {
    console.log('[Culture] Missing API key. Skip fetching.');
    return;
  }

  // 증분 수집: 연속 N개가 이미 있으면 중단
  const CONSECUTIVE_EXISTS_THRESHOLD = 10;

  let totalCollected = 0;
  let totalSkipped = 0;
  let totalSaved = 0;

  // serviceTp A (공연/전시)만 수집 - B는 실제로 동일 데이터가 내려옴
  console.log(`[Culture] Fetching serviceTp: A (공연/전시)...`);

  let pageNo = 1;
  let consecutiveExistsCount = 0;

  while (true) {
    const items = await fetchByPeriod('A', pageNo);

    if (items.length === 0) {
      console.log(`[Culture] No more items on page ${pageNo}.`);
      break;
    }

    console.log(`[Culture] Page ${pageNo}: ${items.length} items`);
    totalCollected += items.length;

    for (const item of items) {
      // 기간이 없는 데이터 스킵
      if (!item.startDate || !item.endDate || item.startDate.length !== 8 || item.endDate.length !== 8) {
        totalSkipped++;
        continue;
      }

      // 오늘 기준: 진행중 + 예정(오늘~CULTURE_DAYS_FORWARD)만 저장
      // 변경 전: 1년 후까지, collectionPolicy.ts 로 이관
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const cultureSaveLimit = new Date(today);
      cultureSaveLimit.setDate(cultureSaveLimit.getDate() + CULTURE_DAYS_FORWARD);
      cultureSaveLimit.setHours(23, 59, 59, 999);

      const startDate = new Date(formatDate(item.startDate));
      const endDate = new Date(formatDate(item.endDate));

      // 종료된 이벤트 스킵
      if (endDate < today) {
        totalSkipped++;
        continue;
      }

      // CULTURE_DAYS_FORWARD 이후에 시작하는 이벤트는 스킵 (변경 전: 1년)
      if (startDate > cultureSaveLimit) {
        totalSkipped++;
        continue;
      }

      // 카테고리 매핑
      const category = mapRealmToCategory(item.realmName, item.serviceName || '');

      // 증분 체크: 이미 events 테이블에 있으면 상세 API 호출 스킵
      const exists = await existsInDB(item.seq);
      if (exists) {
        // 기존 이벤트 날짜 업데이트 (list 응답 기준, 추가 API 호출 없음)
        const startDateStr = formatDate(item.startDate);
        const endDateStr = formatDate(item.endDate);
        if (startDateStr && endDateStr) {
          try {
            await pool.query(
              `UPDATE raw_culture_events SET start_at = $1, end_at = $2, updated_at = NOW()
               WHERE source = 'culture' AND source_event_id = $3`,
              [startDateStr, endDateStr, item.seq],
            );
            await pool.query(
              `UPDATE canonical_events SET start_at = $1, end_at = $2, updated_at = NOW()
               WHERE canonical_key = $3`,
              [startDateStr, endDateStr, `culture:${item.seq}`],
            );
          } catch (err) {
            console.error(`[Culture] Failed to update dates for ${item.seq}:`, err);
          }
        }

        consecutiveExistsCount++;
        totalSkipped++;

        // 연속 N개가 이미 있으면 수집 중단
        if (consecutiveExistsCount >= CONSECUTIVE_EXISTS_THRESHOLD) {
          console.log(`[Culture] Found ${CONSECUTIVE_EXISTS_THRESHOLD} consecutive existing items. Stopping.`);
          break;
        }
        continue;
      }

      // 새 이벤트만 상세 API 호출 + 이미지 유효성 검사
      consecutiveExistsCount = 0;

      await new Promise((resolve) => setTimeout(resolve, 50));
      const detail = await fetchDetail(item.seq);

      const finalItem = detail || item;
      const detailItem = finalItem as CultureDetailItem;
      const region = normalizeRegion(item.area);

      // 이미지: detail의 imgUrl > thumbnail 순으로 사용, 유효성 검사 후 저장
      const imageUrl = await getValidImageUrl(detailItem.imgUrl || item.thumbnail);

      // Raw 테이블 UPSERT (신규 이벤트만)
      try {
        const isFree = parseIsFree(detailItem.price);
        const location = parseLocation(detailItem);

        await upsertRawCultureEvent({
          sourceEventId: item.seq,
          sourceUrl: detailItem.url || `https://www.culture.go.kr/search/searchPerfnexiDetailView.do?seq=${item.seq}`,
          payload: finalItem as unknown as Record<string, unknown>,
          title: item.title,
          startAt: formatDate(item.startDate),
          endAt: formatDate(item.endDate),
          venue: item.place,
          region,
          mainCategory: category,
          subCategory: item.realmName,
          imageUrl,
          isFree,
          address: location.address,
          lat: location.lat,
          lng: location.lng,
        });
        console.log(`[Culture] Raw upserted: seq=${item.seq}${isFree ? ' (무료)' : ''}${location.address ? ' (위치 포함)' : ''}`);
      } catch (error) {
        console.error(`[Culture] Failed to upsert raw: ${item.seq}`, error);
      }

      // TourAPI와 중복 체크 (제목+기간+장소)
      const duplicate = await isDuplicate(item.title, formatDate(item.startDate), formatDate(item.endDate), item.place);
      if (duplicate) {
        totalSkipped++;
        continue;
      }

      // events 테이블 저장 (새로운 이벤트만)
      try {
        const id = uuidv5(item.seq, CULTURE_NAMESPACE);
        const tags = extractTags(detailItem, category);

        await upsertEvent({
          id,
          source: 'CULTURE',
          externalId: item.seq,
          title: item.title.slice(0, 60),
          description: detailItem.contents1?.slice(0, 80) || item.title,
          overview: detailItem.contents1 || '',
          venue: item.place.slice(0, 100),
          periodText: `${formatDisplayDate(item.startDate)} ~ ${formatDisplayDate(item.endDate)}`,
          startDate: formatDate(item.startDate),
          endDate: formatDate(item.endDate),
          region,
          category,
          tags,
          thumbnailUrl: imageUrl,
          detailImageUrl: imageUrl,
          detailLink: detailItem.url || `https://www.culture.go.kr/search/searchPerfnexiDetailView.do?seq=${item.seq}`,
          updatedAt: new Date().toISOString(),
        });

        totalSaved++;
        console.log(`[Culture] Saved: ${item.title}`);
      } catch (error) {
        console.error(`[Culture] Failed to save: ${item.title}`, error);
      }
    }

    // 증분 수집 중단 조건
    if (consecutiveExistsCount >= CONSECUTIVE_EXISTS_THRESHOLD) {
      break;
    }

    // 페이지네이션
    if (items.length < 100) {
      break;
    }

    pageNo++;

    // 안전장치: 최대 50페이지
    if (pageNo > 50) {
      console.log('[Culture] Reached max pages (50). Stopping.');
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(`[Culture] Incremental collection complete!`);
  console.log(`  - Total collected: ${totalCollected}`);
  console.log(`  - Skipped (exists/duplicate/invalid): ${totalSkipped}`);
  console.log(`  - New items saved: ${totalSaved}`);
}

// Export for scheduler
export { collectCultureEvents as collectCulture };

// CLI 실행 모드
if (require.main === module) {
  collectCultureEvents()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Culture] Fatal error:', err);
      process.exit(1);
    });
}

