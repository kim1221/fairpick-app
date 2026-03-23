import { uuidv5 } from '../lib/uuidv5';
import { parseStringPromise } from 'xml2js';
import { pool, upsertEvent, upsertRawKopisEvent } from '../db';
import http from '../lib/http';
import { deriveIsFree, normalizePriceText } from '../utils/priceUtils';
import { KOPIS_DAYS_BACK, KOPIS_DAYS_FORWARD } from '../config/collectionPolicy';

// KOPIS API 설정
const KOPIS_API_BASE = 'http://www.kopis.or.kr/openApi/restful';
const KOPIS_SERVICE_KEY = 'bbef54b0049c4570b7b1f46f52b6dd8f';
// 유효한 UUID v4 형식의 네임스페이스 (고정값 - 변경 금지)
const KOPIS_NAMESPACE = 'c1d2e3f4-a5b6-47c8-89d0-e1f2a3b4c5d6';

interface KopisItem {
  mt20id: string;    // 공연 ID
  prfnm: string;     // 공연명
  prfpdfrom: string; // 시작일 (YYYY.MM.DD)
  prfpdto: string;   // 종료일 (YYYY.MM.DD)
  fcltynm: string;   // 공연장명
  poster: string;    // 포스터 URL
  area: string;      // 지역
  genrenm: string;   // 장르명
  openrun: string;   // 오픈런 여부
  prfstate: string;  // 공연상태
}

interface KopisDetailItem extends KopisItem {
  mt10id?: string;      // 공연시설 ID
  prfcast?: string;     // 출연진
  prfcrew?: string;     // 제작진
  prfruntime?: string;  // 런타임
  prfage?: string;      // 관람연령
  entrpsnmP?: string;   // 제작사
  pcseguidance?: string; // 티켓가격
  sty?: string;         // 줄거리
  dtguidance?: string;  // 공연시간
  la?: string;          // 위도
  lo?: string;          // 경도
  adres?: string;       // 주소
  relates?: Array<{     // 예매처 링크 목록
    relatenm: string;   // 예매처 이름 (예: NHN티켓링크, 인터파크)
    relateurl: string;  // 예매 URL
  }>;
}

/**
 * 날짜 포맷 변환 (YYYY.MM.DD → YYYY-MM-DD)
 */
function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  return dateStr.replace(/\./g, '-');
}

/**
 * 표시용 날짜 포맷 유지 (YYYY.MM.DD)
 */
function formatDisplayDate(dateStr: string): string {
  return dateStr || '';
}

/**
 * 이미지 URL 정규화 (http → https)
 */
function normalizeImageUrl(url?: string): string {
  const PLACEHOLDER = 'https://via.placeholder.com/600x400/E8ECF0/B0B8C1?text=No+Image';
  
  if (!url || !url.trim()) {
    return PLACEHOLDER;
  }
  
  let normalized = url.trim();
  
  // KOPIS는 http를 사용하지만, iOS 호환을 위해 https로 변환
  // (KOPIS 서버가 https도 지원하는지 확인 필요)
  if (normalized.startsWith('http://')) {
    normalized = normalized.replace('http://', 'https://');
  }
  
  return normalized;
}

/**
 * 지역명 정규화
 */
function normalizeRegion(area: string): string {
  const regionMap: Record<string, string> = {
    '서울특별시': '서울',
    '서울': '서울',
    '경기도': '경기',
    '경기': '경기',
    '인천광역시': '인천',
    '인천': '인천',
    '부산광역시': '부산',
    '부산': '부산',
    '대구광역시': '대구',
    '대구': '대구',
    '광주광역시': '광주',
    '광주': '광주',
    '대전광역시': '대전',
    '대전': '대전',
    '울산광역시': '울산',
    '울산': '울산',
    '세종특별자치시': '세종',
    '세종': '세종',
    '강원도': '강원',
    '강원특별자치도': '강원',
    '강원': '강원',
    '충청북도': '충북',
    '충북': '충북',
    '충청남도': '충남',
    '충남': '충남',
    '전라북도': '전북',
    '전북특별자치도': '전북',
    '전북': '전북',
    '전라남도': '전남',
    '전남': '전남',
    '경상북도': '경북',
    '경북': '경북',
    '경상남도': '경남',
    '경남': '경남',
    '제주특별자치도': '제주',
    '제주': '제주',
  };

  return regionMap[area] || '서울';
}

/**
 * 장르를 앱 카테고리로 매핑
 */
function mapGenreToCategory(genrenm: string): string {
  const genre = genrenm || '';
  
  // 뮤지컬, 연극, 무용은 '공연'
  if (/뮤지컬|연극|무용|오페라|발레|국악|클래식|콘서트|대중음악|서커스|복합/.test(genre)) {
    return '공연';
  }
  
  return '공연'; // KOPIS는 공연 전문이므로 기본값도 '공연'
}


/**
 * 가격 범위 추출 (price_min, price_max)
 */
function extractPriceRange(pcseguidance?: string): { priceMin: number | null; priceMax: number | null } {
  if (!pcseguidance) return { priceMin: null, priceMax: null };

  // "전석 30,000원" 또는 "R석 50,000원, S석 30,000원" 형태에서 숫자 추출
  const matches = pcseguidance.match(/(\d{1,3}(?:,\d{3})*)\s*원/g);
  
  if (!matches || matches.length === 0) {
    return { priceMin: null, priceMax: null };
  }

  const prices = matches.map(m => {
    const numStr = m.replace(/[,원\s]/g, '');
    return parseInt(numStr, 10);
  }).filter(p => !isNaN(p) && p > 0);

  if (prices.length === 0) {
    return { priceMin: null, priceMax: null };
  }

  return {
    priceMin: Math.min(...prices),
    priceMax: Math.max(...prices),
  };
}

/**
 * 위치 정보 파싱
 */
function parseLocation(item: KopisDetailItem): {
  address?: string;
  lat?: number;
  lng?: number;
} {
  const address = item.adres?.trim() || undefined;
  const lat = item.la ? parseFloat(item.la) : undefined;
  const lng = item.lo ? parseFloat(item.lo) : undefined;

  return {
    address: address || undefined,
    lat: lat && !isNaN(lat) ? lat : undefined,
    lng: lng && !isNaN(lng) ? lng : undefined,
  };
}

/**
 * 태그 추출
 */
function extractTags(item: KopisItem | KopisDetailItem, _category: string): string[] {
  const tags: string[] = [];

  // 장르 태그
  if (item.genrenm) {
    tags.push(item.genrenm);
  }

  // 오픈런 태그
  if (item.openrun === 'Y') {
    tags.push('오픈런');
  }

  // 상태 태그
  if (item.prfstate === '공연중') {
    tags.push('공연중');
  } else if (item.prfstate === '공연예정') {
    tags.push('공연예정');
  }

  // 제목에서 키워드 추출
  const title = item.prfnm || '';
  const keywords = ['크리스마스', '송년', '신년', '가족', '어린이', '뮤지컬', '콘서트', '리사이틀'];
  for (const keyword of keywords) {
    if (title.includes(keyword) && !tags.includes(keyword)) {
      tags.push(keyword);
    }
  }

  return [...new Set(tags)].slice(0, 4);
}

/**
 * DB에 해당 external_id가 존재하는지 확인 (증분 수집용)
 */
async function existsInDB(externalId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT 1 FROM events WHERE source = 'KOPIS' AND external_id = $1 LIMIT 1`,
      [externalId],
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * 공연 목록 조회
 */
async function fetchPerformanceList(stdate: string, eddate: string, cpage: number = 1, rows: number = 100): Promise<KopisItem[]> {
  try {
    const response = await http.get<string>(`${KOPIS_API_BASE}/pblprfr`, {
      params: {
        service: KOPIS_SERVICE_KEY,
        stdate,
        eddate,
        cpage,
        rows,
        // prfstate 생략 시 전체 (공연예정 + 공연중) 조회
      },
    });

    const parsed = await parseStringPromise(response);
    console.log(`[KOPIS] XML parsed successfully (fetchPerformanceList)`);
    const dbs = parsed?.dbs?.db;

    if (!dbs) {
      return [];
    }

    const items = Array.isArray(dbs) ? dbs : [dbs];
    console.log(`[KOPIS] Parsed ${items.length} items from XML`);
    
    return items.map((item: Record<string, string[]>) => ({
      mt20id: item.mt20id?.[0] || '',
      prfnm: item.prfnm?.[0] || '',
      prfpdfrom: item.prfpdfrom?.[0] || '',
      prfpdto: item.prfpdto?.[0] || '',
      fcltynm: item.fcltynm?.[0] || '',
      poster: item.poster?.[0] || '',
      area: item.area?.[0] || '',
      genrenm: item.genrenm?.[0] || '',
      openrun: item.openrun?.[0] || 'N',
      prfstate: item.prfstate?.[0] || '',
    }));
  } catch (error) {
    console.error(`[KOPIS] Failed to fetch list:`, error);
    return [];
  }
}

/**
 * 공연시설 정보 조회 (좌표 획득용)
 */
async function fetchFacilityDetail(mt10id: string): Promise<{
  la?: string;
  lo?: string;
  adres?: string;
} | null> {
  if (!mt10id) return null;
  
  try {
    const response = await http.get<string>(`${KOPIS_API_BASE}/prfplc/${mt10id}`, {
      params: {
        service: KOPIS_SERVICE_KEY,
      },
    });

    const parsed = await parseStringPromise(response);
    const db = parsed?.dbs?.db?.[0];

    if (!db) {
      return null;
    }

    return {
      la: db.la?.[0] || '',
      lo: db.lo?.[0] || '',
      adres: db.adres?.[0] || '',
    };
  } catch (error) {
    // 시설 정보 조회 실패는 치명적이지 않으므로 null 반환
    return null;
  }
}

/**
 * 공연 상세 조회
 */
export async function fetchPerformanceDetail(mt20id: string): Promise<KopisDetailItem | null> {
  try {
    const response = await http.get<string>(`${KOPIS_API_BASE}/pblprfr/${mt20id}`, {
      params: {
        service: KOPIS_SERVICE_KEY,
      },
    });

    const parsed = await parseStringPromise(response);
    const db = parsed?.dbs?.db?.[0];

    if (!db) {
      return null;
    }

    // relates 파싱 (예매처 링크)
    let relates: Array<{ relatenm: string; relateurl: string }> = [];
    if (db.relates && db.relates[0] && db.relates[0].relate) {
      const relateList = Array.isArray(db.relates[0].relate) ? db.relates[0].relate : [db.relates[0].relate];
      relates = relateList.map((relate: any) => ({
        relatenm: relate.relatenm?.[0] || '',
        relateurl: relate.relateurl?.[0] || '',
      })).filter((r: any) => r.relatenm && r.relateurl);
    }

    return {
      mt20id: db.mt20id?.[0] || mt20id,
      prfnm: db.prfnm?.[0] || '',
      prfpdfrom: db.prfpdfrom?.[0] || '',
      prfpdto: db.prfpdto?.[0] || '',
      fcltynm: db.fcltynm?.[0] || '',
      poster: db.poster?.[0] || '',
      area: db.area?.[0] || '',
      genrenm: db.genrenm?.[0] || '',
      openrun: db.openrun?.[0] || 'N',
      prfstate: db.prfstate?.[0] || '',
      mt10id: db.mt10id?.[0] || '',
      prfcast: db.prfcast?.[0] || '',
      prfcrew: db.prfcrew?.[0] || '',
      prfruntime: db.prfruntime?.[0] || '',
      prfage: db.prfage?.[0] || '',
      entrpsnmP: db.entrpsnmP?.[0] || '',
      pcseguidance: db.pcseguidance?.[0] || '',
      relates,
      sty: db.sty?.[0] || '',
      dtguidance: db.dtguidance?.[0] || '',
      la: db.la?.[0] || '',
      lo: db.lo?.[0] || '',
      adres: db.adres?.[0] || '',
    };
  } catch (error) {
    console.error(`[KOPIS] Failed to fetch detail for ${mt20id}:`, error);
    return null;
  }
}

/**
 * 메인 수집 함수 (증분 방식)
 */
async function collectKopisEvents() {
  console.log('[KOPIS] Starting incremental collection...');

  // DEV_KOPIS_FORCE_FAIL 환경변수로 강제 실패 테스트 가능 (DEV/TEST 환경에서만)
  const forceFailEnabled = process.env.DEV_KOPIS_FORCE_FAIL === 'true' && process.env.NODE_ENV !== 'production';
  if (forceFailEnabled) {
    console.warn('[KOPIS] ⚠️ DEV_KOPIS_FORCE_FAIL=true detected (NODE_ENV=' + (process.env.NODE_ENV || 'development') + ')');
    console.warn('[KOPIS] Simulating KOPIS API failure for testing error handling...');

    // HttpError 형태로 에러 생성 (http.ts의 에러 로깅 루틴을 발동시키기 위함)
    const error: any = new Error('HTTP 500: Internal Server Error');
    error.status = 500;
    error.statusText = 'Internal Server Error';
    error.type = 'HTTP_ERROR';
    error.response = '<?xml version="1.0" encoding="UTF-8"?><error><code>500</code><message>Simulated KOPIS API failure for testing</message></error>';

    console.error('[KOPIS] Simulated Error Details:');
    console.error(`  Status: ${error.status} ${error.statusText}`);
    console.error(`  Content-Type: application/xml`);
    console.error(`  Error Type: ${error.type}`);
    console.error(`  Body (first 300 chars): ${error.response.substring(0, 300)}`);

    throw error;
  }

  // 기간 정책: collectionPolicy.ts 에서 중앙 관리
  // 변경 전: PAST_BUFFER=90, FUTURE=730(2년) → 균형형: 7/120
  const PAST_BUFFER_DAYS = KOPIS_DAYS_BACK;
  const FUTURE_WINDOW_DAYS = KOPIS_DAYS_FORWARD;
  const FULL_COLLECTION = false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const pastBuffer = new Date(today);
  pastBuffer.setDate(pastBuffer.getDate() - PAST_BUFFER_DAYS);

  const futureWindow = new Date(today);
  futureWindow.setDate(futureWindow.getDate() + FUTURE_WINDOW_DAYS);

  const stdate = `${pastBuffer.getFullYear()}${String(pastBuffer.getMonth() + 1).padStart(2, '0')}${String(pastBuffer.getDate()).padStart(2, '0')}`;
  const eddate = `${futureWindow.getFullYear()}${String(futureWindow.getMonth() + 1).padStart(2, '0')}${String(futureWindow.getDate()).padStart(2, '0')}`;

  console.log(`[KOPIS] Date range: ${stdate} ~ ${eddate} (past_buffer=${PAST_BUFFER_DAYS}d, future_window=${FUTURE_WINDOW_DAYS}d)`);

  // 증분 수집: 연속 N개가 이미 있으면 중단 (fullCollection=true면 비활성화)
  const CONSECUTIVE_EXISTS_THRESHOLD = FULL_COLLECTION ? Infinity : 10;
  let consecutiveExistsCount = 0;
  let cpage = 1;
  let totalCollected = 0;
  let totalSaved = 0;
  let totalSkipped = 0;

  while (true) {
    // prfstate 없이 호출하면 전체(공연예정+공연중) 가져옴
    const items = await fetchPerformanceList(stdate, eddate, cpage, 100);

    if (items.length === 0) {
      console.log(`[KOPIS] No more items on page ${cpage}.`);
      break;
    }

    console.log(`[KOPIS] Page ${cpage}: ${items.length} items`);
    totalCollected += items.length;

    for (const item of items) {
      if (!item.mt20id) {
        totalSkipped++;
        continue;
      }

      // 증분 체크: 이미 events 테이블에 있으면 상세 API 호출 스킵
      const exists = await existsInDB(item.mt20id);
      if (exists) {
        // 기존 이벤트 날짜/상태 업데이트 (list 응답 기준, 추가 API 호출 없음)
        const startDate = formatDate(item.prfpdfrom);
        const endDate = formatDate(item.prfpdto);
        if (startDate && endDate) {
          try {
            await pool.query(
              `UPDATE raw_kopis_events SET start_at = $1, end_at = $2, updated_at = NOW()
               WHERE source = 'kopis' AND source_event_id = $3`,
              [startDate, endDate, item.mt20id],
            );
            await pool.query(
              `UPDATE canonical_events SET start_at = $1, end_at = $2, status = $3, updated_at = NOW()
               WHERE canonical_key = $4`,
              [startDate, endDate, item.prfstate || null, `kopis:${item.mt20id}`],
            );
          } catch (err) {
            console.error(`[KOPIS] Failed to update dates for ${item.mt20id}:`, err);
          }
        }

        consecutiveExistsCount++;
        totalSkipped++;

        if (consecutiveExistsCount >= CONSECUTIVE_EXISTS_THRESHOLD) {
          console.log(`[KOPIS] Found ${CONSECUTIVE_EXISTS_THRESHOLD} consecutive existing items. Stopping.`);
          break;
        }
        continue;
      }

      // 새 이벤트만 상세 API 호출
      consecutiveExistsCount = 0;

      await new Promise((resolve) => setTimeout(resolve, 50));
      const detail = await fetchPerformanceDetail(item.mt20id);
      const finalItem = detail || item;

      // 시설 정보 조회 (좌표 획득)
      let facilityInfo: { la?: string; lo?: string; adres?: string; } | null = null;
      if (detail?.mt10id) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        facilityInfo = await fetchFacilityDetail(detail.mt10id);
        if (facilityInfo) {
          (finalItem as KopisDetailItem).la = facilityInfo.la || (finalItem as KopisDetailItem).la || '';
          (finalItem as KopisDetailItem).lo = facilityInfo.lo || (finalItem as KopisDetailItem).lo || '';
          (finalItem as KopisDetailItem).adres = facilityInfo.adres || (finalItem as KopisDetailItem).adres || '';
        }
      }

      const region = normalizeRegion(finalItem.area);
      const category = mapGenreToCategory(finalItem.genrenm);
      const imageUrl = normalizeImageUrl(finalItem.poster);

      // 시작일/종료일 변환
      const startDate = formatDate(finalItem.prfpdfrom);
      const endDate = formatDate(finalItem.prfpdto);

      if (!startDate || !endDate) {
        totalSkipped++;
        continue;
      }

      // 이미 종료된 이벤트 스킵 (오늘 0시 기준)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (new Date(endDate) < today) {
        totalSkipped++;
        continue;
      }

      // Raw 테이블 UPSERT (신규 이벤트만)
      try {
        const detailItem = finalItem as KopisDetailItem;
        const isFree = deriveIsFree(normalizePriceText(detailItem.pcseguidance));
        const location = parseLocation(detailItem);

        await upsertRawKopisEvent({
          sourceEventId: item.mt20id,
          sourceUrl: `https://www.kopis.or.kr/por/db/pblprfr/pblprfrView.do?menuId=MNU_00028&mt20Id=${item.mt20id}`,
          payload: finalItem as unknown as Record<string, unknown>,
          title: finalItem.prfnm,
          startAt: startDate,
          endAt: endDate,
          venue: finalItem.fcltynm,
          region,
          mainCategory: category,
          subCategory: finalItem.genrenm,
          imageUrl,
          isFree,
          address: location.address,
          lat: location.lat,
          lng: location.lng,
        });
        const geoStatus = location.lat && location.lng ? `✅ 좌표` : '⚠️ 좌표 없음';
        console.log(`[KOPIS] Raw upserted: mt20id=${item.mt20id}${isFree ? ' (무료)' : ''} ${geoStatus}${location.address ? ` | ${location.address.substring(0, 30)}` : ''}`);
      } catch (error) {
        console.error(`[KOPIS] Failed to upsert raw: ${item.mt20id}`, error);
      }

      // events 테이블 저장 (새로운 이벤트만)
      try {
        const id = uuidv5(item.mt20id, KOPIS_NAMESPACE);
        const tags = extractTags(finalItem, category);

        // 줄거리에서 설명 추출
        const detailItem = finalItem as KopisDetailItem;
        const overview = detailItem.sty || '';
        const description = overview.slice(0, 80) || finalItem.prfnm;

        await upsertEvent({
          id,
          source: 'KOPIS',
          externalId: item.mt20id,
          title: finalItem.prfnm.slice(0, 60),
          description,
          overview,
          venue: finalItem.fcltynm.slice(0, 100),
          periodText: `${formatDisplayDate(finalItem.prfpdfrom)} ~ ${formatDisplayDate(finalItem.prfpdto)}`,
          startDate,
          endDate,
          region,
          category,
          tags,
          thumbnailUrl: imageUrl,
          detailImageUrl: imageUrl,
          detailLink: `https://www.kopis.or.kr/por/db/pblprfr/pblprfrView.do?menuId=MNU_00028&mt20Id=${item.mt20id}`,
          updatedAt: new Date().toISOString(),
        });

        totalSaved++;
        console.log(`[KOPIS] Saved: ${finalItem.prfnm}`);
      } catch (error) {
        console.error(`[KOPIS] Failed to save: ${finalItem.prfnm}`, error);
        totalSkipped++;
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

    cpage++;

    // 안전장치: 최대 50페이지 (fullCollection=true면 무제한)
    const MAX_PAGES = FULL_COLLECTION ? Infinity : 50;
    if (cpage > MAX_PAGES) {
      console.log(`[KOPIS] Reached max pages (${MAX_PAGES}). Stopping.`);
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(`[KOPIS] Incremental collection complete!`);
  console.log(`  - Total collected: ${totalCollected}`);
  console.log(`  - New items saved: ${totalSaved}`);
  console.log(`  - Skipped: ${totalSkipped}`);
}

// Export for scheduler
export { collectKopisEvents as collectKopis };

// CLI 실행 모드
if (require.main === module) {
  collectKopisEvents()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[KOPIS] Fatal error:', err);
      process.exit(1);
    });
}
